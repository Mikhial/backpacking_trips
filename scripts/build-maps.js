// Builds each trip's trail map, assets/trails/<trip>.json, from the park data saved in parkdata/
// by scripts/download-parks.js. Downloads nothing, so changing what the maps show only needs this.
//
//   node scripts/build-maps.js         build every trip's map
//   node scripts/build-maps.js zion    only this trip
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { dist, simplify } from '../lib/geo.js';
import { parkPath, tripMaps, grow, pad, inside, tileXY, tileFile } from '../lib/parkdata.js';

const OUT_DIR = 'assets/trails';
const ROUTE_PAD = 0.05; // ~5 km (3 mi) around a one-route trip's route
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));

// Elevation from the park's saved Terrarium tiles, bilinear sampled
function elevationFrom(dir) {
  const tiles = new Map();
  const tile = (x, y) => {
    const f = path.join(dir, tileFile(x, y));
    if (!tiles.has(f)) {
      if (!fs.existsSync(f)) throw new Error(`missing elevation tile ${f}; run scripts/download-parks.js`);
      tiles.set(f, PNG.sync.read(fs.readFileSync(f)));
    }
    return tiles.get(f);
  };
  return (lat, lon) => {
    const [fx, fy] = tileXY(lat, lon);
    const px = (fx % 1) * 256 - 0.5, py = (fy % 1) * 256 - 0.5;
    const png = tile(Math.floor(fx), Math.floor(fy));
    const at = (i, j) => {
      i = Math.max(0, Math.min(255, i)); j = Math.max(0, Math.min(255, j));
      const o = (j * 256 + i) * 4, d = png.data;
      return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
    };
    const i = Math.floor(px), j = Math.floor(py), u = px - i, v = py - j;
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
}

// Join ways that share endpoints into longer lines (per trail name)
function chain(lines) {
  const key = p => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  let pool = lines.map(l => l.slice());
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < pool.length && !merged; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i], b = pool[j];
        const as = key(a[0]), ae = key(a[a.length - 1]), bs = key(b[0]), be = key(b[b.length - 1]);
        let joined = null;
        if (ae === bs) joined = a.concat(b.slice(1));
        else if (ae === be) joined = a.concat(b.slice(0, -1).reverse());
        else if (as === be) joined = b.concat(a.slice(1));
        else if (as === bs) joined = b.slice().reverse().concat(a.slice(1));
        if (joined) { pool[i] = joined; pool.splice(j, 1); merged = true; break; }
      }
    }
  }
  return pool;
}

// Densify to ~30 m, sample elevation, smooth, then measure length and gain
function profile(line, elevation) {
  const dense = [line[0]];
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k], d = dist(a, b), steps = Math.ceil(d / 30);
    for (let s = 1; s <= steps; s++) dense.push([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps, s === steps]);
  }
  const raw = dense.map(p => elevation(p[0], p[1]));
  const sm = raw.map((_, k) => { let s = 0, c = 0; for (let w = -2; w <= 2; w++) { const v = raw[k + w]; if (v != null) { s += v; c++; } } return s / c; });
  let len = 0, up = 0, down = 0, ref = sm[0];
  for (let k = 1; k < dense.length; k++) {
    len += dist(dense[k - 1], dense[k]);
    const d = sm[k] - ref;
    if (Math.abs(d) >= 3) { d > 0 ? (up += d) : (down -= d); ref = sm[k]; }
  }
  const withEle = dense.map((p, k) => [p[0], p[1], sm[k]]);
  const pts = simplify(withEle, 8).map(p => [+p[0].toFixed(5), +p[1].toFixed(5), Math.round(p[2])]);
  return { p: pts, len: Math.round(len), up: Math.round(up), down: Math.round(down) };
}

// One trip's map: the park plus your routes and trailheads, with ~3 km around them.
// A one-route trip covers just ~5 km (3 mi) around its route, even in a big park like the Grand Canyon,
// so its page stays small; the whole park is still saved in parkdata/.
function buildMap(trip, park) {
  const elevation = elevationFrom(parkPath(trip.park, 'elevation'));
  const single = trip.single;
  const bb = grow(single ? null : park.bounds, trip.extra);
  const box = pad(bb, single ? ROUTE_PAD : undefined);
  const near = el => el.type === 'node' ? inside(box, [el.lat, el.lon]) : (el.geometry || []).some(p => inside(box, p));
  const features = park.features.filter(near);

  const bigOf = new Map(); // way id -> route names
  for (const r of park.routes) {
    const rn = (r.tags.name || r.tags.ref || '').replace(/\s+[-–—:]\s+.*$/, '').trim(); // "PCT - California Section K" -> "PCT"
    if (!rn) continue;
    for (const m of r.members || []) if (m.type === 'way') {
      const list = bigOf.get(m.ref) || [];
      if (!list.includes(rn)) list.push(rn);
      bigOf.set(m.ref, list);
    }
  }

  // Boundary outline (outer rings only)
  const outer = [];
  for (const el of park.boundary) {
    if (el.type === 'way' && el.geometry) outer.push(el.geometry);
    for (const m of el.members || []) if (m.type === 'way' && m.role !== 'inner' && m.geometry) outer.push(m.geometry);
  }
  const ring = chain(outer).map(l => simplify(l, 25).map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]));

  // Trails grouped by name, then joined into continuous lines
  const groups = new Map();
  const pois = [];
  for (const el of features) {
    const t = el.tags || {};
    const center = el.type === 'node' ? [el.lat, el.lon] : el.geometry && el.geometry[0];
    if (t.highway === 'trailhead') { pois.push({ t: 'trailhead', n: t.name || '', at: center }); continue; }
    if (t.tourism) { pois.push({ t: 'camp', n: t.name || '', at: center }); continue; }
    if (t.natural === 'peak') { pois.push({ t: 'peak', n: t.name, at: center, e: t.ele ? Math.round(parseFloat(t.ele)) : null }); continue; }
    if (t.amenity === 'drinking_water' || t.natural === 'spring') { pois.push({ t: 'water', n: t.name || '', at: center }); continue; }
    if (el.type !== 'way' || !el.geometry) continue;
    const closed = /^(yes|true)$/.test(t.abandoned || '') || /^(yes|true)$/.test(t.disused || '') || !!t['abandoned:highway'] || t.access === 'no';
    const nm = t.name || t.ref || '';
    const kind = t.highway === 'track' ? 'road' : 'trail';
    const big = (bigOf.get(el.id) || []).sort();
    const k = nm ? `${nm}|${kind}|${closed}|${big.join(',')}` : `#${el.id}`;
    if (!groups.has(k)) groups.set(k, { n: nm, k: kind, x: closed, b: big, lines: [] });
    groups.get(k).lines.push(el.geometry);
  }

  const trails = [];
  for (const g of groups.values()) {
    for (const line of g.n ? chain(g.lines) : g.lines) {
      if (line.length < 2) continue;
      const pr = profile(line, elevation);
      if (!g.n && pr.len < 150) continue; // drop tiny unnamed spurs
      trails.push({ n: g.n, k: g.k, ...(g.x ? { x: 1 } : {}), ...(g.b.length ? { b: g.b } : {}), ...pr });
    }
  }
  // Unnamed tracks are usually roads; keep unnamed paths and all named lines
  const kept = trails.filter(t => t.n || t.k === 'trail');
  for (const p of pois) { p.at = [+p.at[0].toFixed(5), +p.at[1].toFixed(5)]; if (p.e == null && p.t !== 'peak') delete p.e; }

  return {
    area: trip.park,
    ...(single ? { single: true } : {}),
    source: park.source,
    fetched: park.fetched,
    bounds: [[bb.minlat, bb.minlon], [bb.maxlat, bb.maxlon]],
    boundary: ring,
    trails: kept.sort((a, b) => b.len - a.len),
    pois
  };
}

// ---------- main ----------
fs.mkdirSync(OUT_DIR, { recursive: true });
let failed = 0;
for (const trip of tripMaps()) {
  if (only.length && !only.includes(trip.slug)) continue;
  const out = path.join(OUT_DIR, trip.slug + '.json');
  if (!trip.park) { if (fs.existsSync(out)) { fs.unlinkSync(out); console.log(`${trip.slug}: no park line, removed its map`); } continue; }
  const file = parkPath(trip.park, 'osm.json');
  if (!fs.existsSync(file)) { failed++; console.error(`${trip.slug}: no saved data for "${trip.park}" yet; run scripts/download-parks.js`); continue; }
  try {
    const result = buildMap(trip, JSON.parse(fs.readFileSync(file, 'utf8')));
    const json = JSON.stringify(result);
    const same = fs.existsSync(out) && fs.readFileSync(out, 'utf8') === json;
    if (!same) fs.writeFileSync(out, json);
    console.log(`${trip.slug}: ${result.trails.length} trails, ${result.pois.length} points, ${(json.length / 1024).toFixed(0)} KB${same ? ' (unchanged)' : ''}`);
  } catch (e) {
    failed++;
    console.error(`${trip.slug}: ${e.message}`);
  }
}
if (failed) process.exit(1);
