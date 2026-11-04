// Downloads the map data for every park named on a trip's `park:` line and saves it, unpublished,
// in parkdata/<park>/: osm.json (OpenStreetMap trails, trailheads, camps, peaks, water, long-distance
// routes and the park boundary) and elevation/ (the elevation tiles that data covers).
// Nothing here is shown on the site; scripts/build-maps.js makes the trip maps from it.
//
//   node scripts/download-parks.js              download parks that have no saved data yet (or no longer cover a trip's routes),
//                                               one at a time from the Overpass API
//   node scripts/download-parks.js --force      download every park again, the same way
//   node scripts/download-parks.js zion         only this trip's park (trip or park name)
//   node scripts/download-parks.js --california [file.osm.pbf]
//                                               redo every park that's in California from Geofabrik's California file
//                                               (downloaded if no file is given, then deleted); needs osmium-tool
//
// The GitHub Action in .github/workflows/trail-data.yml runs this automatically.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { PARK_DIR, parkSlug, parkPath, tripMaps, grow, pad, inside, tileXY, tileFile } from '../lib/parkdata.js';

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const GEOFABRIK_CA = 'https://download.geofabrik.de/north-america/us/california-latest.osm.pbf';
const args = process.argv.slice(2);
const force = args.includes('--force');
const california = args.includes('--california');
const pbfArg = args.find(a => a.endsWith('.pbf'));
const only = args.filter(a => !a.startsWith('--') && !a.endsWith('.pbf'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Try each public Overpass server once. If both are busy, stop rather than wait: run it again later.
async function overpass(query) {
  const errors = [];
  for (const url of OVERPASS) {
    try {
      console.log(`  asking ${url}`);
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'backpacking-trips-site/1.0 (GitHub Action)' },
        signal: AbortSignal.timeout(240000) });
      if (res.ok) return await res.json();
      errors.push(`${new URL(url).host} answered ${res.status}`);
    } catch (e) { errors.push(`${new URL(url).host}: ${e.message}`); }
  }
  throw new Error(`OpenStreetMap's Overpass servers are busy (${errors.join('; ')}). Run it again later.`);
}

// Big parks are downloaded in squares of at most 0.3°, one request each, so no single request is
// too big for the server. Lines that cross squares come back once per square and are kept once.
// Each line comes back whole, even where it runs outside the square.
const SQUARE = 0.3;
async function bySquare(bb, filters, timeout) {
  const rows = Math.ceil((bb.maxlat - bb.minlat) / SQUARE), cols = Math.ceil((bb.maxlon - bb.minlon) / SQUARE);
  const seen = new Set(), elements = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const s = [bb.minlat + (bb.maxlat - bb.minlat) * i / rows, bb.minlon + (bb.maxlon - bb.minlon) * j / cols,
      bb.minlat + (bb.maxlat - bb.minlat) * (i + 1) / rows, bb.minlon + (bb.maxlon - bb.minlon) * (j + 1) / cols].map(v => v.toFixed(4)).join(',');
    if (rows * cols > 1) console.log(`  square ${i * cols + j + 1} of ${rows * cols}`);
    const body = filters.map(f => f.replace('(BOX)', `(${s})`)).join('\n');
    for (const el of (await overpass(`[out:json][timeout:${timeout}];${body}`)).elements) {
      if (!seen.has(el.type + el.id)) { seen.add(el.type + el.id); elements.push(el); }
    }
  }
  return elements;
}

// Smaller files: coordinates as [lat, lon], no per-element bounds
const round = v => +v.toFixed(7);
function compact(el) {
  const out = { type: el.type, id: el.id };
  if (el.lat != null) { out.lat = round(el.lat); out.lon = round(el.lon); }
  if (el.tags) out.tags = el.tags;
  if (el.geometry) out.geometry = el.geometry.map(p => [round(p.lat), round(p.lon)]);
  if (el.members) out.members = el.members.map(m => ({ type: m.type, ref: m.ref, role: m.role,
    ...(m.geometry ? { geometry: m.geometry.map(p => [round(p.lat), round(p.lon)]) } : {}) }));
  return out;
}

async function downloadPark(name, extra) {
  const esc = name.replace(/"/g, '\\"');
  const found = await overpass(`[out:json][timeout:60];
    ( rel["name"="${esc}"]["boundary"~"^(protected_area|national_park)$"];
      rel["name"="${esc}"]["leisure"="nature_reserve"];
      rel["name"="${esc}"]["leisure"="park"];
      way["name"="${esc}"]["boundary"~"^(protected_area|national_park)$"]; );
    out bb tags;`);
  const area = found.elements.sort((a, b) => (a.type === 'relation' ? -1 : 1) - (b.type === 'relation' ? -1 : 1))[0];
  if (!area) throw new Error(`OpenStreetMap has no park or wilderness boundary named "${name}". Check the spelling on openstreetmap.org.`);
  // the park plus every trip's routes and trailheads, which can reach past its boundary
  const box = grow(area.bounds, extra);
  const big = pad(box);

  const boundary = await overpass(`[out:json][timeout:90];${area.type}(${area.id});out geom;`);
  const features = await bySquare(big, [`(
    way["highway"~"^(path|footway|bridleway|track)$"]["footway"!~"sidewalk|crossing"]["access"!~"^(private|no)$"](BOX);
    way["highway"="steps"]["name"](BOX);
    node["highway"="trailhead"](BOX); way["highway"="trailhead"](BOX);
    node["tourism"~"^(camp_site|wilderness_hut|alpine_hut)$"](BOX); way["tourism"="camp_site"](BOX);
    node["natural"="peak"]["name"](BOX);
    node["amenity"="drinking_water"](BOX); node["natural"="spring"](BOX); );
    out geom tags;`], 180);
  // Long-distance trails: international, national or regional hiking routes (PCT, Tahoe Rim Trail…)
  const routes = await bySquare(big, ['rel["route"~"^(hiking|foot)$"]["network"~"^(iwn|nwn|rwn)$"](BOX);', 'out body;'], 90);

  return savePark({ name, area, box, boundary: boundary.elements.map(compact), features: features.map(compact), routes: routes.map(compact) });
}

async function savePark({ name, area, box, boundary, features, routes }) {
  fs.mkdirSync(parkPath(name), { recursive: true });
  const saved = {
    name, source: `OpenStreetMap ${area.type}/${area.id}`, fetched: new Date().toISOString().slice(0, 10),
    bounds: area.bounds, box, boundary, features, routes
  };
  await downloadElevation(saved); // first, so a park with osm.json always has its elevation
  fs.writeFileSync(parkPath(name, 'osm.json'), JSON.stringify(saved));
  return saved;
}

// ---------- California, from Geofabrik's state file ----------
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

// The same things the Overpass queries above ask for
function wanted(el) {
  const t = el.tags || {};
  if (el.type === 'node') return t.highway === 'trailhead' || /^(camp_site|wilderness_hut|alpine_hut)$/.test(t.tourism || '') ||
    (t.natural === 'peak' && !!t.name) || t.amenity === 'drinking_water' || t.natural === 'spring';
  if (el.type === 'way') return (/^(path|footway|bridleway|track)$/.test(t.highway || '') && !/sidewalk|crossing/.test(t.footway || '') && !/^(private|no)$/.test(t.access || '')) ||
    (t.highway === 'steps' && !!t.name) || t.highway === 'trailhead' || t.tourism === 'camp_site';
  return false;
}
const isArea = t => /^(protected_area|national_park)$/.test(t.boundary || '') || /^(nature_reserve|park)$/.test(t.leisure || '');

async function californiaParks(parks) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parks-'));
  try {
    let pbf = pbfArg;
    if (!pbf) {
      pbf = path.join(tmp, 'california.osm.pbf');
      console.log(`downloading ${GEOFABRIK_CA}…`);
      execFileSync('curl', ['-sSfL', '--retry', '5', '-A', 'backpacking-trips-site/1.0 (GitHub Action)', '-o', pbf, GEOFABRIK_CA], { stdio: 'inherit' });
    }
    const opl = (name, filters, refs = true) => {
      const cut = path.join(tmp, name + '.pbf'), out = path.join(tmp, name + '.opl');
      console.log(`cutting out ${name}…`);
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
    const found = new Map(); // park name -> { area, boundary, box, big }
    for (const [name, p] of parks) {
      const area = areas.filter(a => a.tags.name === name).sort((a, b) => (a.type === 'relation' ? -1 : 1) - (b.type === 'relation' ? -1 : 1))[0];
      if (!area) continue;
      const el = { type: area.type, id: area.id, tags: area.tags };
      if (area.type === 'way') el.geometry = ways.get(area.id) || area.geometry || [];
      else el.members = area.members.map(m => ({ ...m, ...(m.type === 'way' && ways.has(m.ref) ? { geometry: ways.get(m.ref) } : {}) }));
      const pts = el.geometry || el.members.flatMap(m => m.geometry || []);
      if (!pts.length) continue;
      const g = grow(null, pts);
      const bounds = { minlat: g.minlat, minlon: g.minlon, maxlat: g.maxlat, maxlon: g.maxlon };
      const box = grow(bounds, p.extra);
      found.set(name, { area: { type: area.type, id: area.id, bounds }, boundary: [el], box, big: pad(box), features: [], wayIds: new Set(), routes: [] });
    }
    fs.unlinkSync(named);
    console.log(`in California: ${[...found.keys()].join(', ') || 'none'}`);
    if (!found.size) return found;

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

    // 3. Long-distance trails (PCT, Tahoe Rim Trail…) that run through each park
    const routes = opl('routes', ['r/route=hiking,foot'], false);
    await eachOpl(routes, el => {
      if (!/^(iwn|nwn|rwn)$/.test(el.tags?.network || '')) return;
      for (const f of found.values()) if ((el.members || []).some(m => m.type === 'way' && f.wayIds.has(m.ref)))
        f.routes.push({ type: 'relation', id: el.id, tags: el.tags, members: el.members });
    });
    fs.unlinkSync(routes);
    return found;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
function compactOpl(el) {
  const out = { type: el.type, id: el.id };
  if (el.type === 'node') { out.lat = el.lat; out.lon = el.lon; }
  if (el.tags) out.tags = el.tags;
  if (el.geometry) out.geometry = el.geometry;
  return out;
}

// Every elevation tile under the padded box and under every downloaded line (lines can run past the box)
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
    let res;
    for (let attempt = 0; attempt < 4 && !res?.ok; attempt++) {
      if (attempt) await sleep(3000 * attempt);
      try { res = await fetch(url, { signal: AbortSignal.timeout(60000) }); } catch {}
    }
    if (!res?.ok) throw new Error(`elevation tile ${x}/${y}: ${res ? res.status : 'no answer'}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    got++;
  }
  console.log(`  ${want.size} elevation tiles (${got} downloaded)`);
}

// ---------- main ----------
const trips = tripMaps();
const parks = new Map(); // park name -> { trips, extra }
for (const t of trips) if (t.park) {
  const p = parks.get(t.park) || { trips: [], extra: [] };
  p.trips.push(t.slug); p.extra.push(...t.extra);
  parks.set(t.park, p);
}
fs.mkdirSync(PARK_DIR, { recursive: true });
let failed = 0;
const done = new Set();
if (california) {
  const want = new Map([...parks].filter(([name, p]) => !only.length || only.includes(parkSlug(name)) || p.trips.some(s => only.includes(s))));
  for (const [name, f] of await californiaParks(want)) {
    const saved = await savePark({ name, ...f });
    console.log(`${parkSlug(name)}: ${saved.features.length} features, ${(fs.statSync(parkPath(name, 'osm.json')).size / 1048576).toFixed(1)} MB`);
    done.add(name);
  }
}
for (const [name, p] of parks) {
  if (done.has(name)) continue;
  // --california only redoes California parks; the others keep their saved data unless it's missing or out of date
  if (california && fs.existsSync(parkPath(name, 'osm.json')) && !force) {
    try { const old = JSON.parse(fs.readFileSync(parkPath(name, 'osm.json'), 'utf8'));
      if (old.name === name && p.extra.every(q => inside(old.box, q))) continue; } catch {}
  }
  if (only.length && !only.includes(parkSlug(name)) && !p.trips.some(s => only.includes(s))) continue;
  const file = parkPath(name, 'osm.json');
  if (!force && fs.existsSync(file)) {
    try {
      const old = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (old.name === name && p.extra.every(q => inside(old.box, q))) { console.log(`${parkSlug(name)}: up to date`); continue; }
    } catch {}
  }
  try {
    console.log(`${parkSlug(name)}: downloading "${name}" (for ${p.trips.join(', ')})…`);
    const saved = await downloadPark(name, p.extra);
    console.log(`${parkSlug(name)}: ${saved.features.length} features, ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
  } catch (e) {
    // stop at the first failure; parks already saved are kept
    failed++;
    console.error(`${parkSlug(name)}: ${e.message}`);
    break;
  }
  await sleep(2000);
}
// parks no trip names any more
const keep = new Set([...parks.keys()].map(parkSlug));
for (const d of fs.readdirSync(PARK_DIR)) if (!keep.has(d) && !only.length && !failed) {
  fs.rmSync(`${PARK_DIR}/${d}`, { recursive: true }); console.log(`${d}: no trip uses this park, removed its data`);
}
if (failed) process.exit(1);
