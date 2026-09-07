"""Build the atlas's ODbL geography tiles from a Geofabrik Nepal OSM extract.
Usage: python scripts/import-geography.py /path/to/nepal.osm.pbf
Requires osmium, shapely. Geometry is simplified for display, not analysis.
"""
import json, math, sys, gzip
from pathlib import Path
from collections import Counter, defaultdict
import osmium
from geography_downloads import write_downloads
from shapely.geometry import shape, mapping, Point, Polygon
from shapely import make_valid

OUT = Path(__file__).resolve().parents[1] / 'public/geography'
OUT.mkdir(parents=True, exist_ok=True)
poly_path = Path(sys.argv[1]).with_suffix('.poly')
# Use the same extract boundary as Geofabrik, retaining crossing features as border context.
lines = poly_path.read_text().splitlines()
boundary = Polygon([tuple(map(float, line.split())) for line in lines if len(line.split()) == 2])
for old in OUT.glob('*.json'): old.unlink()
features = []
factory = osmium.geom.GeoJSONFactory()
errors = Counter()
PLACE = {'city', 'town', 'village', 'hamlet', 'isolated_dwelling', 'suburb', 'neighbourhood'}
RIVERS = {'river', 'stream', 'canal', 'drain', 'ditch'}

def name(tags):
    return tags.get('name:en') or tags.get('name') or tags.get('name:ne') or ''

def rounded(value):
    if isinstance(value, (list, tuple)): return [rounded(x) for x in value]
    return round(value, 5) if isinstance(value, float) else value

def add(osm_id, tags, layer, kind, geometry):
    if geometry.is_empty: return
    if not geometry.is_valid: geometry = make_valid(geometry)
    if not geometry.intersects(boundary): return
    if geometry.geom_type not in {'Point', 'LineString', 'Polygon', 'MultiPolygon'}: return
    # Preserve topology and islands; retain all features, including unnamed water bodies.
    geometry = geometry.simplify(.000035 if layer != 'settlements' else .00007, preserve_topology=True)
    center = geometry.interpolate(.5, normalized=True) if geometry.geom_type == 'LineString' else geometry.representative_point()
    lng, lat = center.x, center.y
    if not (79.7 < lng < 88.5 and 26.1 < lat < 30.8): return
    g = mapping(geometry)
    f = {'id': osm_id, 'layer': layer, 'kind': kind, 'name': name(tags), 'center': rounded([lng, lat]),
         'bounds': rounded(geometry.bounds), 'geometry': {'type': g['type'], 'coordinates': rounded(g['coordinates'])}}
    if tags.get('name:ne') and tags.get('name:ne') != f['name']: f['localName'] = tags.get('name:ne')
    if tags.get('intermittent') == 'yes': f['intermittent'] = True
    if geometry.geom_type in ('Polygon', 'MultiPolygon'):
        f['areaKm2'] = round(geometry.area * 111.32**2 * math.cos(math.radians(lat)), 4)
    features.append(f)

class Import(osmium.SimpleHandler):
    def node(self, obj):
        if obj.tags.get('place') in PLACE and obj.location.valid():
            add('node/'+str(obj.id), obj.tags, 'settlements', obj.tags.get('place'), Point(obj.location.lon, obj.location.lat))
    def way(self, obj):
        if obj.tags.get('waterway') in RIVERS and len(obj.nodes)>1:
            try: add('way/'+str(obj.id), obj.tags, 'rivers', obj.tags.get('waterway'), shape(json.loads(factory.create_linestring(obj))))
            except Exception: errors['waterway_geometry'] += 1
    def area(self, obj):
        tags=obj.tags
        water=tags.get('natural')=='water' or tags.get('waterway')=='riverbank' or tags.get('landuse')=='reservoir'
        residential=tags.get('landuse')=='residential'
        if not water and not residential: return
        layer='settlements' if residential else 'lakes'
        kind='residential' if residential else tags.get('water') or ('riverbank' if tags.get('waterway')=='riverbank' else 'reservoir' if tags.get('landuse')=='reservoir' else 'water')
        if kind in ('river', 'riverbank', 'canal'): layer='rivers'
        try: add(('way/' if obj.from_way() else 'relation/')+str(obj.orig_id()), tags, layer, kind, shape(json.loads(factory.create_multipolygon(obj))))
        except Exception: errors['area_geometry'] += 1

source=Path(sys.argv[1])
reader=osmium.io.Reader(str(source)); timestamp=reader.header().get('osmosis_replication_timestamp');reader.close()
print('Processing OSM snapshot '+timestamp, flush=True)
Import().apply_file(str(source), locations=True, idx='flex_mem')
print('Extracted', len(features), dict(errors), flush=True)
tiles=defaultdict(list)
index=[]
overview=[]
for f in features:
    w,s,e,n=f['bounds']
    for x in range(math.floor(w*2), math.floor(e*2)+1):
        for y in range(math.floor(s*2), math.floor(n*2)+1):
            tiles[f'{x}-{y}'].append(f)
    if f['name'] and f['kind']!='residential':
        index.append({k:v for k,v in f.items() if k!='geometry'})
    if (f['layer']=='rivers' and f['kind']=='river') or (f['layer']=='lakes' and f.get('areaKm2',0)>=.03) or f['kind'] in ('city','town'):
        g=mapping(shape(f['geometry']).simplify(.0008, preserve_topology=True))
        overview.append({**f,'geometry':{'type':g['type'],'coordinates':rounded(g['coordinates'])}})
def save(name,data):
    content=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()
    if name=='manifest.json': (OUT/name).write_bytes(content)
    else:
        (OUT/(name+'.gz')).write_bytes(gzip.compress(content,compresslevel=9,mtime=0))
        (OUT/name).unlink(missing_ok=True)
for key,items in tiles.items(): save(key+'.json',items)
save('overview.json',overview)
save('index.json',index)
counts=Counter(f['layer'] for f in features)
manifest={'source':'OpenStreetMap contributors / Geofabrik Nepal','timestamp':timestamp,'license':'ODbL-1.0',
          'counts':dict(counts),'kinds':dict(Counter(f['kind'] for f in features)),
          'tiles':list(tiles),'tileDegrees':.5,'indexCount':len(index),'overviewCount':len(overview),
          'geometryErrors':dict(errors)}
save('manifest.json',manifest)
write_downloads(OUT, features)
(OUT/'all.geojson.gz').unlink(missing_ok=True)
(OUT/'all.geojson').unlink(missing_ok=True)
(OUT/'LICENSE.txt').write_text('© OpenStreetMap contributors. This derived geographic database is available under the Open Database License (ODbL) 1.0: https://opendatacommons.org/licenses/odbl/1-0/\nSource: https://download.geofabrik.de/asia/nepal.html\nOSM snapshot: '+timestamp+'\nGeometries simplified for display. Mapped river/stream/canal/drain/ditch centerlines, natural water/reservoir polygons, settlement place nodes, and residential landuse polygons intersecting the extract boundary were selected. Unmapped features are absent. Small waters and streams appear in detailed views. Border context can extend outside Nepal. Settlement dots are place nodes, not population counts or individual buildings. Water colors and line widths are symbolic. The derived database is downloadable in GeoJSON parts listed in data.html. Unreadable geometries are recorded in manifest.json.\n')
print(json.dumps(manifest,ensure_ascii=False), flush=True)
