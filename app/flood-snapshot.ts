import { formatArea, areaStatus, type FloodArea, type FloodPilot, type FloodResult } from './flood';
const STATUS={exposed:'Potential residential exposure',sensitive:'Exposure at the +1 m sensitivity level',outside:'Outside the selected scenario',unassessed:'Partly or not assessed'};
/** Compose the actual renderer output with permanent scenario context. No generated terrain. */
export async function makeSnapshot(view:HTMLCanvasElement,pilot:FloodPilot,result:FloodResult,area:FloodArea,index:number){
  const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1120;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image export is unavailable in this browser.');
  ctx.fillStyle='#0c222c';ctx.fillRect(0,0,1600,1120);
  ctx.fillStyle='#faf3e7';ctx.font='30px Georgia';ctx.fillText('FLOOD IT',40,50);
  ctx.fillStyle='#94cad3';ctx.font='16px sans-serif';ctx.fillText('NEPAL · AREA STUDY',1240,47);
  // Fit the complete view: never crop away the selected residential polygon.
  const scale=Math.min(1600/view.width,680/view.height),w=view.width*scale,h=view.height*scale;
  ctx.drawImage(view,(1600-w)/2,76+(680-h)/2,w,h);
  const affected=result.scenario.affectedM2[index];
  ctx.fillStyle='#f28f80';ctx.font='16px sans-serif';ctx.fillText(STATUS[areaStatus(area,affected,result.upper.affectedM2[index])].toUpperCase(),40,800);
  ctx.fillStyle='#faf3e7';ctx.font='34px Georgia';ctx.fillText(area.name||'Mapped residential area',40,844,1040);
  ctx.fillStyle='#bdd1d8';ctx.font='18px sans-serif';ctx.fillText(`${pilot.name} · ${area.center[1].toFixed(4)}° N, ${area.center[0].toFixed(4)}° E · ${area.id}`,40,879,1100);
  ctx.fillStyle='#8edee9';ctx.font='32px sans-serif';ctx.fillText(`+${result.scenario.stage.toFixed(1)} m`,1320,838);
  ctx.font='14px sans-serif';ctx.fillText('channel reference offset',1320,864);
  ctx.fillStyle='#e8eff0';ctx.font='19px sans-serif';ctx.fillText(`${formatArea(affected)} potentially exposed · ${(100*affected/area.areaM2).toFixed(1)}% of mapped area · ${(100*area.assessedM2/area.areaM2).toFixed(1)}% assessed`,40,918,1500);
  ctx.font='14px sans-serif';
  for(const [i,color,label] of [[0,'#41c5df','Estimated inundated land'],[1,'#fa8474','Residential portion exposed'],[2,'#e9b46d',result.showSensitivity?'+1 m sensitivity fringe':'Sensitivity fringe hidden']] as const){ctx.fillStyle=color;ctx.fillRect(40+i*390,945,12,12);ctx.fillStyle='#c3d1d6';ctx.fillText(label,60+i*390,956);}
  ctx.strokeStyle='#38515a';ctx.beginPath();ctx.moveTo(40,979);ctx.lineTo(1560,979);ctx.stroke();
  ctx.fillStyle='#e9b877';ctx.font='17px sans-serif';ctx.fillText('Experimental, uncalibrated screening · Not an operational forecast · Areas, not homes or people',40,1007);
  ctx.fillStyle='#a5bfc9';ctx.font='12px sans-serif';
  ctx.fillText(`© OpenStreetMap contributors · ODbL · Snapshot ${pilot.sourceTimestamp.slice(0,10)} · ${pilot.analysisVersion} · ${pilot.resolution}`,40,1035,1500);
  ctx.fillText(`Method & full data credits: ${window.location.origin}/flood/method.html`,40,1056,1500);
  ctx.fillText('Elevation: Copernicus WorldDEM-30 © DLR e.V. 2010–2014 & © Airbus Defence and Space GmbH 2014–2018; EU / ESA.',40,1077,1500);
  ctx.fillText('Illustrative terrain materials. Flood extent is limited to the assessed window; outside does not mean safe.',40,1098,1500);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('The snapshot could not be encoded.')),'image/png'));
  return {url:URL.createObjectURL(blob),filename:`flood-it-${area.id.replaceAll('/','-')}-${result.scenario.stage}m.png`};
}
export function downloadSnapshot(snapshot:{url:string;filename:string}){const link=document.createElement('a');link.href=snapshot.url;link.download=snapshot.filename;link.click();}
