# Flood IT · Nepal

An interactive Three.js atlas of Nepal’s mountains, rivers, lakes and settlements, with experimental terrain-connected flood exposure screening.

**Explore → Scenario → Review → Capture.** Follow a mountain range, select a natural river or stream, set a hypothetical channel-reference offset, and inspect the mapped residential land touched by the scenario. Download an area snapshot with its scenario and source notes attached.

## What you can explore

- 148 elevation-based terrain models, including a Nepal overview, mountain ranges, summits and adjoining landscape windows.
- Mapped rivers and streams, lakes and ponds, settlement locations and residential land-use polygons.
- Pan and Orbit modes with P / O shortcuts, Shift-drag for the alternate mode, zoom, compass and a west-to-east range navigator.
- Local flood scenarios for natural river and stream reaches: choose up to 6, 12 or 20 km, subject to connected geometry and data quality.
- Residential area exposure, sensitivity at ±1 m, scenario comparison, source polygons and JSON reports.
- Focused area inspection with Previous / Next and a downloadable PNG of the actual 3D view and result context.

## Read this before interpreting results

This is **experimental, uncalibrated screening, not an operational forecast**. It does not calculate rainfall, discharge, velocity, flood arrival time, return periods or probabilities. It cannot support evacuation decisions or certify an area as safe.

A scenario’s offset is relative to an estimated channel surface derived from elevation data. It is **not today’s river level or a gauge reading**. Results cover a local assessment window; exposure may continue beyond it. Areas outside the assessed window have no result.

House symbols mark settlement locations. Shaded polygons represent residential land use, **not individual buildings or counts of homes or people**. Red fills identify the residential portion intersected by the estimated extent; a red outline locates a polygon with some exposure. OSM coverage varies.

Terrain materials and snow colours are illustrative, not satellite imagery. Nearby features are geographically grouped; the explorer does not assert verified basin-wide drainage connections.

[Method, data and validation notes](public/flood/method.html) · [Flood data licence](public/flood/LICENSE.txt) · [Geography licence](public/geography/LICENSE.txt)

## Run locally

Node.js 22.13+ and npm are required. Node.js 24 is used on Vercel.

```sh
npm ci
npm run dev
```

Open the local URL printed by Next.js. No API keys are required. The build bundles a separate analysis worker to a hashed, same-origin public asset before starting Next.js. Keep this step: it avoids worker URLs resolving to local `file://` paths after deployment.

```sh
npm test
npm run lint
npm run build
npm start
```

The tests cover connected inundation, geometry and area accounting, missing elevations, sensitivity, worker cancellation, UI progression and result retention, snapshot PNG encoding, partial map-layer failures, and the actual production worker asset URL. They do not constitute hydraulic calibration.

## Deploy to Vercel

Import this GitHub repository into Vercel with the **Next.js** preset. Use `npm ci` to install and `npm run build` to build. Deploy from Git so the full bundled geographic dataset is included; a CLI source upload can exceed the Hobby upload allowance.

The single server route, `/api/elevation/[lat]/[lng]`, streams bounded byte ranges from the fixed public Copernicus DEM bucket. It validates Nepal tile coordinates and byte ranges. Flood calculations run in the browser worker. No accounts, tracking, private databases or credentials are required by the app.

Static terrain and OSM snapshot assets are included for reproducibility. Avoid committing generated `.next`, `node_modules`, `.vercel`, environment files, raw input PBF/TIFF scratch data or hosting credentials. To update OSM data, use the import/reproduction scripts with a current licensed extract and update the source manifest and documentation.

## Data and attribution

- © OpenStreetMap contributors, ODbL 1.0; Nepal extract from Geofabrik, snapshot 2026-09-06. Geographic data and derived databases retain their own terms.
- Elevation display models: [Mapterhorn attribution](https://mapterhorn.com/attribution/).
- Analysis elevation: Produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. See the full notices and liability statement in `public/flood/LICENSE.txt`.
- Mountain inventory: Gurung, *Mountain Peaks of Nepal Himalaya* (2021), with regional tourism references documented in the app.
- Everest photograph: Vyacheslav Argenberg / Wikimedia Commons, CC BY 4.0; cropped.

Application code is MIT licensed. This licence does **not** replace the licences or attribution obligations of geographic datasets, elevation data, photographs or dependencies.

## Interface concept

[Sidebar and area-inspection mockup](docs/sidebar-concept.png) — AI-generated interface concept. Its landscape and example polygons are illustrative; the running app uses the included elevation and mapped data. The concept is not a flood result.
