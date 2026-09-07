"""Experimental terrain-connected stage screening, not a hydraulic solver.

No display mesh, camera, distance buffer, rainfall, or population input is used.
Four-neighbour connectivity prevents water leaking diagonally through bank corners.
"""
import heapq
import numpy as np


def connected_stage(relative_height, seeds, valid):
    """Minimum stage needed to reach each cell from the selected channel.

    The cost of a path is its largest relative ground elevation. A low depression
    behind a higher bank only connects when that bank's stage is exceeded. Invalid
    cells are barriers and remain NaN. Cells beyond the analysis boundary are not
    assessed. Stage is relative to a spatially varying estimated channel profile.
    """
    height = np.asarray(relative_height, dtype=float)
    valid = np.asarray(valid, dtype=bool) & np.isfinite(height)
    seeds = np.asarray(seeds, dtype=bool) & valid
    if height.ndim != 2 or seeds.shape != height.shape or valid.shape != height.shape:
        raise ValueError('Matching two-dimensional grids are required')
    if not seeds.any():
        raise ValueError('The selected channel has no valid seed cells')
    rows, cols = height.shape
    costs = np.full(height.shape, np.inf)
    queue = []
    for r, c in zip(*np.where(seeds)):
        cost = max(0., height[r, c])
        costs[r, c] = cost
        heapq.heappush(queue, (cost, int(r), int(c)))
    while queue:
        cost, r, c = heapq.heappop(queue)
        if cost != costs[r, c]:
            continue
        for rr, cc in ((r-1,c),(r+1,c),(r,c-1),(r,c+1)):
            if 0 <= rr < rows and 0 <= cc < cols and valid[rr, cc]:
                candidate = max(cost, height[rr, cc], 0.)
                if candidate < costs[rr, cc]:
                    costs[rr, cc] = candidate
                    heapq.heappush(queue, (candidate, rr, cc))
    costs[~np.isfinite(costs)] = np.nan
    return costs


def stage_mask(thresholds, stage, permanent_water=None):
    if not np.isfinite(stage) or stage < 0 or stage > 12:
        raise ValueError('Stage must be between 0 and 12 metres')
    wet = np.isfinite(thresholds) & (thresholds <= stage)
    return wet if permanent_water is None else wet & ~permanent_water


def exposure(geometry, footprint, assessed):
    """Fractional polygon intersections preserve holes and partial coverage."""
    area = geometry.area
    assessed_area = geometry.intersection(assessed).area
    affected = geometry.intersection(footprint).area
    return {'areaM2': area, 'assessedM2': assessed_area, 'affectedM2': affected,
            'affectedPercent': 100 * affected / area if area else 0}
