// Turns the friendly trip-file format into the data the chart and pages use,
// and collects readable errors for anything it can't understand.
import { parseLatLon } from './geo.js';

// "map shows:" in a trip header: which kinds its trip map draws (the All map data page starts with the same ones).
// Without it a trip map shows all of these. Whatever the trip's GPX route runs along is always shown.
export const MAP_WORDS = {
  paths: { highway: 'path' }, footways: { highway: 'footway' }, bridleways: { highway: 'bridleway' },
  cycleways: { highway: 'cycleway' }, steps: { highway: 'steps' }, 'dirt roads': { highway: 'track' },
  trailheads: { poi: 'trailhead' }, camps: { poi: 'camp' }, peaks: { poi: 'peak' }, water: { poi: 'water' },
  boundaries: { boundary: true }
};
// "Dirt roads, Path, trailhead" -> ["dirt roads", "paths", "trailheads"]; unknown words come back as { bad }
// Left off a trip map unless its "map shows:" lists them (Mike, Nov 5 2026: "drop all water for now")
export const DEFAULT_OFF = ['water'];
// Peaks lower than this aren't shown (Mike: "any peak under 5k")
export const MIN_PEAK_FT = 5000;
// whether a trip map shows this kind: its "map shows:" list, or everything but DEFAULT_OFF
export const showsWord = (list, w) => list ? list.includes(w) : !DEFAULT_OFF.includes(w);

export function mapShows(v) {
  if (v == null) return null;
  return String(v).split(',').map(w => w.trim().toLowerCase()).filter(Boolean).map(w => {
    const k = Object.keys(MAP_WORDS).find(k => k === w || k === w + 's' || k.replace(/s$/, '') === w);
    return k || { bad: w };
  });
}


const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS_IN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const REASONS = {
  hot: 'Hot', dry: 'Dry, little water', rain: 'Rain', cold: 'Cold', wind: 'Windy', fog: 'Fog',
  wet: 'Wet trails', bugs: 'Bugs', snow: 'Snow', water: 'High water, flooding', crowds: 'Crowds', smoke: 'Wildfire smoke'
};

const pad = n => String(n).padStart(2, '0');

// "Sep 1" -> "09-01"
export function parseDate(text) {
  const m = String(text ?? '').trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})$/);
  if (!m) throw new Error(`"${text}" isn't a date like "Sep 1"`);
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  if (mi < 0) throw new Error(`"${m[1]}" isn't a month (use Jan, Feb, Mar, ...)`);
  const d = +m[2];
  const max = mi === 1 ? 29 : DAYS_IN[mi];
  if (d < 1 || d > max) throw new Error(`${m[1]} doesn't have a day ${d}`);
  return `${pad(mi + 1)}-${pad(Math.min(d, DAYS_IN[mi]))}`;
}

// "Sep 1 – Oct 31" (also "-" or "to") -> { start, end }; a single date gives start = end
export function parseRange(text) {
  const parts = String(text ?? '').split(/\s*(?:–|—|-|\bto\b)\s*/).filter(Boolean);
  if (parts.length === 1) { const d = parseDate(parts[0]); return { start: d, end: d }; }
  if (parts.length !== 2) throw new Error(`"${text}" isn't a range like "Sep 1 – Oct 31"`);
  return { start: parseDate(parts[0]), end: parseDate(parts[1]) };
}

// "90 days", "24 weeks", "6 months", "day of" -> { n, unit }
function parseBefore(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (t === 'day of' || t === 'same day' || t === '0 days') return { n: 0, unit: 'day' };
  const m = t.match(/^(\d+)\s*(day|week|month)s?$/);
  if (!m) throw new Error(`"before: ${text}" should look like "90 days", "24 weeks", "6 months" or "day of"`);
  return { n: +m[1], unit: m[2] };
}
const toDays = ({ n, unit }) => unit === 'day' ? n : unit === 'week' ? n * 7 : Math.round(n * 30.44);

// One seasons: entry. "peak:" and "shoulder:" are chart bars; "off:" is only listed under When to go.
// The dates can be several ranges ("Apr 1 – May 31, Oct 1 – Nov 30") and a range can run past New Year ("Nov 1 – Feb 28").
const SEASON_TYPES = ['peak', 'shoulder', 'off'];
function normSeason(s, i, errors, where) {
  const w = `${where} seasons[${i + 1}]`;
  const keys = Object.keys(s || {}).filter(k => SEASON_TYPES.includes(k));
  if (keys.length !== 1) { errors.push(`${w}: start the line with "peak:", "shoulder:" or "off:"`); return null; }
  const extra = Object.keys(s).filter(k => !SEASON_TYPES.includes(k) && !['why', 'notes', 'source'].includes(k));
  if (extra.length) errors.push(`${w}: "${extra[0]}" isn't a season field (use why, notes and source)`);
  if (s.source != null && typeof s.source !== 'string') errors.push(`${w}: "source" should be one line: a name and/or a web address, like Exploring Wild https://exploringwild.com/...`);
  if (s.notes != null && typeof s.notes !== 'string') errors.push(`${w}: "notes" should be one line of text. If it has a colon followed by a space, put the whole note in "double quotes"`);
  try {
    const ranges = String(s[keys[0]] ?? '').split(/\s*,\s*/).filter(Boolean).map(parseRange);
    if (!ranges.length) throw new Error(`add the dates after "${keys[0]}:", like "Sep 1 – Oct 31"`);
    const tags = [].concat(s.why || []);
    tags.forEach(t => { if (!REASONS[t]) errors.push(`${w}: unknown reason "${t}" (use: ${Object.keys(REASONS).join(', ')})`); });
    return { type: keys[0], ranges, tags, notes: typeof s.notes === 'string' ? s.notes.trim() : '', source: typeof s.source === 'string' ? s.source.trim() : '' };
  } catch (e) { errors.push(`${w}: ${e.message}`); return null; }
}

// a range as day-of-year pieces that don't cross New Year: Nov 1 – Feb 28 -> Nov 1 – Dec 31 and Jan 1 – Feb 28
const splitYear = r => r.start <= r.end ? [r] : [{ start: r.start, end: '12-31' }, { start: '01-01', end: r.end }];
const nextDay = md => { const [m, d] = md.split('-').map(Number); return d < DAYS_IN[m - 1] ? `${pad(m)}-${pad(d + 1)}` : m < 12 ? `${pad(m + 1)}-01` : '01-01'; };

// The chart's bars: peak and shoulder ranges. Touching peak bars are joined into one (reasons combined);
// touching shoulder bars only when their reasons are the same, so e.g. a windy spring and a foggy summer stay apart.
function chartSeasons(entries) {
  const bars = entries.filter(e => e.type !== 'off')
    .flatMap(e => e.ranges.flatMap(splitYear).map(r => ({ type: e.type, ...r, tags: [...e.tags] })))
    .sort((a, b) => a.start.localeCompare(b.start));
  const out = [];
  for (const b of bars) {
    const last = out[out.length - 1];
    if (last && last.type === b.type && nextDay(last.end) === b.start && (b.type === 'peak' || last.tags.join() === b.tags.join())) {
      last.end = b.end; b.tags.forEach(t => { if (!last.tags.includes(t)) last.tags.push(t); });
    } else out.push(b);
  }
  return out;
}

// Any two entries (off included) that cover the same day
function overlaps(entries, where, errors) {
  const pieces = entries.flatMap((e, i) => e.ranges.flatMap(splitYear).map(r => ({ ...r, i })));
  for (const a of pieces) for (const b of pieces) {
    if (a.i < b.i && a.start <= b.end && b.start <= a.end) { errors.push(`${where} seasons[${a.i + 1}] and seasons[${b.i + 1}] overlap. Each day should be in one season at most`); return; }
  }
}

// "Jun 1 – Jul 31" -> "Jun – Jul"; "Aug 1 – Sep 15" -> "Aug – Mid Sep"; "Sep 21 – Oct 10" -> "Late Sep – Early Oct"
// The 1st (or the last day) of a month is just the month; otherwise days 1–10 are Early, 11–20 Mid, 21 on Late.
const MONTH_NAME = m => MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1);
const part = d => d <= 10 ? 'Early' : d <= 20 ? 'Mid' : 'Late';
export function rangeLabel({ start, end }) {
  const [m1, d1] = start.split('-').map(Number), [m2, d2] = end.split('-').map(Number);
  const last = m => m === 2 ? 28 : DAYS_IN[m - 1];
  if (m1 === m2 && start <= end) {
    if (d1 === 1 && d2 >= last(m2)) return MONTH_NAME(m1);
    const a = part(d1), b = d2 >= last(m2) ? 'Late' : part(d2);
    return a === b ? `${a} ${MONTH_NAME(m1)}` : `${a}–${b.toLowerCase()} ${MONTH_NAME(m1)}`;
  }
  const from = (d1 === 1 ? '' : part(d1) + ' ') + MONTH_NAME(m1);
  const to = (d2 >= last(m2) ? '' : part(d2) + ' ') + MONTH_NAME(m2);
  return `${from} – ${to}`;
}

// The When to go list built from the header: one item per date range, in date order (an entry with
// several ranges shows once per range, with the same notes). Each item's source is its own "source:",
// or the trip's "seasons source:".
function whenToGo(entries, tripSource = '') {
  const TAG = { peak: 'Peak', shoulder: 'Shoulder', off: '' };
  return entries.flatMap(e => e.ranges.map(r => ({ r, e })))
    .sort((a, b) => a.r.start.localeCompare(b.r.start))
    .map(({ r, e }) => ({ label: rangeLabel(r), tag: TAG[e.type], notes: e.notes, source: e.source || tripSource }));
}

function normRelease(r, where, errors) {
  try {
    const opens = parseRange(r.opens);
    const out = { start: opens.start, end: opens.end };
    if (r.for) {
      const cov = parseRange(r.for);
      out.covers = cov;
      if (opens.start > cov.start) out.year = 'prior';   // e.g. opens Dec 1 for Jan–Jun trips
    }
    if (r.note) out.when = r.note;
    return out;
  } catch (e) { errors.push(`${where}: ${e.message}`); return null; }
}

function normChannel(c, i, errors, where) {
  const w = `${where} permit.channels[${i + 1}]`;
  if (!c || !c.label) { errors.push(`${w}: needs a "label" (e.g. Reservations, Lottery, Walk-up)`); return null; }
  const base = { what: c.label, share: c.share, lottery: !!c.lottery, idle: c.idle };
  if (c.before != null) {
    try {
      const b = parseBefore(c.before);
      const out = { ...base, type: 'rolling', daysBefore: toDays(b),
        when: c.note || (b.n === 0 ? 'day of' : `${c.before} before`) };
      if (c.every) {
        if (!['week', 'month'].includes(c.every)) throw new Error(`"every: ${c.every}" should be "week" or "month"`);
        if (b.unit !== c.every) throw new Error(`with "every: ${c.every}", write "before" in ${c.every}s`);
        out.period = c.every; out.periodsBefore = b.n;
      }
      return out;
    } catch (e) { errors.push(`${w}: ${e.message}`); return null; }
  }
  const list = c.releases || (c.opens ? [{ opens: c.opens, for: c.for, note: c.note }] : null);
  if (!list) { errors.push(`${w}: add "before" (rolling, e.g. 90 days) or "opens" (a calendar date)`); return null; }
  const releases = list.map((r, j) => normRelease(r, `${w} releases[${j + 1}]`, errors)).filter(Boolean);
  return { ...base, type: 'fixed', when: c.note || '', releases };
}

export function normalizeTrip(data, file, regions) {
  const errors = [];
  const where = file;
  if (!data.name) errors.push(`${where}: missing "name"`);
  if (!data.region) errors.push(`${where}: missing "region"`);
  else if (regions && !regions.includes(data.region)) errors.push(`${where}: region "${data.region}" isn't one of: ${regions.join(', ')} (add new ones in _data/site.json)`);
  if (data.map != null) errors.push(`${where}: "map" is now called "park" (same value: the park or wilderness name as on openstreetmap.org)`);
  if (data.map_trails != null) errors.push(`${where}: "map_trails" isn't used any more. A trip with "route:" and "gpx:" shows just that route; delete the line`);
  if (data.park != null && (typeof data.park !== 'string' || !data.park.trim())) errors.push(`${where}: "park" should be the name of a park or wilderness, like "Desolation Wilderness"`);
  if (data['route link'] != null && !/^https?:\/\/\S+$/.test(String(data['route link']).trim())) errors.push(`${where}: "route link" should be a web address starting with https://`);
  if (data['status link'] != null && !/^https?:\/\/\S+$/.test(String(data['status link']).trim())) errors.push(`${where}: "status link" should be a web address starting with https://`);
  if (data['map shows'] != null) {
    const bad = (mapShows(data['map shows']) || []).filter(w => w.bad).map(w => `"${w.bad}"`);
    if (bad.length) errors.push(`${where}: "map shows" doesn't know ${bad.join(', ')} (use: ${Object.keys(MAP_WORDS).join(', ')})`);
  }
  if (data.within != null && (typeof data.within !== 'string' || !data.within.trim())) errors.push(`${where}: "within" should be the forest or park the trip is in, like "Stanislaus National Forest"`);
  if (data.route != null && (typeof data.route !== 'string' || !data.route.trim())) errors.push(`${where}: "route" should be the route's name, like "Rim to Rim"`);
  if (data.route != null && data.routes != null) errors.push(`${where}: use "route" + "gpx" for a trip that is one route, or "routes" for a list of routes, not both`);
  if (data.gpx != null && data.route == null) errors.push(`${where}: "gpx" goes with "route" (the route's name); add a route: line`);
  if (data.gpx != null && !/^tracks\/[^/]+\.gpx$/i.test(String(data.gpx).trim())) errors.push(`${where}: gpx "${data.gpx}" should be a GPX file in the tracks folder, like tracks/rim-to-rim.gpx`);
  checkPlaces(data.trailheads, 'trailheads', where, errors, v => parseLatLon(v) ? '' : `"${v}" should be latitude, longitude, like 38.8466, -120.2353`);
  checkPlaces(data.camps, 'camps', where, errors, v => parseLatLon(v) ? '' : `"${v}" should be latitude, longitude, like 38.8466, -120.2353`);
  checkPlaces(data.links, 'links', where, errors, v => /^https?:\/\/\S+$/.test(String(v).trim()) ? '' : `"${v}" should be a web address starting with https://`);
  checkPlaces(data.routes, 'routes', where, errors, v => /^tracks\/[^/]+\.gpx$/i.test(String(v).trim()) ? '' : `"${v}" should be a GPX file in the tracks folder, like tracks/rockbound-pass.gpx`);
  const permit = data.permit || {};
  if (permit.difficulty != null && ![0, 1, 2, 3].includes(permit.difficulty)) errors.push(`${where}: permit.difficulty should be 0, 1, 2 or 3`);
  if (data['seasons source'] != null && typeof data['seasons source'] !== 'string') errors.push(`${where}: "seasons source" should be one line: a name and/or a web address, like Exploring Wild https://exploringwild.com/...`);
  const entries = (data.seasons || []).map((s, i) => normSeason(s, i, errors, where)).filter(Boolean);
  overlaps(entries, where, errors);
  const seasons = chartSeasons(entries);
  const permits = (permit.channels || []).map((c, i) => normChannel(c, i, errors, where)).filter(Boolean);
  return {
    errors,
    chart: {
      name: data.short || data.name, group: data.region, rule: permit.note || '',
      difficulty: permit.difficulty || 0, difficultyNote: permit.why || '',
      status: data.status || '', seasons, permits
    },
    whenToGo: whenToGo(entries, typeof data['seasons source'] === 'string' ? data['seasons source'].trim() : '')
  };
}

// trailheads: / routes: are "Name: value" lines
function checkPlaces(list, field, where, errors, check) {
  if (list == null) return;
  if (typeof list !== 'object' || Array.isArray(list)) { errors.push(`${where}: "${field}" should be a list of "Name: value" lines, each indented under ${field}:`); return; }
  for (const [name, v] of Object.entries(list)) { const e = check(v); if (e) errors.push(`${where} ${field} "${name}": ${e}`); }
}

// "Mar–May", "mid Sep–Oct" for the peak seasons of a trip
export function bestSeason(seasons) {
  const label = (md, end) => {
    const [m, d] = md.split('-').map(Number), name = MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1);
    if (!end) return (d <= 7 ? '' : d <= 20 ? 'mid ' : 'late ') + name;
    return (d >= 24 ? '' : d >= 11 ? 'mid ' : 'early ') + name;
  };
  return seasons.filter(s => s.type === 'peak').map(s => `${label(s.start)}–${label(s.end, true)}`).join(', ');
}

// A trip's GPX routes as { name: file }: the one "route" + "gpx", or the "routes" list
export function tripRoutes(data) {
  if (data.route != null) return data.gpx ? { [String(data.route).trim()]: String(data.gpx).trim() } : {};
  return data.routes && typeof data.routes === 'object' && !Array.isArray(data.routes) ? data.routes : {};
}

// Route names are matched to link text in the notes ignoring case, spacing, bold/italics and dashes
export const routeKey = s => String(s ?? '').replace(/<[^>]*>|[*_]/g, '').replace(/&amp;/g, '&').replace(/[–—-]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
