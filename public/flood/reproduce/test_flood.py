"""Run: python -m unittest discover -s scripts -p 'test_flood.py' -v"""
import json, unittest
from pathlib import Path
import numpy as np
from PIL import Image
from shapely.geometry import Polygon, box, shape
from shapely.ops import transform
from pyproj import Transformer
from flood_core import connected_stage, stage_mask, exposure

class TerrainConnectivity(unittest.TestCase):
    def test_bank_protects_low_depression_until_overtopped(self):
        dem=np.array([[0.,1.,5.,0.,0.],[0.,1.,5.,0.,0.],[0.,1.,5.,0.,0.]])
        seeds=np.zeros(dem.shape,bool);seeds[:,0]=True
        costs=connected_stage(dem,seeds,np.ones(dem.shape,bool))
        self.assertFalse(stage_mask(costs,4)[:,3:].any())
        self.assertTrue(stage_mask(costs,5)[:,3:].all())
    def test_invalid_cells_do_not_become_dry_land(self):
        grid=np.zeros((3,5));valid=np.ones(grid.shape,bool);valid[:,2]=False
        seeds=np.zeros(grid.shape,bool);seeds[:,0]=True
        costs=connected_stage(grid,seeds,valid)
        self.assertTrue(np.isnan(costs[:,2:]).all())
    def test_no_diagonal_leak_at_bank_corner(self):
        grid=np.array([[0.,9.],[9.,0.]])
        costs=connected_stage(grid,np.array([[True,False],[False,False]]),np.ones((2,2),bool))
        self.assertEqual(costs[1,1],9)
    def test_seed_respects_its_ground_elevation(self):
        grid=np.array([[3.,0.]])
        costs=connected_stage(grid,np.array([[True,False]]),np.ones(grid.shape,bool))
        self.assertEqual(costs[0,1],3)
    def test_mapped_water_is_excluded_from_land_impact(self):
        water=np.array([[True,False]])
        self.assertEqual(stage_mask(np.array([[0.,1.]]),2,water).tolist(),[[False,True]])
    def test_invalid_stages_and_no_seed_fail_closed(self):
        for stage in [-1,13,float('nan')]:
            with self.assertRaises(ValueError):stage_mask(np.ones((2,2)),stage)
        with self.assertRaises(ValueError):connected_stage(np.ones((2,2)),np.zeros((2,2)),np.ones((2,2)))
    def test_polygon_holes_and_partial_exposure(self):
        polygon=Polygon([(0,0),(10,0),(10,10),(0,10)],holes=[[(2,2),(4,2),(4,4),(2,4)]])
        values=exposure(polygon,box(0,0,5,10),box(0,0,8,10))
        self.assertEqual(values['areaM2'],96)
        self.assertEqual(values['affectedM2'],46)
        self.assertEqual(values['assessedM2'],76)

class PilotIntegrity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root=Path(__file__).resolve().parents[1]/'public/flood/narayani'
        cls.meta=json.loads((cls.root/'manifest.json').read_text())
    def test_exposure_and_masks_are_monotonic(self):
        previous=None;old=np.zeros(len(self.meta['areas']));assessed=np.array(Image.open(self.root/'assessed.png'))>0
        for scenario in self.meta['scenarios']:
            mask=np.array(Image.open(self.root/Path(scenario['mask']).name))>0
            self.assertEqual(mask.shape,(self.meta['rows'],self.meta['cols']))
            self.assertFalse((mask&~assessed).any())
            if previous is not None:self.assertFalse((previous&~mask).any())
            areas=np.array(scenario['affectedM2'])
            self.assertTrue((areas>=old-.01).all())
            self.assertTrue((areas<=np.array([a['assessedM2'] for a in self.meta['areas']])+.02).all())
            old=areas;previous=mask
    def test_unassessed_polygons_never_get_a_false_zero_classification(self):
        unknown=[i for i,a in enumerate(self.meta['areas']) if a['assessedM2']==0]
        self.assertGreater(len(unknown),0)
        for scenario in self.meta['scenarios']:
            self.assertTrue(all(scenario['affectedM2'][i]==0 for i in unknown))
    def test_reference_profile_runs_downstream(self):
        profile=json.loads((self.root/'profile.json').read_text())
        self.assertTrue((np.diff(profile['referenceElevationMetres'])<=0).all())
        self.assertTrue((np.diff(profile['stationMetres'])>0).all())
    def test_original_polygons_and_ids_are_preserved(self):
        source={f['id']:shape(f['geometry']) for f in json.loads((self.root/'source.geojson').read_text())['features'] if f['properties']['kind']=='residential'}
        self.assertEqual(len({a['id'] for a in self.meta['areas']}),len(self.meta['areas']))
        project=Transformer.from_crs(4326,32645,always_xy=True).transform
        for area in self.meta['areas']:
            geometry=shape(area['geometry']);self.assertTrue(geometry.equals(source[area['id']]))
            self.assertAlmostEqual(transform(project,geometry).area,area['areaM2'],delta=.01)
    def test_channel_datum_translation_does_not_change_exposure(self):
        elevation=np.array([[10.,12.,15.],[10.,11.,12.]])
        reference=np.array([[10.,10.,10.],[10.,10.,10.]])
        seeds=np.zeros(elevation.shape,bool);seeds[:,0]=True
        valid=np.ones(elevation.shape,bool)
        original=connected_stage(elevation-reference,seeds,valid)
        shifted=connected_stage((elevation+100)-(reference+100),seeds,valid)
        np.testing.assert_array_equal(original,shifted)

if __name__=='__main__':unittest.main()
