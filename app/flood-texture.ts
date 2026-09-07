import type { GeoFeature } from './geography';
import type { FloodPilot, FloodResult } from './flood';

function pathGeometry(ctx:CanvasRenderingContext2D,geometry:GeoFeature['geometry'],bounds:number[],size:number){
  const [w,s,e,n]=bounds;
  const ring=(coords:number[][],close:boolean)=>{coords.forEach((c,i)=>{const x=(c[0]-w)/(e-w)*size,y=(n-c[1])/(n-s)*size;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});if(close)ctx.closePath();};
  ctx.beginPath();
  if(geometry.type==='LineString')ring(geometry.coordinates,false);
  else if(geometry.type==='Polygon')geometry.coordinates.forEach(c=>ring(c,true));
  else if(geometry.type==='MultiPolygon')geometry.coordinates.forEach(p=>p.forEach(c=>ring(c,true)));
}
export function paintFlood(canvas:HTMLCanvasElement,pilot:FloodPilot,result:FloodResult|null,bounds:number[],selectedId:string|null){
  const ctx=canvas.getContext('2d')!,size=canvas.width,[w,s,e,n]=bounds;
  const [pw,ps,pe,pn]=pilot.bounds;
  const dx=(pw-w)/(e-w)*size,dy=(n-pn)/(n-s)*size,dw=(pe-pw)/(e-w)*size,dh=(pn-ps)/(n-s)*size;
  ctx.save();ctx.imageSmoothingEnabled=false;
  // Hatch the complement of the assessed domain; neutral terrain is never
  // presented as assessed beyond the pilot boundary.
  const tile=document.createElement('canvas');tile.width=tile.height=16;
  const t=tile.getContext('2d')!;t.strokeStyle='#9faab344';t.lineWidth=1;t.beginPath();t.moveTo(0,16);t.lineTo(16,0);t.stroke();
  pathGeometry(ctx,pilot.assessedGeometry,bounds,size);ctx.rect(0,0,size,size);ctx.fillStyle=ctx.createPattern(tile,'repeat')!;ctx.fill('evenodd');
  pathGeometry(ctx,pilot.assessedGeometry,bounds,size);ctx.strokeStyle='#c7d9dfaa';ctx.lineWidth=2;ctx.setLineDash([9,7]);ctx.stroke();ctx.setLineDash([]);
  if(result){
    const paintMask=(mask:HTMLCanvasElement,colour:string)=>{
      const layer=document.createElement('canvas');layer.width=pilot.cols;layer.height=pilot.rows;
      const l=layer.getContext('2d')!;l.drawImage(mask,0,0);l.globalCompositeOperation='source-in';l.fillStyle=colour;l.fillRect(0,0,layer.width,layer.height);
      ctx.drawImage(layer,dx,dy,dw,dh);
    };
    if(result.showSensitivity)paintMask(result.upperMask,'#f0b8669c');
    paintMask(result.mask,'#31b8e8c9');
    // Clip red to the intersection of residential footprints AND flooded cells.
    const residential=document.createElement('canvas');residential.width=residential.height=size;
    const r=residential.getContext('2d')!;r.imageSmoothingEnabled=false;r.fillStyle='#f36161';
    pilot.areas.forEach((area,i)=>{if(result.scenario.affectedM2[i]>0){pathGeometry(r,area.geometry,bounds,size);r.fill('evenodd');}});
    r.globalCompositeOperation='destination-in';r.drawImage(result.mask,dx,dy,dw,dh);ctx.drawImage(residential,0,0);
    if(result.baselineMask){
      const mask=result.baselineMask,edge=document.createElement('canvas');edge.width=mask.width;edge.height=mask.height;
      const ec=edge.getContext('2d')!,source=mask.getContext('2d')!.getImageData(0,0,mask.width,mask.height),pixels=ec.createImageData(mask.width,mask.height);
      for(let y=1;y<mask.height-1;y++)for(let x=1;x<mask.width-1;x++){
        const i=(y*mask.width+x)*4;
        if(source.data[i+3]&&[-4,4,-mask.width*4,mask.width*4].some(d=>!source.data[i+d+3]))pixels.data.set([244,244,235,255],i);
      }
      ec.putImageData(pixels,0,0);ctx.drawImage(edge,dx,dy,dw,dh);
    }
  }
  pilot.areas.forEach((area,i)=>{
    pathGeometry(ctx,area.geometry,bounds,size);
    ctx.strokeStyle=area.id===selectedId?'#fff4cf':result?.scenario.affectedM2[i]?'#ff7c78':result?.showSensitivity&&result.upper.affectedM2[i]?'#ffc473':'#b9c9cb70';
    ctx.lineWidth=area.id===selectedId?4:result?.scenario.affectedM2[i]?1.8:.6;ctx.stroke();
  });
  pathGeometry(ctx,pilot.reach,bounds,size);ctx.strokeStyle='#adf5ff';ctx.lineWidth=3;ctx.stroke();ctx.restore();
}
