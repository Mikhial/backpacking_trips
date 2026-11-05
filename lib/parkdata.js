// Shared by the two trail map steps:
//   scripts/download-parks.js  downloads each park's map data and elevation into parkdata/<park>/
//   scripts/build-maps.js      builds each trip's map (assets/trails/<trip>.json) from that saved data
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { parseGpx, parseLatLon } from './geo.js';
import { tripRoutes } from './normalize.js';

export const PARK_DIR = 'parkdata';
export const DEM_ZOOM = 12;
export const PAD = 0.03;
// A one-route trip's map covers what's within this distance of its route line (and its trailheads)
export const ROUTE_M = 5000; // ~3 mi // ~3 km so trailheads just outside the boundary are included

// "Henry W. Coe State Park" -> "henry-w-coe-state-park"
export const parkSlug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const parkPath = (name, ...rest) => path.join(PARK_DIR, parkSlug(name), ...rest);

// What each trip's map needs from its header: the park, your GPX routes and trailheads
// (which can reach past the park boundary), and whether it's a one-route trip.
export function tripMaps() {
  return fs.readdirSync('trips').filter(f => f.endsWith('.md') && !f.startsWith('_')).sort().map(f => {
    const slug = f.replace(/\.md$/, '');
    const head = fs.readFileSync(path.join('trips', f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const data = head ? yaml.load(head[1]) || {} : {};
    const routeFiles = Object.values(tripRoutes(data)).map(v => String(v).trim()).filter(p => /^tracks\//.test(p) && fs.existsSync(p)).sort();
    const lines = routeFiles.map(p => parseGpx(fs.readFileSync(p, 'utf8')).map(q => [q[0], q[1]]));
    const trailheads = Object.values(data.trailheads || {}).map(parseLatLon).filter(Boolean);
    const extra = [...lines.flat(), ...trailheads];
    return { slug, name: data.name || slug, route: data.route || null, park: data.park || null, routeFiles, lines, trailheads, extra,
      single: data.route != null && routeFiles.length === 1 };
  });
}

// Smallest box around a starting box (or nothing) and some [lat, lon] points
export function grow(bb, pts) {
  bb = bb ? { ...bb } : { minlat: 90, maxlat: -90, minlon: 180, maxlon: -180 };
  for (const [lat, lon] of pts) {
    bb.minlat = Math.min(bb.minlat, lat); bb.maxlat = Math.max(bb.maxlat, lat);
    bb.minlon = Math.min(bb.minlon, lon); bb.maxlon = Math.max(bb.maxlon, lon);
  }
  return bb;
}
export const pad = (bb, d = PAD) => ({ minlat: bb.minlat - d, minlon: bb.minlon - d, maxlat: bb.maxlat + d, maxlon: bb.maxlon + d });
export const inside = (bb, [lat, lon]) => lat >= bb.minlat && lat <= bb.maxlat && lon >= bb.minlon && lon <= bb.maxlon;

// Elevation tiles (AWS Terrain Tiles, Terrarium PNGs, ~30 m)
const rad = Math.PI / 180;
export function tileXY(lat, lon) {
  const n = 2 ** DEM_ZOOM;
  return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2 * n];
}
export const tileFile = (x, y) => `${DEM_ZOOM}-${x}-${y}.png`;
