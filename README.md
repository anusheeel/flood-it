# Flood IT · Nepal

[Open the live atlas](https://flood-it-rose.vercel.app)

An interactive Three.js atlas of Nepal’s mountains, rivers, lakes and settlements, with experimental terrain-connected flood exposure screening.

**Explore → Scenario → Review → Capture.** Follow a mountain range, select a natural river or stream, set a hypothetical channel-reference offset, and inspect the mapped residential land touched by the scenario. Download an area snapshot with its scenario and source notes attached.

## What you can explore

- 148 elevation-based terrain models, including a Nepal overview, mountain ranges, summits and adjoining landscape windows.
- Mapped rivers and streams, lakes and ponds, settlement locations and residential land-use polygons.
- Pan and Orbit modes with P / O shortcuts, Shift-drag for the alternate mode, zoom, compass and a west-to-east range navigator.
- Local flood scenarios for natural river and stream reaches: choose up to 6, 12 or 20 km, subject to connected geometry and data quality.
- Residential area exposure, sensitivity at ±1 m, scenario comparison, source polygons and JSON reports.
- Focused area inspection with Previous / Next and a downloadable PNG of the actual 3D view and result context.


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


## Data and attribution

- © OpenStreetMap contributors, ODbL 1.0; Nepal extract from Geofabrik, snapshot 2026-09-06. Geographic data and derived databases retain their own terms.
- Elevation display models: [Mapterhorn attribution](https://mapterhorn.com/attribution/).
- Analysis elevation: Produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. See the full notices and liability statement in `public/flood/LICENSE.txt`.
- Mountain inventory: Gurung, *Mountain Peaks of Nepal Himalaya* (2021), with regional tourism references documented in the app.
- Everest photograph: Vyacheslav Argenberg / Wikimedia Commons, CC BY 4.0; cropped.

Application code is MIT licensed. This licence does **not** replace the licences or attribution obligations of geographic datasets, elevation data, photographs or dependencies.

