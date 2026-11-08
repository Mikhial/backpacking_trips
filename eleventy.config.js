import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { EleventyHtmlBasePlugin } from '@11ty/eleventy';
import footnote from 'markdown-it-footnote';
import { normalizeTrip, bestSeason, REASONS, routeKey, mapShows, showsWord } from './lib/normalize.js';
import { parseGpx, parseLatLon, simplify, measure, routeShape } from './lib/geo.js';
import { parkSlug } from './lib/parkdata.js';

const site = JSON.parse(fs.readFileSync('./_data/site.json', 'utf8'));

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);
  eleventyConfig.addPassthroughCopy('assets');
  eleventyConfig.addPassthroughCopy({ 'node_modules/leaflet/dist': 'assets/vendor/leaflet' });
  eleventyConfig.addPassthroughCopy('tracks');
  eleventyConfig.ignores.add('README.md');
  eleventyConfig.ignores.add('CLAUDE.md');
  eleventyConfig.ignores.add('trips/_template.md');
  eleventyConfig.ignores.add('node_modules/**');
  eleventyConfig.ignores.add('scripts/**');
  eleventyConfig.ignores.add('lib/**');
  eleventyConfig.ignores.add('tracks/**');
  eleventyConfig.ignores.add('parkdata/**');
  eleventyConfig.watchIgnores.add('parkdata/**'); // the download and pick steps rewrite it; nothing there is published

  // All trips, in region order, then by "order", then by name
  eleventyConfig.addCollection('trips', api => {
    const rank = r => { const i = site.regions.indexOf(r); return i < 0 ? 99 : i; };
    return api.getFilteredByGlob('trips/*.md').sort((a, b) =>
      rank(a.data.region) - rank(b.data.region) ||
      (a.data.order ?? 99) - (b.data.order ?? 99) ||
      String(a.data.name).localeCompare(String(b.data.name)));
  });

  // Chart-ready data for one trip (fails the build with a clear message if a field can't be read)
  const chartFor = item => {
    const { errors, chart } = normalizeTrip(item.data, item.inputPath.replace(/^\.\//, ''), site.regions);
    if (errors.length) throw new Error('\n  ' + errors.join('\n  '));
    return { ...chart, url: (config.pathPrefix + item.url).replace(/\/{2,}/g, '/') };
  };
  eleventyConfig.addFilter('chartData', items => JSON.stringify({ title: site.chartTitle, trips: [].concat(items).map(chartFor) })
    .replace(/</g, '\\u003c'));
  eleventyConfig.addFilter('bestSeason', item => bestSeason(chartFor(item).seasons));
  eleventyConfig.addFilter('seasonSpans', item => chartFor(item).seasons.map(x => `${x.start}:${x.end}`).join(','));
  eleventyConfig.addFilter('firstNumber', v => { const m = String(v ?? '').match(/\d+(\.\d+)?/); return m ? +m[0] : ''; });
  eleventyConfig.addFilter('peakStart', item => { const ss = chartFor(item).seasons; return ((ss.find(x => x.type === 'peak') || ss[0]) || {}).start || '99'; });
  // Rough sort key for "Getting there": hours, with flights sorted after drives
  // hours for sorting the Trips list by its first time: "3.5 hr", "2:40", "45 min"; trips that start with a flight sort after drives
  eleventyConfig.addFilter('travelHours', v => { const t = String(v ?? ''); const m = t.match(/(\d+):(\d\d)|(\d+(?:\.\d+)?)\s*(min)?/); const n = !m ? 99 : m[1] ? +m[1] + m[2] / 60 : m[4] ? m[3] / 60 : +m[3]; return /fly|flight/i.test(t.split(/,|\+| or /)[0]) ? 10 + n : n; });
  eleventyConfig.addFilter('hasTrailData', slug => fs.existsSync(`./assets/trails/${slug}.json`));
  // whether the trip's map draws this kind ("map shows:" in its header; without it, everything)
  eleventyConfig.addFilter('mapShows', function (word) { return showsWord(mapShows(this.ctx['map shows']), word); });
  // whether the trip's "map shows:" line names this kind (false when there's no line)
  // `status link:` in a trip header: where to check for updates on the status
  eleventyConfig.addFilter('statusLink', function () { const u = this.ctx['status link']; return typeof u === 'string' && /^https?:\/\//.test(u.trim()) ? u.trim() : ''; });
  // `route link:` in a one-route trip's header: the route's page (AllTrails etc.), shown next to the GPX link
  eleventyConfig.addFilter('routeLink', function () { const u = this.ctx['route link']; return typeof u === 'string' && /^https?:\/\//.test(u.trim()) ? u.trim() : ''; });
  eleventyConfig.addFilter('mapListed', function (word) { const list = mapShows(this.ctx['map shows']); return !!list && list.includes(word); });
  eleventyConfig.addFilter('joinAnd', a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  // the park's "all map data" page (parks.njk), if it has one
  eleventyConfig.addFilter('parkPage', name => fs.existsSync(`./assets/parks/${parkSlug(name)}/index.json`) ? `/parks/${parkSlug(name)}/` : '');
  // Your own trailheads, camps and GPX routes from the trip header, ready for the trail map
  eleventyConfig.addFilter('mapExtras', data => {
    const places = list => Object.entries(list || {}).map(([n, v]) => ({ n, at: parseLatLon(v) })).filter(t => t.at);
    const trailheads = places(data.trailheads), camps = places(data.camps);
    const routes = Object.entries(data.trackFiles || {}).map(([n, file]) => {
      file = String(file).trim();
      const pts = parseGpx(fs.readFileSync(file, 'utf8'));
      const stats = measure(pts);
      const p = simplify(pts, 6).map(q => q.length > 2 ? [+q[0].toFixed(5), +q[1].toFixed(5), Math.round(q[2])] : [+q[0].toFixed(5), +q[1].toFixed(5)]);
      return { n, file, p, ...stats, ...(data.link ? { url: data.link } : {}) };
    });
    return (trailheads.length || camps.length || routes.length) ? JSON.stringify({ trailheads, camps, routes }).replace(/</g, '\\u003c') : '';
  });
  // The Trips list's Distance: the trip's "Distance:" fact if it has one, otherwise measured from its GPX routes:
  // one route gives "28 mi point to point", several give the range, "13–48 mi"
  eleventyConfig.addFilter('tripDistance', data => {
    if (data.facts && data.facts.Distance) return String(data.facts.Distance);
    const files = Object.values(data.trackFiles || {});
    if (!files.length) return '';
    const mi = pts => measure(pts).len / 1609.344, fmt = v => v < 10 ? v.toFixed(1) : String(Math.round(v));
    const tracks = files.map(f => parseGpx(fs.readFileSync(String(f).trim(), 'utf8')));
    if (tracks.length === 1) { const shape = routeShape(tracks[0]); return `${fmt(mi(tracks[0]))} mi${shape ? ' ' + shape.toLowerCase() : ''}`; }
    const lens = tracks.map(mi), lo = Math.min(...lens), hi = Math.max(...lens);
    return lo === hi ? `${fmt(lo)} mi` : `${fmt(lo)}–${fmt(hi)} mi`;
  });
  // A one-route trip's stats under the map title: "28 mi · ↑ 7,221 ft · ↓ 7,572 ft · 384–3,812 ft · Point to point"
  eleventyConfig.addFilter('routeSummary', trackFiles => {
    const file = Object.values(trackFiles || {})[0];
    if (!file) return '';
    const pts = parseGpx(fs.readFileSync(String(file).trim(), 'utf8')), s = measure(pts), n = v => Math.round(v * 3.28084).toLocaleString('en-US');
    const out = [`${(s.len / 1609.344).toFixed(s.len < 16093 ? 1 : 0)} mi`];
    if (s.up != null) { const e = simplify(pts, 6).map(p => Math.round(p[2])); out.push(`↑ ${n(s.up)} ft`, `↓ ${n(s.down)} ft`, `${n(Math.min(...e))}–${n(Math.max(...e))} ft`); }
    const shape = routeShape(pts);
    if (shape) out.push(shape);
    return out.join(' · ');
  });
  // A link in the notes whose text matches a route name becomes a route line: the link, then
  // distance, gain and elevation range measured from the GPX file, then a "show on map" toggle.
  // Any ":" or "." right after the link is dropped; the rest of the text continues on the next line.
  const ft = m => Math.round(m * 3.28084 / 100) * 100;
  const routeStats = file => {
    const pts = parseGpx(fs.readFileSync(String(file).trim(), 'utf8'));
    const { len, up } = measure(pts), mi = len / 1609.344;
    const out = [`${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`];
    if (up != null) {
      const e = pts.map(p => p[2]);
      out.push(`${ft(up).toLocaleString('en-US')} ft gain`, `${ft(Math.min(...e)).toLocaleString('en-US')}–${ft(Math.max(...e)).toLocaleString('en-US')} ft`);
    }
    return out.join(' · ');
  };
  // Footnotes are the way to cite sources: "text.[^reddit]" in the notes, and "[^reddit]: [r/norcalhiking](https://...)"
  // anywhere in them. They're numbered in order of use and listed under "Sources" at the end of the notes.
  eleventyConfig.amendLibrary('md', lib => {
    lib.use(footnote);
    lib.renderer.rules.footnote_block_open = () => '<section class="footnotes">\n<h2>Sources</h2>\n<ol class="footnotes-list">\n';
    lib.renderer.rules.footnote_caption = (tokens, idx) => String(tokens[idx].meta.id + 1);
  });

  // The When to go list, built from the header's seasons, is written into the notes under "## When to go" before
  // the Markdown is rendered (or added at the end if there's no such heading), so footnotes in season notes work.
  eleventyConfig.addPreprocessor('whenToGo', 'md', (data, content) => {
    if (!/^\.?\/?trips\/[^_][^/]*\.md$/.test(data.page.inputPath.replace(/^\.\//, ''))) return;
    const { whenToGo } = normalizeTrip(data, data.page.inputPath, site.regions);
    if (!whenToGo.length) return;
    // a small bar in the chart's season color stands in for the bullet: peak, shoulder, or red for off
    const mark = w => `<span class="wt-mark ${w.tag ? w.tag.toLowerCase() : 'off'}" role="img" aria-label="${w.tag || 'Off season'}" title="${w.tag || 'Off season'}"></span>`;
    const items = whenToGo.map(w => `- ${mark(w)}**${w.label}**${w.notes ? ': ' + w.notes : ''}`).join('\n');
    const block = head => `${head}\n\n<div class="when">\n\n${items}\n\n</div>\n`;
    // the heading can carry footnotes (## When to go[^name]) to cite a source for the whole section
    const h = /^## When to go((?:\[\^[^\]\s]+\])*)[ \t]*$/m;
    return h.test(content) ? content.replace(h, m => block(m.trim())) : `${content}\n\n${block('## When to go')}`;
  });

  // The Permits section is written in the notes (README: "Writing the Permits section"). The header's
  // difficulty dots are added next to its heading.
  // PERMIT_COMPARE=<git ref> (preview only) also shows the section as it was at that ref, above the new one.
  eleventyConfig.addPreprocessor('permits', 'md', (data, content) => {
    if (!/^\.?\/?trips\/[^_][^/]*\.md$/.test(data.page.inputPath.replace(/^\.\//, ''))) return;
    const n = (data.permit && data.permit.difficulty) || 0;
    const LEVEL = ['Easy', 'Book ahead', 'Competitive', 'Very hard'];
    const meter = `<span class="meter" title="Permit difficulty: ${LEVEL[n]}">${[1, 2, 3].map(i => `<i class="${i > n ? 'o' : ''}"></i>`).join('')}</span>`;
    const h = /^## Permits((?:\[\^[^\]\s]+\])*)[ \t]*$/m;
    if (!h.test(content)) return;
    let out = content.replace(h, m => `${m.trim()} ${meter}`);
    if (process.env.PERMIT_COMPARE) out = comparePermits(out, data.page.inputPath);
    return out;
  });
  // a section of a Markdown body: its heading to the next ## heading
  const sectionOf = (md, re) => { const m = md.match(re); if (!m) return null; const rest = md.slice(m.index + m[0].length); const n = rest.search(/^## /m); return { start: m.index, end: m.index + m[0].length + (n < 0 ? rest.length : n), body: n < 0 ? rest : rest.slice(0, n) }; };
  function comparePermits(md, inputPath) {
    let old = '';
    try { old = execFileSync('git', ['show', `${process.env.PERMIT_COMPARE}:${inputPath.replace(/^\.\//, '')}`], { encoding: 'utf8' }).replace(/^---[\s\S]*?\n---\n/, ''); } catch { return md; }
    const was = sectionOf(old, /^## (?:Permits[^\n]*|Overnight options)$/m), now = sectionOf(md, /^## Permits[^\n]*$/m);
    if (!now) return md;
    // stacked: the old section under its old heading, then the new one; "(before)" / "(after)" tell them apart
    const oldHead = was ? old.slice(was.start, old.indexOf('\n', was.start)).replace(/^## /, '') : 'Permits';
    const newHead = md.slice(now.start, md.indexOf('\n', now.start)).replace(/^## Permits/, '## Permits (after)');
    return md.slice(0, now.start) + `## ${oldHead} (before)\n\n${was ? was.body.trim() : '*No section*'}\n\n${newHead}\n\n${now.body.trim()}\n\n` + md.slice(now.end);
  }

  // On a one-route trip (single) the route is always on the map, so there's no "show on map" toggle.
  eleventyConfig.addFilter('routeLinks', (content, routes, single) => {
    const entries = Object.entries(routes || {}), keys = entries.map(([n]) => routeKey(n));
    if (!keys.length) return content;
    const done = new Set();
    return content.replace(/<a\s([^>]*)>([\s\S]*?)<\/a>([:.]\s*)?/g, (m, attrs, text) => {
      const i = keys.indexOf(routeKey(text));
      if (i < 0 || done.has(i)) return m;
      done.add(i);
      return `<span class="rt"><a ${attrs} id="route-${i}" data-route="${i}">${text}</a><span class="rt-stats">${routeStats(entries[i][1])}</span>${single ? '' : `<button type="button" class="rt-show" data-route="${i}" aria-pressed="false" title="Show on map"><i></i>Map</button>`}</span>`;
    });
  });
  eleventyConfig.addFilter('onlyPage', (items, inputPath) => items.filter(i => i.inputPath === inputPath));
  eleventyConfig.addFilter('reasonLabel', k => REASONS[k] || k);
  eleventyConfig.addFilter('dots', n => [1, 2, 3].map(i => `<i class="${i > (n || 0) ? 'o' : ''}"></i>`).join(''));
  eleventyConfig.addFilter('levelName', n => ['', 'Book ahead', 'Competitive', 'Very hard'][n || 0]);
  eleventyConfig.addFilter('readableDate', d => {
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  });
  // Links to other sites open in a new tab (trip notes, planning links, Edit on GitHub)
  eleventyConfig.addTransform('externalLinks', function (content) {
    if (!(this.page.outputPath || '').endsWith('.html')) return content;
    return content.replace(/<a\s(?![^>]*\btarget=)([^>]*\bhref="https?:\/\/[^"]*"[^>]*)>/g,
      (m, attrs) => `<a ${attrs} target="_blank" rel="noopener">`);
  });
  eleventyConfig.addFilter('editUrl', inputPath =>
    site.repo ? `https://github.com/${site.repo}/edit/${site.branch}/${inputPath.replace(/^\.\//, '')}` : '');
}

export const config = {
  dir: { input: '.', includes: '_includes', data: '_data', output: '_site' },
  markdownTemplateEngine: false,
  pathPrefix: process.env.PATH_PREFIX || '/'
};
