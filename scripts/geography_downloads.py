"""Offer the complete ODbL database in small, independently usable GeoJSON parts."""
import gzip, json

def write_downloads(out, features):
    links=[]
    for layer in ('rivers','lakes','settlements'):
        records=[f for f in features if f['layer']==layer]
        for start in range(0,len(records),30000):
            part=records[start:start+30000];name=f'{layer}-{start//30000+1}.geojson.gz'
            with gzip.open(out/name,'wt',encoding='utf8') as stream:
                json.dump({'type':'FeatureCollection','features':[{'type':'Feature','id':f['id'],'properties':{k:v for k,v in f.items() if k!='geometry'},'geometry':f['geometry']} for f in part]},stream,ensure_ascii=False,separators=(',',':'))
            links.append(f'<li><a href="{name}" download>{layer.title()} — part {start//30000+1}</a> · {len(part):,} mapped features</li>')
    (out/'data.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nepal atlas geographic data</title><style>body{font:17px/1.7 system-ui;max-width:760px;margin:60px auto;padding:0 24px;background:#102530;color:#d6e7ed}a{color:#8cdeea}h1{font-size:32px}li{margin:12px 0}</style><h1>Nepal atlas geographic data</h1><p>© OpenStreetMap contributors, from the Geofabrik Nepal extract dated 6 September 2026. This derived database is available under the <a href="https://opendatacommons.org/licenses/odbl/1-0/">Open Database License 1.0</a>. Geometries are simplified for display. Each download contains a complete GeoJSON FeatureCollection compressed with gzip.</p><p>Download every part to obtain the full mapped dataset used by the atlas. Features are mapped objects, not an exhaustive physical inventory.</p><ul>'+''.join(links)+'</ul><p><a href="LICENSE.txt">Source and data notes</a> · <a href="/">Return to the atlas</a></p></html>')
