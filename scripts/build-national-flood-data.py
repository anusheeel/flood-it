"""Unsimplified, tiled national flood inputs from the Geofabrik Nepal extract.
Usage: python scripts/build-national-flood-data.py /path/to/nepal.osm.pbf
"""
import sys, json, gzip, math, hashlib
from pathlib import Path
from collections import defaultdict, Counter
import osmium
from shapely.geometry import shape, mapping, Polygon
from shapely import make_valid

root=Path(__file__).resolve().parents[1]
out=root/'public/flood/inputs';out.mkdir(parents=True,exist_ok=True)
source=Path(sys.argv[1]);factory=osmium.geom.GeoJSONFactory()
tiles=defaultdict(list);index=[];counts=Counter();errors=Counter()
boundary=Polygon([tuple(map(float,line.split())) for line in source.with_suffix('.poly').read_text().splitlines() if len(line.split())==2])
reader=osmium.io.Reader(str(source));timestamp=reader.header().get('osmosis_replication_timestamp');reader.close()

def add(identifier,tags,layer,kind,geometry):
    if not geometry.is_valid:geometry=make_valid(geometry)
    if geometry.is_empty or geometry.geom_type not in ('LineString','Polygon','MultiPolygon'):return
    if not geometry.intersects(boundary):return
    center=geometry.interpolate(.5,normalized=True) if geometry.geom_type=='LineString' else geometry.representative_point()
    f={'id':identifier,'name':tags.get('name:en') or tags.get('name') or '', 'layer':layer,'kind':kind,
       'localName':tags.get('name:ne') or '', 'center':[center.x,center.y],'bounds':list(geometry.bounds),'geometry':mapping(geometry)}
    if tags.get('intermittent')=='yes':f['intermittent']=True
    w,s,e,n=geometry.bounds
    for x in range(math.floor(w*2),math.floor(e*2)+1):
        for y in range(math.floor(s*2),math.floor(n*2)+1):tiles[f'{x}-{y}'].append(f)
    if geometry.geom_type=='LineString':index.append({k:v for k,v in f.items() if k!='geometry'})
    counts[kind]+=1

class Extract(osmium.SimpleHandler):
    def way(self,obj):
        kind=obj.tags.get('waterway')
        if kind not in ('river','stream'):return
        try:add('way/'+str(obj.id),obj.tags,'rivers',kind,shape(json.loads(factory.create_linestring(obj))))
        except Exception:errors['waterway']+=1
    def area(self,obj):
        t=obj.tags;residential=t.get('landuse')=='residential'
        water=t.get('natural')=='water' or t.get('waterway')=='riverbank' or t.get('landuse')=='reservoir'
        if not residential and not water:return
        try:add(('way/' if obj.from_way() else 'relation/')+str(obj.orig_id()),t,'settlements' if residential else 'lakes','residential' if residential else 'water',shape(json.loads(factory.create_multipolygon(obj))))
        except Exception:errors['area']+=1

print('Reading original river, water and residential geometry…',flush=True)
Extract().apply_file(str(source),locations=True,idx='flex_mem')
def compressed(name,data):
    payload=json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
    (out/name).write_bytes(gzip.compress(payload,compresslevel=6,mtime=0))
    return {'compressedBytes':(out/name).stat().st_size,'sha256':hashlib.sha256(payload).hexdigest()}
stats={}
for key,features in sorted(tiles.items()):stats[key]=compressed(key+'.json.gz',features)
compressed('rivers.json.gz',index)
manifest={'source':'OpenStreetMap contributors / Geofabrik Nepal','timestamp':timestamp,'license':'ODbL-1.0','tileDegrees':.5,
          'tiles':stats,'counts':dict(counts),'geometryErrors':dict(errors),'coverage':mapping(boundary),
          'method':'Unsimplified river/stream centerlines, water polygons and residential land-use polygons. No building or population inference.'}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
print('Complete:',dict(counts),'errors',dict(errors),'compressed MiB',round(sum(f.stat().st_size for f in out.iterdir())/1048576,2),flush=True)
