import fs from 'node:fs';
import { EleventyHtmlBasePlugin } from '@11ty/eleventy';
import { normalizeTrip, bestSeason, REASONS } from './lib/normalize.js';

const site = JSON.parse(fs.readFileSync('./_data/site.json', 'utf8'));

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);
  eleventyConfig.addPassthroughCopy('assets');
  eleventyConfig.addPassthroughCopy({ 'node_modules/leaflet/dist': 'assets/vendor/leaflet' });
  eleventyConfig.ignores.add('README.md');
  eleventyConfig.ignores.add('trips/_template.md');
  eleventyConfig.ignores.add('node_modules/**');
  eleventyConfig.ignores.add('scripts/**');
  eleventyConfig.ignores.add('lib/**');

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
  eleventyConfig.addFilter('onlyPage', (items, inputPath) => items.filter(i => i.inputPath === inputPath));
  eleventyConfig.addFilter('reasonLabel', k => REASONS[k] || k);
  eleventyConfig.addFilter('dots', n => [1, 2, 3].map(i => `<i class="${i > (n || 0) ? 'o' : ''}"></i>`).join(''));
  eleventyConfig.addFilter('levelName', n => ['', 'Book ahead', 'Competitive', 'Very hard'][n || 0]);
  eleventyConfig.addFilter('readableDate', d => {
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  });
  eleventyConfig.addFilter('editUrl', inputPath =>
    site.repo ? `https://github.com/${site.repo}/edit/${site.branch}/${inputPath.replace(/^\.\//, '')}` : '');
}

export const config = {
  dir: { input: '.', includes: '_includes', data: '_data', output: '_site' },
  markdownTemplateEngine: false,
  pathPrefix: process.env.PATH_PREFIX || '/'
};
