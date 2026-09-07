'use client';
import { ArrowLeft, ArrowRight, Globe2 } from 'lucide-react';
import { ranges, type Range } from './mountains';
export const WEST_EAST = ranges.filter(r => !r.belt).sort((a, b) => a.coords[0] - b.coords[0]);
const LANDMARKS = ['dhaulagiri', 'annapurna', 'manaslu', 'langtang', 'mahalangur', 'kanchenjunga'];
export default function RangeNavigation({active, country, busy, onRange, onOverview}: {active: Range; country: boolean; busy: boolean; onRange:(r:Range)=>void; onOverview:()=>void}) {
  const index = WEST_EAST.findIndex(r => r.id === active.id);
  const visible = WEST_EAST.filter(r => LANDMARKS.includes(r.id) || r.id === active.id);
  return <nav className="range-journey" aria-label="Explore Himalayan ranges west to east">
    <div className="range-dock"><div className="dock-heading"><span>EXPLORE THE HIMALAYA</span><select aria-label="All mountain ranges" value={country?'':active.id} onChange={e=>{const range=ranges.find(r=>r.id===e.target.value);if(range)onRange(range);}} disabled={busy}><option value="" disabled>All Nepal</option><optgroup label="Himalayan ranges · west to east">{WEST_EAST.map((r,i)=><option key={r.id} value={r.id}>{String(i+1).padStart(2,'0')} · {r.name}</option>)}</optgroup><optgroup label="Mountain belts">{ranges.filter(r=>r.belt).map(r=><option value={r.id} key={r.id}>{r.name}</option>)}</optgroup></select></div>
      <div className="dock-route"><button className="dock-arrow" aria-label="Previous range to the west" title={WEST_EAST[index-1]?.name} disabled={busy||index<=0} onClick={()=>onRange(WEST_EAST[index-1])}><ArrowLeft size={18}/></button><span className="direction-letter">W</span><div className="range-stops">{visible.map(r=><button key={r.id} className={!country&&r.id===active.id?'active':''} aria-current={!country&&r.id===active.id?'location':undefined} disabled={busy} onClick={()=>onRange(r)} title={r.name}><i/><span>{r.id==='mahalangur'?'Everest':r.name.replace(' Himal','')}</span></button>)}</div><span className="direction-letter">E</span><button className="dock-arrow" aria-label="Next range to the east" title={WEST_EAST[index+1]?.name} disabled={busy||index<0||index===WEST_EAST.length-1} onClick={()=>onRange(WEST_EAST[index+1])}><ArrowRight size={18}/></button></div>
    </div><button className="country-view" onClick={onOverview} disabled={busy} aria-label="Explore all Nepal"><Globe2 size={17}/><span>All Nepal</span></button>
  </nav>;
}
