import { decodedJSON } from './json-data';
import { intersects, type Coordinate, type GeoFeature } from './geography';

export type Bounds = [number, number, number, number];
export type BuildingRecord = [string, string, string, Coordinate[][][]];
export type BuildingManifest = {
  version: number; timestamp: string; count: number; tileDegrees: number;
  tiles: Record<string, { count: number; bytes: number }>;
  densityTileDegrees: number; density: Record<string, { count: number }>;
};
export type BuildingStatus = { mode: 'density' | 'footprints' | 'hidden'; loading: boolean; count: number; error: string };
export const INITIAL_BUILDING_STATUS: BuildingStatus = { mode: 'density', loading: true, count: 0, error: '' };
const cache = new Map<string, Promise<unknown>>();

async function json<T>(file: string): Promise<T> {
  let pending = cache.get(file);
  if (!pending) {
    pending = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch('/buildings/' + file, { signal: AbortSignal.timeout(20000), cache: attempt ? 'reload' : 'default' });
          if (!response.ok) throw new Error(`Building data unavailable (${response.status}).`);
          return await decodedJSON(response);
        } catch (error) { if (attempt) throw error; }
      }
    })().catch(error => { cache.delete(file); throw error; });
    cache.set(file, pending);
  } else { cache.delete(file); cache.set(file, pending); }
  // Bound retained source geometry. All-Nepal footprints are never loaded at once.
  if (cache.size > 12) cache.delete(cache.keys().next().value!);
  return pending as Promise<T>;
}
export async function buildingManifest() {
  const manifest = await json<BuildingManifest>('manifest.json');
  if (manifest.version !== 1 || manifest.tileDegrees !== .05) throw new Error('Unsupported building dataset.');
  return manifest;
}
export function buildingTileKeys(bounds: number[], step: number, inventory: Record<string, unknown>) {
  const keys: string[] = [];
  for (let x = Math.floor(bounds[0] / step + 1e-8); x <= Math.floor(bounds[2] / step + 1e-8); x++)
    for (let y = Math.floor(bounds[1] / step + 1e-8); y <= Math.floor(bounds[3] / step + 1e-8); y++) {
      const key = `${x}-${y}`; if (Object.hasOwn(inventory, key)) keys.push(key);
    }
  return keys;
}
export function decodeBuilding([id, use, name, coordinates]: BuildingRecord): GeoFeature {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const polygon of coordinates) for (const ring of polygon) for (const [lng, lat] of ring) {
    w = Math.min(w, lng); s = Math.min(s, lat); e = Math.max(e, lng); n = Math.max(n, lat);
  }
  return { id, name, kind: 'building', layer: 'settlements', buildingTag: use,
    center: [(w + e) / 2, (s + n) / 2], bounds: [w, s, e, n], geometry: { type: 'MultiPolygon', coordinates } };
}
export async function loadBuildings(bounds: Bounds, manifest: BuildingManifest) {
  const keys = buildingTileKeys(bounds, manifest.tileDegrees, manifest.tiles);
  if (keys.length > 16 || keys.reduce((sum, key) => sum + manifest.tiles[key].count, 0) > 250000)
    throw new Error('Zoom closer for footprints in this dense area. Building density remains visible.');
  // A failed listed tile must never masquerade as an empty neighbourhood.
  const parts = await Promise.all(keys.map(key => json<BuildingRecord[]>(key + '.json.gz')));
  const features = new Map<string, GeoFeature>();
  for (const part of parts) for (const record of part) {
    if (features.has(record[0])) continue;
    const feature = decodeBuilding(record);
    if (intersects(feature.bounds, bounds)) features.set(feature.id, feature);
  }
  return [...features.values()];
}

export function paintBuildings(canvas: HTMLCanvasElement, features: GeoFeature[], bounds: Bounds, selectedId?: string) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const [w, s, e, n] = bounds;
  for (const feature of features) {
    if (feature.geometry.type !== 'MultiPolygon') continue;
    ctx.fillStyle = feature.id === selectedId ? '#fff3ad' : '#e7d3b3';
    for (const polygon of feature.geometry.coordinates) {
      ctx.beginPath();
      for (const ring of polygon) {
        ring.forEach(([lng, lat], i) => {
          const x = (lng - w) / (e - w) * canvas.width, y = (n - lat) / (n - s) * canvas.height;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
  }
}
