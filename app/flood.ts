import type { GeoFeature, PlaceEntry } from './geography';

export type FloodArea = {
  id:string; name:string; center:[number,number]; bounds:[number,number,number,number];
  geometry:Extract<GeoFeature['geometry'],{type:'Polygon'|'MultiPolygon'}>;
  areaM2:number; assessedM2:number;
};
export type FloodScenario = {stage:number;landAreaM2:number;residentialAreaM2:number;affectedM2:number[];boundaryContact:boolean;mask:string};
export type FloodPilot = {
  id:string;name:string;subtitle:string;reachIds:string[];reach:Extract<GeoFeature['geometry'],{type:'LineString'}>;
  center:[number,number];bounds:[number,number,number,number];coreBounds:[number,number,number,number];
  cols:number;rows:number;resolution:string;reachLengthKm:number;areas:FloodArea[];scenarios:FloodScenario[];
  assessedGeometry:Extract<GeoFeature['geometry'],{type:'Polygon'|'MultiPolygon'}>;assessedMask:string;
  sourceTimestamp:string;analysisVersion:string;reference:string;
  notes?:string[];previousId?:string;nextId?:string;previous?:[number,number]|null;next?:[number,number]|null;
  runtime?:{thresholds:Float32Array;assessment:Uint8Array;landFractions:Float32Array;elevations:Float32Array;
    waterGeometry:Extract<GeoFeature['geometry'],{type:'Polygon'|'MultiPolygon'}>;tiles:string[];elevationSha256?:string;referenceElevations:number[];profileAdjustmentM:number};
};
export type FloodResult = {
  pilot:FloodPilot;scenario:FloodScenario;upper:FloodScenario;lower:FloodScenario;
  baseline:FloodScenario|null;showSensitivity:boolean;
  mask:HTMLCanvasElement;upperMask:HTMLCanvasElement;assessedMask:HTMLCanvasElement;baselineMask:HTMLCanvasElement|null;
};
export const PILOT_REACH_ID='way/25708647';
export const PILOT_CENTER:[number,number]=[84.377,27.712];
export const PILOT_BOUNDS:[number,number,number,number]=[84.27,27.64,84.46,27.79];
export function supportedRiver(feature:PlaceEntry|null){return !!feature&&feature.layer==='rivers'&&['river','stream'].includes(feature.kind);}
export function scenarioAt(pilot:FloodPilot,stage:number){
  if(!Number.isFinite(stage)||stage<0||stage>12||Math.round(stage*2)!==stage*2)throw new Error('Choose a stage from 0 to 12 m in 0.5 m steps.');
  const scenario=pilot.scenarios.find(s=>s.stage===stage);
  if(!scenario||scenario.affectedM2.length!==pilot.areas.length)throw new Error('This scenario is unavailable or incomplete.');
  return scenario;
}
export function affectedCount(scenario:FloodScenario){return scenario.affectedM2.filter(area=>area>0).length;}
export function totalAffected(scenario:FloodScenario){return scenario.residentialAreaM2;}
export function areaStatus(area:FloodArea,affected:number,upperAffected:number):'exposed'|'unassessed'|'sensitive'|'outside'{
  if(affected>0)return 'exposed';
  if(area.assessedM2<area.areaM2-.1)return 'unassessed';
  return upperAffected>0?'sensitive':'outside';
}
export function areaFeature(area:FloodArea):GeoFeature{return {...area,layer:'settlements',kind:'residential',areaKm2:area.areaM2/1e6};}
export function pilotFeature(pilot:FloodPilot):GeoFeature{return {id:pilot.reachIds[0],name:pilot.name,layer:'rivers',kind:'river',center:pilot.center,bounds:pilot.coreBounds,geometry:pilot.reach};}
export function formatArea(area:number){return area>=1e6?`${(area/1e6).toFixed(2)} km²`:area>=10000?`${(area/10000).toFixed(1)} ha`:`${Math.round(area).toLocaleString()} m²`;}

let pilotPromise:Promise<FloodPilot>|null=null;
export function loadPilot(){
  if(!pilotPromise)pilotPromise=fetch('/flood/narayani/manifest.json').then(async response=>{
    if(!response.ok)throw new Error('The pilot dataset could not load. Please retry.');
    const data=await response.json() as FloodPilot;
    if(data.id!=='narayani-bharatpur'||data.scenarios?.length!==25||!data.areas?.length||!data.cols||!data.rows)throw new Error('The pilot dataset is incomplete.');
    return data;
  }).catch(error=>{pilotPromise=null;throw error;});
  return pilotPromise;
}

// Masks are native analysis cells. Turn grayscale PNG values into true alpha;
// drawImage alone would paint a solid black rectangle over the landscape.
const maskCache=new Map<string,Promise<HTMLCanvasElement>>();
function loadMask(url:string,cols:number,rows:number){
  let pending=maskCache.get(url);
  if(!pending){
    pending=fetch(url).then(async response=>{
      if(!response.ok)throw new Error('A flood overlay could not load. Please run the scenario again.');
      const bitmap=await createImageBitmap(await response.blob());
      if(bitmap.width!==cols||bitmap.height!==rows){bitmap.close();throw new Error('Flood overlay dimensions do not match the analysis grid.');}
      const canvas=document.createElement('canvas');canvas.width=cols;canvas.height=rows;
      const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();
      const pixels=ctx.getImageData(0,0,cols,rows);
      for(let i=0;i<pixels.data.length;i+=4){pixels.data[i+3]=pixels.data[i];pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;}
      ctx.putImageData(pixels,0,0);return canvas;
    }).catch(error=>{maskCache.delete(url);throw error;});
    maskCache.set(url,pending);
    if(maskCache.size>10)maskCache.delete(maskCache.keys().next().value!);
  }
  return pending;
}
export async function prepareFlood(pilot:FloodPilot,stage:number,baselineStage:number|null,showSensitivity:boolean):Promise<FloodResult>{
  const scenario=scenarioAt(pilot,stage),upper=scenarioAt(pilot,Math.min(12,stage+1)),lower=scenarioAt(pilot,Math.max(0,stage-1));
  const baseline=baselineStage===null?null:scenarioAt(pilot,baselineStage);
  if(pilot.runtime){
    const mask=runtimeMask(pilot,stage),upperMask=runtimeMask(pilot,upper.stage),assessedMask=runtimeMask(pilot,null),baselineMask=baseline?runtimeMask(pilot,baseline.stage):null;
    return {pilot,scenario,upper,lower,baseline,showSensitivity,mask,upperMask,assessedMask,baselineMask};
  }
  const [mask,upperMask,assessedMask,baselineMask]=await Promise.all([
    loadMask(scenario.mask,pilot.cols,pilot.rows),loadMask(upper.mask,pilot.cols,pilot.rows),
    loadMask(pilot.assessedMask,pilot.cols,pilot.rows),baseline?loadMask(baseline.mask,pilot.cols,pilot.rows):Promise.resolve(null)
  ]);
  return {pilot,scenario,upper,lower,baseline,showSensitivity,mask,upperMask,assessedMask,baselineMask};
}

export function runtimeMask(pilot:FloodPilot,stage:number|null){
  const runtime=pilot.runtime!;
  const canvas=document.createElement('canvas');canvas.width=pilot.cols;canvas.height=pilot.rows;
  const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(pilot.cols,pilot.rows);
  for(let i=0;i<runtime.assessment.length;i++)if(runtime.assessment[i]&&(stage===null||(runtime.landFractions[i]>0&&runtime.thresholds[i]<=stage)))pixels.data.set([255,255,255,255],i*4);
  ctx.putImageData(pixels,0,0);
  // Keep mapped water holes out of the rendered land extent, including cells
  // with a mix of land and water, matching the polygon exposure calculation.
  if(stage!==null){
    ctx.globalCompositeOperation='destination-out';ctx.beginPath();
    const geometry=runtime.waterGeometry,polys=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates,[w,s,e,n]=pilot.bounds;
    polys.forEach(poly=>poly.forEach(ring=>{ring.forEach((point,i)=>{const x=(point[0]-w)/(e-w)*pilot.cols,y=(n-point[1])/(n-s)*pilot.rows;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.closePath();}));ctx.fill('evenodd');
  }
  return canvas;
}
