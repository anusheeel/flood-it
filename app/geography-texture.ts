import type { GeoFeature, Coordinate, LayerVisibility, PlaceEntry } from './geography';
import { paintSettlement } from './settlement-symbol';

// Drape mapped geometry directly onto the elevation mesh. Terrain UVs share these
// geographic bounds, so water follows the same triangles without floating lines.
export function paintGeography(canvas: HTMLCanvasElement, features: GeoFeature[], bounds: number[], layers: LayerVisibility, selected: PlaceEntry | null) {
  const ctx = canvas.getContext('2d')!;
  const [w, s, e, n] = bounds, size = canvas.width;
  const x = (lng: number) => (lng - w) / (e - w) * size;
  const y = (lat: number) => (n - lat) / (n - s) * size;
  ctx.clearRect(0, 0, size, size); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  function path(coords: Coordinate[], close = false) { coords.forEach((c, i) => i ? ctx.lineTo(x(c[0]), y(c[1])) : ctx.moveTo(x(c[0]), y(c[1]))); if (close) ctx.closePath(); }
  function polygon(coords: Coordinate[][]) { ctx.beginPath(); for (const ring of coords) path(ring, true); ctx.fill('evenodd'); ctx.stroke(); }
  for (const layer of ['settlements', 'lakes', 'rivers'] as const) {
    if (!layers[layer]) continue;
    for (const f of features) {
      if (f.layer !== layer) continue;
      const active = selected?.id === f.id || !!selected?.name && selected.layer === f.layer && selected.name === f.name;
      ctx.strokeStyle = active ? '#fff3ad' : layer === 'rivers' ? f.kind === 'river' ? '#7bc6d2cc' : '#76b3bf66' : layer === 'lakes' ? '#7fcedbc0' : '#d8b27b80';
      ctx.fillStyle = layer === 'settlements' ? active ? '#f1d683c9' : '#d8b27b60' : active ? '#32b9e8ee' : '#207c9bf0';
      ctx.lineWidth = active ? 4 : layer === 'rivers' ? f.kind === 'river' ? 2.2 : .8 : .7;
      if (f.geometry.type === 'LineString') { ctx.beginPath(); path(f.geometry.coordinates); ctx.stroke(); }
      else if (f.geometry.type === 'Polygon') polygon(f.geometry.coordinates);
      else if (f.geometry.type === 'MultiPolygon') f.geometry.coordinates.forEach(polygon);
      else { const p = f.geometry.coordinates;
        if(layer==='settlements')paintSettlement(ctx,x(p[0]),y(p[1]),active?18:f.kind==='city'?16:f.kind==='town'?13:9,active);
        else{ctx.beginPath();ctx.arc(x(p[0]),y(p[1]),active?5:3,0,Math.PI*2);ctx.fill();}
      }
    }
  }
}

function segmentDistance(p: Coordinate, a: Coordinate, b: Coordinate) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function inRing(p: Coordinate, ring: Coordinate[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function pickGeography(features: GeoFeature[], point: Coordinate, tolerance: number, layers: LayerVisibility) {
  let best: GeoFeature | null = null, distance = Infinity;
  for (const f of features) {
    if (!layers[f.layer]) continue;
    const [w, s, e, n] = f.bounds;
    if (point[0] < w - tolerance || point[0] > e + tolerance || point[1] < s - tolerance || point[1] > n + tolerance) continue;
    let d = Infinity;
    if (f.geometry.type === 'Point') d = Math.hypot(point[0] - f.center[0], point[1] - f.center[1]);
    else if (f.geometry.type === 'LineString') for (let i = 1; i < f.geometry.coordinates.length; i++) d = Math.min(d, segmentDistance(point, f.geometry.coordinates[i - 1], f.geometry.coordinates[i]));
    else {
      const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
      if (polys.some(p => inRing(point, p[0]) && !p.slice(1).some(ring => inRing(point, ring)))) d = tolerance * .85;
    }
    if (d <= tolerance && d < distance) { distance = d; best = f; }
  }
  return best;
}
