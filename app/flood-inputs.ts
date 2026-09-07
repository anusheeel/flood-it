import { decodedJSON } from './json-data';
import { intersects, type GeoFeature, type PlaceEntry } from './geography';
export type InputManifest={timestamp:string;tiles:Record<string,{compressedBytes:number;sha256:string}>;counts:Record<string,number>;coverage:Extract<GeoFeature['geometry'],{type:'Polygon'|'MultiPolygon'}>};
const cache=new Map<string,Promise<unknown>>();
export async function floodJSON<T>(file:string):Promise<T>{
  let promise=cache.get(file);
  if(!promise){promise=fetch('/flood/inputs/'+file).then(async response=>{
    if(!response.ok||!response.body)throw new Error('The original river and settlement data could not load. Please retry.');
    return decodedJSON(response);
  }).catch(error=>{cache.delete(file);throw error;});cache.set(file,promise);if(cache.size>8)cache.delete(cache.keys().next().value!);}
  return promise as Promise<T>;
}
export function loadRiverIndex(){return floodJSON<PlaceEntry[]>('rivers.json.gz');}
export async function loadFloodInputs(bounds:number[]){
  const manifest=await floodJSON<InputManifest>('manifest.json');const keys:string[]=[];
  for(let x=Math.floor(bounds[0]*2);x<=Math.floor(bounds[2]*2);x++)for(let y=Math.floor(bounds[1]*2);y<=Math.floor(bounds[3]*2);y++){const key=`${x}-${y}`;if(manifest.tiles[key])keys.push(key);}
  if(!keys.length)throw new Error('No source mapping is available in this area.');
  const groups=await Promise.all(keys.map(key=>floodJSON<GeoFeature[]>(key+'.json.gz')));
  return {manifest,features:[...new Map(groups.flat().filter(f=>intersects(f.bounds,bounds)).map(f=>[f.id+':'+f.kind,f])).values()]};
}
