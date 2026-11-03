// Downloads the trail network for every trip that has a `map:` line in its header,
// and saves it to assets/trails/<trip>.json for the map on the trip page.
//
//   node scripts/fetch-trails.js            fetch trips that don't have data yet (or whose map name changed)
//   node scripts/fetch-trails.js --force    refetch everything
//   node scripts/fetch-trails.js zion       only this trip
//
// Trails, trailheads, camps, peaks and water come from OpenStreetMap (Overpass API).
// Elevations come from the AWS Terrain Tiles (USGS-based, ~30 m resolution).
// The GitHub Action in .github/workflows/trail-data.yml runs this automatically.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { PNG } from 'pngjs';
import { dist, simplify } from '../lib/geo.js';

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const DEM_ZOOM = 12;
const OUT_DIR = 'assets/trails';

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter(a => !a.startsWith('--'));

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rad = Math.PI / 180;

async function overpass(query) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      console.log(`  asking ${url}`);
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'backpacking-trips-site/1.0 (GitHub Action)' },
        signal: AbortSignal.timeout(240000) });
      if (res.ok) return await res.json();
      last = new Error(`${url} answered ${res.status}`);
    } catch (e) { last = e; }
    await sleep(5000 * (attempt + 1));
  }
  throw last;
}

// Elevation from Terrarium PNG tiles, bilinear sampled
const tiles = new Map();
async function tile(x, y) {
  const key = `${x}/${y}`;
  if (!tiles.has(key)) tiles.set(key, (async () => {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${DEM_ZOOM}/${x}/${y}.png`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`elevation tile ${key}: ${res.status}`);
    return PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  })());
  return tiles.get(key);
}
async function elevation(lat, lon) {
  const n = 2 ** DEM_ZOOM;
  const fx = (lon + 180) / 360 * n;
  const fy = (1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2 * n;
  const px = (fx % 1) * 256 - 0.5, py = (fy % 1) * 256 - 0.5;
  const png = await tile(Math.floor(fx), Math.floor(fy));
  const at = (i, j) => {
    i = Math.max(0, Math.min(255, i)); j = Math.max(0, Math.min(255, j));
    const o = (j * 256 + i) * 4, d = png.data;
    return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
  };
  const i = Math.floor(px), j = Math.floor(py), u = px - i, v = py - j;
  return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
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
async function profile(line) {
  const dense = [line[0]];
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k], d = dist(a, b), steps = Math.ceil(d / 30);
    for (let s = 1; s <= steps; s++) dense.push([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps, s === steps]);
  }
  const raw = [];
  for (const p of dense) raw.push(await elevation(p[0], p[1]));
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

// ---------- one area ----------
async function fetchArea(name) {
  const esc = name.replace(/"/g, '\\"');
  const found = await overpass(`[out:json][timeout:60];
    ( rel["name"="${esc}"]["boundary"~"^(protected_area|national_park)$"];
      rel["name"="${esc}"]["leisure"="nature_reserve"];
      rel["name"="${esc}"]["leisure"="park"];
      way["name"="${esc}"]["boundary"~"^(protected_area|national_park)$"]; );
    out bb tags;`);
  const area = found.elements.sort((a, b) => (a.type === 'relation' ? -1 : 1) - (b.type === 'relation' ? -1 : 1))[0];
  if (!area) throw new Error(`OpenStreetMap has no park or wilderness boundary named "${name}". Check the spelling on openstreetmap.org.`);
  const bb = area.bounds;
  const pad = 0.03; // ~3 km so trailheads just outside the boundary are included
  const box = [bb.minlat - pad, bb.minlon - pad, bb.maxlat + pad, bb.maxlon + pad].map(v => v.toFixed(4)).join(',');

  const boundary = await overpass(`[out:json][timeout:90];${area.type}(${area.id});out geom;`);
  const data = await overpass(`[out:json][timeout:180][bbox:${box}];
    ( way["highway"~"^(path|footway|bridleway|track)$"]["footway"!~"sidewalk|crossing"]["access"!~"^(private|no)$"];
      way["highway"="steps"]["name"];
      node["highway"="trailhead"]; way["highway"="trailhead"];
      node["tourism"~"^(camp_site|wilderness_hut|alpine_hut)$"]; way["tourism"="camp_site"];
      node["natural"="peak"]["name"];
      node["amenity"="drinking_water"]; node["natural"="spring"]; );
    out geom tags;`);

  // Boundary outline (outer rings only)
  const outer = [];
  for (const el of boundary.elements) {
    if (el.type === 'way' && el.geometry) outer.push(el.geometry);
    for (const m of el.members || []) if (m.type === 'way' && m.role !== 'inner' && m.geometry) outer.push(m.geometry);
  }
  const ring = chain(outer.map(g => g.map(p => [p.lat, p.lon])))
    .map(l => simplify(l, 25).map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]));

  // Trails grouped by name, then joined into continuous lines
  const groups = new Map();
  const pois = [];
  for (const el of data.elements) {
    const t = el.tags || {};
    const center = el.type === 'node' ? [el.lat, el.lon] : el.geometry && [el.geometry[0].lat, el.geometry[0].lon];
    if (t.highway === 'trailhead') { pois.push({ t: 'trailhead', n: t.name || '', at: center }); continue; }
    if (t.tourism) { pois.push({ t: 'camp', n: t.name || '', at: center }); continue; }
    if (t.natural === 'peak') { pois.push({ t: 'peak', n: t.name, at: center, e: t.ele ? Math.round(parseFloat(t.ele)) : null }); continue; }
    if (t.amenity === 'drinking_water' || t.natural === 'spring') { pois.push({ t: 'water', n: t.name || '', at: center }); continue; }
    if (el.type !== 'way' || !el.geometry) continue;
    const closed = /^(yes|true)$/.test(t.abandoned || '') || /^(yes|true)$/.test(t.disused || '') || !!t['abandoned:highway'] || t.access === 'no';
    const nm = t.name || t.ref || '';
    const kind = t.highway === 'track' ? 'road' : 'trail';
    const k = nm ? `${nm}|${kind}|${closed}` : `#${el.id}`;
    if (!groups.has(k)) groups.set(k, { n: nm, k: kind, x: closed, lines: [] });
    groups.get(k).lines.push(el.geometry.map(p => [p.lat, p.lon]));
  }

  const trails = [];
  for (const g of groups.values()) {
    for (const line of g.n ? chain(g.lines) : g.lines) {
      if (line.length < 2) continue;
      const pr = await profile(line);
      if (!g.n && pr.len < 150) continue; // drop tiny unnamed spurs
      trails.push({ n: g.n, k: g.k, ...(g.x ? { x: 1 } : {}), ...pr });
    }
  }
  // Unnamed tracks are usually roads; keep unnamed paths and all named lines
  const kept = trails.filter(t => t.n || t.k === 'trail');
  for (const p of pois) { p.at = [+p.at[0].toFixed(5), +p.at[1].toFixed(5)]; if (p.e == null && p.t !== 'peak') delete p.e; }

  return {
    area: name,
    source: `OpenStreetMap ${area.type}/${area.id}`,
    fetched: new Date().toISOString().slice(0, 10),
    bounds: [[bb.minlat, bb.minlon], [bb.maxlat, bb.maxlon]],
    boundary: ring,
    trails: kept.sort((a, b) => b.len - a.len),
    pois
  };
}

// ---------- main ----------
fs.mkdirSync(OUT_DIR, { recursive: true });
const files = fs.readdirSync('trips').filter(f => f.endsWith('.md') && !f.startsWith('_'));
let failed = 0;
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  if (only.length && !only.includes(slug)) continue;
  const head = fs.readFileSync(path.join('trips', f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const map = head && (yaml.load(head[1]) || {}).map;
  const out = path.join(OUT_DIR, slug + '.json');
  if (!map) { if (fs.existsSync(out)) { fs.unlinkSync(out); console.log(`${slug}: no map line, removed old data`); } continue; }
  if (!force && fs.existsSync(out)) {
    try { if (JSON.parse(fs.readFileSync(out, 'utf8')).area === map) { console.log(`${slug}: up to date`); continue; } } catch {}
  }
  try {
    console.log(`${slug}: fetching "${map}"…`);
    const result = await fetchArea(map);
    fs.writeFileSync(out, JSON.stringify(result));
    console.log(`${slug}: ${result.trails.length} trails, ${result.pois.length} points, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  } catch (e) {
    failed++;
    console.error(`${slug}: ${e.message}`);
  }
  await sleep(2000);
}
if (failed) process.exit(1);
