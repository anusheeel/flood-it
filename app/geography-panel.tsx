'use client';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, Droplets, House, Building2, Mountain, Waves, X } from 'lucide-react';
import { KIND_NAMES, featureName, geographyJSON, intersects, type GeographyManifest, type GeographyStatus, type LayerKey, type LayerVisibility, type PlaceEntry } from './geography';
import { ranges, peaks, type Range, type Peak } from './mountains';
import { WEST_EAST } from './range-navigation';
import type { BuildingStatus } from './buildings';
type Props = {
  buildingsVisible:boolean; buildingStatus:BuildingStatus; onBuildings:(visible:boolean)=>void; onRetryBuildings:()=>void;
  layers:LayerVisibility; onLayers:(layers:LayerVisibility)=>void; status:GeographyStatus;
  selected:PlaceEntry|null; summit:Peak|null; range:Range; country:boolean; bounds:number[]|null;
  onSelect:(place:PlaceEntry)=>void;onFocus:(place:PlaceEntry)=>void; onPeak:(peak:Peak)=>void; onRange:(range:Range)=>void;
  onClear:()=>void; onRetry:()=>void; busy:boolean; open:boolean; onOpen:(value:boolean)=>void;
  query:string; onQuery:(value:string)=>void; onFlood:()=>void;
};
const ICONS={rivers:Waves,lakes:Droplets,settlements:House};
const FILTERS={all:'All',mountains:'Mountains',rivers:'Rivers',lakes:'Lakes',settlements:'Places'};
const inBounds=(coords:number[],bounds:number[]|null)=>!bounds||coords[0]>=bounds[0]&&coords[0]<=bounds[2]&&coords[1]>=bounds[1]&&coords[1]<=bounds[3];
export default function GeographyPanel({buildingsVisible,buildingStatus,onBuildings,onRetryBuildings,layers,onLayers,status,selected,summit,range,country,bounds,onSelect,onFocus,onPeak,onRange,onClear,onRetry,busy,open,onOpen,query,onQuery,onFlood}:Props){
  const scrollArea=useRef<HTMLDivElement>(null);
  const [index,setIndex]=useState<PlaceEntry[]>([]);
  const [manifest,setManifest]=useState<GeographyManifest|null>(null);
  const [directory,setDirectory]=useState(false);
  const [filter,setFilter]=useState<keyof typeof FILTERS>('all');
  const [scope,setScope]=useState<'landscape'|'nepal'>('landscape');
  const [catalogError,setCatalogError]=useState('');
  const [retry,setRetry]=useState(0);
  const deferredQuery=useDeferredValue(query.trim().toLowerCase());
  const expanded=directory||!!query;
  useEffect(()=>{let active=true;Promise.all([geographyJSON<PlaceEntry[]>('index.json'),geographyJSON<GeographyManifest>('manifest.json')]).then(([places,meta])=>{if(active){setIndex(places);setManifest(meta);setCatalogError('');}}).catch(()=>{if(active)setCatalogError('The place directory could not load.');});return()=>{active=false;};},[retry]);
  useEffect(()=>{if(scrollArea.current)scrollArea.current.scrollTop=0;},[selected?.id,summit?.id,range.id,query,filter]);
  const local=useMemo(()=>index.filter(f=>!bounds||intersects(f.bounds,bounds)),[index,bounds]);
  const nearby=useMemo(()=>{
    const picks:PlaceEntry[]=[];
    const preferred=range.id==='annapurna'?['Phewa Lake','Seti Gandaki River','Pokhara']:[];
    for(const layer of ['lakes','rivers','settlements'] as const){
      const places=local.filter(f=>f.layer===layer&&f.id!==selected?.id);
      const pick=places.find(f=>preferred.includes(f.name))??places.sort((a,b)=>{
        const priority=(f:PlaceEntry)=>f.kind==='city'?6:f.kind==='lake'||f.kind==='river'?5:f.kind==='town'?4:f.kind==='village'?3:1;
        const distance=(f:PlaceEntry)=>Math.hypot(f.center[0]-range.coords[0],f.center[1]-range.coords[1]);
        return priority(b)-priority(a)||(b.areaKm2??0)-(a.areaKm2??0)||distance(a)-distance(b);
      })[0];if(pick)picks.push(pick);
    }return picks;
  },[local,range,selected?.id]);
  const searchEverywhere=!!deferredQuery||scope==='nepal';
  const matches=useMemo(()=>{
    const seen=new Set<string>();return (searchEverywhere?index:local).filter(f=>{
      if(filter!=='all'&&filter!==f.layer)return false;
      if(!`${f.name} ${f.localName??''} ${KIND_NAMES[f.kind]??f.kind}`.toLowerCase().includes(deferredQuery))return false;
      const key=f.layer==='rivers'?f.layer+f.name.toLowerCase():f.id;if(seen.has(key))return false;seen.add(key);return true;
    }).sort((a,b)=>a.name.localeCompare(b.name));
  },[index,local,filter,deferredQuery,searchEverywhere]);
  const mountainResults=filter==='all'||filter==='mountains';
  const matchingPeaks=mountainResults?peaks.filter(p=>(searchEverywhere||inBounds(p.coords,bounds))&&`${p.name} ${p.local??''}`.toLowerCase().includes(deferredQuery)):[];
  const matchingRanges=mountainResults?[...WEST_EAST,...ranges.filter(r=>r.belt)].filter(r=>(searchEverywhere||inBounds(r.coords,bounds))&&`${r.name} ${r.alias??''} ${r.region}`.toLowerCase().includes(deferredQuery)):[];
  const total=matches.length+matchingPeaks.length+matchingRanges.length;
  function selectPlace(f:PlaceEntry){onQuery('');setDirectory(false);onSelect(f);}
  function selectMountain(p:Peak){onQuery('');setDirectory(false);onPeak(p);}
  function selectRange(r:Range){onQuery('');setDirectory(false);onRange(r);}
  function row(f:PlaceEntry){const Icon=ICONS[f.layer];return <button className={`guide-row ${f.layer} ${selected?.id===f.id?'active':''}`} key={f.id} onClick={()=>selectPlace(f)} disabled={busy}><Icon size={22} strokeWidth={1.35}/><span><strong>{featureName(f)}</strong><small>{KIND_NAMES[f.kind]??'Water body'}</small></span><ChevronRight size={16}/></button>;}
  if(!open)return <button className="guide-collapsed" onClick={()=>onOpen(true)} aria-label="Open landscape field guide"><Mountain size={17}/><span>{country?'Explore Nepal':range.name}</span><ChevronDown size={17}/></button>;
  return <aside className={`field-guide ${expanded?'catalogue-open':''}`} aria-label="Landscape field guide">
    <div className="guide-heading"><span className="eyebrow">{expanded?'FIND YOUR LANDSCAPE':'MOUNTAINS · WATER · LIFE'}</span></div>
    <div className="guide-scroll" ref={scrollArea}>
      {!expanded?<>
        <div className="guide-region"><h1>{country?'Nepal Himalaya':selected?featureName(selected):range.name}</h1><span>{country?'Mountains, water & the places between':range.region.split('·').at(-1)?.trim()}</span><p>{summit?`${summit.name} · ${summit.height.toLocaleString('en-US')} m`:'From high ridges to the valleys below.'}</p>{summit&&<p className="summit-story">{summit.description}</p>}</div>
        {selected&&<section className={`selected-place ${selected.layer}`} aria-label="Selected mapped feature"><button className="clear-place" aria-label="Clear selected place" onClick={onClear}><X size={14}/></button><span className="eyebrow">{KIND_NAMES[selected.kind]??'Mapped feature'}</span><h2>{featureName(selected)}</h2>{selected.localName&&<p>{selected.localName}</p>}<p className="coordinates">{selected.center[1].toFixed(4)}° N · {selected.center[0].toFixed(4)}° E</p>{selected.areaKm2!==undefined&&<p>Mapped area ≈ {selected.areaKm2<.01?(selected.areaKm2*1e6).toLocaleString()+' m²':selected.areaKm2.toFixed(2)+' km²'}</p>}{selected.kind==='building'&&<p className="building-source-note">Source tag: building={selected.buildingTag}. {selected.buildingTag==='yes'?'Type and use unspecified.':'Mapped type: '+selected.buildingTag+'.'} Current use, height and occupancy are not inferred. This footprint is not individually assessed for flood exposure.</p>}{selected.intermittent&&<p>Mapped as seasonal / intermittent.</p>}<div className="feature-actions"><button onClick={()=>onFocus(selected)} disabled={busy}>View surroundings <ChevronRight size={13}/></button><a href={`https://www.openstreetmap.org/${selected.id}`} target="_blank" rel="noreferrer">OSM record <ArrowUpRight size={13}/></a></div>{selected.layer==='rivers'&&<button className="open-flood-from-river" onClick={onFlood}><Waves size={15}/>Use this river <ArrowUpRight size={13}/></button>}<button className="return-range" onClick={()=>selectRange(range)} disabled={busy}><ArrowLeft size={13}/>Back to {range.name}</button></section>}
        <button className="explore-scenario-cta" onClick={onFlood}><Waves size={18}/><span>Study a flood scenario<small>Choose a river, then explore exposure</small></span><ArrowUpRight size={16}/></button><div className="nearby-heading">NEARBY LANDSCAPE</div><div className="nearby-list">{nearby.map(row)}{!nearby.length&&manifest&&<p className="guide-empty">Choose a detailed region to explore nearby features.</p>}</div>
        <button className="view-directory" onClick={()=>{setDirectory(true);setScope(country?'nepal':'landscape');setFilter('all');}}>View all nearby <ChevronRight size={14}/></button>
      </>:<>
        <button className="back-guide" onClick={()=>{onQuery('');setDirectory(false);}}><ArrowLeft size={15}/>Back to {range.name}</button>
        <h2 className="directory-title">{query?'Search the Himalaya':'Explore this landscape'}</h2>
        <p className="directory-note">{country?'Follow Nepal’s mountain regions from west to east.':range.description}</p>
        <div className="directory-filters" aria-label="Landscape feature filter">{(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map(key=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{FILTERS[key]}</button>)}</div>
        <div className="directory-scope"><span>{manifest?`${total.toLocaleString()} named features`:'Loading…'}</span>{query?<span>All Nepal</span>:<select aria-label="Search area" value={scope} onChange={e=>setScope(e.target.value as 'landscape'|'nepal')}><option value="landscape">Current terrain</option><option value="nepal">All Nepal</option></select>}</div>
        <div className="directory-results" aria-label="Landscape search results">{matchingRanges.map(r=><button className="guide-row mountain" key={'range-'+r.id} disabled={busy} onClick={()=>selectRange(r)}><Mountain size={21}/><span><strong>{r.name}</strong><small>{r.region}</small></span><ChevronRight size={16}/></button>)}{matchingPeaks.map(p=><button className="guide-row mountain" key={'peak-'+p.id} disabled={busy} onClick={()=>selectMountain(p)}><Mountain size={21}/><span><strong>{p.name}</strong><small>{p.height.toLocaleString()} m · Summit</small></span><ChevronRight size={16}/></button>)}{matches.slice(0,60).map(row)}{matches.length>60&&<p className="guide-empty">Showing the first 60 places. Refine your search to find more.</p>}{manifest&&total===0&&<p className="guide-empty">No matching places. Try another name or choose All Nepal.</p>}</div>
        <p className="directory-note">Nearby features are grouped by location, not verified drainage connections. Mapping coverage varies.</p><a className="region-travel" href={range.link} target="_blank" rel="noreferrer">Discover this region <ArrowUpRight size={14}/></a>
      </>}
      <div className="building-coverage" aria-label="Building coverage">
        <strong>Mapped buildings <a href="/buildings/data.html" target="_blank" rel="noreferrer">Source ↗</a></strong>
        <output>{!buildingsVisible?'Building layer hidden.':buildingStatus.loading?'Loading building detail…':buildingStatus.error?'Building coverage is incomplete. See the data message below.':buildingStatus.mode==='footprints'?`${buildingStatus.count.toLocaleString()} footprints in the detail window. Click one to inspect; density remains outside the window.`:'Building density shown. Zoom closer to inspect individual footprints.'}</output>
        {buildingStatus.error&&<p role="alert">{buildingStatus.error} <button onClick={onRetryBuildings}>Retry buildings</button></p>}
        <small>OSM · 6 Sep 2026. Density counts mapped buildings, not people. Coverage can be incomplete.</small>
      </div>
      {status.error&&<div className="guide-error" role="alert">{status.error}<button onClick={onRetry}>Retry map layers</button></div>}{catalogError&&<div className="guide-error">{catalogError}<button onClick={()=>setRetry(r=>r+1)}>Retry directory</button></div>}{!manifest&&!catalogError&&<output className="guide-empty">Loading the landscape directory…</output>}
    </div>
    <div className="guide-layers" aria-label="Visible map layers">{(['rivers','lakes','settlements'] as LayerKey[]).map(key=>{const Icon=ICONS[key];return <button key={key} className={key} aria-label={`Show ${key==='settlements'?'settlements':key==='lakes'?'lakes and ponds':'rivers and channels'}`} aria-pressed={layers[key]} onClick={()=>onLayers({...layers,[key]:!layers[key]})}><Icon size={15}/><span>{FILTERS[key]}</span><i>{layers[key]&&<Check size={10} strokeWidth={3}/>}</i></button>;})}<button className="buildings" aria-label="Show building footprints and density" aria-pressed={buildingsVisible} onClick={()=>onBuildings(!buildingsVisible)}><Building2 size={15}/><span>Buildings</span><i>{buildingsVisible&&<Check size={10} strokeWidth={3}/>}</i></button></div>
  </aside>;
}
