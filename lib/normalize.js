// Turns the friendly trip-file format into the data the chart and pages use,
// and collects readable errors for anything it can't understand.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS_IN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const REASONS = {
  hot: 'Hot', dry: 'Dry, little water', rain: 'Rain', cold: 'Cold', wind: 'Windy', fog: 'Fog',
  wet: 'Wet trails', bugs: 'Bugs', snow: 'Snow', water: 'High water, flooding', crowds: 'Crowds'
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

function normSeason(s, i, errors, where) {
  const keys = Object.keys(s || {}).filter(k => k === 'peak' || k === 'shoulder');
  if (keys.length !== 1) { errors.push(`${where} seasons[${i + 1}]: start the line with "peak:" or "shoulder:"`); return null; }
  try {
    const { start, end } = parseRange(s[keys[0]]);
    const tags = [].concat(s.why || []);
    tags.forEach(t => { if (!REASONS[t]) errors.push(`${where} seasons[${i + 1}]: unknown reason "${t}" (use: ${Object.keys(REASONS).join(', ')})`); });
    return { type: keys[0], start, end, tags };
  } catch (e) { errors.push(`${where} seasons[${i + 1}]: ${e.message}`); return null; }
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
  const permit = data.permit || {};
  if (permit.difficulty != null && ![0, 1, 2, 3].includes(permit.difficulty)) errors.push(`${where}: permit.difficulty should be 0, 1, 2 or 3`);
  const seasons = (data.seasons || []).map((s, i) => normSeason(s, i, errors, where)).filter(Boolean);
  const permits = (permit.channels || []).map((c, i) => normChannel(c, i, errors, where)).filter(Boolean);
  return {
    errors,
    chart: {
      name: data.short || data.name, group: data.region, rule: permit.note || '',
      difficulty: permit.difficulty || 0, difficultyNote: permit.why || '',
      status: data.status || '', seasons, permits
    }
  };
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
