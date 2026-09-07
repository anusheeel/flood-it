'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Mountain, Waves, House, Compass, Pause, X, Plus, Minus, RotateCcw, Layers, Info, ChevronRight, Hand, Orbit, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ranges, peaks, type Range, type Peak } from './mountains';
import type { MountainScene } from './terrain-scene';
import GeographyPanel from './geography-panel';
import RangeNavigation from './range-navigation';
import FloodPanel from './flood-panel';
import { loadPilot, pilotFeature, PILOT_CENTER, type FloodPilot, type FloodResult } from './flood';
import { DEFAULT_LAYERS, featureName, geographyJSON, type GeographyStatus, type PlaceEntry } from './geography';

const TOUR = ['everest','kanchenjunga','makalu','manaslu','annapurna','dhaulagiri','saipal','api'];
export default function Home() {
  const container = useRef<HTMLDivElement>(null);
  const mountain = useRef<MountainScene | null>(null);
  const navigationId=useRef(0);
  const selectRef = useRef<(p: Peak) => Promise<void>>(async()=>{});
  const rangeActionRef = useRef<(r: Range) => Promise<void>>(async()=>{});
  const geoActionRef = useRef<(p: PlaceEntry) => Promise<boolean>>(async()=>false);
  const floodContext=useRef<{pilot:FloodPilot|null;result:FloodResult|null}>({pilot:null,result:null});
  const [floodRiver,setFloodRiver]=useState<PlaceEntry|null>(null);
  const [step,setStep]=useState<'explore'|'scenario'|'review'>('explore');

  const stepRef=useRef(step);
  useEffect(()=>{stepRef.current=step;},[step]);
  const [floodResult,setFloodResult]=useState<FloodResult|null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Peak | null>(null);
  const [overviewMode, setOverviewMode] = useState(false);
  const [rangeId, setRangeId] = useState('annapurna');
  const [query, setQuery] = useState('');
  const [info, setInfo] = useState(false);
  const [settings, setSettings] = useState(false);
  const [is3d, set3d] = useState(true);
  const [labels, setLabels] = useState(true);
  const [exaggeration, setExaggeration] = useState(1.2);
  const [satellite, setSatellite] = useState(true);
  const [tour, setTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [geoOpen, setGeoOpen] = useState(true);
  const [navigationMode, setNavigationMode] = useState<'pan'|'orbit'>('pan');
  const [terrainBounds, setTerrainBounds] = useState<number[]|null>(null);
  const [continuing, setContinuing] = useState(false);
  const [geoFeature, setGeoFeature] = useState<PlaceEntry|null>(null);
  const [geoLayers, setGeoLayers] = useState(DEFAULT_LAYERS);
  const [geoStatus, setGeoStatus] = useState<GeographyStatus>({loading:true,error:'',counts:{rivers:0,lakes:0,settlements:0},overview:false});
  const [position, setPosition] = useState({lng:83.88,lat:28.48,bearing:0});
  const activeRange = ranges.find(r=>r.id===rangeId)!;

  function stopTour(){setTour(false);}
  function closeFlood(){setStep('explore');setGeoOpen(true);}
  const showFloodOverlay=useCallback((pilot:FloodPilot|null,result:FloodResult|null)=>{floodContext.current={pilot,result};mountain.current?.setFloodOverlay(pilot,result);setFloodResult(result);},[]);
  async function openPilot(){
    stopTour();clearAssessment();setQuery('');const pilot=await loadPilot();if(!await loadTerrain('flood-narayani',PILOT_CENTER))return false;
    const feature=pilotFeature(pilot);setGeoFeature(feature);setFloodRiver(feature);setSelected(null);setOverviewMode(false);mountain.current?.selectGeography(feature);return true;
  }
  function openFlood(){stopTour();setQuery('');setStep('scenario');setGeoOpen(true);if(geoFeature?.layer==='rivers'&&geoFeature.id!==floodRiver?.id)setFloodRiver(geoFeature);}
  function clearAssessment(){floodContext.current={pilot:null,result:null};setFloodResult(null);setFloodRiver(null);mountain.current?.setFloodOverlay(null,null);}
  async function chooseFloodRiver(feature:PlaceEntry){clearAssessment();if(await flyGeography(feature,true))setFloodRiver(feature);}
  function changeNavigation(mode:'pan'|'orbit'){
    mountain.current?.setNavigationMode(mode);
    setNavigationMode(mode);
  }
  async function loadTerrain(id:string,coords:[number,number],peakId:string|null=null){
    const scene=mountain.current;if(!scene)return false;
    const token=++navigationId.current;setLoading(true);setError('');
    try{const complete=await scene.load(id,coords,peakId);if(complete&&token===navigationId.current){setReady(true);setLoading(false);return true;}return false;}
    catch(error){if(token===navigationId.current){setLoading(false);setError(error instanceof Error?error.message:'The mountain model could not be loaded.');}throw error;}
  }
  async function flyPeak(p:Peak){clearAssessment();closeFlood();setQuery('');setGeoFeature(null);setOverviewMode(false);setSelected(p);setRangeId(p.range);if(window.innerWidth<760)setGeoOpen(false);await loadTerrain('peak-'+p.id,p.coords,p.id);}
  async function flyRange(r:Range){clearAssessment();closeFlood();stopTour();setQuery('');setGeoFeature(null);setOverviewMode(false);setRangeId(r.id);setSelected(null);if(window.innerWidth<760)setGeoOpen(false);await loadTerrain('range-'+r.id,r.id==='annapurna'?[83.88,28.48]:r.coords);}
  function overview(){clearAssessment();closeFlood();stopTour();setQuery('');setGeoFeature(null);setOverviewMode(true);setSelected(null);void loadTerrain('nepal',[84.14,28.45]).catch(()=>{});}
  async function flyGeography(feature:PlaceEntry,keepFlood=false){
    if(!keepFlood){clearAssessment();closeFlood();}
    const scene=mountain.current;if(!scene)return false;stopTour();setQuery('');setGeoOpen(window.innerWidth>=760);setGeoFeature(feature);setSelected(null);setOverviewMode(false);setGeoLayers(layers=>({...layers,[feature.layer]:true}));
    const token=++navigationId.current;setLoading(true);setError('');
    try{const complete=await scene.focusGeography(feature);if(complete&&token===navigationId.current){setReady(true);setLoading(false);return true;}return false;}
    catch(error){if(token===navigationId.current){setLoading(false);setError(error instanceof Error?error.message:'This landscape could not be loaded.');}return false;}
  }
  useEffect(()=>{selectRef.current=async p=>{stopTour();await flyPeak(p);};rangeActionRef.current=flyRange;geoActionRef.current=flyGeography;});
  useEffect(()=>{
    let cancelled=false;
    import('./terrain-scene').then(async({MountainScene})=>{
      if(cancelled||!container.current)return;if(window.innerWidth<760)setGeoOpen(false);
      try{
        const scene=new MountainScene(container.current,{onPeak:p=>{void selectRef.current(p).catch(()=>{});},onInteraction:()=>setTour(false),onPosition:(lng,lat,bearing)=>setPosition({lng,lat,bearing}),onError:setError,onFeature:feature=>{setGeoFeature(feature);if(feature.layer==='rivers'&&stepRef.current!=='explore'){setStep('scenario');setFloodRiver(feature);}if(feature.kind==='residential'&&floodContext.current.result)setStep('review');setGeoOpen(true);setTour(false);},onGeography:setGeoStatus,onWindow:bounds=>setTerrainBounds(bounds),onContinuing:setContinuing});
        mountain.current=scene;await scene.load('range-annapurna',[83.88,28.48]);scene.setFloodOverlay(floodContext.current.pilot,floodContext.current.result);
        if(!cancelled){setReady(true);setLoading(false);}
      }catch(error){if(!cancelled){setLoading(false);setError(error instanceof Error?error.message:'The browser could not start 3D graphics. Please enable WebGL or try another browser.');}}
    }).catch(()=>{setLoading(false);setError('The 3D renderer could not load. Please reload the page.');});
    return()=>{cancelled=true;mountain.current?.dispose();mountain.current=null;};
  },[]);
  useEffect(()=>{mountain.current?.setNavigationMode(navigationMode);},[navigationMode,ready]);
  useEffect(()=>{
    const shortcut=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.repeat||event.ctrlKey||event.metaKey||event.altKey)return;
      const target=event.target;
      if(target instanceof Element&&target.closest('input,textarea,select,[contenteditable],[role="dialog"]'))return;
      if(document.querySelector('[role="dialog"]'))return;
      const key=event.key.toLowerCase();if(key!=='p'&&key!=='o')return;
      event.preventDefault();changeNavigation(key==='p'?'pan':'orbit');
    };
    window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);
  },[]);
  useEffect(()=>{mountain.current?.setLabels(labels);},[labels,ready]);
  useEffect(()=>{mountain.current?.setExaggeration(exaggeration);},[exaggeration]);
  useEffect(()=>{mountain.current?.setTopDown(!is3d);},[is3d]);
  useEffect(()=>{mountain.current?.setSurface(satellite);},[satellite]);
  useEffect(()=>{mountain.current?.setLayers(geoLayers);},[geoLayers,ready]);
  useEffect(()=>{
    if(!tour||!ready)return;
    let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    const p=peaks.find(p=>p.id===TOUR[tourStep])!;
    const start=requestAnimationFrame(()=>{void flyPeak(p).then(()=>{if(!cancelled)timer=setTimeout(()=>{if(tourStep<TOUR.length-1)setTourStep(s=>s+1);else setTour(false);},7000);}).catch(()=>setTour(false));});
    return()=>{cancelled=true;cancelAnimationFrame(start);clearTimeout(timer);};
  },[tour,tourStep,ready]);

  useEffect(()=>{
    const context=(document as Document & {modelContext?: {registerTool:(tool:object,options:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    try{void Promise.resolve(context.registerTool({
      name:'navigate_nepal_mountain',title:'Explore a Nepal mountain or range',
      description:'Move the 3D atlas to a named mountain or range and display its visitor information.',
      inputSchema:{type:'object',properties:{name:{type:'string',description:'An exact range or peak name, for example Everest or Annapurna Himal.'}},required:['name'],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      async execute(input:unknown){
        if(!input||typeof input!=='object'||typeof (input as {name?:unknown}).name!=='string'||Object.keys(input).some(k=>k!=='name'))throw new Error('Provide only a mountain or range name.');
        const name=(input as {name:string}).name.trim().toLowerCase();
        const p=peaks.find(p=>p.name.toLowerCase()===name||p.id===name);
        const r=ranges.find(r=>r.name.toLowerCase()===name||r.id===name);
        if(!p&&!r)throw new Error('Mountain or range not found.');
        const m=mountain.current;if(!m?.isReady())throw new Error('The mountain scene is still loading. Try again shortly.');
        if(p)await selectRef.current(p);else if(r)await rangeActionRef.current(r);
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        return {name:p?.name??r?.name,kind:p?'summit':'range',center:m.getCoordinates(),heightMetres:p?.height??null,renderer:'Three.js'};
      }
    },{signal:lifecycle.signal})).catch(()=>{});}catch{/* Unsupported implementations leave the normal explorer available. */}
    try{void Promise.resolve(context.registerTool({
      name:'navigate_nepal_place',title:'Explore a Nepal river, lake or settlement',
      description:'Move the 3D terrain to a mapped river, lake or settlement and show the same information as selecting it in the place directory.',
      inputSchema:{type:'object',properties:{name:{type:'string',description:'Exact mapped name, such as Phewa Lake or Kathmandu, or an OpenStreetMap feature ID such as relation/8202581.'}},required:['name'],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:true},
      async execute(input:unknown){
        if(!input||typeof input!=='object'||typeof (input as {name?:unknown}).name!=='string'||Object.keys(input).some(k=>k!=='name'))throw new Error('Provide only a mapped place name or ID.');
        const name=(input as {name:string}).name.trim().toLowerCase();
        const index=await geographyJSON<PlaceEntry[]>('index.json');const matches=index.filter(f=>f.name.toLowerCase()===name||f.localName?.toLowerCase()===name||f.id===name);
        if(!matches.length)throw new Error('Mapped place not found.');
        if(matches.length>1&&!matches.every(f=>f.layer==='rivers'))throw new Error('Several mapped places share that name. Use its OpenStreetMap feature ID.');
        const scene=mountain.current;if(!scene?.isReady())throw new Error('The terrain is still loading. Try again shortly.');
        const place=matches[0];if(!await geoActionRef.current(place))throw new Error('The requested terrain view could not be loaded.');
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        return {name:featureName(place),kind:place.kind,id:place.id,center:scene.getCoordinates(),renderer:'Three.js'};
      }
    },{signal:lifecycle.signal})).catch(()=>{});}catch{/* The directory remains available without WebMCP. */}
    return()=>lifecycle.abort();
  },[]);

  return <main className="atlas">
    <header className="masthead"><Link className="brand" href="/" aria-label="Flood IT home"><span className="brand-mark" aria-hidden="true"><Mountain size={30} strokeWidth={1.35}/><Waves size={28} strokeWidth={1.4}/></span><div>FLOOD <b>IT</b><span>NEPAL · RANGES &amp; RIVERS</span></div></Link><label className="atlas-search"><Search size={18}/><input aria-label="Search mountains rivers lakes and settlements" placeholder="Search mountains, rivers, places…" value={query} onChange={e=>{setQuery(e.target.value);if(e.target.value){setStep('explore');setGeoOpen(true);}}} onKeyDown={e=>{if(e.key==='Escape')setQuery('');}}/>{query&&<button aria-label="Clear landscape search" onClick={()=>setQuery('')}><X size={16}/></button>}</label><div className="header-actions"><button className="quiet-button" onClick={()=>setInfo(true)}>About &amp; method</button><button className="tour-button" aria-label={tour?'Pause mountain journey':'Take a mountain journey'} onClick={()=>{if(tour)setTour(false);else{setTourStep(0);setTour(true);setGeoOpen(false);}}} disabled={!ready||loading}>{tour?<Pause size={15}/>:<Mountain size={16} strokeWidth={1.5}/>}<span>{tour?'Pause journey':'Take a journey'}</span></button></div></header>
    <div className={`workspace ${geoOpen?'explorer-open':''} ${floodResult?'has-assessment':''} unified-workspace`}>
      <div className={`explorer-shell ${geoOpen?'':'is-collapsed'}`} aria-label="Landscape and flood explorer">
        <nav className="workflow-nav" aria-label="Exploration steps">
          {(['explore','scenario','review'] as const).map((item,i)=><button key={item} aria-current={step===item?'step':undefined} disabled={item==='review'&&!floodResult} onClick={()=>{setStep(item);setGeoOpen(true);if(item==='scenario')openFlood();}}><span>{String(i+1).padStart(2,'0')}</span>{item[0].toUpperCase()+item.slice(1)}</button>)}
          <button className="collapse-explorer" aria-label={geoOpen?'Collapse explorer':'Expand explorer'} onClick={()=>setGeoOpen(v=>!v)}>{geoOpen?<ChevronUp size={17}/>:<ChevronDown size={17}/>}</button>
        </nav>
        <div className="explorer-content" hidden={!geoOpen}>
          <div className="explorer-pane" hidden={step!=='explore'}><GeographyPanel key={rangeId+':'+(selected?.id??'')} open={true} onOpen={setGeoOpen} query={query} onQuery={setQuery} layers={geoLayers} onLayers={setGeoLayers} status={geoStatus} selected={geoFeature} summit={selected} range={activeRange} country={overviewMode} bounds={terrainBounds} onPeak={p=>{stopTour();void flyPeak(p).catch(()=>{});}} onRange={r=>{void flyRange(r).catch(()=>{});}} onSelect={p=>{void flyGeography(p);}} onClear={()=>{setGeoFeature(null);mountain.current?.selectGeography(null);}} onRetry={()=>{void mountain.current?.refreshGeography();}} busy={loading||continuing||!ready} onFlood={openFlood}/>{floodResult&&<button className="resume-review" onClick={()=>setStep('review')}><Waves size={16}/>Return to +{floodResult.scenario.stage.toFixed(1)} m results<ChevronRight size={16}/></button>}</div>
          <div className="explorer-pane" hidden={step==='explore'}><FloodPanel key={floodRiver?`${floodRiver.id}:${floodRiver.center.join(',')}`:'no-reach'} river={floodRiver} selected={geoFeature} ready={ready&&!loading} onPilot={openPilot} bounds={terrainBounds??[79.35,25.35,88.65,31.15]} onRiver={river=>{setStep('scenario');void chooseFloodRiver(river);}} onInspect={area=>{void flyGeography(area,true);}} onOverlay={showFloodOverlay} onClose={closeFlood} review={step==='review'&&geoOpen} onReview={()=>setStep('review')} onEdit={()=>setStep('scenario')} onCapture={()=>{const scene=mountain.current;if(!scene)throw new Error('The terrain is still loading.');return scene.captureView();}} onClearSelection={()=>{setGeoFeature(null);mountain.current?.selectGeography(null);}}/></div>
        </div>
      </div>
      <section className="map-stage" aria-label="Interactive 3D terrain of Nepal">
        <div className="map-canvas three-canvas" ref={container} style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>
        <div className="map-topline"><div className="navigation-modes" data-mode={navigationMode} aria-label="Drag navigation mode"><button aria-label="Pan mode" aria-keyshortcuts="P" title="Pan · P" aria-pressed={navigationMode==='pan'} onClick={()=>changeNavigation('pan')}><Hand size={17}/>Pan<kbd aria-hidden="true">P</kbd></button><button aria-label="Orbit mode" aria-keyshortcuts="O" title="Orbit · O" aria-pressed={navigationMode==='orbit'} onClick={()=>changeNavigation('orbit')}><Orbit size={17}/>Orbit<kbd aria-hidden="true">O</kbd></button></div><span className="navigation-hint">Shift-drag to {navigationMode==='pan'?'orbit':'pan'}</span></div>
        {continuing&&<output className="terrain-continuation">Loading adjoining landscape…</output>}
        {loading&&!error&&<output className="map-loading"><Mountain size={35}/><span>Loading your landscape…</span><small>Building the mountain mesh from real elevation</small></output>}
        {error&&<div className="map-error" role="alert"><Info size={20}/><p>{error}</p><button onClick={()=>window.location.reload()}>Reload</button></div>}
        <div className="map-tools" aria-label="Map controls"><button aria-label="Zoom in" onClick={()=>mountain.current?.zoom(.8)}><Plus size={21}/></button><button aria-label="Zoom out" onClick={()=>mountain.current?.zoom(1.25)}><Minus size={21}/></button><button className="north-control" title="Reset north" aria-label="Reset map to north" onClick={()=>mountain.current?.resetNorth()}><Compass size={21} style={{transform:`rotate(${-position.bearing}deg)`}}/><small>N</small></button><button className={is3d?'on':''} aria-label={is3d?'Switch to top-down view':'Switch to 3D perspective'} onClick={()=>set3d(v=>!v)}>{is3d?'3D':'TOP'}</button><button aria-label="Terrain and map settings" aria-expanded={settings} onClick={()=>setSettings(v=>!v)}><Layers size={18}/></button></div>
        {settings&&<div className="settings-panel"><div className="settings-title">Your perspective<button aria-label="Close map settings" onClick={()=>setSettings(false)}><X size={17}/></button></div><label htmlFor="surface-colours">Natural surface colours<Switch id="surface-colours" checked={satellite} onCheckedChange={setSatellite}/></label><label htmlFor="landscape-labels">Landscape labels<Switch id="landscape-labels" checked={labels} onCheckedChange={setLabels}/></label><label htmlFor="perspective-view">Perspective view<Switch id="perspective-view" checked={is3d} onCheckedChange={set3d}/></label><div className="elevation-label">Terrain height <span>{exaggeration.toFixed(1)}×</span></div><Slider aria-label="Terrain elevation exaggeration" min={1} max={2} step={.1} value={[exaggeration]} onValueChange={v=>setExaggeration(Array.isArray(v)?v[0]:v)} disabled={!is3d}/><p>1× shows natural proportions.</p><div className="perspective-actions"><button onClick={()=>mountain.current?.rotate(45)} aria-label="Rotate map 45 degrees"><RotateCcw size={15}/>Rotate 45°</button><div className="pan-pad" aria-label="Pan the terrain"><button aria-label="Pan west" onClick={()=>mountain.current?.pan('west')}><ArrowLeft size={17}/></button><button aria-label="Pan north" onClick={()=>mountain.current?.pan('north')}><ArrowUp size={17}/></button><button aria-label="Pan south" onClick={()=>mountain.current?.pan('south')}><ArrowDown size={17}/></button><button aria-label="Pan east" onClick={()=>mountain.current?.pan('east')}><ArrowRight size={17}/></button></div></div></div>}
        {<RangeNavigation active={activeRange} country={overviewMode} busy={loading||continuing||!ready} onRange={r=>{void flyRange(r).catch(()=>{});}} onOverview={overview}/>}
        {tour&&<div className="tour-status"><span className="live-dot"/><span>THE HIMALAYAN JOURNEY</span><strong>{tourStep+1} / {TOUR.length}</strong><button onClick={()=>setTourStep(s=>(s+1)%TOUR.length)} aria-label="Next mountain in journey"><ChevronRight size={19}/></button><button onClick={()=>setTour(false)} aria-label="End guided journey"><X size={18}/></button><div className="tour-progress" key={tourStep}/></div>}
        {floodResult&&<div className="flood-map-legend" aria-label="Flood exposure map legend"><strong>{floodResult?`Scenario +${floodResult.scenario.stage.toFixed(1)} m`:floodRiver?.name||'Choose a river reach'}</strong><span><i className="wet"/>Estimated inundated land</span><span><House size={14} className="exposed"/>Residential portion exposed</span>{(!floodResult||floodResult.showSensitivity)&&<span><i className="sensitive"/>+1 m sensitivity fringe</span>}{floodResult?.baseline&&<span><i className="comparison"/>Comparison +{floodResult.baseline.stage.toFixed(1)} m</span>}<span><i className="unassessed"/>Outside assessment</span><small>Uncalibrated · No velocity or arrival time</small></div>}
        <div hidden={!!floodResult||!geoLayers.settlements} className="settlement-legend" aria-label="Settlement map legend"><House size={16} aria-hidden="true"/><span>Settlements</span><i aria-hidden="true"/><span>Residential areas</span></div>
        <div className="map-bottom"><span className="map-coordinates">{position.lat.toFixed(3)}° N &nbsp; {position.lng.toFixed(3)}° E</span><span className="gesture-hint">Drag to {navigationMode} · Scroll to zoom</span><div><button aria-label="Sources and guide" onClick={()=>setInfo(true)}><Info size={13}/></button><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></div></div>
      </section>
    </div>
    <Dialog open={info} onOpenChange={setInfo}><DialogContent className="about-dialog"><DialogTitle className="about-title">Flood IT · Nepal</DialogTitle><DialogDescription>Explore Nepal as three-dimensional mountain models built from real elevation measurements.</DialogDescription><div className="about-content"><h3>Make the mountains your own</h3><p>Choose Pan to move across the ground, or Orbit to turn around a mountain. Drag with the mouse or one finger in the selected mode. Scroll or pinch over the terrain to zoom the landscape; the explorer stays in place. Press P for Pan or O for Orbit. Switching modes keeps your camera position and stops the previous motion. Hold Shift before dragging to temporarily use the other mode; right-drag also uses the other mode. Open the map settings for arrows that move geographically north, south, west or east. Focus the terrain and use arrow keys to pan. The compass restores north; map settings also offer rotation in 45-degree steps. Use All Nepal for the country view.</p><h3>What the atlas covers</h3><p>A country-wide terrain model and detailed terrain windows for all 28 Himalayan ranges in the Gurung inventory, plus the Mahabharat and Chure belts. Range names and groupings vary across sources. Range views are approximate geographic anchors, not surveyed range boundaries. Summit labels are a curated selection, including Nepal’s eight widely recognized principal 8,000 m peaks.</p><p>Border summits belong to shared landscapes. The model uses sampled elevation, with illustrative rock, vegetation and snow colours. Rock texture, vegetation tones and snow shading are illustrative materials, not satellite photographs or a current snow map. Mountain and summit windows use refined elevation grids; the Annapurna range view includes the surrounding valleys and Pokhara area. Detailed terrain loads in overlapping windows. Panning near a window edge loads adjoining mapped terrain while retaining your perspective, wherever the atlas has coverage. The bottom range navigator, its west/east arrows and full range selector travel between mountain regions. The selected region stays as a reference when exploring places; nearby features are grouped geographically, not by a verified drainage connection. Terrain height defaults to 1.2× and can be set to natural 1× in the settings.</p><h3>Rivers, lakes & settlements</h3><p>The geographic layers use the OpenStreetMap Nepal extract from Geofabrik, dated 6 September 2026. They include mapped river and stream segments, canals, drains and ditches; lakes, ponds, reservoirs and river water areas; settlement place nodes and residential land use. Names can be searched in English or Nepali where the source provides them. Click a mapped feature to inspect its record.</p><p>The country overview shows major river channels, water areas of at least 0.03 km², and cities and towns. Detailed terrain windows include the smaller mapped features. Labels are spaced to stay readable. Water fills and channel widths are symbolic; house symbols mark settlement locations, and shaded patches represent residential areas. The symbols do not represent individual buildings or their footprints. Mapping is incomplete in some areas, and crossing features can extend beyond Nepal. Flood IT adds experimental terrain-connected flood screening for natural river and stream reaches across the modelled Nepal atlas. It estimates potential residential land exposure at assumed water-level offsets. It does not simulate flow dynamics, velocity, arrival time, rainfall, or flood probability. The map is not locally calibrated and is not suitable for operational warnings or evacuation decisions. <a href="/flood/method.html" target="_blank" rel="noreferrer">Read the flood method, data limitations and validation status</a>.</p><h3>Travel further</h3><p>This atlas is for inspiration. For current access, local guides and travel requirements, visit the <a href="https://ntb.gov.np/" target="_blank" rel="noreferrer">Nepal Tourism Board</a>. The atlas is independent and is not an official tourism service.</p><h3>Sources & credits</h3><ul><li><a href="https://nepjol.info/index.php/jtha/article/download/39118/29948/113661" target="_blank" rel="noreferrer">Gurung, Mountain Peaks of Nepal Himalaya (2021), Table 2</a> — the 28-range inventory.</li><li><a href="https://ntb.gov.np/en/eight-thousanders" target="_blank" rel="noreferrer">Nepal Tourism Board</a> — principal 8,000 m peaks and regional travel inspiration.</li><li><a href="https://mapterhorn.com/attribution/" target="_blank" rel="noreferrer">Mapterhorn</a> — elevation data, sampled into local terrain grids. Model bounds and sampling metadata are included with the atlas.</li><li>Everest photograph: <a href="https://commons.wikimedia.org/wiki/File:Everest,_Himalayas.jpg" target="_blank" rel="noreferrer">Vyacheslav Argenberg / Wikimedia Commons</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>; cropped.</li><li><a href="https://download.geofabrik.de/asia/nepal.html" target="_blank" rel="noreferrer">Geofabrik / © OpenStreetMap contributors</a> — rivers, water areas and settlements, under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">Open Database License</a>. <a href="/geography/data.html" target="_blank" rel="noreferrer">Download the mapped dataset (GeoJSON parts)</a>; <a href="/geography/LICENSE.txt" target="_blank" rel="noreferrer">data notes</a>.</li><li><a href="https://threejs.org" target="_blank" rel="noreferrer">Three.js</a> — real-time mesh rendering, lighting and orbital camera controls.</li></ul></div></DialogContent></Dialog>
  </main>;
}
