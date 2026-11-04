// Downloads the map data for every park named on a trip's `park:` line and saves it, unpublished,
// in parkdata/<park>/: osm.json (OpenStreetMap trails, trailheads, camps, peaks, water, long-distance
// routes and the park boundary) and elevation/ (the elevation tiles that data covers).
// Nothing here is shown on the site; scripts/build-maps.js makes the trip maps from it.
//
// Each park is cut out of its state's map file from Geofabrik (download.geofabrik.de), using osmium.
// A new park's state is looked up once on OpenStreetMap's place search (Nominatim) and saved with it.
// Parks in the same state share one download of that state's file.
//
//   node scripts/download-parks.js               download parks that have no saved data yet (or no longer cover a trip's routes)
//   node scripts/download-parks.js --all         download every park again
//   node scripts/download-parks.js zion          download this trip's park again (trip or park name)
//   node scripts/download-parks.js --cache DIR   keep the state files in DIR and reuse them if they're from today
//   node scripts/download-parks.js --check       only say whether any park needs downloading
//
// Needs osmium-tool. The GitHub Action in .github/workflows/trail-data.yml runs this automatically.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { PARK_DIR, parkSlug, parkPath, tripMaps, grow, pad, inside, tileXY, tileFile } from '../lib/parkdata.js';

const UA = 'backpacking-trips-site/1.0 (https://github.com/Mikhial/backpacking_trips)';
const args = process.argv.slice(2);
const all = args.includes('--all');
const check = args.includes('--check');
const cacheAt = args.indexOf('--cache');
const cache = cacheAt >= 0 ? args[cacheAt + 1] : null;
const only = args.filter((a, i) => a && !a.startsWith('--') && (cacheAt < 0 || i !== cacheAt + 1)).map(parkSlug);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

// ---------- which state file a park is in ----------
let index;
async function stateFile(name) {
  const hits = await getJson(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: name, format: 'jsonv2', addressdetails: 1, limit: 5 })}`);
  await sleep(1100); // Nominatim allows one request a second
  const hit = hits.find(h => h.name === name && h.address?.['ISO3166-2-lvl4']) || hits.find(h => h.address?.['ISO3166-2-lvl4']);
  if (!hit) throw new Error(`OpenStreetMap's place search can't find "${name}". Check the spelling on openstreetmap.org.`);
  const iso = hit.address['ISO3166-2-lvl4']; // "US-UT"
  index ||= (await getJson('https://download.geofabrik.de/index-v1-nogeom.json')).features.map(f => f.properties);
  const region = index.filter(r => (r['iso3166-2'] || []).includes(iso) && r.urls?.pbf).sort((a, b) => a.id.length - b.id.length)[0];
  if (!region) throw new Error(`Geofabrik has no map file for ${iso} (where "${name}" is)`);
  return { id: region.id, url: region.urls.pbf };
}

// ---------- cutting parks out of a state file ----------
// osmium cuts the file down to the kinds of things the maps use and writes them as text (OPL),
// one object per line, with each line's points filled in. Each park keeps what's in its padded box.

// "Name=Foo%20%Bar" -> "Foo Bar"
const unesc = s => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
function parseOpl(line) {
  const parts = line.split(' ');
  const el = { type: { n: 'node', w: 'way', r: 'relation' }[parts[0][0]], id: +parts[0].slice(1) };
  for (const p of parts.slice(1)) {
    const v = p.slice(1);
    if (p[0] === 'T' && v) el.tags = Object.fromEntries(v.split(',').map(kv => kv.split('=').map(unesc)));
    else if (p[0] === 'x' && v) el.lon = +v;
    else if (p[0] === 'y' && v) el.lat = +v;
    else if (p[0] === 'N' && v) el.geometry = v.split(',').map(n => n.match(/x([-\d.]*)y([-\d.]*)$/)).filter(m => m && m[1] && m[2]).map(m => [+m[2], +m[1]]);
    else if (p[0] === 'M' && v) el.members = v.split(',').map(m => { const [ref, role] = m.split('@');
      return { type: { n: 'node', w: 'way', r: 'relation' }[ref[0]], ref: +ref.slice(1), role: unesc(role || '') }; });
  }
  return el;
}
async function eachOpl(file, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line) fn(parseOpl(line));
}
const osmium = (...a) => execFileSync('osmium', a, { stdio: ['ignore', 'inherit', 'inherit'] });

// What the maps use: trails and dirt roads, trailheads, camps, named peaks, water
function wanted(el) {
  const t = el.tags || {};
  if (el.type === 'node') return t.highway === 'trailhead' || /^(camp_site|wilderness_hut|alpine_hut)$/.test(t.tourism || '') ||
    (t.natural === 'peak' && !!t.name) || t.amenity === 'drinking_water' || t.natural === 'spring';
  if (el.type === 'way') return (/^(path|footway|bridleway|track)$/.test(t.highway || '') && !/sidewalk|crossing/.test(t.footway || '') && !/^(private|no)$/.test(t.access || '')) ||
    (t.highway === 'steps' && !!t.name) || t.highway === 'trailhead' || t.tourism === 'camp_site';
  return false;
}
const isArea = t => /^(protected_area|national_park)$/.test(t.boundary || '') || /^(nature_reserve|park)$/.test(t.leisure || '');
function compactOpl(el) {
  const out = { type: el.type, id: el.id };
  if (el.type === 'node') { out.lat = el.lat; out.lon = el.lon; }
  if (el.tags) out.tags = el.tags;
  if (el.geometry) out.geometry = el.geometry;
  return out;
}

// parks: Map of park name -> { extra }. Returns Map of park name -> what to save.
async function cutParks(pbf, label, parks, tmp) {
  const opl = (name, filters, refs = true) => {
    const cut = path.join(tmp, name + '.pbf'), out = path.join(tmp, name + '.opl');
    console.log(`  cutting out ${name}…`);
    osmium('tags-filter', pbf, ...filters, ...(refs ? [] : ['-R']), '-o', cut, '--overwrite');
    if (refs) osmium('add-locations-to-ways', cut, '-f', 'opl,add_metadata=false', '-o', out, '--overwrite');
    else osmium('cat', cut, '-f', 'opl,add_metadata=false', '-o', out, '--overwrite');
    fs.unlinkSync(cut);
    return out;
  };

  // 1. Park boundaries, by name
  const named = opl('boundaries', [...parks.keys()].map(n => `nwr/name=${n}`));
  const ways = new Map(), areas = [];
  await eachOpl(named, el => {
    if (el.type === 'way') ways.set(el.id, el.geometry || []);
    if (el.type !== 'node' && el.tags && parks.has(el.tags.name) && isArea(el.tags)) areas.push(el);
  });
  fs.unlinkSync(named);
  const found = new Map();
  for (const [name, p] of parks) {
    const area = areas.filter(a => a.tags.name === name).sort((a, b) => (a.type === 'relation' ? -1 : 1) - (b.type === 'relation' ? -1 : 1))[0];
    if (!area) throw new Error(`${label} has no park or wilderness boundary named "${name}". Check the spelling on openstreetmap.org.`);
    const el = { type: area.type, id: area.id, tags: area.tags };
    if (area.type === 'way') el.geometry = ways.get(area.id) || area.geometry || [];
    else el.members = area.members.map(m => ({ ...m, ...(m.type === 'way' && ways.has(m.ref) ? { geometry: ways.get(m.ref) } : {}) }));
    const missing = el.members ? el.members.filter(m => m.type === 'way' && !m.geometry).length : 0;
    if (missing) console.log(`  warning: ${missing} pieces of the "${name}" boundary aren't in ${label}; it may cross into another state`);
    const pts = el.geometry || el.members.flatMap(m => m.geometry || []);
    const g = grow(null, pts);
    const bounds = { minlat: g.minlat, minlon: g.minlon, maxlat: g.maxlat, maxlon: g.maxlon };
    const box = grow(bounds, p.extra);
    found.set(name, { area: { type: area.type, id: area.id, bounds }, boundary: [el], box, big: pad(box), features: [], wayIds: new Set(), routes: [] });
  }

  // 2. Trails, trailheads, camps, peaks and water
  const features = opl('features', ['n/highway=trailhead', 'w/highway=path,footway,bridleway,track,steps,trailhead',
    'n/tourism=camp_site,wilderness_hut,alpine_hut', 'w/tourism=camp_site', 'n/natural=peak,spring', 'n/amenity=drinking_water']);
  await eachOpl(features, el => {
    if (!wanted(el)) return;
    const pts = el.type === 'node' ? [[el.lat, el.lon]] : el.geometry || [];
    for (const f of found.values()) if (pts.some(q => inside(f.big, q))) {
      f.features.push(compactOpl(el));
      if (el.type === 'way') f.wayIds.add(el.id);
    }
  });
  fs.unlinkSync(features);

  // 3. Long-distance trails (PCT, Tahoe Rim Trail…): international, national or regional hiking routes through each park
  const routes = opl('routes', ['r/route=hiking,foot'], false);
  await eachOpl(routes, el => {
    if (!/^(iwn|nwn|rwn)$/.test(el.tags?.network || '')) return;
    for (const f of found.values()) if ((el.members || []).some(m => m.type === 'way' && f.wayIds.has(m.ref)))
      f.routes.push({ type: 'relation', id: el.id, tags: el.tags, members: el.members });
  });
  fs.unlinkSync(routes);
  return found;
}

// A state's file: from the cache if it's from today, otherwise downloaded
function statePbf(region, tmp) {
  const dir = cache || tmp;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, region.id.replace(/\//g, '-') + '.osm.pbf');
  if (cache && fs.existsSync(file) && fs.statSync(file).mtime.toDateString() === new Date().toDateString()) {
    console.log(`  using ${file}`);
    return file;
  }
  console.log(`  downloading ${region.url}…`);
  execFileSync('curl', ['-sSfL', '--retry', '3', '-A', UA, '-o', file, region.url], { stdio: 'inherit' });
  return file;
}

async function savePark({ name, region, area, box, boundary, features, routes }) {
  fs.mkdirSync(parkPath(name), { recursive: true });
  const saved = {
    name, region: region.id, source: `OpenStreetMap ${area.type}/${area.id}`, fetched: new Date().toISOString().slice(0, 10),
    bounds: area.bounds, box, boundary, features, routes
  };
  await downloadElevation(saved); // first, so a park with osm.json always has its elevation
  fs.writeFileSync(parkPath(name, 'osm.json'), JSON.stringify(saved));
  return saved;
}

// Every elevation tile under the padded box and under every downloaded line (lines can run past the box).
// Elevation: AWS Terrain Tiles (USGS-based, ~30 m).
async function downloadElevation(saved) {
  let bb = pad(saved.box);
  for (const el of saved.features) if (el.geometry) bb = grow(bb, el.geometry);
  const [x0, y0] = tileXY(bb.maxlat, bb.minlon).map(Math.floor), [x1, y1] = tileXY(bb.minlat, bb.maxlon).map(Math.floor);
  const dir = parkPath(saved.name, 'elevation');
  fs.mkdirSync(dir, { recursive: true });
  const want = new Set();
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) want.add(tileFile(x, y));
  for (const f of fs.readdirSync(dir)) if (!want.has(f)) fs.unlinkSync(`${dir}/${f}`);
  let got = 0;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const file = `${dir}/${tileFile(x, y)}`;
    if (fs.existsSync(file)) continue;
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/${x}/${y}.png`;
    let body, last = 'no answer';
    for (let attempt = 0; attempt < 4 && !body; attempt++) {
      if (attempt) await sleep(3000 * attempt);
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (res.ok) body = Buffer.from(await res.arrayBuffer()); else last = res.status;
      } catch (e) { last = e.message; }
    }
    if (!body) throw new Error(`elevation tile ${x}/${y}: ${last}`);
    fs.writeFileSync(file, body);
    got++;
  }
  console.log(`  ${want.size} elevation tiles (${got} downloaded)`);
}

// ---------- main ----------
const parks = new Map(); // park name -> { trips, extra }
for (const t of tripMaps()) if (t.park) {
  const p = parks.get(t.park) || { trips: [], extra: [] };
  p.trips.push(t.slug); p.extra.push(...t.extra);
  parks.set(t.park, p);
}
fs.mkdirSync(PARK_DIR, { recursive: true });
const saved = name => { try { return JSON.parse(fs.readFileSync(parkPath(name, 'osm.json'), 'utf8')); } catch { return null; } };

// Which parks to download, grouped by state
const byRegion = new Map(); // region id -> { region, parks: Map }
const todo = [];
let failed = 0;
try {
  for (const [name, p] of parks) {
    const old = saved(name);
    const asked = only.includes(parkSlug(name)) || p.trips.some(s => only.includes(s));
    const current = old && old.name === name && p.extra.every(q => inside(old.box, q));
    if (only.length ? !asked : (!all && current)) { if (!only.length) console.log(`${parkSlug(name)}: up to date`); continue; }
    todo.push(name);
    if (check) continue;
    const region = old?.region ? await regionById(old.region) : await stateFile(name);
    if (!byRegion.has(region.id)) byRegion.set(region.id, { region, parks: new Map() });
    byRegion.get(region.id).parks.set(name, p);
  }
  // --check: only say whether anything needs downloading (the workflow skips installing osmium if not)
  if (check) {
    console.log(todo.length ? `to download: ${todo.join(', ')}` : 'nothing to download');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `needed=${todo.length ? 'true' : 'false'}\n`);
    process.exit(0);
  }
  for (const { region, parks: list } of byRegion.values()) {
    console.log(`${region.id}: ${[...list.keys()].join(', ')}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parks-'));
    try {
      const pbf = statePbf(region, tmp);
      for (const [name, f] of await cutParks(pbf, `The ${region.id} map file`, list, tmp)) {
        console.log(`${parkSlug(name)}: saving`);
        const s = await savePark({ name, region, ...f });
        console.log(`${parkSlug(name)}: ${s.features.length} features, ${(fs.statSync(parkPath(name, 'osm.json')).size / 1048576).toFixed(1)} MB`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
} catch (e) {
  // stop at the first failure; parks already saved are kept
  failed++;
  console.error(e.message);
}

async function regionById(id) {
  index ||= (await getJson('https://download.geofabrik.de/index-v1-nogeom.json')).features.map(f => f.properties);
  const r = index.find(x => x.id === id);
  if (!r) throw new Error(`Geofabrik no longer has a "${id}" map file`);
  return { id: r.id, url: r.urls.pbf };
}

// parks no trip names any more
const keep = new Set([...parks.keys()].map(parkSlug));
if (!failed && !only.length) for (const d of fs.readdirSync(PARK_DIR)) if (!keep.has(d)) {
  fs.rmSync(`${PARK_DIR}/${d}`, { recursive: true }); console.log(`${d}: no trip uses this park, removed its data`);
}
if (failed) process.exit(1);
