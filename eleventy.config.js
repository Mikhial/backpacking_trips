import fs from 'node:fs';
import { EleventyHtmlBasePlugin } from '@11ty/eleventy';
import { normalizeTrip, bestSeason, REASONS, routeKey } from './lib/normalize.js';
import { parseGpx, parseLatLon, simplify, measure } from './lib/geo.js';
import { forecastPoints } from './lib/forecast.js';

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
  eleventyConfig.addFilter('travelHours', v => { const m = String(v ?? '').match(/\d+(\.\d+)?/); const n = m ? +m[0] : 99; return /fly|flight/i.test(v || '') ? 10 + n : n; });
  eleventyConfig.addFilter('hasTrailData', slug => fs.existsSync(`./assets/trails/${slug}.json`));
  // Your own trailheads, camps and GPX routes from the trip header, ready for the trail map
  eleventyConfig.addFilter('mapExtras', data => {
    const places = list => Object.entries(list || {}).map(([n, v]) => ({ n, at: parseLatLon(v) })).filter(t => t.at);
    const trailheads = places(data.trailheads), camps = places(data.camps);
    const routes = Object.entries(data.routes || {}).map(([n, file]) => {
      file = String(file).trim();
      const pts = parseGpx(fs.readFileSync(file, 'utf8'));
      const stats = measure(pts);
      const p = simplify(pts, 6).map(q => q.length > 2 ? [+q[0].toFixed(5), +q[1].toFixed(5), Math.round(q[2])] : [+q[0].toFixed(5), +q[1].toFixed(5)]);
      return { n, file, p, ...stats };
    });
    return (trailheads.length || camps.length || routes.length) ? JSON.stringify({ trailheads, camps, routes }).replace(/</g, '\\u003c') : '';
  });
  // Places along each route for the weather forecast table (start, end, high point, camps)
  eleventyConfig.addFilter('forecastData', (data, slug) => {
    const places = list => Object.entries(list || {}).map(([n, v]) => ({ n, at: parseLatLon(v) })).filter(t => t.at);
    const file = `./assets/trails/${slug}.json`;
    const osm = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).pois : [];
    const pl = { trailheads: places(data.trailheads), camps: places(data.camps) };
    const routes = Object.entries(data.routes || {}).map(([n, f]) =>
      ({ n, pts: forecastPoints(parseGpx(fs.readFileSync(String(f).trim(), 'utf8')), pl, osm) })).filter(r => r.pts.length);
    return routes.length ? JSON.stringify(routes).replace(/</g, '\\u003c') : '';
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
  eleventyConfig.addFilter('routeLinks', (content, routes) => {
    const entries = Object.entries(routes || {}), keys = entries.map(([n]) => routeKey(n));
    if (!keys.length) return content;
    const done = new Set();
    return content.replace(/<a\s([^>]*)>([\s\S]*?)<\/a>([:.]\s*)?/g, (m, attrs, text) => {
      const i = keys.indexOf(routeKey(text));
      if (i < 0 || done.has(i)) return m;
      done.add(i);
      return `<span class="rt"><a ${attrs} id="route-${i}" data-route="${i}">${text}</a><span class="rt-stats">${routeStats(entries[i][1])}</span><button type="button" class="rt-show" data-route="${i}" aria-pressed="false" title="Show on map"><i></i>Map</button></span>`;
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
