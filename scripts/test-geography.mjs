import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const cache=new Map();
function load(name){if(cache.has(name))return cache.get(name);const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(new URL(`../app/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(id=>load(id.slice(2)),m,m.exports);cache.set(name,m.exports);return m.exports;}
let tries=0,fail=true;
const feature={id:'retained',layer:'rivers',bounds:[84,27,84.5,27.5]};
globalThis.fetch=async url=>{
 if(url.endsWith('manifest.json'))return Response.json({tiles:['168-54','169-54']});
 if(url.endsWith('168-54.json.gz')){tries++;if(tries===1)return new Response('Temporary outage',{status:503});return Response.json([feature]);}
 if(url.endsWith('169-54.json.gz'))return fail?new Response('Missing',{status:404}):Response.json([{...feature,id:'recovered'}]);
 throw new Error(url);
};
const {loadGeography}=load('geography');
const partial=await loadGeography([84,27,85,27.4],false);
assert.equal(tries,2,'a temporary HTTP failure retries');assert.equal(partial.features.length,1,'one missing tile must not discard available features');assert(partial.warning.includes('1 map tile'));
fail=false;const full=await loadGeography([84,27,85,27.4],false);assert.equal(full.features.length,2);assert.equal(full.warning,'','failed tile is not permanently cached');
console.log('PASS: automatic transient retry, retained partial geography, explicit missing coverage and successful recovery.');
