import { fromUrl } from 'geotiff';
export type ElevationGrid={bounds:[number,number,number,number];cols:number;rows:number;heights:Float32Array;tiles:string[]};
const STEP=1/3600;
// Copernicus COG pixel centres are on whole arc-seconds (RasterPixelIsPoint).
// Adjacent source tiles omit shared south/east rows. Read image 0 explicitly to
// retain native resolution; do not let the decoder choose a coarser overview.
export async function readElevation(bounds:number[],origin:string,progress:(message:string)=>void):Promise<ElevationGrid>{
  const west=Math.floor(bounds[0]*3600),east=Math.ceil(bounds[2]*3600),north=Math.ceil(bounds[3]*3600),south=Math.floor(bounds[1]*3600);
  const cols=east-west+1,rows=north-south+1;
  if(cols*rows>1200000)throw new Error('This reach spans too large an area. Choose a shorter reach length.');
  const result:ElevationGrid={bounds:[(west-.5)*STEP,(south-.5)*STEP,(east+.5)*STEP,(north+.5)*STEP],cols,rows,heights:new Float32Array(cols*rows).fill(NaN),tiles:[]};
  const tiles:{lng:number;lat:number}[]=[];
  for(let lng=Math.floor(west*STEP);lng<=Math.floor(east*STEP);lng++)for(let lat=Math.floor((south-.5)*STEP);lat<=Math.floor((north-.5)*STEP);lat++)tiles.push({lng,lat});
  // At most a few neighbouring one-degree files; each request reads only the
  // needed internal TIFF blocks through the bounded same-origin range endpoint.
  for(const {lng,lat} of tiles){
    progress(`Reading 30 m elevation · tile ${result.tiles.length+1} of ${tiles.length}`);
    const tiff=await fromUrl(`${origin}/api/elevation/${lat}/${lng}`,{allowFullFile:false,maxRanges:0});
    try{
      const image=await tiff.getImage(0),[ox,oy]=image.getOrigin(),[rx,ry]=image.getResolution();
      if(Math.abs(rx-STEP)>1e-9||Math.abs(ry+STEP)>1e-9||image.getWidth()!==3600||image.getHeight()!==3600)throw new Error('The elevation source has an unexpected grid. This area was not assessed.');
      const x0=Math.max(0,Math.ceil((west*STEP-ox)/rx-1e-6)),x1=Math.min(3600,Math.floor((east*STEP-ox)/rx+1e-6)+1);
      const y0=Math.max(0,Math.ceil((north*STEP-oy)/ry-1e-6)),y1=Math.min(3600,Math.floor((south*STEP-oy)/ry+1e-6)+1);
      if(x1<=x0||y1<=y0)continue;
      const data=await image.readRasters({window:[x0,y0,x1,y1],samples:[0],interleave:true});
      const values=data as unknown as Float32Array,nodata=image.getGDALNoData(),width=x1-x0;
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
        const c=Math.round((ox+x*rx)/STEP)-west,r=north-Math.round((oy+y*ry)/STEP),value=Number(values[(y-y0)*width+x-x0]);
        if(r>=0&&r<rows&&c>=0&&c<cols&&Number.isFinite(value)&&value!==nodata&&value>=0)result.heights[r*cols+c]=value;
      }
      result.tiles.push(`N${lat}E0${lng}`);
    }finally{await tiff.close();}
  }
  return result;
}
