// Downloads the map data for every park named on a trip's `park:` line and saves it, unpublished, in parkdata/<park>/:
//   full.osm.pbf  everything OpenStreetMap has in the park's area (its boundary plus ~3 km, and your routes
//                 and trailheads), with nothing dropped
//   park.json     where it came from and the area it covers
//   elevation/    elevation tiles under the trip maps' lines (AWS Terrain Tiles, USGS-based, ~30 m)
// It then runs the pick step (lib/pick.js), which makes osm.json and all.json from full.osm.pbf without downloading.
// Nothing here is shown on the site; scripts/build-maps.js makes the trip maps and All map data pages.
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
import { execFileSync } from 'node:child_process';
import { PARK_DIR, parkSlug, parkPath, tripMaps, grow, pad, inside, tileXY, tileFile } from '../lib/parkdata.js';
import { osmium, readPbf } from '../lib/osm.js';
import { pickPark } from '../lib/pick.js';

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
const geofabrik = async () => index ||= (await getJson('https://download.geofabrik.de/index-v1-nogeom.json')).features.map(f => f.properties);
async function stateFile(name) {
  const hits = await getJson(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: name, format: 'jsonv2', addressdetails: 1, limit: 5 })}`);
  await sleep(1100); // Nominatim allows one request a second
  const hit = hits.find(h => h.name === name && h.address?.['ISO3166-2-lvl4']) || hits.find(h => h.address?.['ISO3166-2-lvl4']);
  if (!hit) throw new Error(`OpenStreetMap's place search can't find "${name}". Check the spelling on openstreetmap.org.`);
  const iso = hit.address['ISO3166-2-lvl4']; // "US-UT"
  const region = (await geofabrik()).filter(r => (r['iso3166-2'] || []).includes(iso) && r.urls?.pbf).sort((a, b) => a.id.length - b.id.length)[0];
  if (!region) throw new Error(`Geofabrik has no map file for ${iso} (where "${name}" is)`);
  return { id: region.id, url: region.urls.pbf };
}
async function regionById(id) {
  const r = (await geofabrik()).find(x => x.id === id);
  if (!r) throw new Error(`Geofabrik no longer has a "${id}" map file`);
  return { id: r.id, url: r.urls.pbf };
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

// ---------- cutting parks out of a state file ----------
const isArea = t => /^(protected_area|national_park)$/.test(t.boundary || '') || /^(nature_reserve|park)$/.test(t.leisure || '');

// Find each park's boundary by name, then save everything in its padded box
async function cutParks(pbf, region, list, tmp) {
  const ways = new Map(), areas = [];
  await readPbf(pbf, tmp, el => {
    if (el.type === 'way') ways.set(el.id, el.geometry || []);
    if (el.type !== 'node' && el.tags && list.has(el.tags.name) && isArea(el.tags)) areas.push(el);
  }, [...list.keys()].map(n => `nwr/name=${n}`));
  const extracts = [];
  for (const [name, p] of list) {
    const area = areas.filter(a => a.tags.name === name).sort((a, b) => (a.type === 'relation' ? -1 : 1) - (b.type === 'relation' ? -1 : 1))[0];
    if (!area) throw new Error(`The ${region.id} map file has no park or wilderness boundary named "${name}". Check the spelling on openstreetmap.org.`);
    const pts = area.type === 'way' ? ways.get(area.id) || [] : area.members.filter(m => m.type === 'way').flatMap(m => ways.get(m.ref) || []);
    const missing = area.type === 'relation' ? area.members.filter(m => m.type === 'way' && !ways.has(m.ref)).length : 0;
    if (missing) console.log(`  warning: ${missing} pieces of the "${name}" boundary aren't in the ${region.id} file; it may cross into another state`);
    const g = grow(null, pts);
    const bounds = { minlat: g.minlat, minlon: g.minlon, maxlat: g.maxlat, maxlon: g.maxlon };
    const box = grow(bounds, p.extra), big = pad(box);
    fs.mkdirSync(parkPath(name), { recursive: true });
    fs.writeFileSync(parkPath(name, 'park.json'), JSON.stringify({
      name, region: region.id, source: `OpenStreetMap ${area.type}/${area.id}`, fetched: new Date().toISOString().slice(0, 10),
      area: { type: area.type, id: area.id }, bounds, box
    }, null, 1));
    extracts.push({ output: path.resolve(parkPath(name, 'full.osm.pbf')), output_format: 'pbf', bbox: [big.minlon, big.minlat, big.maxlon, big.maxlat] });
  }
  // one pass over the state file for all its parks; whole lines and areas that cross the edge are kept
  const config = path.join(tmp, 'extracts.json');
  fs.writeFileSync(config, JSON.stringify({ extracts }));
  console.log(`  cutting out ${extracts.length} park${extracts.length > 1 ? 's' : ''}…`);
  osmium('extract', '-c', config, '-s', 'smart', '--overwrite', pbf);
}

// Every elevation tile under a box; tiles already saved are kept
async function downloadElevation(name, bb) {
  const [x0, y0] = tileXY(bb.maxlat, bb.minlon).map(Math.floor), [x1, y1] = tileXY(bb.minlat, bb.maxlon).map(Math.floor);
  const dir = parkPath(name, 'elevation');
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
const saved = name => { try { return JSON.parse(fs.readFileSync(parkPath(name, 'park.json'), 'utf8')); } catch { return null; } };

const byRegion = new Map(); // region id -> { region, parks: Map }
const todo = [];
let failed = 0;
try {
  for (const [name, p] of parks) {
    const old = saved(name);
    const asked = only.includes(parkSlug(name)) || p.trips.some(s => only.includes(s));
    const current = old && old.name === name && fs.existsSync(parkPath(name, 'full.osm.pbf')) && p.extra.every(q => inside(old.box, q));
    if (only.length ? !asked : (!all && current)) { if (!only.length) console.log(`${parkSlug(name)}: up to date`); continue; }
    todo.push(name);
    if (check) continue;
    // the state: saved with the park (older saves kept it in osm.json), or looked up
    let regionId = old?.region;
    if (!regionId) try { regionId = JSON.parse(fs.readFileSync(parkPath(name, 'osm.json'), 'utf8')).region; } catch {}
    const region = regionId ? await regionById(regionId) : await stateFile(name);
    if (!byRegion.has(region.id)) byRegion.set(region.id, { region, parks: new Map() });
    byRegion.get(region.id).parks.set(name, p);
  }
  // --check: only say whether anything needs downloading
  if (check) {
    console.log(todo.length ? `to download: ${todo.join(', ')}` : 'nothing to download');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `needed=${todo.length ? 'true' : 'false'}\n`);
    process.exit(0);
  }
  for (const { region, parks: list } of byRegion.values()) {
    console.log(`${region.id}: ${[...list.keys()].join(', ')}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parks-'));
    try {
      await cutParks(statePbf(region, tmp), region, list, tmp);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    for (const name of list.keys()) {
      const r = await pickPark(name);
      await downloadElevation(name, r.elevationBox);
      console.log(`${parkSlug(name)}: ${(fs.statSync(parkPath(name, 'full.osm.pbf')).size / 1048576).toFixed(1)} MB saved; ` +
        `${r.features} features for the trip maps, ${r.all} on the All map data page`);
    }
  }
} catch (e) {
  // stop at the first failure; parks already saved are kept
  failed++;
  console.error(e.message);
}

// parks no trip names any more
const keep = new Set([...parks.keys()].map(parkSlug));
if (!failed && !only.length) for (const d of fs.readdirSync(PARK_DIR)) if (!keep.has(d)) {
  fs.rmSync(`${PARK_DIR}/${d}`, { recursive: true }); console.log(`${d}: no trip uses this park, removed its data`);
}
if (failed) process.exit(1);
