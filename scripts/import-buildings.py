"""Import OSM building footprints and a point-count density overview, nationwide.
Usage: python scripts/import-buildings.py /path/to/nepal.osm.pbf /path/to/temp-dir
Requires pyosmium, shapely, numpy, pillow. No current building use, height or population is inferred.
"""
import sys,json,gzip,math,hashlib
from pathlib import Path
from collections import OrderedDict,Counter
import osmium
import numpy as np
from PIL import Image
from shapely.geometry import shape,Polygon
from shapely import make_valid

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/buildings';OUT.mkdir(exist_ok=True)
SOURCE=Path(sys.argv[1]);TEMP=Path(sys.argv[2]);TEMP.mkdir(parents=True,exist_ok=True)
STEP=.05;SIZE=1024
boundary=Polygon([tuple(map(float,line.split())) for line in SOURCE.with_suffix('.poly').read_text().splitlines() if len(line.split())==2])
reader=osmium.io.Reader(str(SOURCE));timestamp=reader.header().get('osmosis_replication_timestamp');reader.close()
factory=osmium.geom.GeoJSONFactory();handles=OrderedDict();tiles=Counter();uses=Counter();errors=Counter();density={};count=0

def polygons(g):
 if g.geom_type=='Polygon':yield g
 elif hasattr(g,'geoms'):
  for part in g.geoms:yield from polygons(part)
def write(key,row):
 if key not in handles:
  if len(handles)>=48:handles.popitem(last=False)[1].close()
  handles[key]=(TEMP/(key+'.jsonl')).open('a')
 handles.move_to_end(key);handles[key].write(row+'\n');tiles[key]+=1
class Import(osmium.SimpleHandler):
 def area(self,a):
  global count
  use=a.tags.get('building')
  if not use or use=='no':return
  try:
   g=shape(json.loads(factory.create_multipolygon(a)))
   if not g.is_valid:g=make_valid(g);errors['repaired_geometry']+=1
   if g.is_empty or not g.intersects(boundary):return
   parts=list(polygons(g))
   if not parts:errors['no_polygon']+=1;return
   point=g.representative_point();lng,lat=point.x,point.y
   # Use seven decimal places: preserve the source OSM coordinate precision.
   coords=[[[[round(x,7),round(y,7)] for x,y in ring.coords] for ring in [p.exterior,*p.interiors]] for p in parts]
   identifier=('way/' if a.from_way() else 'relation/')+str(a.orig_id())
   record=[identifier,use,a.tags.get('name:en') or a.tags.get('name') or '',coords]
   row=json.dumps(record,ensure_ascii=False,separators=(',',':'))
   w,s,e,n=g.bounds
   for x in range(math.floor(w/STEP+1e-8),math.floor(e/STEP+1e-8)+1):
    for y in range(math.floor(s/STEP+1e-8),math.floor(n/STEP+1e-8)+1):write(f'{x}-{y}',row)
   dx,dy=math.floor(lng*2),math.floor(lat*2);key=f'{dx}-{dy}'
   if key not in density:density[key]=np.zeros((SIZE,SIZE),dtype=np.uint32)
   col=min(SIZE-1,max(0,int((lng-dx/2)*2*SIZE)));r=min(SIZE-1,max(0,int(((dy+1)/2-lat)*2*SIZE)))
   density[key][r,col]+=1;count+=1;uses[use]+=1
   if count%250000==0:print(f'{count:,} buildings extracted',flush=True)
  except RuntimeError as e:errors[type(e).__name__]+=1  # Invalid OSM area assembly; all other failures abort the import.

# An interrupted import must not append to a previous partial database.
for p in TEMP.glob('*.jsonl'):p.unlink()
print('Extracting building polygons from the Nepal snapshot…',flush=True)
Import().apply_file(str(SOURCE),locations=True,idx='flex_mem')
for f in handles.values():f.close()
meta={}
for i,(key,num) in enumerate(sorted(tiles.items())):
 lines=(TEMP/(key+'.jsonl')).read_text().splitlines();payload=('['+','.join(lines)+']').encode()
 blob=gzip.compress(payload,compresslevel=6,mtime=0);(OUT/(key+'.json.gz')).write_bytes(blob)
 meta[key]={'count':num,'bytes':len(blob),'sha256':hashlib.sha256(payload).hexdigest()}
 if i%500==0:print(f'{i}/{len(tiles)} footprint tiles written',flush=True)
densityMeta={}
for key,grid in sorted(density.items()):
 # Each cell's alpha encodes log-scaled counts of actual building representative
 # points, not population or a polygon estimating where buildings might exist.
 rgba=np.zeros((SIZE,SIZE,4),dtype=np.uint8);rgba[:,:,:3]=[231,211,179]
 rgba[:,:,3]=np.where(grid>0,np.minimum(235,90+45*np.log2(np.maximum(1,grid))),0).astype(np.uint8)
 Image.fromarray(rgba).save(OUT/(key+'.png'),optimize=True)
 densityMeta[key]={'count':int(grid.sum()),'maxCellCount':int(grid.max()),'bytes':(OUT/(key+'.png')).stat().st_size}
manifest={'version':1,'sourceSha256':hashlib.file_digest(SOURCE.open('rb'),'sha256').hexdigest(),'source':'OpenStreetMap contributors / Geofabrik Nepal','timestamp':timestamp,'license':'ODbL-1.0','count':count,'buildingTypes':dict(uses),'geometryNotes':dict(errors),'tileDegrees':STEP,'tiles':meta,'densityTileDegrees':.5,'densitySize':SIZE,'density':densityMeta,'record':['OSM id','building tag (architectural type; yes means unspecified)','name','MultiPolygon coordinates'],'method':'Original building footprints at OSM coordinate precision. Polygon holes retained. Density counts one representative point per source building per ~50 m cell. No building heights, use, population, or completeness inferred.'}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
(OUT/'LICENSE.txt').write_text('© OpenStreetMap contributors. Adapted geographic database under ODbL 1.0: https://opendatacommons.org/licenses/odbl/1-0/\nSource: https://download.geofabrik.de/asia/nepal.html\nSnapshot: '+timestamp+'\nBuilding footprints preserve source coordinate precision and holes. Building=yes has unspecified use. No height, occupancy or population inference. Mapping can be incomplete or outdated. The density images count representative building points, not population. All compressed JSON tiles in manifest.json form the downloadable adapted database.\n')
(OUT/'data.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flood IT building data</title><style>body{font:16px/1.6 system-ui;max-width:800px;margin:50px auto;padding:20px}li{margin:6px 0}</style><h1>Mapped buildings of Nepal</h1><p>© OpenStreetMap contributors / Geofabrik · '+timestamp+' · <a href="LICENSE.txt">ODbL source and data notes</a></p><p>'+f'{count:,}'+' building footprints. Building use is unspecified where tagged yes. These records are not homes or population counts. Density images encode counts per cell.</p><p><a href="manifest.json">Manifest, schema, counts and checksums</a></p><ul>'+''.join(f'<li><a href="{key}.json.gz">{key}</a> · {num:,} records</li>' for key,num in sorted(tiles.items()))+'</ul></html>')
print(json.dumps({'count':count,'tiles':len(meta),'densityTiles':len(density),'compressedMiB':round(sum(v['bytes'] for v in meta.values())/1048576,1),'notes':dict(errors)}),flush=True)
