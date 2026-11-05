// Picks what the maps use out of a park's complete saved data (parkdata/<park>/full.osm.pbf), with no downloading:
//   osm.json  what the trip maps are built from: trails, dirt roads, trailheads, camps, peaks, water,
//             long-distance trails and the park boundary
//   all.json  everything in the file, trimmed, for the park's "All map data" page
// Changing what the trip maps use only means changing the rules here and running scripts/pick-features.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simplify } from './geo.js';
import { parkPath, grow, pad, inside } from './parkdata.js';
import { readPbf } from './osm.js';
import { createHash } from 'node:crypto';

// A fingerprint of the pick rules (this file and lib/osm.js), saved in osm.json, so a park picked with older
// rules is picked again (scripts/download-parks.js does this; the workflow runs it)
export const RULES = createHash('sha1').update(['pick.js', 'osm.js'].map(f => fs.readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n')).digest('hex').slice(0, 12);
export const pickedWithOldRules = name => { try { return JSON.parse(fs.readFileSync(parkPath(name, 'osm.json'), 'utf8')).rules !== RULES; } catch { return true; } };

// What trip maps use: walkable lines (paths, footways, bridleways, cycleways, dirt roads, named steps),
// trailheads, camps, huts, named peaks, springs and drinking water.
// (Every piece of a long-distance trail is added too, whatever it's tagged as; see below.)
export function wanted(el) {
  const t = el.tags || {};
  if (el.type === 'node') return t.highway === 'trailhead' || /^(camp_site|wilderness_hut|alpine_hut)$/.test(t.tourism || '') ||
    (t.natural === 'peak' && !!t.name) || t.amenity === 'drinking_water' || t.natural === 'spring';
  if (el.type === 'way') return (/^(path|footway|bridleway|cycleway|track)$/.test(t.highway || '') && !/sidewalk|crossing/.test(t.footway || '') && !/^(private|no)$/.test(t.access || '')) ||
    (t.highway === 'steps' && !!t.name) || t.highway === 'trailhead' || t.tourism === 'camp_site';
  return false;
}
// Long-distance trails: international, national or regional hiking routes (PCT, Tahoe Rim Trail, Ohlone Wilderness Trail…)
export const isLongTrail = el => el.type === 'relation' && /^(hiking|foot)$/.test(el.tags?.route || '') && /^(iwn|nwn|rwn)$/.test(el.tags?.network || '');

// ---------- the All map data page: one kind per object, from its main tag ----------
const KEYS = ['highway', 'railway', 'aerialway', 'waterway', 'natural', 'water', 'landuse', 'landcover', 'leisure', 'amenity', 'tourism',
  'historic', 'man_made', 'building', 'boundary', 'protect_class', 'barrier', 'power', 'place', 'shop', 'office', 'craft', 'emergency',
  'information', 'route', 'type'];
export const kindOf = t => { const k = KEYS.find(k => t[k]) || Object.keys(t)[0]; return k ? `${k}=${t[k]}` : 'other'; };
// What the All map data page shows (Mike's calls, Nov 4 2026). Anything not shown is still in full.osm.pbf,
// so it can come back with just a re-pick (no download).
//   trails and roads: trails (paths, footways, bridleways, steps, cycleways, pedestrian ways, climbing routes, ladders,
//            trails under construction), dirt roads, forest roads, highways, service roads (not driveways or parking
//            aisles), trailheads; not residential streets, freeways, ramps, bus stops, signals, crossings, proposed…
//   anything that's part of a long-distance trail stays, whatever its kind
//   tourism and amenities: only camps, huts and drinking water
//   boundaries: neighboring parks, forests and wildernesses, tribal lands, hazard areas (not county, census, fire…)
//   water: streams, rivers, lakes, pools, tanks, waterfalls, rapids, stream ends, bends (not pipes, canals, ditches,
//          drains, dams, weirs, connector lines, paddle routes)
//   natural: landmarks (peaks, springs, passes, ridges, canyons, cliffs, glaciers, wetlands, lakes…); land cover
//            (forest, bare rock, scrub, grassland, scree…) only where named, since the topo base already shows it;
//            not reefs, earth banks or tree stumps
//   not shown: leisure, land use, buildings and everything else (power lines, barriers, places…)
const LANDCOVER = /^(wood|bare_rock|scrub|grassland|heath|sand|scree|shingle|mud|grass|fell|shrubbery|shrub|tree_row|tree_group)$/;
const ROADS = /^(path|footway|bridleway|steps|cycleway|pedestrian|construction|climbing|climbing_access|ladder|trail|track|unclassified|tertiary|secondary|primary|trunk|service)$/;
export function onPage(k, isPoint, tags = {}, longTrail = false) {
  const [key, val] = k.split('=');
  if (longTrail) return true;
  if (/^(tourism=(camp_site|wilderness_hut|alpine_hut)|amenity=drinking_water|highway=trailhead)$/.test(k)) return true;
  if (key === 'highway') return !isPoint && ROADS.test(val) && !(val === 'service' && /^(driveway|parking_aisle)$/.test(tags.service || ''));
  if (key === 'boundary') return /^(protected_area|aboriginal_lands|indigenous_administration|hazard)$/.test(val);
  if (key === 'waterway') return /^(stream|river|waterfall|rapids|stream_end|bend|tidal_channel)$/.test(val);
  if (key === 'water') return val !== 'wastewater';
  if (key === 'natural') return LANDCOVER.test(val) ? !!tags.name : !/^(reef|earth_bank|tree_stump)$/.test(val);
  return key === 'protect_class';
}
const r5 = p => [+p[0].toFixed(5), +p[1].toFixed(5)];
const r7 = p => [+p[0].toFixed(7), +p[1].toFixed(7)];
const skipTag = k => /^(tiger|source|gnis|nhd|created_by|attribution)(:|$)/.test(k);

export async function pickPark(name) {
  const meta = JSON.parse(fs.readFileSync(parkPath(name, 'park.json'), 'utf8'));
  const big = pad(meta.box);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-'));
  const ways = new Map();       // way id -> points (every way, for relations)
  const wayTags = new Map();    // way id -> tags (ways that have tags)
  const nodes = [], relations = [];
  try {
    await readPbf(parkPath(name, 'full.osm.pbf'), tmp, el => {
      if (el.type === 'node') { if (el.tags) nodes.push(el); }
      else if (el.type === 'way') { ways.set(el.id, el.geometry || []); if (el.tags) wayTags.set(el.id, el.tags); }
      else relations.push(el);
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const way = id => ({ type: 'way', id, tags: wayTags.get(id), geometry: ways.get(id) });
  const near = pts => pts.some(q => inside(big, q));

  // The park boundary, by the OpenStreetMap object found when it was downloaded
  const area = meta.area.type === 'way' ? way(meta.area.id) : relations.find(r => r.id === meta.area.id);
  if (!area) throw new Error(`the saved data for "${name}" has no ${meta.area.type} ${meta.area.id}; download it again`);
  const boundary = [area.type === 'way' ? { type: 'way', id: area.id, tags: area.tags, geometry: area.geometry }
    : { type: 'relation', id: area.id, tags: area.tags, members: area.members.map(m => ({ ...m, ...(m.type === 'way' && ways.has(m.ref) ? { geometry: ways.get(m.ref) } : {}) })) }];

  // What the trip maps use, inside the park's padded box
  const features = [], picked = new Set();
  for (const el of nodes) if (wanted(el) && inside(big, [el.lat, el.lon])) { features.push({ type: 'node', id: el.id, lat: el.lat, lon: el.lon, tags: el.tags }); picked.add('n' + el.id); }
  for (const [id, tags] of wayTags) {
    const el = way(id);
    if (wanted(el) && near(el.geometry)) { features.push({ type: 'way', id, tags, geometry: el.geometry.map(r7) }); picked.add('w' + id); }
  }
  // Every piece of a long-distance trail near the park, whatever it's tagged as (Mike's call, Nov 4 2026): dirt and
  // service roads, bike paths, a trail closed for construction (North Kaibab), cross-country stretches, and also
  // paved roads and town streets that road-walking routes like the California Mission Trail follow
  const routes = relations.filter(isLongTrail).filter(r => r.members.some(m => m.type === 'way' && ways.has(m.ref) && near(ways.get(m.ref))));
  for (const r of routes) for (const m of r.members) if (m.type === 'way' && !picked.has('w' + m.ref) && ways.has(m.ref) && near(ways.get(m.ref))) {
    features.push({ type: 'way', id: m.ref, tags: wayTags.get(m.ref) || {}, geometry: ways.get(m.ref).map(r7) }); picked.add('w' + m.ref);
  }
  const saved = {
    name, rules: RULES, region: meta.region, source: meta.source, fetched: meta.fetched, bounds: meta.bounds, box: meta.box,
    boundary, features, routes: routes.map(r => ({ type: 'relation', id: r.id, tags: r.tags, members: r.members }))
  };
  fs.writeFileSync(parkPath(name, 'osm.json'), JSON.stringify(saved));

  // Everything, for the All map data page: tagged points and lines, and areas made of several lines
  // (lakes, landcover…) drawn from their pieces.
  const all = [];
  // trails and roads keep ~8 m detail; areas and everything else (forests, cliffs, streams…) ~20 m
  const longIds = new Set(routes.flatMap(r => r.members.filter(m => m.type === 'way').map(m => 'w' + m.ref)));
  const add = (id, tags, at, lines) => {
    const k = kindOf(tags), tol = /^highway=/.test(k) ? 8 : 20;
    if (!onPage(k, !!at, tags, longIds.has(id))) return;
    all.push({ id, k, tags: Object.fromEntries(Object.entries(tags).filter(([key]) => !skipTag(key))),
      ...(at ? { at: r5(at) } : { g: lines.map(l => simplify(l, tol).map(r5)) }) });
  };
  for (const el of nodes) add('n' + el.id, el.tags, [el.lat, el.lon]);
  for (const r of relations) {
    if (!r.tags || r === area) continue;
    const lines = r.members.filter(m => m.type === 'way' && ways.has(m.ref)).map(m => ways.get(m.ref)).filter(l => l.length > 1 && near(l));
    if (!lines.length) continue;
    // long-distance trails are shown by their pieces; other relations (lakes, landcover, boundaries) as their own feature
    if (isLongTrail(r)) continue;
    add('r' + r.id, r.tags, null, lines);
  }
  for (const [id, tags] of wayTags) {
    const g = ways.get(id);
    if (g.length > 1 && near(g)) add('w' + id, tags, null, [g]);
  }
  fs.writeFileSync(parkPath(name, 'all.json'), JSON.stringify({ name, features: all }));

  // the area the trip map's lines cover (for elevation tiles)
  let bb = big;
  for (const f of features) if (f.geometry) bb = grow(bb, f.geometry);
  return { features: features.length, all: all.length, elevationBox: bb };
}
