import { decodedJSON } from './json-data';
export type LayerKey = 'rivers' | 'lakes' | 'settlements';
export type LayerVisibility = Record<LayerKey, boolean>;
export type Coordinate = [number, number];
export type GeoFeature = {
  id: string; layer: LayerKey; kind: string; name: string; localName?: string;
  center: Coordinate; bounds: [number, number, number, number]; areaKm2?: number; intermittent?: boolean; buildingTag?: string;
  geometry: { type: 'Point'; coordinates: Coordinate } | { type: 'LineString'; coordinates: Coordinate[] }
    | { type: 'Polygon'; coordinates: Coordinate[][] } | { type: 'MultiPolygon'; coordinates: Coordinate[][][] };
};
export type PlaceEntry = Omit<GeoFeature, 'geometry'>;
export type GeographyManifest = { timestamp: string; counts: Record<LayerKey, number>; kinds: Record<string, number>; tiles: string[]; overviewCount: number };
export type GeographyStatus = { loading: boolean; error: string; counts: Record<LayerKey, number>; overview: boolean };
export const DEFAULT_LAYERS: LayerVisibility = { rivers: true, lakes: true, settlements: true };
export const LAYER_NAMES = { rivers: 'Rivers & channels', lakes: 'Lakes & water', settlements: 'Settlements' };
export const KIND_NAMES: Record<string, string> = { building: 'Building footprint', river: 'River channel', stream: 'Stream', canal: 'Canal', drain: 'Drain', ditch: 'Ditch', lake: 'Lake', pond: 'Pond', reservoir: 'Reservoir', water: 'Water body', riverbank: 'River water area', residential: 'Residential area', city: 'City', town: 'Town', village: 'Village', hamlet: 'Hamlet', isolated_dwelling: 'Isolated settlement', suburb: 'Suburb', neighbourhood: 'Neighbourhood' };
export const featureName = (p: PlaceEntry) => p.name || `Unnamed ${KIND_NAMES[p.kind]?.toLowerCase() || 'water body'}`;
const cache = new Map<string, Promise<unknown>>();
export async function geographyJSON<T>(file: string): Promise<T> {
  let pending = cache.get(file);
  if (!pending) {
    pending = (async()=>{
      const url='/geography/'+file+(file==='manifest.json'?'':'.gz');
      for(let attempt=0;attempt<3;attempt++){
        try{
          const response=await fetch(url,{signal:AbortSignal.timeout(20000),cache:attempt?'reload':'default'});
          if(response.status===404)throw new Error(`Map tile ${file} is unavailable (404).`);
          if(!response.ok)throw new Error(`Map layers could not load (${response.status}).`);
          return await decodedJSON(response);
        }catch(error){
          if(attempt===2||(error instanceof Error&&error.message.includes('(404)')))throw error;
          await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));
        }
      }
    })().catch(error => { cache.delete(file); throw error; });
    cache.set(file, pending);
    if (cache.size > 36) cache.delete(cache.keys().next().value!);
  }
  return pending as Promise<T>;
}
export function intersects(a: number[], b: number[]) { return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }
export async function loadGeography(bounds: number[], overview: boolean): Promise<{features:GeoFeature[];warning:string}> {
  if (overview) return {features:await geographyJSON<GeoFeature[]>('overview.json'),warning:''};
  const manifest = await geographyJSON<GeographyManifest>('manifest.json');
  const keys: string[] = [];
  for (let x = Math.floor(bounds[0] * 2); x <= Math.floor(bounds[2] * 2); x++)
    for (let y = Math.floor(bounds[1] * 2); y <= Math.floor(bounds[3] * 2); y++) if (manifest.tiles.includes(`${x}-${y}`)) keys.push(`${x}-${y}.json`);
  const parts = await Promise.allSettled(keys.map(key => geographyJSON<GeoFeature[]>(key)));
  const failed=parts.filter(part=>part.status==='rejected').length;
  const features=parts.flatMap(part=>part.status==='fulfilled'?part.value:[]);
  if(failed===parts.length&&failed>0)throw new Error('Map layers could not load after retrying. Check your connection and retry.');
  return {features:[...new Map(features.filter(f=>intersects(f.bounds,bounds)).map(f=>[f.id,f])).values()],warning:failed?`${failed} map tile${failed===1?'':'s'} could not load. Showing available layers; retry for full coverage.`:''};
}
