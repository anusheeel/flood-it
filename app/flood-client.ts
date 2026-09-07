import { FLOOD_WORKER_URL } from './worker-url';
import type { PlaceEntry } from './geography';
import { loadPilot, PILOT_REACH_ID, type FloodPilot } from './flood';
export function loadAssessment(river:PlaceEntry,length:number,progress:(message:string)=>void,signal:AbortSignal):Promise<FloodPilot>{
  if(river.id===PILOT_REACH_ID&&river.center[0]>84.27&&river.center[0]<84.46&&river.center[1]>27.64&&river.center[1]<27.79&&length===12)return loadPilot();
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
    // Use a generated root-relative public URL, independent of server-side module URLs.
    const worker=new Worker(FLOOD_WORKER_URL,{type:'module',name:'flood-assessment'});
    const cleanup=()=>{worker.terminate();signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(new DOMException('Cancelled','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=event=>{if(event.data.progress)progress(event.data.progress);else if(event.data.error){cleanup();reject(new Error(event.data.error));}else if(event.data.pilot){cleanup();resolve(event.data.pilot);}};
    worker.onerror=()=>{cleanup();reject(new Error('The local analysis could not start. Reload and try again.'));};
    worker.postMessage({river,length,origin:window.location.origin});
  });
}
