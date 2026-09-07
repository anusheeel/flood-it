// Stream bounded byte ranges from one fixed, public Copernicus DEM bucket.
// No caller-supplied URL or credentials reach the upstream service.
export async function GET(request:Request,{params}:{params:Promise<{lat:string;lng:string}>}){
  const {lat:latitude,lng:longitude}=await params;
  if(!/^\d{2}$/.test(latitude)||!/^\d{2}$/.test(longitude))return new Response('Invalid tile',{status:400});
  const lat=Number(latitude),lng=Number(longitude);
  if(lat<25||lat>31||lng<79||lng>88)return new Response('Outside modelled coverage',{status:400});
  const range=request.headers.get('range'),match=range?.match(/^bytes=(\d+)-(\d+)$/);
  if(!match)return new Response('A single bounded byte range is required',{status:416});
  const start=Number(match[1]),end=Number(match[2]);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end-start>=16*1024*1024||end>250*1024*1024)return new Response('Range too large',{status:416});
  const tile=`Copernicus_DSM_COG_10_N${lat}_00_E0${lng}_00_DEM`;
  try{
    const response=await fetch(`https://copernicus-dem-30m.s3.amazonaws.com/${tile}/${tile}.tif`,{headers:{Range:range!},signal:AbortSignal.timeout(45000)});
    if(response.status===404)return new Response('Elevation tile unavailable',{status:404});
    if(response.status!==206||!response.headers.get('content-range')){await response.body?.cancel();return new Response('Elevation range service unavailable',{status:502});}
    const headers=new Headers({'Content-Type':'image/tiff','Accept-Ranges':'bytes','Cache-Control':'public, max-age=86400','Content-Range':response.headers.get('content-range')!});
    for(const key of ['content-length','etag','last-modified']){const value=response.headers.get(key);if(value)headers.set(key,value);}
    return new Response(response.body,{status:206,headers});
  }catch{return new Response('Elevation data could not load. Please retry.',{status:503});}
}
