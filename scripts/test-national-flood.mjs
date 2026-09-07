// Run with: node scripts/test-national-flood.mjs (no browser or network needed).
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(root+'/package.json'),ts=require('typescript'),cache=new Map();
function load(name){const file=path.resolve(root,'app',name+'.ts');if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const code=ts.transpileModule(fs.readFileSync(file,'utf8').replaceAll('import.meta.url',JSON.stringify('file://'+file)),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(id=>id.endsWith('?worker')?globalThis.Worker:id.startsWith('./')?load(id.slice(2)):require(id),module,module.exports);return module.exports;}
const a=load('flood-analysis');
assert.deepEqual(a.monotoneProfile([5,4,6,2]),[5,5,5,2]);
const relative=new Float32Array([0,2,0,0,2,0,0,2,0]),seeds=new Uint8Array([1,0,0,0,0,0,0,0,0]),valid=new Uint8Array(9).fill(1);
const costs=a.connectedStages(relative,seeds,valid,3,3);assert.equal(costs[2],2);assert.equal(costs[6],0);valid[1]=valid[4]=valid[7]=0;assert(Number.isNaN(a.connectedStages(relative,seeds,valid,3,3)[2]));
const diagonal=a.connectedStages(new Float32Array([0,0,0,0]),new Uint8Array([1,0,0,0]),new Uint8Array([1,0,0,1]),2,2);assert(Number.isNaN(diagonal[3]));
const simple={bounds:[0,0,2,2],cols:2,rows:2,heights:new Float32Array(4),tiles:[]},identity=p=>p;
const hole=[[[[.25,.25],[1.75,.25],[1.75,1.75],[.25,1.75],[.25,.25]],[[.5,.5],[.5,1.5],[1.5,1.5],[1.5,.5],[.5,.5]]]];
const weights=a.cellWeights(hole,simple,identity);for(const value of weights.values())assert.equal(value,.3125);
const river=(id,x0,x1)=>({id,name:'Example',layer:'rivers',kind:'river',center:[(x0+x1)/2,27],bounds:[x0,27,x1,27],geometry:{type:'LineString',coordinates:[[x0,27],[x1,27]]}});
const chain=Array.from({length:9},(_,i)=>river('way/'+i,84+i*.03,84+(i+1)*.03)),reach=a.selectReach(chain[4],chain,6);
assert(Math.abs(reach.center[0]-chain[4].center[0])<.001,'extend in both directions around the selected point');assert(reach.previous&&reach.next&&reach.previousId&&reach.nextId);assert.notEqual(reach.nextId,chain[4].id,'next window retains its actual source ID');
assert.throws(()=>a.selectReach({...chain[4],kind:'canal'},[],6));assert.throws(()=>a.selectReach(river('short',84,84.0001),[river('short',84,84.0001)],6),/shorter than 300/);
const fork={...river('fork',84.15,84.18),geometry:{type:'LineString',coordinates:[[84.15,27],[84.18,27.02]]}};
const junction=a.selectReach(chain[4],[...chain,fork],6);assert(junction.notes.some(n=>n.includes('ambiguous')));
const {decodedJSON}=load('json-data');assert.deepEqual(await decodedJSON(new Response(gzipSync('[1,2]'))),[1,2]);assert.deepEqual(await decodedJSON(new Response('[1,2]')),[1,2]);
const rectangle=(w,s,e,n)=>({type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]});
const grid={bounds:[84,27,84.01,27.01],cols:40,rows:40,heights:new Float32Array(1600).fill(102),tiles:['fixture']};
for(let r=0;r<40;r++)grid.heights[r*40+20]=100;
const source={...river('channel',84.005,84.005),center:[84.005,27.005],bounds:[84.005,27.001,84.005,27.009],geometry:{type:'LineString',coordinates:[[84.005,27.009],[84.005,27.001]]}};
const selected=a.selectReach(source,[source],6),area={id:'area',name:'Area',layer:'settlements',kind:'residential',center:[84.005,27.005],bounds:[84.004,27.004,84.006,27.006],geometry:rectangle(84.004,27.004,84.006,27.006)};
const water={...area,id:'water',kind:'water',layer:'lakes',geometry:rectangle(84.005,27,84.00525,27.01)};
const result=a.analyseReach(source,selected,grid,[source,area,{...area,id:'overlap'},water],rectangle(83,26,85,28),'fixture',()=>{});
assert.equal(result.areas.length,2);assert(result.scenarios[4].residentialAreaM2>0);assert(Math.abs(result.scenarios[4].residentialAreaM2-result.scenarios[4].affectedM2[0])<.1,'overlaps union once');assert(result.scenarios[4].affectedM2[0]<result.areas[0].areaM2,'mapped water is excluded');
for(let i=1;i<25;i++){assert(result.scenarios[i].landAreaM2>=result.scenarios[i-1].landAreaM2);assert(result.scenarios[i].affectedM2.every((v,k)=>v>=result.scenarios[i-1].affectedM2[k]&&v<=result.areas[k].assessedM2+.1));}
const missing={...grid,heights:new Float32Array(1600).fill(NaN)};assert.throws(()=>a.analyseReach(source,selected,missing,[],rectangle(83,26,85,28),'fixture',()=>{}),/missing/);
console.log('PASS: connectivity barriers, diagonal exclusion, missing elevations, monotone stages, fractional areas and holes, water exclusion, overlapping polygons, bidirectional reach selection, junction limits, continuation IDs, tiny-channel rejection and gzip decoding.');

const instances=[];
globalThis.window={location:{origin:'https://example.test'}};
globalThis.Worker=class{constructor(){instances.push(this);}postMessage(value){this.request=value;}terminate(){this.terminated=true;}};
const client=load('flood-client'),controller=new AbortController(),messages=[];
const pending=client.loadAssessment({...source,id:'worker-fixture'},6,m=>messages.push(m),controller.signal),worker=instances.at(-1);
worker.onmessage({data:{progress:'Reading native data'}});assert.deepEqual(messages,['Reading native data']);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert(worker.terminated);
const next=client.loadAssessment({...source,id:'worker-fixture'},12,()=>{},new AbortController().signal),complete=instances.at(-1);complete.onmessage({data:{pilot:result}});assert.equal((await next).id,result.id);assert(complete.terminated);
const failure=client.loadAssessment({...source,id:'worker-fixture'},6,()=>{},new AbortController().signal),failed=instances.at(-1);failed.onmessage({data:{error:'Missing elevation'}});await assert.rejects(failure,/Missing elevation/);assert(failed.terminated);
console.log('PASS: worker progress, result delivery, explicit source errors, abort and worker cleanup.');
