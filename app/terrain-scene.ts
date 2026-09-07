import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { peaks, type Peak } from './mountains';
import { DEFAULT_LAYERS, featureName, loadGeography, type GeoFeature, type LayerVisibility, type GeographyStatus, type PlaceEntry } from './geography';
import { paintGeography, pickGeography } from './geography-texture';
import { landscapeMaterial, landscapeSky } from './terrain-material';
import { settlementIcon } from './settlement-symbol';
import { areaFeature, type FloodPilot, type FloodResult } from './flood';
import { paintFlood } from './flood-texture';

type TerrainModel={id:string;center:[number,number];bounds:[number,number,number,number];cols:number;rows:number;widthKm:number;depthKm:number;minHeight:number;maxHeight:number;file:string};
type Callbacks={onPeak:(peak:Peak)=>void;onInteraction:()=>void;onPosition:(lng:number,lat:number,bearing:number)=>void;onError:(message:string)=>void;onFeature:(feature:PlaceEntry)=>void;onGeography:(status:GeographyStatus)=>void;onWindow:(bounds:number[])=>void;onContinuing:(loading:boolean)=>void};
type Label={el:HTMLButtonElement;position:THREE.Vector3;peak:Peak};
export class MountainScene{
  private renderer:THREE.WebGLRenderer;
  private scene=new THREE.Scene();
  private sky:ReturnType<typeof landscapeSky>|null=null;
  private shaderError=false;
  private camera=new THREE.PerspectiveCamera(42,1,.03,4000);
  private controls:OrbitControls;
  private terrain:THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>|null=null;
  private skirt:THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>|null=null;
  private manifest:Record<string,TerrainModel>|null=null;
  private model:TerrainModel|null=null;
  private heights:Uint16Array|Float32Array|null=null;
  private markerLabels:Label[]=[];
  private geographyLabels:{el:HTMLButtonElement;position:THREE.Vector3;feature:PlaceEntry}[]=[];
  private geography:GeoFeature[]=[];
  private geographyRequest=0;
  private geographyPending:Promise<void>=Promise.resolve();
  private layers:LayerVisibility={...DEFAULT_LAYERS};
  private selectedFeature:PlaceEntry|null=null;
  private floodPilot:FloodPilot|null=null;
  private floodResult:FloodResult|null=null;
  private geoCanvas=document.createElement('canvas');
  private geoTexture:THREE.CanvasTexture;
  private pointerStart:{x:number;y:number;time:number}|null=null;
  private labelLayer:HTMLDivElement;
  private request=0;
  private renderedRequest=0;
  private disposed=false;
  private frame=0;
  private heightScale=1.2;
  private natural=true;
  private showLabels=true;
  private topDown=false;
  private continuationTimer:ReturnType<typeof setTimeout>|null=null;
  private continuing=false;
  private gestureScale=1;
  private navigationMode:'pan'|'orbit'|null=null;
  private focus:[number,number]=[86.925,27.9881];
  private selectedId:string|null='everest';
  private lastReport=0;
  private sun=new THREE.DirectionalLight(0xffedcf,2.7);
  private resizeObserver:ResizeObserver;
  private flight:{start:number;duration:number;from:THREE.Vector3;to:THREE.Vector3;targetFrom:THREE.Vector3;targetTo:THREE.Vector3}|null=null;
  constructor(private host:HTMLDivElement,private callbacks:Callbacks){
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75));
    this.renderer.setClearColor(0x122430,0);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.05;
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate=false;
    this.renderer.debug.onShaderError=(gl,_program,vertex,fragment)=>{
      console.error('Landscape shader:',gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment));
      this.shaderError=true;this.host.dataset.rendered='false';
      this.callbacks.onError('The landscape material could not render. Reload to restore the terrain.');
    };
    this.geoCanvas.width=this.geoCanvas.height=window.innerWidth<760?2048:4096;
    this.geoTexture=new THREE.CanvasTexture(this.geoCanvas);this.geoTexture.colorSpace=THREE.SRGBColorSpace;this.geoTexture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
    const canvas=this.renderer.domElement;canvas.className='mountain-webgl';canvas.tabIndex=0;canvas.setAttribute('aria-label','3D Nepal landscape. Drag to pan, right-drag to orbit. Scroll or pinch to zoom. Arrow keys pan.');
    canvas.style.cssText='display:block;width:100%;height:100%;position:absolute;inset:0;touch-action:none';
    host.appendChild(canvas);
    this.labelLayer=document.createElement('div');this.labelLayer.className='three-labels';host.appendChild(this.labelLayer);
    this.controls=new OrbitControls(this.camera,canvas);
    this.controls.enableDamping=true;this.controls.dampingFactor=.08;
    this.controls.minPolarAngle=.02;this.controls.maxPolarAngle=Math.PI*.475;
    this.controls.minDistance=2;this.controls.maxDistance=1700;
    this.controls.enablePan=true;this.controls.screenSpacePanning=false;
    this.controls.rotateSpeed=.7;this.controls.zoomSpeed=.85;
    this.controls.addEventListener('start',()=>{this.flight=null;if(this.continuationTimer)clearTimeout(this.continuationTimer);callbacks.onInteraction();});
    this.controls.addEventListener('end',this.scheduleContinuation);
    this.setNavigationMode('pan');
    this.controls.listenToKeyEvents(canvas);
    this.sky=landscapeSky();this.sky.renderOrder=-100;this.scene.add(this.sky);
    this.scene.add(new THREE.HemisphereLight(0xc0d9eb,0x53543c,.95));
    this.sun.position.set(-35,50,20);this.sun.castShadow=true;
    const shadowSize=window.innerWidth<760?2048:4096;
    this.sun.shadow.mapSize.set(shadowSize,shadowSize);this.sun.shadow.bias=-.000035;this.sun.shadow.normalBias=.025;
    this.scene.add(this.sun);this.scene.add(this.sun.target);
    const fill=new THREE.DirectionalLight(0xabcdf2,.32);fill.position.set(25,15,-25);this.scene.add(fill);
    canvas.addEventListener('webglcontextlost',this.contextLost);
    canvas.addEventListener('pointerdown',this.pointerDown);canvas.addEventListener('pointerup',this.pointerUp);
    // Capture gestures on the terrain and its labels, never on the separate explorer.
    host.addEventListener('wheel',this.surfaceWheel,{passive:false,capture:true});
    host.addEventListener('gesturestart',this.gestureStart,{passive:false});
    host.addEventListener('gesturechange',this.gestureChange,{passive:false});
    host.addEventListener('gestureend',this.gestureEnd,{passive:false});
    canvas.addEventListener('keyup',this.scheduleContinuation);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();
    this.render();
  }
  private contextLost=(event:Event)=>{event.preventDefault();this.callbacks.onError('The 3D graphics context was interrupted. Reload to restore the mountains.');};
  private async getManifest(){
    if(this.manifest)return this.manifest;
    const response=await fetch('/terrain/manifest.json');if(!response.ok)throw new Error('The terrain catalogue could not be loaded.');
    this.manifest=await response.json();return this.manifest!;
  }
  async load(id:string,focus:[number,number],selectedId:string|null=null,preserveView=false){
    const token=++this.request;const manifest=await this.getManifest();const model=manifest[id];
    if(!model)throw new Error('This mountain model is unavailable.');
    const response=await fetch(model.file);if(!response.ok)throw new Error('The elevation model could not be loaded. Please retry.');
    const buffer=await response.arrayBuffer();
    if(this.disposed||token!==this.request)return false;
    if(buffer.byteLength!==model.cols*model.rows*2)throw new Error('The elevation model is incomplete. Please retry.');
    const offset=preserveView?this.camera.position.clone().sub(this.controls.target):null;
    const feature=preserveView?this.selectedFeature:null;
    this.model=model;this.heights=new Uint16Array(buffer);
    // Keep smaller devices responsive while sampling the same source grid.
    if(window.innerWidth<760&&model.cols>513&&model.id!=='nepal'){
      const cols=(model.cols-1)/2+1,rows=(model.rows-1)/2+1,heights=new Uint16Array(cols*rows);
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)heights[r*cols+c]=this.heights[r*2*model.cols+c*2];
      this.model={...model,cols,rows};this.heights=heights;
    }
    this.focus=focus;this.selectedId=selectedId;
    this.geography=[];this.selectedFeature=null;this.paintLayers();
    this.flight=null;this.removeMesh();this.buildMesh();this.buildLabels();this.frameModel(!preserveView);
    if(offset){this.flight=null;this.camera.position.copy(this.controls.target).add(offset);this.controls.update();this.selectedFeature=feature;}
    this.renderedRequest=token;
    this.callbacks.onWindow([...model.bounds]);
    this.renderer.render(this.scene,this.camera);
    this.host.dataset.renderer='threejs';this.host.dataset.model=id;this.host.dataset.vertices=String(this.model.cols*this.model.rows);this.host.dataset.rendered=String(!this.shaderError);
    this.callbacks.onPosition(focus[0],focus[1],this.getBearing());this.geographyPending=this.refreshGeography();return true;
  }
  private removeMesh(){for(const mesh of [this.terrain,this.skirt])if(mesh){this.scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}this.terrain=null;this.skirt=null;}
  private buildMesh(){
    const m=this.model!,heights=this.heights!;const positions=new Float32Array(m.cols*m.rows*3);const indices=new Uint32Array((m.cols-1)*(m.rows-1)*6);
    for(let row=0;row<m.rows;row++)for(let col=0;col<m.cols;col++){
      const i=row*m.cols+col;positions[i*3]=(col/(m.cols-1)-.5)*m.widthKm;positions[i*3+1]=heights[i]/1000*this.heightScale;positions[i*3+2]=(row/(m.rows-1)-.5)*m.depthKm;
    }
    let k=0;for(let row=0;row<m.rows-1;row++)for(let col=0;col<m.cols-1;col++){const a=row*m.cols+col,b=a+1,c=a+m.cols,d=c+1;indices.set([a,c,b,b,c,d],k);k+=6;}
    const uv=new Float32Array(m.cols*m.rows*2);for(let row=0;row<m.rows;row++)for(let col=0;col<m.cols;col++){const i=(row*m.cols+col)*2;uv[i]=col/(m.cols-1);uv[i+1]=1-row/(m.rows-1);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeVertexNormals();
    const material=landscapeMaterial(this.geoTexture,new THREE.Vector2(m.center[0]*98,-m.center[1]*111.32));
    this.terrain=new THREE.Mesh(geometry,material);this.terrain.receiveShadow=true;this.terrain.castShadow=m.id!=='nepal';this.scene.add(this.terrain);this.colorMesh();
    const edge:number[]=[];for(let c=0;c<m.cols;c++)edge.push(c);for(let r=1;r<m.rows;r++)edge.push(r*m.cols+m.cols-1);for(let c=m.cols-2;c>=0;c--)edge.push((m.rows-1)*m.cols+c);for(let r=m.rows-2;r>0;r--)edge.push(r*m.cols);
    const skirtVertices:number[]=[];const base=Math.max(-1,m.minHeight/1000-1.3);
    for(let i=0;i<edge.length;i++){const a=edge[i]*3,b=edge[(i+1)%edge.length]*3;const ax=positions[a],ay=positions[a+1],az=positions[a+2],bx=positions[b],by=positions[b+1],bz=positions[b+2];skirtVertices.push(ax,ay,az,bx,by,bz,ax,base,az,bx,by,bz,bx,base,bz,ax,base,az);}
    const skirtGeometry=new THREE.BufferGeometry();skirtGeometry.setAttribute('position',new THREE.Float32BufferAttribute(skirtVertices,3));skirtGeometry.computeVertexNormals();
    this.skirt=new THREE.Mesh(skirtGeometry,new THREE.MeshStandardMaterial({color:0x253e49,roughness:1,side:THREE.DoubleSide}));this.scene.add(this.skirt);
    const size=Math.max(m.widthKm,m.depthKm);const shadow=this.sun.shadow.camera;shadow.left=-size*.64;shadow.right=size*.64;shadow.top=size*.64;shadow.bottom=-size*.64;shadow.near=.1;shadow.far=size*4;shadow.updateProjectionMatrix();this.sun.position.set(-size*.65,size*.75,size*.4);
    this.renderer.shadowMap.needsUpdate=true;
    this.scene.fog=new THREE.Fog(0xb9ccd2,size*(m.id==='nepal'?5:.48),size*(m.id==='nepal'?10:1.8));
  }
  private colorMesh(){
    if(!this.terrain||!this.heights||!this.model)return;
    const normal=this.terrain.geometry.getAttribute('normal');const colors=new Float32Array(this.heights.length*3);const color=new THREE.Color();
    const greens=new THREE.Color('#425d3f'),earth=new THREE.Color('#8b876b'),rock=new THREE.Color('#737780'),snow=new THREE.Color('#eff5f6');
    for(let i=0;i<this.heights.length;i++){
      const h=this.heights[i],ny=normal.getY(i);
      if(this.natural){
        if(h<3100)color.copy(greens).lerp(earth,THREE.MathUtils.smoothstep(h,1300,3400));
        else color.copy(earth).lerp(rock,THREE.MathUtils.smoothstep(h,3100,4800));
        const row=Math.floor(i/this.model.cols),col=i%this.model.cols;
        const lng=this.model.bounds[0]+col/(this.model.cols-1)*(this.model.bounds[2]-this.model.bounds[0]);
        const lat=this.model.bounds[3]-row/(this.model.rows-1)*(this.model.bounds[3]-this.model.bounds[1]);
        const snowline=4850+Math.sin(lng*85+Math.sin(lat*110))*150;
        const snowCover=THREE.MathUtils.smoothstep(h,snowline,snowline+1050)*THREE.MathUtils.smoothstep(ny,.37,.86);
        color.lerp(snow,Math.max(snowCover,THREE.MathUtils.smoothstep(h,6800,7800)*.58));
        // A small local valley shading term adds depth without altering heights.
        if(row>0&&row<this.model.rows-1&&col>0&&col<this.model.cols-1){
          const surrounding=(this.heights[i-1]+this.heights[i+1]+this.heights[i-this.model.cols]+this.heights[i+this.model.cols])/4;
          color.multiplyScalar(1-THREE.MathUtils.clamp((surrounding-h)/140,0,.18));
        }
      }else{color.setHSL(.58-THREE.MathUtils.clamp(h/8850,0,1)*.49,.4,.27+h/8850*.46);}
      colors[i*3]=color.r;colors[i*3+1]=color.g;colors[i*3+2]=color.b;
    }
    this.terrain.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  }
  private sampleHeight(lng:number,lat:number){
    const m=this.model!,h=this.heights!;const [w,s,e,n]=m.bounds;const x=THREE.MathUtils.clamp((lng-w)/(e-w)*(m.cols-1),0,m.cols-1),y=THREE.MathUtils.clamp((n-lat)/(n-s)*(m.rows-1),0,m.rows-1);
    const ix=Math.min(m.cols-2,Math.floor(x)),iy=Math.min(m.rows-2,Math.floor(y)),fx=x-ix,fy=y-iy,a=h[iy*m.cols+ix],b=h[iy*m.cols+ix+1],c=h[(iy+1)*m.cols+ix],d=h[(iy+1)*m.cols+ix+1];
    return (fx+fy<=1?a+(b-a)*fx+(c-a)*fy:d+(c-d)*(1-fx)+(b-d)*(1-fy))/1000*this.heightScale;
  }
  private world(lng:number,lat:number){const m=this.model!;return new THREE.Vector3((lng-m.center[0])/(m.bounds[2]-m.bounds[0])*m.widthKm,this.sampleHeight(lng,lat),(m.center[1]-lat)/(m.bounds[3]-m.bounds[1])*m.depthKm);}
  private frameModel(animate=false){
    const m=this.model!;const target=this.world(...this.focus);const size=Math.max(m.widthKm,m.depthKm);
    const isOverview=m.id==='nepal';let distance=isOverview?Math.max(m.widthKm/Math.max(.35,this.camera.aspect),m.depthKm)*1.6:size*.54;
    if(!isOverview&&this.camera.aspect<.8)distance*=1.35;
    if(!this.topDown&&!isOverview)target.y*=.7;
    const direction=this.topDown?new THREE.Vector3(0,1,.001):new THREE.Vector3(.16,.39,.93).normalize();
    this.camera.position.copy(target).addScaledVector(direction,distance);
    if(m.id==='range-annapurna'&&!this.topDown){
      target.y=2.7;this.camera.position.copy(this.world(84.14,27.99));this.camera.position.y=14.5;
      if(this.camera.aspect<.8)this.camera.position.sub(target).multiplyScalar(1.35).add(target);
    }
    this.controls.target.copy(target);
    this.camera.near=.03;this.camera.far=Math.max(500,size*6);this.camera.updateProjectionMatrix();
    this.controls.minDistance=isOverview?20:3;this.controls.maxDistance=size*4;this.controls.maxTargetRadius=size*.45;this.controls.cursor.copy(target);
    this.controls.update();
    if(animate&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      const to=this.camera.position.clone();const from=to.clone().sub(target).multiplyScalar(1.15).applyAxisAngle(new THREE.Vector3(0,1,0),-.18).add(target);
      this.camera.position.copy(from);this.flight={start:performance.now(),duration:1400,from,to,targetFrom:target.clone(),targetTo:target.clone()};
    }
  }
  private buildLabels(){
    this.labelLayer.replaceChildren();this.markerLabels=[];this.geographyLabels=[];const m=this.model!;
    for(const p of peaks){
      const [lng,lat]=p.coords,[w,s,e,n]=m.bounds;if(lng<w||lng>e||lat<s||lat>n||m.id==='nepal'&&p.height<8000)continue;
      const el=document.createElement('button');el.className='three-peak'+(p.id===this.selectedId?' selected':'');el.setAttribute('aria-label','Explore '+p.name);el.title=p.name+' · '+p.height.toLocaleString()+' m';
      const name=document.createElement('span');name.textContent=p.name;const height=document.createElement('small');height.textContent=p.height.toLocaleString()+' m';el.appendChild(name);el.appendChild(height);
      el.onclick=()=>this.callbacks.onPeak(p);this.labelLayer.appendChild(el);const position=this.world(lng,lat);position.y+=m.id==='nepal'?1:.38;this.markerLabels.push({el,position,peak:p});
    }
    this.buildGeographyLabels();
  }
  private updateLabels(){
    const width=this.host.clientWidth,height=this.host.clientHeight;const view=new THREE.Vector3();
    const occupied:{x:number;y:number}[]=[];
    for(const label of this.markerLabels){
      view.copy(label.position).project(this.camera);const x=(view.x*.5+.5)*width,y=(-view.y*.5+.5)*height;
      const visible=this.showLabels&&view.z<1&&view.z>-1&&x>50&&x<width-75&&y>120&&y<height-125&&!occupied.some(p=>Math.abs(p.x-x)<125&&Math.abs(p.y-y)<65);
      label.el.style.display=visible?'':'none';if(visible){label.el.style.transform=`translate(-50%,-100%) translate(${x}px,${y-25}px)`;occupied.push({x,y});}
    }
    const distance=this.camera.position.distanceTo(this.controls.target),limit=distance>45?9:distance>22?16:28;
    let visibleCount=0;
    for(const label of this.geographyLabels){
      view.copy(label.position).project(this.camera);const x=(view.x*.5+.5)*width,y=(-view.y*.5+.5)*height;
      const selected=label.feature.id===this.selectedFeature?.id;
      const visible=this.layers[label.feature.layer]&&(this.showLabels||selected)&&view.z<1&&view.z>-1&&x>45&&x<width-80&&y>140&&y<height-150&&(selected||visibleCount<limit&&!occupied.some(p=>Math.abs(p.x-x)<145&&Math.abs(p.y-y)<55));
      label.el.style.display=visible?'':'none';if(visible){label.el.style.transform=`translate(-50%,-100%) translate(${x}px,${y-10}px)`;occupied.push({x,y});visibleCount++;}
    }
  }
  private paintLayers(){if(!this.model)return;paintGeography(this.geoCanvas,this.geography,this.model.bounds,this.layers,this.selectedFeature);if(this.floodPilot)paintFlood(this.geoCanvas,this.floodPilot,this.floodResult,this.model.bounds,this.selectedFeature?.id??null);this.geoTexture.needsUpdate=true;this.host.dataset.layers=Object.entries(this.layers).filter(([,v])=>v).map(([k])=>k).join(',');}
  setFloodOverlay(pilot:FloodPilot|null,result:FloodResult|null){
    this.floodPilot=pilot;this.floodResult=result;
    if(pilot?.runtime&&this.model?.id!==pilot.id)this.showAssessmentTerrain(pilot);
    this.paintLayers();
  }
  private showAssessmentTerrain(pilot:FloodPilot){
    const source=pilot.runtime!.elevations,[w,s,e,n]=pilot.bounds,dx=(e-w)/pilot.cols,dy=(n-s)/pilot.rows;
    const bounds:[number,number,number,number]=[w+dx/2,s+dy/2,e-dx/2,n-dy/2],center:[number,number]=[(w+e)/2,(s+n)/2];
    // Rendering may thin vertices on a small screen. The analysis arrays and
    // exposure masks always retain every native cell at their original heights.
    const step=window.innerWidth<760?2:1,columns=Array.from({length:Math.ceil((pilot.cols-1)/step)+1},(_,i)=>Math.min(pilot.cols-1,i*step)),rowIds=Array.from({length:Math.ceil((pilot.rows-1)/step)+1},(_,i)=>Math.min(pilot.rows-1,i*step));
    // Resample at evenly spaced model vertices, including both end centres.
    const heights=new Float32Array(columns.length*rowIds.length);let min=Infinity,max=-Infinity;
    for(const h of source)if(Number.isFinite(h)){min=Math.min(min,h);max=Math.max(max,h);}
    for(let r=0;r<rowIds.length;r++)for(let c=0;c<columns.length;c++){const y=Math.round(r/(rowIds.length-1)*(pilot.rows-1)),x=Math.round(c/(columns.length-1)*(pilot.cols-1)),h=source[y*pilot.cols+x];heights[r*columns.length+c]=Number.isFinite(h)?h:min;}
    const token=++this.request;this.renderedRequest=token;
    this.model={id:pilot.id,center,bounds,cols:columns.length,rows:rowIds.length,widthKm:(bounds[2]-bounds[0])*111.32*Math.cos(center[1]*Math.PI/180),depthKm:(bounds[3]-bounds[1])*111.32,minHeight:min,maxHeight:max,file:''};
    this.heights=heights;this.focus=pilot.center;this.selectedId=null;this.geography=[];this.flight=null;
    this.removeMesh();this.buildMesh();this.buildLabels();this.frameModel();this.callbacks.onWindow([...bounds]);
    this.host.dataset.model=pilot.id;this.host.dataset.vertices=String(heights.length);this.geographyPending=this.refreshGeography();
  }
  async refreshGeography(){
    if(!this.model)return;const token=++this.geographyRequest,model=this.model;
    this.callbacks.onGeography({loading:true,error:'',counts:{rivers:0,lakes:0,settlements:0},overview:model.id==='nepal'});
    try{
      const {features,warning}=await loadGeography(model.bounds,model.id==='nepal');if(this.disposed||token!==this.geographyRequest||model!==this.model)return;
      this.geography=features;this.paintLayers();this.buildGeographyLabels();
      const counts={rivers:0,lakes:0,settlements:0};features.forEach(f=>counts[f.layer]++);
      this.host.dataset.geographyFeatures=String(features.length);this.callbacks.onGeography({loading:false,error:warning,counts,overview:model.id==='nepal'});
    }catch(error){if(!this.disposed&&token===this.geographyRequest)this.callbacks.onGeography({loading:false,error:error instanceof Error?error.message:'Mapped layers unavailable.',counts:{rivers:0,lakes:0,settlements:0},overview:model.id==='nepal'});}
  }
  private buildGeographyLabels(){
    this.geographyLabels.forEach(l=>l.el.remove());this.geographyLabels=[];if(!this.model)return;
    const [w,s,e,n]=this.model.bounds,seen=new Set<string>();
    const priority=(f:PlaceEntry)=>f.id===this.selectedFeature?.id?100:['Phewa Lake','Seti Gandaki River','Pokhara'].includes(f.name??'')?95:f.kind==='city'?90:f.kind==='lake'?80:f.kind==='river'?70:f.kind==='town'?60:30;
    const entries:PlaceEntry[]=[...this.geography];if(this.selectedFeature&&!entries.some(f=>f.id===this.selectedFeature?.id))entries.push(this.selectedFeature);
    const candidates=entries.filter(f=>(f.name||f.id===this.selectedFeature?.id)&&f.kind!=='residential'&&f.center[0]>=w&&f.center[0]<=e&&f.center[1]>=s&&f.center[1]<=n).sort((a,b)=>priority(b)-priority(a)||(b.areaKm2??0)-(a.areaKm2??0));
    for(const f of candidates){
      if(this.geographyLabels.length>=65)break;const key=f.layer+f.name;if(seen.has(key))continue;seen.add(key);
      const el=document.createElement('button');el.className=`three-place ${f.layer}${f.id===this.selectedFeature?.id?' selected':''}`;el.setAttribute('aria-label','Inspect '+featureName(f));
      if(f.layer==='settlements'){const badge=document.createElement('span');badge.className='settlement-marker';badge.appendChild(settlementIcon());el.appendChild(badge);el.title=featureName(f)+' · '+f.kind+' (settlement marker)';}
      const name=document.createElement('span');name.className='place-name';name.textContent=featureName(f);el.appendChild(name);
      el.onclick=()=>{this.selectGeography(f);this.callbacks.onFeature(f);};this.labelLayer.appendChild(el);const position=this.world(...f.center);position.y+=this.model.id==='nepal'?1.2:.1;this.geographyLabels.push({el,position,feature:f});
    }
  }
  private pointerDown=(event:PointerEvent)=>{this.renderer.domElement.focus({preventScroll:true});this.pointerStart=event.button===0&&event.isPrimary?{x:event.clientX,y:event.clientY,time:performance.now()}:null;};
  private pointerUp=(event:PointerEvent)=>{
    const start=this.pointerStart;this.pointerStart=null;if(!start||!this.terrain||!this.model||performance.now()-start.time>500||Math.hypot(event.clientX-start.x,event.clientY-start.y)>5)return;
    const rect=this.renderer.domElement.getBoundingClientRect(),pointer=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(pointer,this.camera);
    const hit=ray.intersectObject(this.terrain)[0];if(!hit)return;const m=this.model,coord:[number,number]=[m.center[0]+hit.point.x/m.widthKm*(m.bounds[2]-m.bounds[0]),m.center[1]-hit.point.z/m.depthKm*(m.bounds[3]-m.bounds[1])];
    const tolerance=hit.distance*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*16/rect.height/m.widthKm*(m.bounds[2]-m.bounds[0]);
    const f=(this.floodPilot?pickGeography(this.floodPilot.areas.map(areaFeature),coord,tolerance,{rivers:true,lakes:true,settlements:true}):null)??pickGeography(this.geography,coord,tolerance,this.layers);if(f){const feature=f.layer==='rivers'?{...f,center:coord}:f;this.selectGeography(feature);this.callbacks.onFeature(feature);}
  };
  selectGeography(feature:PlaceEntry|null){this.selectedFeature=feature;this.paintLayers();this.buildGeographyLabels();}
  async focusGeography(feature:PlaceEntry){
    const [lng,lat]=feature.center;const key=`area-${Math.floor(lng*2)}-${Math.floor(lat*2)}`;
    const m=this.model,inside=!!this.floodPilot?.areas.some(area=>area.id===feature.id)||(m&&m.id!=='nepal'&&this.request===this.renderedRequest&&feature.bounds[0]>=m.bounds[0]&&feature.bounds[1]>=m.bounds[1]&&feature.bounds[2]<=m.bounds[2]&&feature.bounds[3]<=m.bounds[3]);
    if(!inside){const loaded=await this.load(key,feature.center);if(!loaded)return false;}
    const token=this.request;await this.geographyPending;if(this.disposed||token!==this.request)return false;
    this.focus=feature.center;this.selectedId=null;this.controls.target.copy(this.world(lng,lat));this.controls.cursor.copy(this.controls.target);this.selectGeography(feature);
    const size=Math.max((feature.bounds[2]-feature.bounds[0])*98,(feature.bounds[3]-feature.bounds[1])*111);
    const distance=Math.min(50,Math.max(feature.kind==='residential'?2.8:feature.layer==='settlements'?14:10,size*2.7))*(this.camera.aspect<.8?1.5:1);
    const target=this.controls.target.clone(),from=this.camera.position.clone();
    const to=target.clone().addScaledVector(this.topDown?new THREE.Vector3(0,1,.001):new THREE.Vector3(.12,.55,.85).normalize(),distance);
    this.flight=null;this.camera.position.copy(to);this.controls.update();
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){this.camera.position.copy(from);this.flight={start:performance.now(),duration:1100,from,to,targetFrom:target.clone(),targetTo:target.clone()};}
    return true;
  }
  captureView(){
    if(!this.model||this.disposed||this.shaderError)throw new Error('Wait for the landscape to finish loading.');
    if(this.flight){this.camera.position.copy(this.flight.to);this.controls.target.copy(this.flight.targetTo);this.flight=null;}
    this.controls.update();
    if(this.sky){this.sky.position.copy(this.camera.position);this.sky.scale.setScalar(this.camera.far*.85);}
    // Draw and copy synchronously before WebGL clears its buffer. No continuous preserveDrawingBuffer cost.
    this.renderer.render(this.scene,this.camera);
    const capture=document.createElement('canvas');capture.width=this.renderer.domElement.width;capture.height=this.renderer.domElement.height;
    const ctx=capture.getContext('2d');if(!ctx)throw new Error('Canvas export is unavailable.');
    ctx.fillStyle='#7995a1';ctx.fillRect(0,0,capture.width,capture.height);ctx.drawImage(this.renderer.domElement,0,0);
    return capture;
  }
  setLayers(layers:LayerVisibility){this.layers={...layers};this.paintLayers();this.buildGeographyLabels();}
  private render=()=>{
    if(this.disposed)return;this.frame=requestAnimationFrame(this.render);
    const now=performance.now();if(this.flight){const t=Math.min(1,(now-this.flight.start)/this.flight.duration),e=t*t*(3-2*t);this.camera.position.lerpVectors(this.flight.from,this.flight.to,e);this.controls.target.lerpVectors(this.flight.targetFrom,this.flight.targetTo,e);if(t===1)this.flight=null;}
    this.controls.update();if(this.sky){this.sky.position.copy(this.camera.position);this.sky.scale.setScalar(this.camera.far*.85);}this.renderer.render(this.scene,this.camera);this.updateLabels();
    if(this.model&&now-this.lastReport>800){const m=this.model;const lng=m.center[0]+this.controls.target.x/m.widthKm*(m.bounds[2]-m.bounds[0]),lat=m.center[1]-this.controls.target.z/m.depthKm*(m.bounds[3]-m.bounds[1]);this.callbacks.onPosition(lng,lat,this.getBearing());this.lastReport=now;}
  };
  resize(){const width=this.host.clientWidth,height=this.host.clientHeight;if(width<1||height<1)return;this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height,false);}
  getBearing(){const offset=this.camera.position.clone().sub(this.controls.target);return THREE.MathUtils.radToDeg(Math.atan2(offset.x,offset.z));}
  getCoordinates(){if(!this.model)return this.focus;const m=this.model;return [m.center[0]+this.controls.target.x/m.widthKm*(m.bounds[2]-m.bounds[0]),m.center[1]-this.controls.target.z/m.depthKm*(m.bounds[3]-m.bounds[1])] as [number,number];}
  setNavigationMode(mode:'pan'|'orbit'){
    if(this.navigationMode===mode)return;
    if(this.navigationMode!==null){
      this.flight=null;this.pointerStart=null;
      if(this.continuationTimer){clearTimeout(this.continuationTimer);this.continuationTimer=null;}
      // Flush the old gesture's damping through the public controls API, then
      // restore this exact pose. A mode change must never move the landscape.
      const position=this.camera.position.clone(),target=this.controls.target.clone();
      const damping=this.controls.enableDamping;
      this.controls.saveState();this.controls.enableDamping=false;this.controls.reset();
      this.camera.position.copy(position);this.controls.target.copy(target);
      this.controls.enableDamping=damping;this.controls.update();this.callbacks.onInteraction();
    }
    this.navigationMode=mode;
    this.controls.mouseButtons.LEFT=mode==='pan'?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT=mode==='pan'?THREE.MOUSE.ROTATE:THREE.MOUSE.PAN;
    this.controls.touches.ONE=mode==='pan'?THREE.TOUCH.PAN:THREE.TOUCH.ROTATE;
    this.controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
    this.host.dataset.navigation=mode;this.controls.cursorStyle=mode==='pan'?'grab':'auto';this.renderer.domElement.style.cursor=mode==='pan'?'grab':'all-scroll';
    this.renderer.domElement.setAttribute('aria-label',`3D Nepal landscape. Drag to ${mode}. P selects pan; O selects orbit. Shift-drag uses the other mode. Scroll or pinch to zoom. Arrow keys pan.`);
  }
  private surfaceWheel=(event:WheelEvent)=>{
    event.preventDefault();event.stopPropagation();this.callbacks.onInteraction();
    const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?this.host.clientHeight:1);
    this.zoom(Math.exp(THREE.MathUtils.clamp(delta*(event.ctrlKey ? .012 : .0018),-.45,.45)));
  };
  private gestureStart=(event:Event)=>{event.preventDefault();this.gestureScale=1;this.callbacks.onInteraction();};
  private gestureChange=(event:Event)=>{event.preventDefault();const scale=(event as Event&{scale:number}).scale;if(Number.isFinite(scale)&&scale>0){this.zoom(this.gestureScale/scale);this.gestureScale=scale;}};
  private gestureEnd=(event:Event)=>{event.preventDefault();this.gestureScale=1;};
  private scheduleContinuation=()=>{if(this.continuationTimer)clearTimeout(this.continuationTimer);this.continuationTimer=setTimeout(()=>{void this.continueLandscape();},350);};
  private async continueLandscape(){
    const m=this.model;if(!m||m.id==='nepal'||this.floodPilot||this.continuing||this.disposed||this.request!==this.renderedRequest)return;
    const coord=this.getCoordinates();
    const nearEdge=Math.abs(coord[0]-m.center[0])>(m.bounds[2]-m.bounds[0])*.26||Math.abs(coord[1]-m.center[1])>(m.bounds[3]-m.bounds[1])*.26;
    const id=`area-${Math.floor(coord[0]*2)}-${Math.floor(coord[1]*2)}`;
    if(!nearEdge||id===m.id||!this.manifest?.[id])return;
    this.continuing=true;this.callbacks.onContinuing(true);
    try{await this.load(id,coord,this.selectedId,true);}catch{if(!this.disposed)this.callbacks.onError('The adjoining terrain could not load. Choose a range or reload to try again.');}
    finally{this.continuing=false;if(!this.disposed)this.callbacks.onContinuing(false);}
  }
  pan(direction:'north'|'south'|'east'|'west'){
    if(!this.model||this.continuing)return;
    this.flight=null;this.callbacks.onInteraction();
    const distance=this.camera.position.distanceTo(this.controls.target)*.18;
    const shift=new THREE.Vector3(direction==='east'?distance:direction==='west'?-distance:0,0,direction==='south'?distance:direction==='north'?-distance:0);
    this.controls.target.add(shift);this.camera.position.add(shift);this.controls.update();this.scheduleContinuation();
  }
  zoom(factor:number){this.callbacks.onInteraction();this.flight=null;this.camera.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target);this.controls.update();this.host.dataset.cameraDistance=this.camera.position.distanceTo(this.controls.target).toFixed(3);}
  rotate(degrees:number){this.callbacks.onInteraction();this.flight=null;const offset=this.camera.position.clone().sub(this.controls.target);offset.applyAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(degrees));this.camera.position.copy(this.controls.target).add(offset);this.controls.update();}
  resetNorth(){this.rotate(-this.getBearing());}
  setTopDown(value:boolean){this.topDown=value;if(this.model)this.frameModel();}
  setExaggeration(value:number){this.heightScale=value;if(this.model){this.removeMesh();this.buildMesh();this.buildLabels();this.frameModel();}}
  setSurface(natural:boolean){this.natural=natural;this.colorMesh();}
  setLabels(show:boolean){this.showLabels=show;}
  isReady(){return !!this.terrain&&!this.disposed&&!this.shaderError;}
  dispose(){this.disposed=true;this.request++;this.geographyRequest++;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();if(this.continuationTimer)clearTimeout(this.continuationTimer);this.host.removeEventListener('wheel',this.surfaceWheel,true);this.host.removeEventListener('gesturestart',this.gestureStart);this.host.removeEventListener('gesturechange',this.gestureChange);this.host.removeEventListener('gestureend',this.gestureEnd);this.renderer.domElement.removeEventListener('keyup',this.scheduleContinuation);this.controls.dispose();this.removeMesh();this.geoTexture.dispose();this.sky?.geometry.dispose();this.sky?.material.dispose();this.sun.shadow.map?.dispose();this.renderer.domElement.removeEventListener('webglcontextlost',this.contextLost);this.renderer.domElement.removeEventListener('pointerdown',this.pointerDown);this.renderer.domElement.removeEventListener('pointerup',this.pointerUp);this.renderer.dispose();this.renderer.domElement.remove();this.labelLayer.remove();}
}
