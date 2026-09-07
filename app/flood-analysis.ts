import proj4 from 'proj4';
import { union, difference, intersection, type MultiPolygon, type Pair } from 'polygon-clipping';
import type { GeoFeature, PlaceEntry } from './geography';
import type { ElevationGrid } from './flood-elevation';
import type { FloodPilot, FloodArea, FloodScenario } from './flood';

type AreaGeometry=Extract<GeoFeature['geometry'],{type:'Polygon'|'MultiPolygon'}>;
const polygons=(geometry:AreaGeometry):MultiPolygon=>geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
const geometry=(coordinates:MultiPolygon):AreaGeometry=>({type:'MultiPolygon',coordinates});
const rectangle=(w:number,s:number,e:number,n:number):MultiPolygon=>[[[[w,s],[e,s],[e,n],[w,n],[w,s]]]];
export function projection(center:Pair){const zone=Math.floor((center[0]+180)/6)+1;const converter=proj4('EPSG:4326',`+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);return {forward:(p:Pair)=>converter.forward(p) as Pair,inverse:(p:Pair)=>converter.inverse(p) as Pair,zone};}
function median(values:number[]){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];}
export function monotoneProfile(values:number[],increasing=false){
  const blocks:{sum:number;count:number}[]=[];const sign=increasing?1:-1;
  for(const value of values){blocks.push({sum:value*sign,count:1});while(blocks.length>1){const a=blocks.at(-2)!,b=blocks.at(-1)!;if(a.sum/a.count<=b.sum/b.count)break;blocks.splice(-2,2,{sum:a.sum+b.sum,count:a.count+b.count});}}
  return blocks.flatMap(block=>Array(block.count).fill(sign*block.sum/block.count)) as number[];
}
function ringArea(ring:Pair[],project:(p:Pair)=>Pair){let result=0;const points=ring.map(project);for(let i=0,j=points.length-1;i<points.length;j=i++)result+=points[j][0]*points[i][1]-points[i][0]*points[j][1];return Math.abs(result)/2;}
export function polygonArea(polys:MultiPolygon,project:(p:Pair)=>Pair){return polys.reduce((sum,poly)=>sum+Math.max(0,ringArea(poly[0],project)-poly.slice(1).reduce((v,ring)=>v+ringArea(ring,project),0)),0);}
function boundsOf(points:Pair[]):[number,number,number,number]{const b:[number,number,number,number]=[Infinity,Infinity,-Infinity,-Infinity];for(const p of points){b[0]=Math.min(b[0],p[0]);b[1]=Math.min(b[1],p[1]);b[2]=Math.max(b[2],p[0]);b[3]=Math.max(b[3],p[1]);}return b;}

export type Reach={coordinates:Pair[];sourceIds:string[];lengthM:number;bounds:[number,number,number,number];center:Pair;next:Pair|null;previous:Pair|null;nextId?:string;previousId?:string;notes:string[]};
export function selectReach(selected:PlaceEntry,features:GeoFeature[],lengthKm:number):Reach{
  if(![6,12,20].includes(lengthKm))throw new Error('Choose a 6, 12 or 20 km reach.');
  const source=features.find(f=>f.id===selected.id&&f.geometry.type==='LineString'&&['river','stream'].includes(f.kind));
  if(!source||source.geometry.type!=='LineString')throw new Error('Select a mapped river or stream centreline. Water-area polygons and artificial drains are not assessment reaches.');
  const project=projection(selected.center),lines=features.filter(f=>f.geometry.type==='LineString'&&f.kind===source.kind);
  const used=new Set([source.id]);let coords=[...source.geometry.coordinates];const notes:string[]=[];
  const key=(p:Pair)=>p.map(v=>v.toFixed(7)).join(',');
  const length=(points:Pair[])=>points.reduce((sum,p,i)=>i?sum+Math.hypot(...subtract(project.forward(p),project.forward(points[i-1]))):0,0);
  // Extend only through an unambiguous, exactly shared endpoint. Never select
  // a tributary by geographic proximity or silently merge named branches.
  for(const front of [false,true]){let added=0;for(let step=0;step<120&&added<lengthKm*1000;step++){
    const endpoint=front?coords[0]:coords.at(-1)!;
    const candidates=lines.filter(f=>!used.has(f.id)&&f.geometry.type==='LineString'&&(!source.name||!f.name||f.name===source.name)&&[f.geometry.coordinates[0],f.geometry.coordinates.at(-1)!].some(p=>key(p)===key(endpoint)));
    if(candidates.length!==1){if(candidates.length>1)notes.push('Reach extension stopped at an ambiguous junction.');break;}
    const next=candidates[0];if(next.geometry.type!=='LineString')break;
    const points=[...next.geometry.coordinates];used.add(next.id);added+=length(points);
    if(front){if(key(points.at(-1)!)!==key(endpoint))points.reverse();coords=[...points.slice(0,-1),...coords];}
    else{if(key(points[0])!==key(endpoint))points.reverse();coords=[...coords,...points.slice(1)];}
  }
  }
  const xy=coords.map(project.forward),dist=[0];for(let i=1;i<xy.length;i++)dist.push(dist[i-1]+Math.hypot(...subtract(xy[i],xy[i-1])));
  const anchor=project.forward(selected.center);let best=Infinity,along=0;
  for(let i=1;i<xy.length;i++){const a=xy[i-1],b=xy[i],dx=b[0]-a[0],dy=b[1]-a[1],size=dx*dx+dy*dy,t=size?Math.max(0,Math.min(1,((anchor[0]-a[0])*dx+(anchor[1]-a[1])*dy)/size)):0;
    const d=Math.hypot(anchor[0]-a[0]-dx*t,anchor[1]-a[1]-dy*t);if(d<best){best=d;along=dist[i-1]+t*(dist[i]-dist[i-1]);}}
  const total=dist.at(-1)!;if(total<300)throw new Error('This connected channel is shorter than 300 m. The 30 m elevation grid cannot support a useful reach assessment here.');
  const start=Math.max(0,Math.min(total-lengthKm*1000,along-lengthKm*500)),end=Math.min(total,start+lengthKm*1000);
  function at(station:number):Pair{const i=Math.max(1,dist.findIndex(d=>d>=station)),f=(station-dist[i-1])/(dist[i]-dist[i-1]||1);return project.inverse([xy[i-1][0]+(xy[i][0]-xy[i-1][0])*f,xy[i-1][1]+(xy[i][1]-xy[i-1][1])*f]);}
  const clipped=[at(start),...coords.filter((_,i)=>dist[i]>start&&dist[i]<end),at(end)];
  const previous=start>50?at(Math.max(0,(start+end)/2-lengthKm*800)):null,next=end<total-50?at(Math.min(total,(start+end)/2+lengthKm*800)):null;
  function idAt(point:Pair|null){if(!point)return undefined;const p=project.forward(point);let best=Infinity,id=source!.id;
    for(const f of lines)if(used.has(f.id)&&f.geometry.type==='LineString')for(let i=1;i<f.geometry.coordinates.length;i++){const a=project.forward(f.geometry.coordinates[i-1]),b=project.forward(f.geometry.coordinates[i]),v=subtract(b,a),size=v[0]**2+v[1]**2,t=size?Math.max(0,Math.min(1,((p[0]-a[0])*v[0]+(p[1]-a[1])*v[1])/size)):0,d=Math.hypot(p[0]-a[0]-t*v[0],p[1]-a[1]-t*v[1]);if(d<best){best=d;id=f.id;}}return id;
  }
  return {coordinates:clipped,sourceIds:[...used],lengthM:end-start,bounds:boundsOf(clipped),center:at((start+end)/2),
    previous,next,previousId:idAt(previous),nextId:idAt(next),notes:[...new Set(notes)]};
}
function subtract(a:Pair,b:Pair):Pair{return [a[0]-b[0],a[1]-b[1]];}
export function reachWindow(reach:Reach):[number,number,number,number]{
  const [w,s,e,n]=reach.bounds,paddingLat=3000/111320,paddingLng=paddingLat/Math.cos(reach.center[1]*Math.PI/180);
  return [w-paddingLng,s-paddingLat,e+paddingLng,n+paddingLat];
}

class Heap{
  ids:number[]=[];values:number[]=[];
  push(id:number,value:number){let i=this.ids.length;this.ids.push(id);this.values.push(value);while(i>0){const p=(i-1)>>1;if(this.values[p]<=value)break;this.ids[i]=this.ids[p];this.values[i]=this.values[p];i=p;}this.ids[i]=id;this.values[i]=value;}
  pop():[number,number]{const id=this.ids[0],value=this.values[0],lastId=this.ids.pop()!,lastValue=this.values.pop()!;if(this.ids.length){let i=0;while(i*2+1<this.ids.length){let child=i*2+1;if(child+1<this.ids.length&&this.values[child+1]<this.values[child])child++;if(this.values[child]>=lastValue)break;this.ids[i]=this.ids[child];this.values[i]=this.values[child];i=child;}this.ids[i]=lastId;this.values[i]=lastValue;}return [id,value];}
}
export function connectedStages(relative:Float32Array,seeds:Uint8Array,valid:Uint8Array,cols:number,rows:number){
  if(relative.length!==cols*rows||valid.length!==relative.length||seeds.length!==relative.length)throw new Error('Inconsistent analysis grid.');
  const costs=new Float32Array(relative.length).fill(Infinity),heap=new Heap();
  for(let i=0;i<costs.length;i++)if(seeds[i]&&valid[i]&&Number.isFinite(relative[i])){costs[i]=Math.max(0,relative[i]);heap.push(i,costs[i]);}
  if(!heap.ids.length)throw new Error('No valid channel elevations were found. This reach was not assessed.');
  while(heap.ids.length){const [id,cost]=heap.pop();if(cost!==costs[id])continue;const r=Math.floor(id/cols),c=id%cols;
    for(const next of [r>0?id-cols:-1,r<rows-1?id+cols:-1,c>0?id-1:-1,c<cols-1?id+1:-1])if(next>=0&&valid[next]&&Number.isFinite(relative[next])){const candidate=Math.max(cost,relative[next],0);if(candidate<costs[next]){costs[next]=candidate;heap.push(next,Math.fround(candidate));}}}
  for(let i=0;i<costs.length;i++)if(!Number.isFinite(costs[i]))costs[i]=NaN;return costs;
}
type KDNode={id:number;axis:number;left:KDNode|null;right:KDNode|null};
function kdTree(points:Pair[],ids=points.map((_,i)=>i),depth=0):KDNode|null{if(!ids.length)return null;const axis=depth%2;ids.sort((a,b)=>points[a][axis]-points[b][axis]);const mid=ids.length>>1;return {id:ids[mid],axis,left:kdTree(points,ids.slice(0,mid),depth+1),right:kdTree(points,ids.slice(mid+1),depth+1)};}
function nearestStation(root:KDNode,points:Pair[],point:Pair){let best=0,distance=Infinity;function visit(node:KDNode|null){if(!node)return;const p=points[node.id],d=(p[0]-point[0])**2+(p[1]-point[1])**2;if(d<distance){best=node.id;distance=d;}const delta=point[node.axis]-p[node.axis];visit(delta<0?node.left:node.right);if(delta*delta<distance)visit(delta<0?node.right:node.left);}visit(root);return best;}

function insideRing(point:Pair,ring:Pair[]){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function inside(point:Pair,polys:MultiPolygon){return polys.some(p=>insideRing(point,p[0])&&!p.slice(1).some(r=>insideRing(point,r)));}
function gridGeometry(mask:Uint8Array,grid:ElevationGrid):AreaGeometry{
  const [w,s,e,n]=grid.bounds,dx=(e-w)/grid.cols,dy=(n-s)/grid.rows,runs:MultiPolygon[]=[];
  for(let r=0;r<grid.rows;r++){let c=0;while(c<grid.cols){if(!mask[r*grid.cols+c]){c++;continue;}const start=c;while(c<grid.cols&&mask[r*grid.cols+c])c++;runs.push(rectangle(w+start*dx,n-(r+1)*dy,w+c*dx,n-r*dy));}}
  if(!runs.length)return geometry([]);const groups:MultiPolygon[]=[];for(let i=0;i<runs.length;i+=128)groups.push(union(runs[i],...runs.slice(i+1,i+128)));return geometry(union(groups[0],...groups.slice(1)));
}

// Sutherland–Hodgman clipping against one cell. Ring holes are subtracted;
// clipped vertices are projected into local UTM before measuring square metres.
function clipRing(ring:Pair[],w:number,s:number,e:number,n:number){
  let points=ring.slice(0,-1);
  for(const [axis,bound,greater] of [[0,w,true],[0,e,false],[1,s,true],[1,n,false]] as [number,number,boolean][]){
    const output:Pair[]=[];if(!points.length)break;
    for(let i=0;i<points.length;i++){const a=points[(i+points.length-1)%points.length],b=points[i],ain=greater?a[axis]>=bound:a[axis]<=bound,bin=greater?b[axis]>=bound:b[axis]<=bound;
      if(ain!==bin){const t=(bound-a[axis])/(b[axis]-a[axis]);output.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}if(bin)output.push(b);}
    points=output;
  }
  if(points.length)points.push(points[0]);return points;
}
export function cellWeights(polys:MultiPolygon,grid:ElevationGrid,project:(p:Pair)=>Pair){
  const weights=new Map<number,number>(),[w,s,e,n]=grid.bounds,dx=(e-w)/grid.cols,dy=(n-s)/grid.rows;
  for(const poly of polys){const b=boundsOf(poly[0]),c0=Math.max(0,Math.floor((b[0]-w)/dx)),c1=Math.min(grid.cols-1,Math.floor((b[2]-w)/dx)),r0=Math.max(0,Math.floor((n-b[3])/dy)),r1=Math.min(grid.rows-1,Math.floor((n-b[1])/dy));
    for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){let area=0;for(let j=0;j<poly.length;j++){const clipped=clipRing(poly[j],w+c*dx,n-(r+1)*dy,w+(c+1)*dx,n-r*dy);if(clipped.length)area+=(j===0?1:-1)*ringArea(clipped,project);}if(area>.001){const id=r*grid.cols+c;weights.set(id,(weights.get(id)??0)+area);}}}
  return weights;
}
function unionPolygons(values:MultiPolygon[]):MultiPolygon{if(!values.length)return [];const parts:MultiPolygon[]=[];for(let i=0;i<values.length;i+=64)parts.push(union(values[i],...values.slice(i+1,i+64)));return parts.length?union(parts[0],...parts.slice(1)):[];}

export function analyseReach(selected:PlaceEntry,reach:Reach,grid:ElevationGrid,features:GeoFeature[],coverage:AreaGeometry,timestamp:string,progress:(message:string)=>void):FloodPilot{
  const {cols,rows,heights,bounds}=grid,[w,s,e,n]=bounds,dx=(e-w)/cols,dy=(n-s)/rows,project=projection(reach.center);
  progress('Building the channel reference');
  const line=reach.coordinates.map(project.forward);const distances=[0];for(let i=1;i<line.length;i++)distances.push(distances[i-1]+Math.hypot(...subtract(line[i],line[i-1])));
  const count=Math.floor(reach.lengthM/30)+1,stations:Pair[]=[],stationCoordinates:Pair[]=[];let segment=1;
  for(let i=0;i<count;i++){const d=i/(count-1)*distances.at(-1)!;while(segment<line.length-1&&distances[segment]<d)segment++;const t=(d-distances[segment-1])/(distances[segment]-distances[segment-1]||1);const point:Pair=[line[segment-1][0]+t*(line[segment][0]-line[segment-1][0]),line[segment-1][1]+t*(line[segment][1]-line[segment-1][1])];stations.push(point);stationCoordinates.push(project.inverse(point));}
  const sample=stationCoordinates.map(point=>{const c=Math.floor((point[0]-w)/dx),r=Math.floor((n-point[1])/dy);let min=Infinity;for(let yy=r-1;yy<=r+1;yy++)for(let xx=c-1;xx<=c+1;xx++)if(yy>=0&&yy<rows&&xx>=0&&xx<cols&&Number.isFinite(heights[yy*cols+xx]))min=Math.min(min,heights[yy*cols+xx]);return min;});
  if(sample.some(v=>!Number.isFinite(v)))throw new Error('Some channel elevations are missing. This reach was not assessed.');
  const startHeight=median(sample.slice(0,Math.min(10,count))),endHeight=median(sample.slice(-Math.min(10,count))),reversed=startHeight<endHeight;
  if(reversed){stations.reverse();stationCoordinates.reverse();sample.reverse();}
  const smooth=sample.map((_,i)=>median(Array.from({length:11},(_,j)=>sample[Math.max(0,Math.min(count-1,i+j-5))]))),profile=monotoneProfile(smooth);
  const adjustments=profile.map((h,i)=>Math.abs(h-sample[i])),maxAdjustment=Math.max(...adjustments),meanAdjustment=adjustments.reduce((a,b)=>a+b,0)/count;
  if(meanAdjustment>10||maxAdjustment>45)throw new Error('Channel elevations are too inconsistent for this screening method. Try a shorter reach or another stream.');
  const tree=kdTree(stations)!,relative=new Float32Array(heights.length),valid=new Uint8Array(heights.length),seeds=new Uint8Array(heights.length),cover=polygons(coverage);
  progress('Checking terrain connections to the river');
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const id=r*cols+c,point:Pair=[w+(c+.5)*dx,n-(r+.5)*dy],station=nearestStation(tree,stations,project.forward(point));relative[id]=heights[id]-profile[station];valid[id]=Number(Number.isFinite(heights[id])&&station>3&&station<count-4&&inside(point,cover));}
  // Supercover-like sub-cell line sampling seeds the channel without lowering
  // its ground elevations. Disconnected data and corner-only paths stay closed.
  for(let i=1;i<reach.coordinates.length;i++){const a=reach.coordinates[i-1],b=reach.coordinates[i],steps=Math.max(1,Math.ceil(Math.max(Math.abs(b[0]-a[0])/dx,Math.abs(b[1]-a[1])/dy)*3));for(let j=0;j<=steps;j++){const c=Math.floor((a[0]+(b[0]-a[0])*j/steps-w)/dx),r=Math.floor((n-a[1]-(b[1]-a[1])*j/steps)/dy);if(r>=0&&r<rows&&c>=0&&c<cols)seeds[r*cols+c]=1;}}
  const thresholds=connectedStages(relative,seeds,valid,cols,rows),assessed=new Uint8Array(valid.length);
  // Exclude a 90 m outer margin to keep the computational edge distinct from
  // the reported domain. It is still a limited local calculation, not a basin.
  for(let r=3;r<rows-3;r++)for(let c=3;c<cols-3;c++){const id=r*cols+c;assessed[id]=Number(valid[id]&&Number.isFinite(thresholds[id]));}
  if(!assessed.some(Boolean))throw new Error('No usable assessment area remains after checking data coverage.');
  const assessedGeometry=gridGeometry(assessed,grid),window=rectangle(w,s,e,n);
  const water=unionPolygons(features.filter(f=>f.kind==='water'&&(f.geometry.type==='Polygon'||f.geometry.type==='MultiPolygon')).map(f=>intersection(polygons(f.geometry as AreaGeometry),window)));
  const waterWeights=cellWeights(water,grid,project.forward),landFractions=new Float32Array(heights.length),cellAreas=new Float32Array(heights.length);
  for(let r=0;r<rows;r++){const area=polygonArea(rectangle(reach.center[0]-dx/2,n-(r+1)*dy,reach.center[0]+dx/2,n-r*dy),project.forward);for(let c=0;c<cols;c++){const id=r*cols+c;cellAreas[id]=area;landFractions[id]=Math.max(0,Math.min(1,1-(waterWeights.get(id)??0)/area));}}
  progress('Measuring residential portions against 25 scenarios');
  const scenarios:FloodScenario[]=Array.from({length:25},(_,i)=>({stage:i*.5,landAreaM2:0,residentialAreaM2:0,affectedM2:[],boundaryContact:false,mask:''}));
  for(let id=0;id<thresholds.length;id++){if(!assessed[id]||landFractions[id]<=0)continue;const first=Math.max(0,Math.ceil(thresholds[id]*2));for(let level=first;level<25;level++){scenarios[level].landAreaM2+=cellAreas[id]*landFractions[id];const row=Math.floor(id/cols),col=id%cols;if(row<=5||row>=rows-6||col<=5||col>=cols-6||[id-1,id+1,id-cols,id+cols].some(i=>!assessed[i]))scenarios[level].boundaryContact=true;}}
  const areas:FloodArea[]=[],residentialLand:MultiPolygon[]=[];
  for(const feature of features){if(feature.kind!=='residential'||(feature.geometry.type!=='Polygon'&&feature.geometry.type!=='MultiPolygon'))continue;
    const original=polygons(feature.geometry),clipped=intersection(original,window);if(!clipped.length)continue;
    const areaM2=polygonArea(original,project.forward);if(areaM2<.01)continue;
    const weights=cellWeights(clipped,grid,project.forward);let assessedM2=0;for(const [id,area] of weights)if(assessed[id])assessedM2+=area;
    const dry=water.length?difference(clipped,water):clipped,landWeights=cellWeights(dry,grid,project.forward),impacts=new Float64Array(25);
    for(const [id,area] of landWeights)if(assessed[id])for(let level=Math.max(0,Math.ceil(thresholds[id]*2));level<25;level++)impacts[level]+=area;
    areas.push({id:feature.id,name:feature.name||`Residential area · ${feature.id.split('/').at(-1)}`,center:feature.center,bounds:feature.bounds,geometry:feature.geometry,areaM2,assessedM2:Math.min(areaM2,assessedM2)});
    scenarios.forEach((scenario,i)=>scenario.affectedM2.push(Math.min(assessedM2,impacts[i])));residentialLand.push(dry);
  }
  const residentialUnion=unionPolygons(residentialLand),unionWeights=cellWeights(residentialUnion,grid,project.forward);
  for(const [id,area] of unionWeights)if(assessed[id])for(let level=Math.max(0,Math.ceil(thresholds[id]*2));level<25;level++)scenarios[level].residentialAreaM2+=area;
  const notes=[...reach.notes];if(meanAdjustment>3)notes.push('Channel reference required substantial smoothing. Treat small offsets with extra caution.');if(Math.abs(startHeight-endHeight)<1)notes.push('The channel has little measured elevation drop; downstream direction is uncertain.');if(selected.intermittent)notes.push('OpenStreetMap marks this channel as seasonal or intermittent.');if(!areas.length)notes.push('No residential polygons are mapped in this window. This does not establish absence of settlements.');
  return {id:`reach:${selected.id}:${reach.center.map(v=>v.toFixed(5)).join(',')}`,name:selected.name||'Unnamed '+selected.kind,subtitle:`${reach.center[1].toFixed(3)}° N · ${reach.center[0].toFixed(3)}° E`,reachIds:reach.sourceIds,
    reach:{type:'LineString',coordinates:reversed?reach.coordinates.toReversed():reach.coordinates},center:reach.center,bounds,coreBounds:bounds,cols,rows,resolution:'1 arc-second Copernicus surface elevations (about 30 m)',reachLengthKm:reach.lengthM/1000,areas,scenarios,assessedGeometry,assessedMask:'',sourceTimestamp:timestamp,
    analysisVersion:'connected-stage-national-v2',reference:'Offset above a smoothed channel surface profile derived from Copernicus GLO-30 DSM; not a gauge reading or rise above current water.',
    notes,previous:reversed?reach.next:reach.previous,next:reversed?reach.previous:reach.next,previousId:reversed?reach.nextId:reach.previousId,nextId:reversed?reach.previousId:reach.nextId,
    runtime:{thresholds,assessment:assessed,landFractions,elevations:heights,waterGeometry:geometry(water),tiles:grid.tiles,referenceElevations:profile,profileAdjustmentM:meanAdjustment}};
}
