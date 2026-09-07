import json, math, os, time, urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'site/public/terrain';OUT.mkdir(parents=True,exist_ok=True)
CACHE=ROOT/'work/dem-cache';CACHE.mkdir(exist_ok=True)
catalog=json.loads((ROOT/'site/public/geography/manifest.json').read_text())
def tx(lon,z):return (lon+180)/360*2**z
def ty(lat,z):return (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**z
places=[]
for key in catalog['tiles']:
 x,y=map(int,key.split('-'));lon=x/2+.25;lat=y/2+.25
 if (OUT/('area-'+key+'.bin')).exists():continue
 width=.8*111.32*math.cos(math.radians(lat));depth=.8*111.32
 places.append({'id':'area-'+key,'center':[lon,lat],'bounds':[lon-.4,lat-.4,lon+.4,lat+.4],'cols':385,'rows':385,'widthKm':width,'depthKm':depth,'zoom':10})
tiles=set()
for p in places:
 w,s,e,n=p['bounds'];z=p['zoom']
 for x in range(int(tx(w,z)),int(tx(e,z))+1):
  for y in range(int(ty(n,z)),int(ty(s,z))+1):tiles.add((z,x,y))
def fetch(tile):
 z,x,y=tile;f=CACHE/f'{z}-{x}-{y}.webp'
 if f.exists():return tile
 for attempt in range(4):
  try:
   req=urllib.request.Request(f'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',headers={'User-Agent':'Nepal3DAtlas/1.0'})
   with urllib.request.urlopen(req,timeout=35) as r: blob=r.read()
   f.write_bytes(blob);return tile
  except Exception:
   if attempt==3:raise
   time.sleep(attempt+1)
print(f'Fetching {len(tiles)} elevation tiles',flush=True)
with ThreadPoolExecutor(max_workers=10) as pool:
 for i,f in enumerate(as_completed([pool.submit(fetch,t) for t in tiles])):
  f.result()
  if (i+1)%50==0:print(f'{i+1}/{len(tiles)} tiles',flush=True)
manifest=json.loads((OUT/'manifest.json').read_text())
for p in places:
 z=p['zoom'];w,s,e,n=p['bounds'];x0=int(tx(w,z));y0=int(ty(n,z));x1=int(tx(e,z));y1=int(ty(s,z))
 mosaic=np.zeros(((y1-y0+1)*512,(x1-x0+1)*512),dtype=np.float32)
 for x in range(x0,x1+1):
  for y in range(y0,y1+1):
   rgb=np.asarray(Image.open(CACHE/f'{z}-{x}-{y}.webp').convert('RGB'),dtype=np.float32)
   heights=rgb[:,:,0]*256+rgb[:,:,1]+rgb[:,:,2]/256-32768
   assert rgb.shape[:2]==(512,512)
   mosaic[(y-y0)*512:(y-y0+1)*512,(x-x0)*512:(x-x0+1)*512]=heights
 lons=np.linspace(w,e,p['cols']);lats=np.linspace(n,s,p['rows'])
 xs=(lons+180)/360*2**z*512-x0*512-.5
 ys=(1-np.arcsinh(np.tan(np.radians(lats)))/np.pi)/2*2**z*512-y0*512-.5
 xx,yy=np.meshgrid(xs,ys);xa=np.floor(xx).astype(int).clip(0,mosaic.shape[1]-2);ya=np.floor(yy).astype(int).clip(0,mosaic.shape[0]-2)
 fx=np.clip(xx-xa,0,1);fy=np.clip(yy-ya,0,1)
 sampled=mosaic[ya,xa]*(1-fx)*(1-fy)+mosaic[ya,xa+1]*fx*(1-fy)+mosaic[ya+1,xa]*(1-fx)*fy+mosaic[ya+1,xa+1]*fx*fy
 heights=np.maximum(sampled,0).round().astype('<u2')
 assert heights.max()>0, p['id']
 (OUT/(p['id']+'.bin')).write_bytes(heights.tobytes())
 manifest[p['id']]={**p,'minHeight':int(heights.min()),'maxHeight':int(heights.max()),'file':'/terrain/'+p['id']+'.bin'}
 print(p['id'],int(heights.min()),int(heights.max()),flush=True)
(OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
print('DONE: '+str(len(manifest))+' terrain models',flush=True)
