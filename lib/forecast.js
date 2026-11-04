// Places along each route to show in the weather forecast table on trip pages:
// the start, the end (if it's somewhere else), the high point, and camps on the route.
// NWS forecasts in ~2.5 km squares, so places closer together than that are merged.

import { dist } from './geo.js';

const MERGE_M = 3000, MIN_ROWS = 4, MAX_ROWS = 7;

// The nearest place in the list within maxM meters of pt, or null
function nearest(pt, list, maxM) {
  let best = null, bd = maxM;
  for (const p of list) { const d = dist(pt, p.at); if (d < bd) { bd = d; best = p; } }
  return best;
}

// Index of the route point closest to pt, and how far away it is
function onRoute(pts, at) {
  let k = 0, bd = Infinity;
  pts.forEach((p, i) => { const d = dist(p, at); if (d < bd) { bd = d; k = i; } });
  return { k, d: bd };
}

// pts: full GPX points [lat, lon, ele?]. places: { trailheads, camps } from the trip header,
// osm: points of interest from the trail map data (may be empty).
export function forecastPoints(pts, places, osm = []) {
  if (!pts.length) return [];
  const ft = k => Number.isFinite(pts[k][2]) ? Math.round(pts[k][2] * 3.28084) : null;
  const osmOf = t => osm.filter(p => p.t === t && p.n).map(p => ({ n: p.n, at: p.at }));
  const trailheads = [...places.trailheads, ...osmOf('trailhead')];
  const ends = (k, fallback) => {
    const th = nearest(pts[k], trailheads, 1000);
    return { n: th ? th.n : fallback, kind: 'Trailhead', k };
  };

  // In priority order: what's kept when two places fall in the same forecast square
  const cands = [ends(0, 'Start')];
  const last = pts.length - 1;
  if (dist(pts[0], pts[last]) > MERGE_M) cands.push(ends(last, 'End'));
  if (pts.every(p => Number.isFinite(p[2]))) {
    let hk = 0; pts.forEach((p, i) => { if (p[2] > pts[hk][2]) hk = i; });
    const peak = nearest(pts[hk], osmOf('peak'), 800);
    cands.push({ n: 'High point', kind: 'High point', k: hk, near: peak && peak.n });
  }
  // Camps from the trip header if any are on this route, otherwise named camps from the map data
  const campsOn = list => list.map(c => ({ c, ...onRoute(pts, c.at) })).filter(x => x.d < 400);
  let camps = campsOn(places.camps);
  if (!camps.length) camps = campsOn(osmOf('camp'));
  camps.sort((a, b) => a.k - b.k).forEach(({ c, k }) => cands.push({ n: c.n, kind: 'Camp', k }));

  // Merge places in the same square; widen the spacing until it fits in MAX_ROWS rows
  const merge = list => {
    let spacing = MERGE_M, kept;
    do {
      kept = [];
      for (const c of list) {
        const hit = kept.find(x => dist(pts[x.k], pts[c.k]) < spacing);
        if (hit) { if (c.kind === 'Camp' && c.n !== hit.n) hit.also.push(c.n); }
        else kept.push({ ...c, also: [] });
      }
      spacing *= 1.4;
    } while (kept.length > MAX_ROWS);
    return kept;
  };
  let kept = merge(cands);
  // Few places on the route: add points every quarter of the way, named by the mile
  if (kept.length < MIN_ROWS) {
    const d = [0];
    for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + dist(pts[i - 1], pts[i]));
    const fill = [1, 2, 3].map(q => {
      const k = d.findIndex(x => x >= d[last] * q / 4), mi = Math.round(d[k] / 1609.344);
      return { n: `Mile ${mi}`, kind: 'On the route', k, near: (nearest(pts[k], [...osmOf('camp'), ...osmOf('peak')], 800) || {}).n };
    });
    kept = merge([...cands, ...fill]);
  }

  return kept.sort((a, b) => a.k - b.k || (a.kind === 'Trailhead' ? -1 : 1)).map(x => ({
    n: x.n, kind: x.kind, at: [+pts[x.k][0].toFixed(4), +pts[x.k][1].toFixed(4)], ft: ft(x.k), ...(x.near ? { near: x.near } : {}), ...(x.also.length ? { also: x.also } : {})
  }));
}
