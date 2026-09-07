"""Reproducible Narayani pilot. Run with the source PBF and Copernicus GLO-30 tile.
Dependencies: numpy, scipy, shapely, pyproj, rasterio, osmium, Pillow.
The output is experimental connected-stage screening. It is NOT HAND or a
hydrodynamic model; stages are offsets from a DEM-derived channel profile.
"""
import json, sys, hashlib
from pathlib import Path
from collections import Counter
import numpy as np
import osmium
import rasterio
from rasterio.features import rasterize, shapes
from rasterio.windows import from_bounds, Window
from rasterio.transform import array_bounds
from shapely.geometry import shape, mapping, box, LineString
from shapely.ops import transform, unary_union
from shapely import make_valid
from scipy.spatial import cKDTree
from scipy.ndimage import median_filter, minimum_filter
from scipy.optimize import isotonic_regression
from pyproj import Transformer
from PIL import Image
from flood_core import connected_stage, stage_mask, exposure

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/flood/narayani'
OUT.mkdir(parents=True, exist_ok=True)
PBF, DEM = map(Path, sys.argv[1:3])
CORE = [84.27, 27.64, 84.46, 27.79]
BUFFER = [84.24, 27.61, 84.49, 27.82]
REACH_ID = 'way/25708647'
factory = osmium.geom.GeoJSONFactory()
project = Transformer.from_crs(4326, 32645, always_xy=True).transform
unproject = Transformer.from_crs(32645, 4326, always_xy=True).transform
features = []
errors = Counter()
cache = OUT / 'source.geojson'

def add(identifier, tags, kind, geometry):
    if not geometry.is_valid: geometry = make_valid(geometry)
    if geometry.is_empty or not geometry.intersects(box(*BUFFER)): return
    features.append({'type':'Feature','id':identifier,'properties':{
        'id':identifier, 'kind':kind, 'name':tags.get('name:en') or tags.get('name') or '',
        'localName':tags.get('name:ne') or ''}, 'geometry':mapping(geometry)})

class Extract(osmium.SimpleHandler):
    def way(self, obj):
        if obj.tags.get('waterway') not in ('river','stream'): return
        try: add('way/'+str(obj.id),obj.tags,obj.tags.get('waterway'),shape(json.loads(factory.create_linestring(obj))))
        except Exception: errors['waterway'] += 1
    def area(self, obj):
        t=obj.tags
        if t.get('landuse')!='residential' and t.get('natural')!='water' and t.get('waterway')!='riverbank': return
        try: add(('way/' if obj.from_way() else 'relation/')+str(obj.orig_id()),t,'residential' if t.get('landuse')=='residential' else 'water',shape(json.loads(factory.create_multipolygon(obj))))
        except Exception: errors['area'] += 1

def save(path, value):
    (OUT/path).write_text(json.dumps(value, ensure_ascii=False, separators=(',',':'), allow_nan=False))

if cache.exists(): features=json.loads(cache.read_text())['features']
else:
    print('Extracting unsimplified pilot geometry…',flush=True)
    Extract().apply_file(str(PBF),locations=True,idx='flex_mem')
    save('source.geojson',{'type':'FeatureCollection','features':features})
reach=next(f for f in features if f['id']==REACH_ID)
line=transform(project,shape(reach['geometry']))
assert line.geom_type=='LineString' and 12000<line.length<25000
print('Reach metres',line.length,'features',len(features),'errors',dict(errors),flush=True)
with rasterio.open(DEM) as src:
    win=from_bounds(*BUFFER,src.transform).round_offsets().round_lengths()
    grid=src.read(1,window=win).astype(float)
    affine=src.window_transform(win)
    source_nodata=src.nodata
    dem_crs=str(src.crs)
rows,cols=grid.shape
w,s,e,n=array_bounds(rows,cols,affine)
bounds=[w,s,e,n]
xx,yy=np.meshgrid(w+(np.arange(cols)+.5)*affine.a,n+(np.arange(rows)+.5)*affine.e)
gx,gy=project(xx,yy)
valid=np.isfinite(grid)&(grid>0)
if source_nodata is not None: valid &= grid!=source_nodata

# Read channel surface elevations at 30 m stations. A local minimum reduces
# narrow bridges/vegetation artifacts; median filtering and monotone regression
# form a downstream-decreasing reference. This is an assumed water-surface proxy,
# not a riverbed, measured gauge zero, bankfull level, or observed normal flow.
station=np.linspace(0,line.length,int(line.length/30)+1)
points=np.array([line.interpolate(float(d)).coords[0] for d in station])
lon,lat=unproject(points[:,0],points[:,1])
rr=np.clip(((n-np.array(lat))/-affine.e).astype(int),0,rows-1)
cc=np.clip(((np.array(lon)-w)/affine.a).astype(int),0,cols-1)
sample=minimum_filter(grid,size=3)[rr,cc]
if np.median(sample[:10]) < np.median(sample[-10:]):
    raise ValueError('Source reach direction is not downhill; inspect topology before proceeding')
profile=isotonic_regression(median_filter(sample,size=11),increasing=False).x
_, nearest=cKDTree(points).query(np.column_stack((gx.ravel(),gy.ravel())))
nearest=nearest.reshape(grid.shape)
reference=profile[nearest]
relative=grid-reference
seed=rasterize([(shape(reach['geometry']),1)],out_shape=grid.shape,transform=affine,all_touched=True).astype(bool)&valid
# Seed values retain their own relative heights; no forced removal of bank cells.
domain=valid&(nearest>3)&(nearest<len(station)-4)
thresholds=connected_stage(relative,seed,domain)
# No extrapolated profile beyond the reach endpoints; buffered margin is not assessed.
core=(xx>CORE[0])&(xx<CORE[2])&(yy>CORE[1])&(yy<CORE[3])
assess=core&domain&np.isfinite(thresholds)
water_geoms=[shape(f['geometry']) for f in features if f['properties']['kind']=='water']
water=rasterize([(g,1) for g in water_geoms],out_shape=grid.shape,transform=affine).astype(bool)

def polygon(mask):
    return unary_union([shape(g) for g,v in shapes(mask.astype('uint8'),mask=mask,transform=affine,connectivity=4) if v==1])

assessed_poly=polygon(assess)
assessed_m=transform(project,assessed_poly)
residential=[f for f in features if f['properties']['kind']=='residential' and shape(f['geometry']).intersects(box(*CORE))]
res_geoms=[transform(project,shape(f['geometry'])) for f in residential]
res_union=unary_union(res_geoms)
areas=[]
for i,(f,g) in enumerate(zip(residential,res_geoms)):
    original=shape(f['geometry']); p=original.representative_point()
    areas.append({'id':f['id'],'name':f['properties']['name'] or f'Residential area {i+1:03d}',
        'center':[p.x,p.y],'bounds':list(original.bounds),'geometry':mapping(original),
        'areaM2':round(g.area,2),'assessedM2':round(g.intersection(assessed_m).area,2)})

# Native-resolution raster masks are used for the 3D overlay. Exact cell-footprint
# polygon intersections (in metres) give partial residential area, preserving holes.
# There are 25 discrete scenarios at 0.5 m intervals for fast browser operation.
scenarios=[]
for index in range(25):
    stage=index*.5
    wet=stage_mask(thresholds,stage)&assess
    land=wet&~water
    land_polygon=polygon(land)
    projected=transform(project,land_polygon)
    impacts=[round(g.intersection(projected).area,2) for g in res_geoms]
    Image.fromarray((land*255).astype('uint8')).save(OUT/f'stage-{index}.png')
    boundary_contact=bool((land & (core & ~minimum_filter(core,size=7))).any())
    scenarios.append({'stage':stage,'landAreaM2':round(projected.area,2),'residentialAreaM2':round(res_union.intersection(projected).area,2),'affectedM2':impacts,
        'boundaryContact':boundary_contact,'mask':f'/flood/narayani/stage-{index}.png'})
    print('Stage',stage,'land km²',round(projected.area/1e6,2),'residential areas',sum(a>0 for a in impacts),flush=True)
Image.fromarray((assess*255).astype('uint8')).save(OUT/'assessed.png')
encoded=np.where(assess,np.clip(np.ceil(thresholds*100),0,65534),65535).astype('<u2')
encoded.tofile(OUT/'connected-stage-cm.bin')

meta={'id':'narayani-bharatpur','name':'Narayani River','subtitle':'Devghat → Bharatpur / Gaindakot',
      'reachIds':[REACH_ID],'reach':reach['geometry'],'center':[84.377,27.712],
      'bounds':bounds,'coreBounds':CORE,'cols':cols,'rows':rows,'resolution':'1 arc-second (about 27 × 31 m here)',
      'cellWidthM':round(float(np.median(np.diff(gx,axis=1))),2),'cellHeightM':round(float(-np.median(np.diff(gy,axis=0))),2),
      'reachLengthKm':round(line.length/1000,2),'profileRangeM':[round(float(profile.min()),2),round(float(profile.max()),2)],
      'analysisVersion':'connected-stage-v1','experimental':True,'locallyCalibrated':False,
      'assessedGeometry':mapping(assessed_poly),'areas':areas,'scenarios':scenarios,
      'assessedMask':'/flood/narayani/assessed.png','sourceTimestamp':'2026-09-06T20:21:35Z',
      'reference':'Offset above an estimated channel surface profile derived from Copernicus DSM. Not a gauge reading or rise above current water.',
      'validation':{'syntheticTests':'See /flood/method.html','historicalCalibration':'Not performed: no matching reach stage or georeferenced validation extent established.',
         'referenceEvent':'https://sentinel-asia.org/EO/2017/article20170812NP.html'},
      'sourceDemSha256':hashlib.sha256(DEM.read_bytes()).hexdigest()}
save('manifest.json',meta)
save('profile.json',{'stationMetres':station.round(2).tolist(),'referenceElevationMetres':profile.round(2).tolist(),'rawSampleMetres':sample.round(2).tolist()})

# A separate display window sampled from the same source. Analysis retains float
# elevations at native resolution; these rounded display metres never feed it.
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds as transform_from_bounds
display=np.empty((769,769),dtype='float32')
target_bounds=[84.22,27.60,84.51,27.84]
with rasterio.open(DEM) as src:
    reproject(rasterio.band(src,1),display,src_transform=src.transform,src_crs=src.crs,
              dst_transform=transform_from_bounds(*target_bounds,769,769),dst_crs='EPSG:4326',resampling=Resampling.bilinear)
np.rint(display).clip(0,65535).astype('<u2').tofile(ROOT/'public/terrain/flood-narayani.bin')
terrain=json.loads((ROOT/'public/terrain/manifest.json').read_text())
ww,ss,ee,nn=target_bounds; center=[(ww+ee)/2,(ss+nn)/2]
terrain['flood-narayani']={'id':'flood-narayani','center':center,'bounds':target_bounds,'cols':769,'rows':769,
    'widthKm':(ee-ww)*111.32*np.cos(np.deg2rad(center[1])),'depthKm':(nn-ss)*111.32,
    'minHeight':float(display.min()),'maxHeight':float(display.max()),'file':'/terrain/flood-narayani.bin',
    'source':'Copernicus GLO-30; see /flood/method.html'}
(ROOT/'public/terrain/manifest.json').write_text(json.dumps(terrain,separators=(',',':')))
print('Complete:',len(areas),'residential polygons;',grid.shape,'analysis cells',flush=True)
