import * as THREE from 'three';
import { buildingManifest, buildingTileKeys, loadBuildings, paintBuildings, type Bounds, type BuildingStatus } from './buildings';
import { paintGeography, pickGeography } from './geography-texture';
import type { GeoFeature, LayerVisibility, PlaceEntry } from './geography';
import { paintFlood } from './flood-texture';
import type { FloodPilot, FloodResult } from './flood';

export class BuildingOverlay {
  private density = document.createElement('canvas');
  private detail = document.createElement('canvas');
  private detailGeography = document.createElement('canvas');
  private geography: { features: GeoFeature[]; layers: LayerVisibility; selected: PlaceEntry | null; pilot: FloodPilot | null; result: FloodResult | null } | null = null;
  readonly uniforms: {
    buildingDensity: { value: THREE.CanvasTexture }; buildingDetail: { value: THREE.CanvasTexture }; geographyDetail: { value: THREE.CanvasTexture };
    buildingRect: { value: THREE.Vector4 }; buildingDetailReady: { value: number }; buildingsVisible: { value: number };
  };
  private bounds: Bounds | null = null;
  private detailBounds: Bounds | null = null;
  private features: GeoFeature[] = [];
  private generation = 0;
  private detailGeneration = 0;
  private key = '';
  private selectedId?: string;
  private controller: AbortController | null = null;
  private status: BuildingStatus = { mode: 'density', loading: true, count: 0, error: '' };
  private densityError = '';
  private detailError = '';
  private detailLoading = false;
  private densityLoading = false;

  constructor(private onStatus: (status: BuildingStatus) => void, small: boolean) {
    this.density.width = this.density.height = small ? 2048 : 4096;
    this.detail.width = this.detail.height = 2048;
    this.detailGeography.width = this.detailGeography.height = 2048;
    const texture = (canvas: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return t;
    };
    this.uniforms = { buildingDensity: { value: texture(this.density) }, buildingDetail: { value: texture(this.detail) }, geographyDetail: { value: texture(this.detailGeography) },
      buildingRect: { value: new THREE.Vector4(0, 0, 1, 1) }, buildingDetailReady: { value: 0 }, buildingsVisible: { value: 1 } };
  }
  private report(changes: Partial<BuildingStatus>) {
    this.status = { ...this.status, ...changes, loading: this.densityLoading || this.detailLoading, error: [this.densityError, this.detailError].filter(Boolean).join(' ') };
    this.onStatus({ ...this.status, mode: this.uniforms.buildingsVisible.value ? this.status.mode : 'hidden' });
  }
  setVisible(visible: boolean) { this.uniforms.buildingsVisible.value = +visible; this.report({}); }
  setModel(bounds: Bounds) {
    if (this.bounds?.every((v, i) => v === bounds[i])) return;
    this.bounds = [...bounds]; this.detailLoading = false; this.detailError = ''; this.generation++; this.detailGeneration++; this.key = '';
    this.detailBounds = null; this.features = []; this.uniforms.buildingDetailReady.value = 0;
    this.density.getContext('2d')!.clearRect(0, 0, this.density.width, this.density.height);
    this.uniforms.buildingDensity.value.needsUpdate = true;
    void this.loadDensity();
  }
  retry() { this.key = ''; void this.loadDensity(); }
  private async loadDensity() {
    if (!this.bounds) return;
    this.controller?.abort(); const controller = new AbortController(); this.controller = controller;
    const generation = this.generation, bounds = this.bounds;
    this.densityLoading = true; this.densityError = ''; this.report({ loading: true, error: '' });
    try {
      const manifest = await buildingManifest();
      if (generation !== this.generation || controller.signal.aborted) return;
      const keys = buildingTileKeys(bounds, manifest.densityTileDegrees, manifest.density);
      // Compose offscreen, then swap atomically. Limit concurrent decoded images;
      // never retain hundreds of 1024-square bitmaps for the national overview.
      const canvas = document.createElement('canvas'); canvas.width = this.density.width; canvas.height = this.density.height;
      const ctx = canvas.getContext('2d')!, [w, s, e, n] = bounds;
      let cursor = 0;
      const results = await Promise.allSettled(Array.from({ length: Math.min(4, keys.length) }, async () => {
        while (cursor < keys.length && !controller.signal.aborted) {
          const key = keys[cursor++];
          const response = await fetch(`/buildings/${key}.png`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
          if (!response.ok) throw new Error('A building density tile could not load.');
          const bitmap = await createImageBitmap(await response.blob());
          try {
            const [x, y] = key.split('-').map(Number), step = manifest.densityTileDegrees;
            ctx.drawImage(bitmap, (x * step - w) / (e - w) * canvas.width, (n - (y + 1) * step) / (n - s) * canvas.height,
              step / (e - w) * canvas.width, step / (n - s) * canvas.height);
          } finally { bitmap.close(); }
        }
      }));
      if (generation !== this.generation || controller.signal.aborted) return;
      if (results.some(result => result.status === 'rejected')) throw new Error('Building density could not load completely. Retry buildings.');
      const target = this.density.getContext('2d')!; target.clearRect(0, 0, this.density.width, this.density.height); target.drawImage(canvas, 0, 0);
      this.uniforms.buildingDensity.value.needsUpdate = true; this.densityLoading = false;
      this.report({ loading: false, error: '' });
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      this.densityLoading = false;
      this.densityError = error instanceof Error ? error.message : 'Building density unavailable.';
      this.report({ loading: false, error: this.densityError });
    }
  }
  // Called after camera motion settles. Bounds describe a local view window,
  // independent of the coarse full-range geography texture.
  async updateView(center: [number, number], distance: number) {
    if (!this.bounds || !this.uniforms.buildingsVisible.value) return;
    if (distance > 14) {
      if (this.key !== 'density') {
        this.key = 'density'; this.detailLoading = false; this.detailError = ''; this.detailGeneration++; this.uniforms.buildingDetailReady.value = 0; this.features = [];
        this.report({ mode: 'density', count: 0, loading: this.densityLoading, error: this.densityError });
      }
      return;
    }
    const span = distance < 5 ? .04 : distance < 9 ? .08 : .12, snap = span / 4;
    const x = Math.round(center[0] / snap) * snap, y = Math.round(center[1] / snap) * snap;
    const key = `${x.toFixed(4)}:${y.toFixed(4)}:${span}`;
    if (key === this.key) return;
    this.key = key; this.detailError = ''; this.detailLoading = false; const generation = ++this.detailGeneration;
    const [mw, ms, me, mn] = this.bounds;
    const bounds: Bounds = [Math.max(mw, x - span / 2), Math.max(ms, y - span / 2), Math.min(me, x + span / 2), Math.min(mn, y + span / 2)];
    this.uniforms.buildingDetailReady.value = 0; this.features = [];
    if (bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) { this.report({ mode: 'density', count: 0 }); return; }
    this.detailLoading = true;
    this.report({ mode: 'density', loading: true, count: 0, error: this.densityError });
    try {
      const manifest = await buildingManifest();
      if (generation !== this.detailGeneration) return;
      const features = await loadBuildings(bounds, manifest);
      if (generation !== this.detailGeneration) return;
      this.detailLoading = false;
      paintBuildings(this.detail, features, bounds, this.selectedId);
      this.features = features; this.detailBounds = bounds;
      this.paintLocalGeography();
      this.uniforms.buildingRect.value.set((bounds[0] - mw) / (me - mw), (bounds[1] - ms) / (mn - ms), (bounds[2] - mw) / (me - mw), (bounds[3] - ms) / (mn - ms));
      this.uniforms.buildingDetail.value.needsUpdate = true; this.uniforms.buildingDetailReady.value = 1;
      this.report({ mode: 'footprints', loading: this.densityLoading, count: features.length, error: this.densityError });
    } catch (error) {
      if (generation !== this.detailGeneration) return;
      this.detailLoading = false; this.detailError = error instanceof Error ? error.message : 'Building footprints unavailable.';
      this.report({ mode: 'density', count: 0 });
    }
  }
  select(id?: string) {
    this.selectedId = id;
    if (this.detailBounds && this.features.length) {
      paintBuildings(this.detail, this.features, this.detailBounds, id); this.uniforms.buildingDetail.value.needsUpdate = true;
    }
  }
  setGeography(features: GeoFeature[], layers: LayerVisibility, selected: PlaceEntry | null, pilot: FloodPilot | null, result: FloodResult | null) {
    this.geography = { features, layers, selected, pilot, result }; this.paintLocalGeography();
  }
  private paintLocalGeography() {
    if (!this.detailBounds || !this.geography) return;
    const { features, layers, selected, pilot, result } = this.geography;
    // Use the same local resolution for the shoreline and buildings so a coarse
    // water texel cannot paint over real lakeside footprints as the user zooms.
    paintGeography(this.detailGeography, features, this.detailBounds, layers, selected);
    if (pilot) paintFlood(this.detailGeography, pilot, result, this.detailBounds, selected?.id ?? null);
    this.uniforms.geographyDetail.value.needsUpdate = true;
  }
  pick(point: [number, number]) {
    if (!this.uniforms.buildingsVisible.value || !this.uniforms.buildingDetailReady.value || !this.detailBounds) return null;
    const [w, s, e, n] = this.detailBounds;
    if (point[0] < w || point[0] > e || point[1] < s || point[1] > n) return null;
    const feature = pickGeography(this.features, point, 0, { rivers: false, lakes: false, settlements: true });
    return feature ? { ...feature, center: point } : null;
  }
  dispose() {
    this.generation++; this.detailGeneration++; this.controller?.abort();
    this.uniforms.buildingDensity.value.dispose(); this.uniforms.buildingDetail.value.dispose(); this.uniforms.geographyDetail.value.dispose(); this.features = [];
  }
}
