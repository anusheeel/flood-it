import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const origin='https://flood-it.example',location={origin,href:origin+'/'};
export function hostedWorkerURL(expression){
 const value=vm.runInNewContext(expression,{URL,location,window:{location}},{timeout:1000});
 const url=new URL(String(value),location.href);
 assert.equal(url.protocol,'https:','The flood worker must load over HTTPS, never file://');
 assert.equal(url.origin,origin,'The flood worker must be hosted on the application origin');
 return url;
}
assert.throws(()=>hostedWorkerURL('new URL("/workers/flood-worker-broken.js", "file:///ROOT/app/flood-client.ts")'),/HTTPS/);
const generated=fs.readFileSync(path.join(root,'app/worker-url.ts'),'utf8');
const match=generated.match(/export const FLOOD_WORKER_URL = ('[^']+');/);assert(match);
const url=hostedWorkerURL(match[1]),asset=path.join(root,'public',url.pathname);
assert(fs.existsSync(asset));const worker=fs.readFileSync(asset,'utf8');assert(worker.includes('onmessage'));
assert(!worker.includes('file:///'));
const chunks=path.join(root,'.next/static/chunks');
const scripts=fs.readdirSync(chunks,{recursive:true}).filter(n=>n.endsWith('.js')).map(n=>fs.readFileSync(path.join(chunks,n),'utf8'));
assert(scripts.some(s=>s.includes(url.pathname)&&/new Worker\(/.test(s)),'Actual browser chunks must use the packaged root-relative worker URL');
export const workerPaths=[url.pathname];
console.log('PASS production worker URL:',url.pathname,'(same origin, packaged asset; previous file:// regression rejected)');
