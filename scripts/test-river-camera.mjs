import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

globalThis.window={innerWidth:1440,matchMedia:()=>({matches:true})};

// Exercise the production scene methods and real OrbitControls without a WebGL surface.
let source=fs.readFileSync(new URL('../app/terrain-scene.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class MountainScene','class MountainScene');
const start=source.indexOf('  constructor('),end=source.indexOf('  private contextLost=',start);
source=source.slice(0,start)+'constructor(private host:HTMLDivElement,private callbacks:Callbacks){}\n'+source.slice(end);
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const element=()=>({style:{},children:[],appendChild(child){this.children.push(child);},setAttribute(){},remove(){}});
const MountainScene=new Function('THREE','DEFAULT_LAYERS','document','featureName','settlementIcon',js+'\nreturn MountainScene;')(THREE,{rivers:true,lakes:true,settlements:true},{createElement:element},f=>f.name,element);
const root=new EventTarget();root.pointerLockElement=null;
class Surface extends EventTarget {
  style={};clientWidth=1440;clientHeight=900;ownerDocument=root;
  getRootNode(){return root;}getBoundingClientRect(){return {left:0,top:0,width:1440,height:900};}setAttribute(){}
}
const scene=new MountainScene({dataset:{},clientHeight:900},{onInteraction(){},onWindow(){}});
scene.renderer={domElement:new Surface()};scene.labelLayer=element();
scene.controls=new OrbitControls(scene.camera,scene.renderer.domElement);
scene.controls.enableDamping=true;scene.controls.dampingFactor=.08;scene.controls.maxTargetRadius=90;
scene.model={id:'landscape',center:[83.75,28.25],bounds:[83,27.5,84.5,29],cols:5,rows:5,widthKm:145,depthKm:166,minHeight:1200,maxHeight:1200};
scene.heights=new Uint16Array(25).fill(1200);scene.focus=[83.75,28.25];
scene.camera.aspect=1.6;scene.camera.updateProjectionMatrix();
scene.controls.target.copy(scene.world(83.93,28.32));scene.controls.cursor.copy(scene.controls.target).add(new THREE.Vector3(2,0,-3));
scene.camera.position.copy(scene.controls.target).add(new THREE.Vector3(18,11,-24));scene.controls.update();
scene.scene.fog=new THREE.Fog(0xb9ccd2,50,200);
scene.removeMesh=()=>{};let builds=0;scene.buildMesh=()=>{builds++;scene.scene.fog=new THREE.Fog(0xb9ccd2,1,3);};scene.buildLabels=()=>{};scene.paintLayers=()=>{};scene.refreshGeography=async()=>{};
const river={id:'way/selected',name:'Seti Gandaki River',layer:'rivers',kind:'river',center:[83.98,28.31],bounds:[82,27,85,30]};
const screen=()=>{scene.camera.updateMatrixWorld();return scene.world(...river.center).project(scene.camera);};
const pose=()=>({position:scene.camera.position.clone(),target:scene.controls.target.clone(),quaternion:scene.camera.quaternion.clone(),distance:scene.camera.position.distanceTo(scene.controls.target),anchor:scene.getCoordinates(),screen:screen()});
const sameAngle=(before)=>{assert(Math.abs(scene.camera.position.distanceTo(scene.controls.target)-before.distance)<1e-8,'zoom changed');assert(1-Math.abs(scene.camera.quaternion.dot(before.quaternion))<1e-10,'viewing angle changed');};
scene.load=async()=>{throw new Error('A visible river must not load and reframe another terrain');};
scene.controls.pan(45,-20);scene.controls.update();const beforeSelect=pose();scene.flight={pending:true};
await scene.selectRiver(river);sameAngle(beforeSelect);assert(scene.camera.position.distanceTo(beforeSelect.position)<1e-8);assert.equal(scene.selectedFeature,river);assert.equal(scene.flight,null);
for(let i=0;i<30;i++)scene.controls.update();sameAngle(beforeSelect);assert(scene.camera.position.distanceTo(beforeSelect.position)<1e-8,'selection left stale camera momentum');
scene.setNavigationMode('pan');
for(const mode of ['orbit','pan']){
  scene.controls.rotateLeft(.1);scene.controls.update();const beforeSwitch=pose();
  scene.setNavigationMode(mode);for(let i=0;i<30;i++)scene.controls.update();
  sameAngle(beforeSwitch);assert(scene.camera.position.distanceTo(beforeSwitch.position)<1e-8,'navigation switch moved the camera');
}
// The user is free to continue navigating while the worker prepares its DEM.
scene.controls.rotateLeft(.3);scene.controls.pan(35,12);scene.controls.update();const latest=pose();
const pilot={id:'assessment-1',center:[83.95,28.3],bounds:[83.87,28.22,84.03,28.37],cols:5,rows:5,reachIds:[river.id],areas:[],runtime:{elevations:new Float32Array(25).fill(1200)}};
scene.setFloodOverlay(pilot,null);sameAngle(latest);
assert.deepEqual(scene.getCoordinates().map(n=>+n.toFixed(10)),latest.anchor.map(n=>+n.toFixed(10)),'assessment changed the geographic look-at point');
assert(screen().distanceTo(latest.screen)<1e-8,'selected river moved on screen when model origin changed');
assert.equal(scene.scene.fog.far,200,'a smaller model must not fog out the preserved view');
for(let i=0;i<30;i++)scene.controls.update();sameAngle(latest);
const afterMesh=pose();scene.setFloodOverlay(pilot,{scenario:{stage:3}});sameAngle(afterMesh);assert.equal(builds,1,'running Flood It must not reframe the prepared mesh');
// Clicking the same OSM segment at a different location must keep that clicked anchor.
scene.geography=[{...river,center:[83.90,28.27]}];scene.buildGeographyLabels();
const label=scene.geographyLabels.find(label=>label.feature.id===river.id);assert.deepEqual(label.feature.center,river.center);
// Explicit focus may move the camera but must keep the chosen viewing direction.
const direction=scene.camera.position.clone().sub(scene.controls.target).normalize();
await scene.focusGeography(river);
assert(scene.camera.position.clone().sub(scene.controls.target).normalize().distanceTo(direction)<1e-8,'explicit river focus changed orientation');
assert(scene.controls.target.distanceTo(scene.world(...river.center))<1e-8);
scene.controls.dispose();
console.log('PASS: visible-river selection preserves camera pose; latest view survives assessment mesh rebasing and Flood It; selected label retains clicked anchor; explicit focus preserves viewing direction.');
