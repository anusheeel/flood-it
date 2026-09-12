import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import { createCanvas } from '@napi-rs/canvas';

function loader(overrides = {}) {
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (cache.has(name)) return cache.get(name);
    const m = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(new URL(`../app/${name}.ts`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', code)(id => id === 'three' ? THREE : load(id.slice(2)), m, m.exports);
    cache.set(name, m.exports); return m.exports;
  }
  return load;
}
const source = loader();
const { buildingManifest, loadBuildings, decodeBuilding, paintBuildings, buildingTileKeys } = source('buildings');
globalThis.fetch = async url => new Response(fs.readFileSync(new URL('../public' + url, import.meta.url)));
const manifest = await buildingManifest();
assert.equal(manifest.count, 8286549);
assert.equal(Object.keys(manifest.tiles).length, 4519);
assert.equal(Object.values(manifest.density).reduce((n, tile) => n + tile.count, 0), manifest.count);
const phewa = await loadBuildings([83.914, 28.185, 84.012, 28.252], manifest);
const ids = new Set(phewa.map(f => f.id));
const auditedIds = JSON.parse(fs.readFileSync(new URL('./fixtures/phewa-shore-building-ids.json', import.meta.url)));
assert.equal(auditedIds.length, 4549);
for (const id of auditedIds) assert(ids.has(id), `Missing independently audited shoreline building ${id}`);
assert.equal(ids.size, phewa.length, 'duplicated tile-edge buildings are deduplicated');
assert.equal(phewa.find(f => f.buildingTag === 'yes').kind, 'building', 'unspecified buildings must not be classified residential');
await assert.rejects(loadBuildings([80, 26, 88, 31], manifest), /Zoom closer/, 'nationwide footprints cannot be requested as one batch');
assert.deepEqual(buildingTileKeys([84, 28, 84.01, 28.01], .05, { '1680-560': {} }), ['1680-560'], 'exact boundary arithmetic');

const record = ['way/test', 'yes', '', [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[.4, .4], [.6, .4], [.6, .6], [.4, .6], [.4, .4]]]]];
const feature = decodeBuilding(record), canvas = createCanvas(100, 100);
paintBuildings(canvas, [feature], [0, 0, 1, 1]);
const alpha = (x, y) => canvas.getContext('2d').getImageData(x, y, 1, 1).data[3];
assert.equal(alpha(20, 20), 255); assert.equal(alpha(50, 50), 0, 'courtyard remains transparent');
const { pickGeography, paintGeography } = source('geography-texture');
const layers = { rivers: true, lakes: true, settlements: true };
assert.equal(pickGeography([feature], [.5, .5], 0, layers), null, 'courtyard is not a building hit');
assert.equal(pickGeography([feature], [.2, .2], 0, layers).id, feature.id);
paintGeography(canvas, [{ ...feature, kind: 'city', center: [.5, .5], geometry: { type: 'Point', coordinates: [.5, .5] } }], [0, 0, 1, 1], layers, null);
assert.equal(alpha(50, 50), 0, 'place labels do not paint invented houses on terrain');

let fail = true;
const retry = loader()('buildings');
globalThis.fetch = async () => fail ? new Response('Unavailable', { status: 503 }) : Response.json([record, record]);
const tinyManifest = { ...manifest, tiles: { '0-0': { count: 2 } } };
await assert.rejects(retry.loadBuildings([0, 0, .01, .01], tinyManifest), /unavailable/, 'failed tile is not an empty neighbourhood');
fail = false;
assert.equal((await retry.loadBuildings([0, 0, .01, .01], tinyManifest)).length, 1, 'retry recovers and deduplicates');

// Exercise real overlay state transitions with deferred tile responses.
globalThis.document = { createElement: () => createCanvas(1, 1) };
const waiting = [];
const mockBuildings = { ...source('buildings'), buildingManifest: async () => manifest,
  loadBuildings: () => new Promise(resolve => waiting.push(resolve)) };
const { BuildingOverlay } = loader({ buildings: mockBuildings })('building-overlay');
const states = [], overlay = new BuildingOverlay(status => states.push(status), true);
overlay.loadDensity = async () => {};
overlay.setModel([83, 27, 85, 29]);
const first = overlay.updateView([83.94, 28.21], 4); await Promise.resolve();
const second = overlay.updateView([84.04, 28.21], 4); await Promise.resolve();
waiting[1]([feature]); await second;
waiting[0]([]); await first;
assert.equal(states.at(-1).count, 1, 'old empty response cannot replace newer view');
assert.equal(overlay.uniforms.buildingDetailReady.value, 1);
overlay.setVisible(false); assert.equal(states.at(-1).mode, 'hidden');
overlay.setVisible(true); await overlay.updateView([84.04, 28.21], 40);
assert.equal(overlay.uniforms.buildingDetailReady.value, 0, 'zoom-out restores density');
const pending = overlay.updateView([83.94, 28.21], 4); await Promise.resolve();
overlay.dispose(); const stateCount = states.length; waiting[2]([feature]); await pending;
assert.equal(states.length, stateCount, 'disposed scene ignores in-flight tiles');
console.log('PASS: all 4,549 independently audited Phewa shoreline buildings recovered; original holes, precise picking, tile deduplication, bounded detail loading, missing-data retry, density totals, no invented houses, stale-response rejection, toggling and disposal.');
