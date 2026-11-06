// Reading OpenStreetMap files with osmium (osmium-tool must be installed).
// osmium writes text (OPL): one object per line, with each line's points filled in.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';

export const osmium = (...a) => execFileSync('osmium', a, { stdio: ['ignore', 'inherit', 'inherit'] });

// "Name=Foo%20%Bar" -> "Foo Bar"
const unesc = s => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const TYPES = { n: 'node', w: 'way', r: 'relation' };
export function parseOpl(line) {
  const parts = line.split(' ');
  const el = { type: TYPES[parts[0][0]], id: +parts[0].slice(1) };
  for (const p of parts.slice(1)) {
    const v = p.slice(1);
    if (p[0] === 'T' && v) el.tags = Object.fromEntries(v.split(',').map(kv => kv.split('=').map(unesc)));
    else if (p[0] === 'x' && v) el.lon = +v;
    else if (p[0] === 'y' && v) el.lat = +v;
    else if (p[0] === 'N' && v) el.geometry = v.split(',').map(n => n.match(/x([-\d.]*)y([-\d.]*)$/)).filter(m => m && m[1] && m[2]).map(m => [+m[2], +m[1]]);
    else if (p[0] === 'M' && v) el.members = v.split(',').map(m => { const [ref, role] = m.split('@');
      return { type: TYPES[ref[0]], ref: +ref.slice(1), role: unesc(role || '') }; });
  }
  return el;
}
export async function eachOpl(file, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line) fn(parseOpl(line));
}

// Every object in a .osm.pbf file (or only those matching osmium tags-filter expressions), with ways' points.
// refs: also include what matching relations and ways refer to (default true).
export async function readPbf(pbf, tmp, fn, filters = null, refs = true) {
  const base = path.join(tmp, path.basename(pbf, '.osm.pbf') + '-' + Math.random().toString(36).slice(2));
  let src = pbf;
  if (filters) { src = base + '.pbf'; osmium('tags-filter', pbf, ...filters, ...(refs ? [] : ['-R']), '-o', src, '--overwrite'); }
  const out = base + '.opl';
  osmium('add-locations-to-ways', src, '-f', 'opl,add_metadata=false', '-o', out, '--overwrite');
  try { await eachOpl(out, fn); } finally { fs.rmSync(out, { force: true }); if (src !== pbf) fs.rmSync(src, { force: true }); }
}
