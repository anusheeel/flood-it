'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Camera, ChevronDown, Download, House, Info, RotateCcw, Waves, X } from 'lucide-react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { makeSnapshot, downloadSnapshot } from './flood-snapshot';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { featureName, intersects, type PlaceEntry } from './geography';
import { loadRiverIndex } from './flood-inputs';
import { loadAssessment } from './flood-client';
import { affectedCount, areaFeature, areaStatus, formatArea, supportedRiver, prepareFlood, totalAffected, type FloodPilot, type FloodResult } from './flood';

type Props={river:PlaceEntry|null;selected:PlaceEntry|null;ready:boolean;onPilot:()=>Promise<boolean>;bounds:number[];onRiver:(river:PlaceEntry)=>void;onInspect:(area:PlaceEntry)=>void;onFocusRiver:()=>void;
  onOverlay:(pilot:FloodPilot|null,result:FloodResult|null)=>void;onClose:()=>void; review:boolean;onReview:()=>void;onEdit:()=>void;onCapture:()=>HTMLCanvasElement;onClearSelection:()=>void;};
const STATUS={exposed:'Potentially exposed',sensitive:'Exposed at +1 m',outside:'Outside this scenario',unassessed:'Partly / not assessed'};
export default function FloodPanel({river,selected,ready,onPilot,bounds,onRiver,onInspect,onFocusRiver,onOverlay,onClose,review,onReview,onEdit,onCapture,onClearSelection}:Props){
  const [pilot,setPilot]=useState<FloodPilot|null>(null);
  const [stage,setStage]=useState(3);
  const chosen=supportedRiver(river);
  const [length,setLength]=useState(12);
  const [progress,setProgress]=useState('');
  const [preparing,setPreparing]=useState(false);
  const [catalogue,setCatalogue]=useState<PlaceEntry[]>([]);
  const [catalogueError,setCatalogueError]=useState('');
  const [riverQuery,setRiverQuery]=useState('');
  const [scope,setScope]=useState<'view'|'nepal'>('view');
  const [choosing,setChoosing]=useState(!chosen);
  const candidates=useMemo(()=>catalogue.filter(f=>(scope==='nepal'||intersects(f.bounds,bounds))&&`${f.name} ${f.localName??''} ${f.id}`.toLowerCase().includes(riverQuery.toLowerCase())).sort((a,b)=>Number(!!b.name)-Number(!!a.name)||featureName(a).localeCompare(featureName(b))),[catalogue,scope,bounds,riverQuery]);
  const [running,setRunning]=useState(false);
  const [result,setResult]=useState<FloodResult|null>(null);
  const [baseline,setBaseline]=useState<number|null>(null);
  const [sensitivity,setSensitivity]=useState(true);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const [snapshot,setSnapshot]=useState<{url:string;filename:string}|null>(null);
  const [capturing,setCapturing]=useState(false);
  const [captureError,setCaptureError]=useState('');
  const scrollArea=useRef<HTMLDivElement>(null);
  useEffect(()=>{scrollArea.current?.scrollTo({top:0});},[review]);
  useEffect(()=>()=>{if(snapshot)URL.revokeObjectURL(snapshot.url);},[snapshot]);
  const [filter,setFilter]=useState<'exposed'|'all'>('exposed');
  const [areaQuery,setAreaQuery]=useState('');
  const [limit,setLimit]=useState(30);
  const request=useRef(0);
  const stale=!!result&&(result.scenario.stage!==stage||result.baseline?.stage!==(baseline??undefined));
  const unsupported=river!==null&&!chosen;
  useEffect(()=>{let active=true;loadRiverIndex().then(data=>{if(active){setCatalogue(data);setCatalogueError('');}}).catch(e=>{if(active)setCatalogueError(e.message);});return()=>{active=false;};},[retry]);
  useEffect(()=>{
    const pending=request,controller=new AbortController();let active=true;
    queueMicrotask(()=>{if(!active)return;
    setPilot(null);setResult(null);setBaseline(null);setRunning(false);setPreparing(false);setError('');onOverlay(null,null);
    if(river&&chosen){
      setPreparing(true);setProgress('Preparing the local reach');
      loadAssessment(river,length,message=>{if(active)setProgress(message);},controller.signal).then(data=>{if(active){setPilot(data);setPreparing(false);setProgress('');onOverlay(data,null);}}).catch(e=>{if(active&&e.name!=='AbortError'){setError(e.message);setPreparing(false);}});
    }
    });
    return()=>{active=false;controller.abort();pending.current++;onOverlay(null,null);};
  },[river,chosen,length,retry,onOverlay]);
  async function run(){
    if(!pilot||!chosen||unsupported)return;
    const token=++request.current;setRunning(true);setError('');
    try{
      const next=await prepareFlood(pilot,stage,baseline,sensitivity);
      if(request.current!==token)return;
      setResult(next);setLimit(30);onOverlay(pilot,next);onClearSelection();onReview();
    }catch(e){if(request.current===token)setError(e instanceof Error?e.message:'The scenario could not load.');}
    finally{if(request.current===token)setRunning(false);}
  }
  function reset(){onEdit();onClearSelection();request.current++;setRunning(false);setResult(null);setBaseline(null);setStage(3);setError('');if(pilot)onOverlay(pilot,null);}
  function changeStage(value:number){request.current++;setRunning(false);setStage(value);}
  function toggleSensitivity(value:boolean){setSensitivity(value);if(result){const next={...result,showSensitivity:value};setResult(next);onOverlay(pilot,next);}}
  const rows=useMemo(()=>{
    if(!pilot||!result)return [];
    return pilot.areas.map((area,index)=>({area,index,affected:result.scenario.affectedM2[index],status:areaStatus(area,result.scenario.affectedM2[index],result.upper.affectedM2[index])}))
      .filter(row=>(filter==='all'||row.affected>0)&&`${row.area.name} ${row.area.id}`.toLowerCase().includes(areaQuery.toLowerCase()))
      .sort((a,b)=>b.affected-a.affected||a.area.name.localeCompare(b.area.name));
  },[pilot,result,filter,areaQuery]);
  const selectedIndex=pilot?.areas.findIndex(a=>a.id===selected?.id)??-1;
  const active=selectedIndex>=0&&pilot?pilot.areas[selectedIndex]:null;
  const activeRow=rows.findIndex(row=>row.area.id===active?.id);
  async function capture(){
    if(!active||!pilot||!result||stale)return;
    setCapturing(true);setCaptureError('');
    try{const shot=onCapture();setSnapshot(await makeSnapshot(shot,pilot,result,active,selectedIndex));}
    catch(e){setCaptureError(e instanceof Error?e.message:'The view could not be captured. Try again.');}
    finally{setCapturing(false);}
  }
  function download(){
    if(!pilot||!result)return;
    const report={tool:'Flood IT',status:'Experimental, uncalibrated screening. Not an operational forecast.',reach:pilot.id,reachIds:pilot.reachIds,bounds:pilot.bounds,resolution:pilot.resolution,notes:pilot.notes??[],elevationTiles:pilot.runtime?.tiles??['N27E084'],nativeGridSha256:pilot.runtime?.elevationSha256??null,grid:{cols:pilot.cols,rows:pilot.rows},profileAdjustmentM:pilot.runtime?.profileAdjustmentM??null,
      analysisVersion:pilot.analysisVersion,stageOffsetM:result.scenario.stage,reference:pilot.reference,
      baselineStageM:result.baseline?.stage??null,sensitivityOffsetM:1,sourceTimestamp:pilot.sourceTimestamp,
      sourceNotes:window.location.origin+'/flood/method.html',landAreaM2:result.scenario.landAreaM2,residentialAreaM2:result.scenario.residentialAreaM2,
      buildingAssessment:{status:'not_assessed',note:'Visible building footprints are context only. Buildings outside mapped residential polygons are absent from residential exposure totals.'},
      residentialAreas:pilot.areas.map((area,i)=>({id:area.id,name:area.name,areaM2:area.areaM2,assessedM2:area.assessedM2,
        affectedM2:result.scenario.affectedM2[i],affectedPercent:100*result.scenario.affectedM2[i]/area.areaM2,
        status:STATUS[areaStatus(area,result.scenario.affectedM2[i],result.upper.affectedM2[i])]}))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`flood-it-${pilot.id.replace(/[^a-z0-9-]/gi,"_")}-${result.scenario.stage}m.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <>
  <aside className={`field-guide flood-panel ${review?'review-panel':''}`} aria-label={review?'Review scenario exposure':'Set a flood scenario'}>
    <div className="guide-heading"><span className="eyebrow">{review?'SCENARIO RESULTS':'RIVER → FLOODPLAIN → SETTLEMENT'}</span></div>
    <div className="guide-scroll flood-scroll" ref={scrollArea}>
      <div className="study-heading"><h1>{river?featureName(river):'Follow the water.'}</h1><p>{review?'Explore the mapped residential areas touched by this scenario.':'Choose a local river reach and an assumed rise in water level.'}</p>{result&&<button className="scenario-chip" onClick={review?onEdit:onReview}>+{result.scenario.stage.toFixed(1)} m <span>· {review?'Edit scenario':'View results'}</span><ArrowUpRight size={13}/></button>}</div>
      <div hidden={review}>
      <section className="flood-step"><span className="step-label"><b>01</b>SELECT A RIVER REACH</span>
        {river&&<button className={`pilot-reach ${chosen?'chosen':''}`} onClick={()=>setChoosing(v=>!v)}><Waves size={22}/><span><strong>{featureName(river)}</strong><small>{river.id} · {river.center[1].toFixed(3)}° N, {river.center[0].toFixed(3)}° E</small><small>{pilot?`${pilot.reachLengthKm.toFixed(1)} km assessed reach`:'Local reach around your selection'}</small></span><ChevronDown size={17}/></button>}
        {!river&&<p className="flood-help">Click a river in the landscape or find one below.</p>}
        <div className="river-selection-actions"><button className="change-river" onClick={()=>setChoosing(v=>!v)}>{choosing?'Close river finder':'Choose another river'}</button>{river&&<button className="focus-river" onClick={onFocusRiver} disabled={!ready}><ArrowUpRight size={13}/>Focus river</button>}</div>
        {choosing&&<div className="river-finder">
          <input className="area-search" type="search" aria-label="Find a river or stream" placeholder="River name, नेपाली or OSM ID…" value={riverQuery} onChange={e=>setRiverQuery(e.target.value)}/>
          <label className="river-scope">Look in <select aria-label="River search area" value={scope} onChange={e=>setScope(e.target.value as 'view'|'nepal')}><option value="view">Current terrain</option><option value="nepal">All Nepal</option></select><span>{candidates.length.toLocaleString()} segments</span></label>
          <div className="river-options">{candidates.slice(0,40).map(f=><button key={f.id} onClick={()=>{setChoosing(false);onRiver(f);}}><Waves size={15}/><span>{featureName(f)}<small>{f.id} · {f.center[1].toFixed(3)}° N, {f.center[0].toFixed(3)}° E</small></span><ArrowUpRight size={13}/></button>)}</div>
          {candidates.length>40&&<p className="flood-help">Showing the first 40. Refine the name or OSM ID.</p>}
          {!catalogue.length&&!catalogueError&&<p className="flood-help">Loading Nepal’s river catalogue…</p>}
          {catalogue.length>0&&!candidates.length&&<p className="flood-help">No matching segments here. Try All Nepal or another name.</p>}
          {catalogueError&&<p className="flood-caution" role="alert">{catalogueError}<button onClick={()=>setRetry(v=>v+1)}>Retry river catalogue</button></p>}
          <button className="benchmark-link" onClick={()=>void onPilot().catch(e=>setError(e instanceof Error?e.message:'The example could not load. Please retry.'))}>Open the original Narayani example <ArrowUpRight size={13}/></button>
        </div>}
        {unsupported&&<p className="flood-caution">Choose a natural river or stream centreline. Artificial drains, canals and water polygons do not use this method.</p>}
        {chosen&&<details className="reach-options"><summary>Reach &amp; data options</summary><label className="reach-length">Local reach length <select aria-label="Assessment reach length" value={length} onChange={e=>setLength(Number(e.target.value))}><option value={6}>Up to 6 km</option><option value={12}>{pilot?.id==='narayani-bharatpur'?'Original 21.4 km example':'Up to 12 km'}</option><option value={20}>Up to 20 km</option></select></label><p className="flood-help">Ends stop at ambiguous junctions. Each result covers a local window, not the entire river basin.</p></details>}
        {preparing&&<output className="analysis-progress"><i/>{progress}…<small>You can pan, orbit or choose another reach while this runs.</small></output>}
        {pilot&&<><p className="flood-help">{pilot.resolution} · {pilot.areas.length.toLocaleString()} mapped residential polygons. Building footprints are shown for context and are not individually assessed; buildings outside these polygons are missing from exposure totals. <a href="/flood/method.html#national" target="_blank" rel="noreferrer">Coverage & method</a></p>{pilot.notes?.map(note=><p className="flood-caution" key={note}>{note}</p>)}{(pilot.previous||pilot.next)&&<div className="reach-neighbours"><button disabled={!pilot.previous} onClick={()=>{if(river&&pilot.previous)onRiver({...river,id:pilot.previousId??river.id,center:pilot.previous});}}>← Upstream window</button><button disabled={!pilot.next} onClick={()=>{if(river&&pilot.next)onRiver({...river,id:pilot.nextId??river.id,center:pilot.next});}}>Downstream window →</button></div>}</>}

      </section>
      <section className="flood-step"><span className="step-label"><b>02</b>SET THE SCENARIO</span>
        <div className="stage-value"><span>Channel reference offset</span><strong>+{stage.toFixed(1)}<small> m</small></strong></div>
        <Slider aria-label="Scenario offset above estimated channel reference in metres" min={0} max={12} step={.5} value={[stage]} onValueChange={value=>changeStage(Array.isArray(value)?value[0]:value)} disabled={!chosen||unsupported||!pilot}/>
        <div className="stage-scale"><span>0 m reference</span><span>+12 m</span></div>
        <p className="flood-help">Above an estimated channel surface, derived from elevation data. <strong>Not today’s water level or a gauge reading.</strong></p>
        <label className="sensitivity-toggle" htmlFor="flood-sensitivity"><span>Show +1 m sensitivity fringe</span><Switch id="flood-sensitivity" checked={sensitivity} onCheckedChange={toggleSensitivity}/></label>
        <button className="flood-run" onClick={()=>void run()} disabled={!chosen||unsupported||running||preparing||!ready||!pilot}><Waves size={20}/>{preparing?'Preparing reach…':running?'Preparing scenario…':'Flood It'}<ArrowUpRight size={17}/></button>
        {error&&<p className="flood-caution" role="alert">{error}{!pilot&&<button onClick={()=>setRetry(v=>v+1)}>Retry assessment</button>}</p>}
      </section>
      </div>
      {result&&review&&<section className="flood-results" aria-label="Scenario exposure results">
        <div className="results-heading"><span className="step-label"><b>03</b>REVIEW AFFECTED AREAS</span><button title="Reset scenario" aria-label="Reset flood scenario" onClick={reset}><RotateCcw size={16}/></button></div>
        <output className={`result-stage ${stale?'stale':''}`}>{stale?`Settings changed. Map still shows +${result.scenario.stage.toFixed(1)} m. Run Flood It to update.`:`Showing +${result.scenario.stage.toFixed(1)} m above channel reference`}</output>
        <div className="exposure-summary"><div><strong>{affectedCount(result.scenario)}</strong><span>residential areas<br/>potentially exposed</span></div><div><strong>{formatArea(totalAffected(result.scenario))}</strong><span>residential land<br/>within the extent</span></div></div>
        <p className="flood-help">Estimated land extent: {formatArea(result.scenario.landAreaM2)}. Mapped water areas excluded. These are areas, not counts of homes or people.</p>
        {sensitivity&&<p className="sensitivity-note">At {result.lower.stage.toFixed(1)}–{result.upper.stage.toFixed(1)} m: {affectedCount(result.lower)}–{affectedCount(result.upper)} mapped areas touched. A stage sensitivity check, not a probability or confidence interval.</p>}
        {result.scenario.boundaryContact&&<p className="flood-caution">The extent reaches the local boundary. Flooding may continue beyond the assessed area.</p>}
        <div className="scenario-actions"><button onClick={()=>{setBaseline(result.scenario.stage);}} disabled={baseline===result.scenario.stage}>Pin {result.scenario.stage.toFixed(1)} m to compare</button><button onClick={download} aria-label="Download scenario exposure report"><Download size={15}/>Report</button></div>
        {baseline!==null&&<p className="baseline-note">Comparison pinned at +{baseline.toFixed(1)} m. Set another level and run.<button aria-label="Remove comparison" onClick={()=>{setBaseline(null);if(result){const next={...result,baseline:null,baselineMask:null};setResult(next);onOverlay(pilot,next);}}}><X size={14}/></button></p>}
        {result.baseline&&<p className="baseline-note">{affectedCount(result.scenario)-affectedCount(result.baseline)>=0?'+':''}{affectedCount(result.scenario)-affectedCount(result.baseline)} areas compared with +{result.baseline.stage.toFixed(1)} m. The white outline shows the comparison extent.</p>}

        {selected?.layer==='settlements'&&selected.kind!=='residential'&&<p className="flood-help"><House size={14}/> {selected.name} is a location marker. Select a residential polygon for area exposure.</p>}
        {rows.length>0&&!active&&<button className="inspect-start" onClick={()=>onInspect(areaFeature(rows[0].area))}><House size={18}/><span>Inspect affected areas<small>Focus an area, then capture your view</small></span><ArrowRight size={17}/></button>}
        <div className="exposure-list-heading"><h2>Areas in this reach</h2><select aria-label="Filter assessed residential areas" value={filter} onChange={e=>{setFilter(e.target.value as 'exposed'|'all');setLimit(30);}}><option value="exposed">Potentially exposed</option><option value="all">All mapped areas</option></select></div>
        <input className="area-search" type="search" aria-label="Find a residential area by name or OSM ID" placeholder="Find an area or OSM ID…" value={areaQuery} onChange={e=>{setAreaQuery(e.target.value);setLimit(30);}}/>
        <div className="exposure-list">{rows.slice(0,limit).map(({area,index,affected,status})=><button className={`exposure-row ${status} ${active?.id===area.id?'selected':''}`} key={area.id} onClick={()=>onInspect(areaFeature(area))}><House size={18}/><span><strong>{area.name.startsWith('Residential')?`Residential area · ${index+1}`:area.name}</strong><small>{STATUS[status]}{affected>0?` · ${(affected/area.areaM2*100).toFixed(1)}%`:''}</small><small>{area.id}{affected>0?` · ${formatArea(result.scenario.affectedM2[index])}`:''}</small></span><ArrowUpRight size={14}/></button>)}{!rows.length&&<p className="flood-help">No mapped areas match this filter. This does not establish that the surrounding land is safe.</p>}{rows.length>limit&&<button className="show-more-areas" onClick={()=>setLimit(n=>n+30)}>Show 30 more · {rows.length} matches</button>}</div>
      </section>}
    </div>
    <footer className="flood-panel-footer"><p><Info size={14}/>Uncalibrated screening · Not an operational forecast</p><div><button onClick={review?onEdit:onClose}><ArrowLeft size={13}/>{review?'Adjust scenario':'Back to landscape'}</button><a href="/flood/method.html" target="_blank" rel="noreferrer">Method & data <ArrowUpRight size={12}/></a></div></footer>
  </aside>
  {review&&active&&result&&pilot&&createPortal(<section className="area-inspector" aria-label="Focused residential area">
    <div className="inspector-top"><span className="eyebrow">{activeRow>=0?`AREA ${activeRow+1} OF ${rows.length}`:'SELECTED AREA'} · {STATUS[areaStatus(active,result.scenario.affectedM2[selectedIndex],result.upper.affectedM2[selectedIndex])]}</span><button aria-label="Close area inspector" onClick={onClearSelection}><X size={17}/></button></div>
    <h2>{active.name.startsWith('Residential')?'Residential area':active.name}</h2>
    <p className="inspector-location">{featureName(river!)} · {active.center[1].toFixed(4)}° N, {active.center[0].toFixed(4)}° E</p>
    <div className="inspector-metrics"><div><strong>{formatArea(result.scenario.affectedM2[selectedIndex])}</strong><span>potentially exposed</span></div><div><strong>{(result.scenario.affectedM2[selectedIndex]/active.areaM2*100).toFixed(1)}%</strong><span>of mapped area</span></div></div>
    <p className="inspector-note">Residential land use. Individual buildings are not assessed. {(active.assessedM2/active.areaM2*100).toFixed(1)}% of this polygon is assessed.</p>
    {active.assessedM2<active.areaM2-.1&&<p className="flood-caution">The portion outside this local assessment has no result.</p>}
    <div className="inspector-pagination"><button disabled={activeRow<=0} onClick={()=>onInspect(areaFeature(rows[activeRow-1].area))}><ArrowLeft size={15}/>Previous</button><button disabled={activeRow<0||activeRow>=rows.length-1} onClick={()=>onInspect(areaFeature(rows[activeRow+1].area))}>Next<ArrowRight size={15}/></button></div>
    <button className="capture-view" onClick={()=>void capture()} disabled={capturing||!ready||stale}><Camera size={18}/>{capturing?'Creating snapshot…':'Capture this view'}</button>
    {stale&&<p className="flood-caution">Run the updated scenario before capturing.</p>}
    {captureError&&<p role="alert" className="flood-caution">{captureError}</p>}
    <a className="inspector-source" href={`https://www.openstreetmap.org/${active.id}`} target="_blank" rel="noreferrer">{active.id} · Source polygon <ArrowUpRight size={12}/></a>
  </section>,document.body)}
  <Dialog open={!!snapshot} onOpenChange={open=>{if(!open)setSnapshot(null);}}><DialogContent className="snapshot-dialog"><DialogTitle>Your area snapshot</DialogTitle><DialogDescription>The current 3D view, area exposure, scenario and source notes. Ready to download and share.</DialogDescription>{snapshot&&<><Image unoptimized width={1600} height={1120} src={snapshot.url} alt="Flood IT captured terrain and residential exposure summary"/><button className="capture-view" onClick={()=>downloadSnapshot(snapshot)}><Download size={18}/>Download PNG</button></>}</DialogContent></Dialog>
  </>;
}
