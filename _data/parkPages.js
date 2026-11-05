// One "all map data" page per park that has debug data (assets/parks/<park>.json, made by scripts/build-maps.js)
import fs from 'node:fs';
import { parkSlug, tripMaps } from '../lib/parkdata.js';

export default function () {
  const parks = new Map();
  for (const t of tripMaps()) if (t.park) {
    const slug = parkSlug(t.park);
    if (!fs.existsSync(`assets/parks/${slug}/index.json`)) continue;
    const p = parks.get(slug) || { name: t.park, slug, trips: [] };
    p.trips.push(t.slug);
    parks.set(slug, p);
  }
  return [...parks.values()];
}
