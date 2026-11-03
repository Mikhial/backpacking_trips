// Checks every trip file and explains any problem in plain words.
// Run with: npm run check   (the site build runs it first, too)
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { normalizeTrip } from '../lib/normalize.js';

const site = JSON.parse(fs.readFileSync('_data/site.json', 'utf8'));
const dir = 'trips';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
const problems = [];

for (const f of files) {
  const file = path.join(dir, f);
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) { problems.push(`${file}: the file must start with a --- header block`); continue; }
  let data;
  try { data = yaml.load(m[1]) || {}; }
  catch (e) {
    const line = e.mark ? ` (line ${e.mark.line + 2})` : '';
    problems.push(`${file}${line}: the header isn't valid YAML: ${e.reason || e.message}. Check indentation and colons.`);
    continue;
  }
  problems.push(...normalizeTrip(data, file, site.regions).errors);
}

if (problems.length) {
  console.error(`\nFound ${problems.length} problem${problems.length > 1 ? 's' : ''} in the trip files:\n`);
  problems.forEach(p => console.error('  • ' + p));
  console.error('');
  process.exit(1);
}
console.log(`All ${files.length} trip files look good.`);
