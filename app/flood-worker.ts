import { loadFloodInputs } from './flood-inputs';
import { selectReach, reachWindow, analyseReach } from './flood-analysis';
import { readElevation } from './flood-elevation';
import type { PlaceEntry } from './geography';
self.onmessage=async(event:MessageEvent<{river:PlaceEntry;length:number;origin:string}>)=>{
  const {river,length,origin}=event.data;
  const progress=(message:string)=>self.postMessage({progress:message});
  try{
    progress('Reading original river and settlement mapping');
    const [lng,lat]=river.center;
    const initial=await loadFloodInputs([lng-.3,lat-.3,lng+.3,lat+.3]);
    const reach=selectReach(river,initial.features,length),bounds=reachWindow(reach);
    const {features,manifest}=await loadFloodInputs(bounds);
    const grid=await readElevation(bounds,origin,progress);
    const pilot=analyseReach(river,reach,grid,features,manifest.coverage,manifest.timestamp,progress);
    const runtime=pilot.runtime!;
    runtime.elevationSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',runtime.elevations.buffer as ArrayBuffer)),v=>v.toString(16).padStart(2,'0')).join('');
    self.postMessage({pilot},{transfer:[runtime.thresholds.buffer,runtime.assessment.buffer,runtime.landFractions.buffer,runtime.elevations.buffer]});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:'This reach could not be assessed. Please try again.'});}
};
