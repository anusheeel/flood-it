// Lucide House icon paths, ISC license (lucide-react). Reuse the same symbol
// for screen-facing labels and map points; each symbol represents a settlement.
const OUTLINE='M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';
const DOOR='M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8';
let paths:Path2D[]|null=null;

export function settlementIcon(){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','17');svg.setAttribute('height','17');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
  for(const d of [OUTLINE,DOOR]){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.appendChild(path);}
  return svg;
}

export function paintSettlement(ctx:CanvasRenderingContext2D,x:number,y:number,size:number,selected:boolean){
  paths??=[new Path2D(OUTLINE),new Path2D(DOOR)];
  ctx.save();ctx.translate(x-size/2,y-size/2);ctx.scale(size/24,size/24);
  ctx.fillStyle=selected?'#fff3ad':'#e9bd82';ctx.strokeStyle=selected?'#fff7d6':'#f5d5a4';ctx.lineWidth=1.5;
  ctx.fill(paths[0]);ctx.stroke(paths[0]);ctx.strokeStyle='#354235';ctx.lineWidth=2.5;ctx.stroke(paths[1]);ctx.restore();
}
