"""Refine mountain windows from cached/public Mapterhorn elevation; no synthetic relief."""
import json, math, time, urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'site/public/terrain'; CACHE=ROOT/'work/dem-cache'
manifest=json.loads((OUT/'manifest.json').read_text())
def tx(lon,z): return (lon+180)/360*2**z
def ty(lat,z): return (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**z
models=[]
for model in manifest.values():
 if model['id']=='nepal' or model['id'].startswith('area-') or model['cols']>=769: continue
 model={**model,'cols':769,'rows':769,'zoom':11}
 if model['id']=='range-annapurna':
  w,s,e,n=83.30,28.04,84.64,29.12; lon,lat=(w+e)/2,(s+n)/2
  model.update(center=[lon,lat],bounds=[w,s,e,n],cols=1025,rows=1025,widthKm=(e-w)*111.32*math.cos(math.radians(lat)),depthKm=(n-s)*111.32)
 model['file']='/terrain/'+model['id']+'-hd.bin'; models.append(model)
tiles=set()
for m in models:
 w,s,e,n=m['bounds'];z=m['zoom']
 for x in range(int(tx(w,z)),int(tx(e,z))+1):
  for y in range(int(ty(n,z)),int(ty(s,z))+1): tiles.add((z,x,y))
def fetch(t):
 z,x,y=t; path=CACHE/f'{z}-{x}-{y}.webp'
 if path.exists(): return
 for attempt in range(4):
  try:
   req=urllib.request.Request(f'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',headers={'User-Agent':'Nepal3DAtlas/1.0'})
   with urllib.request.urlopen(req,timeout=35) as response: blob=response.read()
   path.write_bytes(blob); return
  except Exception:
   if attempt==3: raise
   time.sleep(attempt+1)
print(f'Refining {len(models)} mountain windows; {sum(not (CACHE/f"{z}-{x}-{y}.webp").exists() for z,x,y in tiles)} uncached source tiles',flush=True)
with ThreadPoolExecutor(max_workers=8) as pool:
 for f in as_completed([pool.submit(fetch,t) for t in tiles]): f.result()
for m in models:
 z=m['zoom'];w,s,e,n=m['bounds'];x0,x1=int(tx(w,z)),int(tx(e,z));y0,y1=int(ty(n,z)),int(ty(s,z))
 mosaic=np.empty(((y1-y0+1)*512,(x1-x0+1)*512),dtype=np.float32)
 for x in range(x0,x1+1):
  for y in range(y0,y1+1):
   rgb=np.asarray(Image.open(CACHE/f'{z}-{x}-{y}.webp').convert('RGB'),dtype=np.float32)
   assert rgb.shape[:2]==(512,512)
   mosaic[(y-y0)*512:(y-y0+1)*512,(x-x0)*512:(x-x0+1)*512]=rgb[:,:,0]*256+rgb[:,:,1]+rgb[:,:,2]/256-32768
 lons=np.linspace(w,e,m['cols']);lats=np.linspace(n,s,m['rows'])
 xs=(lons+180)/360*2**z*512-x0*512-.5;ys=(1-np.arcsinh(np.tan(np.radians(lats)))/np.pi)/2*2**z*512-y0*512-.5
 xx,yy=np.meshgrid(xs,ys);xa=np.floor(xx).astype(int).clip(0,mosaic.shape[1]-2);ya=np.floor(yy).astype(int).clip(0,mosaic.shape[0]-2)
 fx=np.clip(xx-xa,0,1);fy=np.clip(yy-ya,0,1)
 sampled=mosaic[ya,xa]*(1-fx)*(1-fy)+mosaic[ya,xa+1]*fx*(1-fy)+mosaic[ya+1,xa]*(1-fx)*fy+mosaic[ya+1,xa+1]*fx*fy
 heights=np.maximum(sampled,0).round().astype('<u2');assert 0<heights.max()<9000
 (OUT/Path(m['file']).name).write_bytes(heights.tobytes())
 manifest[m['id']]={**m,'minHeight':int(heights.min()),'maxHeight':int(heights.max())}
 print(m['id'],heights.shape,int(heights.max()),flush=True)
(OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
print('Elevation refinement complete.',flush=True)
