// Picks what the maps use out of each park's saved full.osm.pbf again (osm.json and all.json), with no downloading.
// Run it after changing the rules in lib/pick.js, then scripts/build-maps.js. (scripts/download-parks.js also
// picks again any park whose osm.json was made with older rules, so the workflow does this on its own.)
//
//   node scripts/pick-features.js         every park
//   node scripts/pick-features.js zion    only this trip's park (trip or park name)
//
// Needs osmium-tool.
import fs from 'node:fs';
import { parkSlug, parkPath, tripMaps } from '../lib/parkdata.js';
import { pickPark } from '../lib/pick.js';

const only = process.argv.slice(2).filter(a => !a.startsWith('--')).map(parkSlug);
const parks = new Map();
for (const t of tripMaps()) if (t.park) parks.set(t.park, [...(parks.get(t.park) || []), t.slug]);
let failed = 0;
for (const [name, trips] of parks) {
  if (only.length && !only.includes(parkSlug(name)) && !trips.some(s => only.includes(s))) continue;
  if (!fs.existsSync(parkPath(name, 'full.osm.pbf'))) { console.log(`${parkSlug(name)}: not downloaded yet; run scripts/download-parks.js`); failed++; continue; }
  try {
    const r = await pickPark(name);
    console.log(`${parkSlug(name)}: ${r.features} features for the trip maps, ${r.all} on the All map data page`);
  } catch (e) { failed++; console.error(`${parkSlug(name)}: ${e.message}`); }
}
if (failed) process.exit(1);
