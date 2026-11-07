// Checks every trip file and explains any problem in plain words.
// Run with: npm run check   (the site build runs it first, too)
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { normalizeTrip, routeKey, tripRoutes } from '../lib/normalize.js';
import { parseGpx } from '../lib/geo.js';

const site = JSON.parse(fs.readFileSync('_data/site.json', 'utf8'));
const dir = 'trips';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
const problems = [], notes = [];

for (const f of files) {
  const file = path.join(dir, f);
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) { problems.push(`${file}: the file must start with a --- header block`); continue; }
  let data;
  try { data = yaml.load(m[1]) || {}; }
  catch (e) {
    const line = e.mark ? ` (line ${e.mark.line + 2})` : '';
    const text = e.mark ? m[1].split(/\r?\n/)[e.mark.line] || '' : '';
    if (/^\s*notes:/.test(text)) problems.push(`${file}${line}: this note has a colon followed by a space in it. Put the whole note in "double quotes", or use a different punctuation mark.`);
    else problems.push(`${file}${line}: the header isn't valid YAML: ${e.reason || e.message}. Check indentation and colons.`);
    continue;
  }
  problems.push(...normalizeTrip(data, file, site.regions).errors);
  // Footnote sources: every [^name] (in the notes or in a season's notes) needs a "[^name]: source" line in the notes
  const body = text.slice(m[0].length);
  const defs = new Set([...body.matchAll(/^\[\^([^\]\s]+)\]:/gm)].map(x => x[1]));
  const cites = body + '\n' + [].concat(data.seasons || []).map(x => (x && typeof x.notes === 'string') ? x.notes : '').join('\n');
  const used = new Set([...cites.matchAll(/\[\^([^\]\s]+)\](?!:)/g)].map(x => x[1]));
  for (const n of used) if (!defs.has(n)) problems.push(`${file}: the notes cite [^${n}] but there's no "[^${n}]: ..." line in the notes saying what the source is`);
  for (const n of defs) if (!used.has(n)) notes.push(`${file}: the source [^${n}] isn't cited anywhere, so it won't be listed. (Fine if that's on purpose.)`);
  const linkTexts = [...text.slice(m[0].length).matchAll(/\[((?:[^\[\]]|\[[^\]]*\])+)\]\(/g)].map(x => routeKey(x[1]));
  const field = data.route != null ? 'route' : 'routes';
  for (const [name, gpx] of Object.entries(tripRoutes(data))) {
    const p = String(gpx).trim();
    if (!linkTexts.includes(routeKey(name))) notes.push(`${file} ${field} "${name}": no link in the notes has this exact text, so it won't get its distance and elevation there. (Fine if that's on purpose.)`);
    if (!/^tracks\//.test(p)) continue;
    if (!fs.existsSync(p)) problems.push(`${file} ${field} "${name}": can't find ${p}. Upload the GPX file to the tracks folder.`);
    else if (parseGpx(fs.readFileSync(p, 'utf8')).length < 2) problems.push(`${file} ${field} "${name}": ${p} has no track points. Export it as a GPX track.`);
  }
}

if (notes.length) {
  console.log('\nNotes (not errors):');
  notes.forEach(n => console.log('  • ' + n));
  console.log('');
}
if (problems.length) {
  console.error(`\nFound ${problems.length} problem${problems.length > 1 ? 's' : ''} in the trip files:\n`);
  problems.forEach(p => console.error('  • ' + p));
  console.error('');
  process.exit(1);
}
console.log(`All ${files.length} trip files look good.`);
