
const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DIM = [31,28,31,30,31,30,31,31,30,31,30,31];
const ROW = 40, LANE0 = 50, LANE = 34, MIN = -12, MAX = 12;
let DATA = null, TRIPS = [], OPTS = {};

/* Positions are in months: 0 = Jan 1 of the trip year, -12 = Jan 1 of the previous year */
/* Prior Jan–Sep is squeezed into a narrow strip; prior Oct–Dec and the trip year are full scale */
const BRK = -3, CW = 1.1, SPAN = CW + (MAX - BRK);
const P = v => (v < BRK ? (v - MIN) / (BRK - MIN) * CW : CW + (v - BRK)) / SPAN * 100;
const daysToM = d => d / 30.44;
function pos(md, isEnd) {
  const [m, d] = md.split('-').map(Number);
  const dd = Math.min(d, DIM[m - 1]);
  return (m - 1) + (isEnd ? dd : dd - 1) / DIM[m - 1];
}
function fmt(x) { const w = ((x % 12) + 12) % 12, i = Math.floor(w); return MN[i] + ' ' + Math.min(DIM[i], Math.floor((w - i) * DIM[i] + 1e-6) + 1); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const laneY = i => LANE0 + i * LANE;

/* Labels for shoulder-season reasons */
const ICONS = {
  hot: { label: 'Hot' }, dry: { label: 'Dry, little water' }, rain: { label: 'Rain' }, cold: { label: 'Cold' },
  wind: { label: 'Windy' }, fog: { label: 'Fog' }, wet: { label: 'Wet trails' }, bugs: { label: 'Bugs' },
  snow: { label: 'Snow' }, water: { label: 'High water, flooding' }, crowds: { label: 'Crowds' }
};

function relOf(r) {
  const off = r.year === 'prior' ? -12 : 0;
  return { a: pos(r.start, false) + off, b: pos(r.end || r.start, true) + off,
           cov: r.covers ? [pos(r.covers.start, false), pos(r.covers.end, true)] : null, when: r.when };
}

function prep(t) {
  const seasons = (t.seasons || []).map(s => ({ type: s.type, a: pos(s.start, false), b: pos(s.end, true), tags: s.tags || [] }));
  const permits = (t.permits || []).map(p => p.type === 'fixed'
    ? { ...p, rel: (p.releases || [p]).map(relOf) }
    : { ...p, shift: p.period === 'month' ? p.periodsBefore : p.period === 'week' ? p.periodsBefore * 7 / 30.44 : daysToM(p.daysBefore || 0) });
  permits.forEach(p => { if (p.type === 'fixed') p.rel.forEach(r => {
    const c = r.cov || [-99, 99];
    const hit = seasons.filter(s => s.a < c[1] && s.b > c[0]);
    r.k = hit.some(s => s.type === 'peak') ? 'peak' : hit.length ? 'shoulder' : null;
  }); });
  return { ...t, seasons, permits };
}

/* Bands for one permit: fixed = its own dates; rolling = every season shifted back, colored by season type */
function bandsFor(t, p) {
  let out = p.type === 'fixed'
    ? p.rel.flatMap((r, j) => {
        return r.k ? [{ a: r.a, b: Math.max(r.b, r.a + 0.16), k: r.k, j }] : [];
      })
    : p.period === 'month'
      ? t.seasons.map(s => ({ a: Math.floor(s.a) - p.shift, b: Math.ceil(s.b - 1e-6) - p.shift, k: s.type }))
      : t.seasons.map(s => ({ a: s.a - p.shift, b: s.b - p.shift, k: s.type }));
  let over = false;
  out.forEach(b => b.lot = !!p.lottery && b.k !== 'window');
  out = out.filter(b => { if (b.b <= MIN) { over = true; return false; } if (b.a < MIN) { over = true; b.a = MIN; } return true; });
  return { bands: out, over };
}

function bandHTML(t, p, y, h) {
  const { bands, over } = bandsFor(t, p);
  let s = bands.map(b => { const hh = h; return `<div class="bd ${b.k}${b.lot ? ' lot' : ''}"${b.j !== undefined ? ` data-j="${b.j}"` : ''} style="top:${y - hh / 2}px;height:${hh}px;left:${P(b.a)}%;width:${P(b.b) - P(b.a)}%"></div>`; }).join('');
  if (over) s += `<div class="ovf" style="top:${y + 8}px">‹ 1+ yr out</div>`;
  return s;
}

const LEVELS = ['', 'Book ahead', 'Competitive', 'Very hard'];
const dotsHTML = (n, cls) => [1, 2, 3].map(i => `<i class="${i > n ? 'o' : ''}"></i>`).join('');
function diffHTML(t) {
  if (!t.difficulty) return '';
  return `<span class="dots" tabindex="0" aria-label="Permit difficulty: ${LEVELS[t.difficulty]}">${dotsHTML(t.difficulty)}<span class="tip">${LEVELS[t.difficulty]}${t.difficultyNote ? ' · ' + esc(t.difficultyNote) : ''}</span></span>`;
}

function laneText(p, when) { if (when == null && p.idle) return esc(p.idle); return `<b>${esc(p.what)}</b> · ${esc(when ?? p.when)}${p.share ? ' (' + esc(p.share) + ')' : ''}`; }

const NOW = new Date();
const TODAY = NOW.getMonth() + (NOW.getDate() - 1) / DIM[NOW.getMonth()];
const TODAYS = TODAY - 12 >= BRK ? [TODAY - 12, TODAY] : [TODAY];

function gridHTML() {
  let g = `<div class="pz" style="width:${P(0)}%"></div><div class="cz" style="width:${P(BRK)}%"></div>`;
  for (let i = BRK + 1; i <= MAX; i++) g += `<div class="g${i === 0 ? ' yr' : ''}" style="left:${P(i)}%"></div>`;
  TODAYS.forEach(v => g += `<div class="td" style="left:${P(v)}%"></div>`);
  return g;
}

function render(data, opts = {}) {
  DATA = data; OPTS = opts; TRIPS = (data.trips || []).map(prep);
  let html = '';
  TRIPS.forEach((t, ri) => {
    let g = gridHTML();
    t.seasons.forEach(s => {
      const why = s.tags.map(k => ICONS[k]?.label).filter(Boolean).join(', ');
      g += `<div class="sg ${s.type}" style="left:${P(s.a)}%;width:${P(s.b) - P(s.a)}%" title="${esc(t.name)}: ${s.type} ${fmt(s.a)} – ${fmt(s.b - 0.001)}${why ? ' · ' + why : ''}"></div>`;
    });
    const cmp = t.permits.filter((p, i) => i === 0 || p.compact).map(p => bandHTML(t, p, 30, 4)).join('');
    let det = t.permits.map((p, i) => `<div id="ln${ri}_${i}">${bandHTML(t, p, laneY(i), 6)}</div>`).join('');
    det += `<svg class="cn" id="cn${ri}"></svg><div id="dy${ri}"></div>`;
    let ll = `<div class="c cmp">${esc(t.rule)}</div><div class="c det sw" id="sw${ri}"></div><div class="d det">`;
    t.permits.forEach((p, i) => ll += `<div class="lane one" style="top:${laneY(i)}px"><span class="lt" id="lt${ri}_${i}">${laneText(p)}</span><span class="lv" id="lv${ri}_${i}"></span></div>`);
    ll += '</div>';
    const H = t.permits.length ? laneY(t.permits.length - 1) + 32 : ROW;
    if (OPTS.groups !== false && t.group && (ri === 0 || TRIPS[ri - 1].group !== t.group)) html += `<div class="gh">${esc(t.group)}</div>`;
    html += `<div class="r" tabindex="0" data-r="${ri}" data-h="${H}"><div class="nm">${OPTS.link !== false && t.url ? `<a class="tn" href="${esc(t.url)}">${esc(t.name)}</a>` : `<span class="tn">${esc(t.name)}</span>`}${diffHTML(t)}</div><div class="tr">${g}<div class="cmp">${cmp}</div><div class="det">${det}</div></div><div class="ll">${ll}</div></div>`;
  });
  document.getElementById('rows').innerHTML = html;

  let tk = `<span class="p" style="left:${P((MIN + BRK) / 2)}%;font-size:10px">Jan–Sep</span>`;
  for (let i = BRK; i < MAX; i++) tk += `<span class="${i < 0 ? 'p' : ''}" style="left:${P(i + 0.5)}%">${MN[(i + 12) % 12]}</span>`;
  const hp = document.getElementById('hdPrev'), ht = document.getElementById('hdTrip');
  hp.style.left = P(0) / 2 + '%'; ht.style.left = (P(0) + 100) / 2 + '%';
  const yrs = document.querySelector('.hdr .yrs');
  yrs.querySelectorAll('.tdl').forEach(e => e.remove());
  TODAYS.forEach((v, n) => yrs.insertAdjacentHTML('beforeend', `<span class="tdl" style="left:${P(v)}%">Today</span>`));
  document.getElementById('tk').innerHTML = tk;
  wire();
  if (OPTS.alwaysOpen) document.querySelectorAll('.r').forEach(r => setOpen(r, true));
}

/* Lottery windows snap to calendar periods: trips in the same month (or week) share one window */
const CUM = DIM.reduce((acc, d, i) => (acc.push(acc[i] + d), acc), [0]);
const toDay = x => { const m = Math.floor(x); return CUM[m] + (x - m) * DIM[m]; };
function fromDay(d) {
  if (d < 0) return fromDay(d + 365) - 12;
  const m = Math.min(11, CUM.findIndex(c => c > d) - 1);
  return m + (d - CUM[m]) / DIM[m];
}
function lotteryWindow(p, x) {
  if (p.period === 'month') { const m = Math.floor(x) - p.periodsBefore; return [m, m + 1]; }
  const wk = Math.floor(toDay(x) / 7), d0 = (wk - p.periodsBefore) * 7;
  return [fromDay(d0), fromDay(d0 + 7)];
}

function inSeason(t, x) { return t.seasons.some(s => x >= s.a && x <= s.b); }

function relRange(r) {
  const startF = fmt(r.a), endF = fmt(r.b - 0.001);
  if (r.b - r.a <= 0.1) return startF;
  return startF + '–' + (endF.split(' ')[0] === startF.split(' ')[0] ? endF.split(' ')[1] : endF);
}

function show(ri, x) {
  const t = TRIPS[ri], row = document.querySelector(`.r[data-r="${ri}"]`), W = row.querySelector('.tr').clientWidth;
  const cn = document.getElementById('cn' + ri), dy = document.getElementById('dy' + ri);
  const active = inSeason(t, x);
  t.permits.forEach((p, i) => {
    document.getElementById(`lv${ri}_${i}`).textContent = '';
    document.getElementById(`lt${ri}_${i}`).innerHTML = laneText(p);
    document.querySelectorAll(`#ln${ri}_${i} .bd`).forEach(b => b.classList.remove('dim'));
  });
  const se = t.seasons.find(q => x >= q.a && x <= q.b), sw = document.getElementById('sw' + ri);
  sw.innerHTML = !se ? '' : se.type === 'peak' ? '<b class="pk">Peak season</b>'
    : '<b class="sh">Shoulder</b>' + (se.tags.length ? ' · ' + se.tags.map(k => (ICONS[k]?.label || k).toLowerCase()).join(', ') : '');
  if (!active) { cn.innerHTML = ''; dy.innerHTML = ''; return; }
  let s = '', h = `<div class="trip" style="left:${P(x)}%"></div><div class="tl" style="top:28px;left:${P(x)}%;${x > 10 ? 'transform:translateX(-100%);margin-left:-5px' : 'margin-left:5px'}">${fmt(x)} trip</div>`;
  const link = (bx, y) => {
    const X1 = P(bx) / 100 * W, X2 = P(x) / 100 * W;
    s += `<path d="M${X1} ${y} C ${X1} ${y - 14}, ${X2} ${y - 10}, ${X2} 27" fill="none" stroke-width="1.2" stroke-dasharray="3 3" opacity=".7"/>`;
    h += `<div class="dot" style="left:${P(bx)}%;top:${y}px"></div>`;
  };
  /* Lottery: a shaded funnel joins the whole application window to the trip date */
  const linkSpan = (a, b, y, mark) => {
    if (P(b) - P(a) < 0.6) return link(a, y);
    const A = P(a) / 100 * W, B = P(b) / 100 * W, X2 = P(x) / 100 * W, top = y - 5;
    s += `<path d="M${A} ${top} C ${A} ${top - 12}, ${X2} ${top - 8}, ${X2} 27 C ${X2} ${top - 8}, ${B} ${top - 12}, ${B} ${top} Z" class="fun"/>`;
    s += `<path d="M${A} ${top} C ${A} ${top - 12}, ${X2} ${top - 8}, ${X2} 27 C ${X2} ${top - 8}, ${B} ${top - 12}, ${B} ${top}" fill="none" stroke-width="1.2" stroke-dasharray="3 3" opacity=".7"/>`;
    if (mark) h += `<div class="bd peak lot sel" style="top:${y - 4}px;height:8px;left:${P(a)}%;width:${P(b) - P(a)}%"></div>`;
  };
  t.permits.forEach((p, i) => {
    const y = laneY(i), out = document.getElementById(`lv${ri}_${i}`);
    if (p.type === 'fixed') {
      const j = p.rel.findIndex(r => !r.cov || (x >= r.cov[0] && x <= r.cov[1]));
      document.querySelectorAll(`#ln${ri}_${i} .bd`).forEach(b => b.classList.toggle('dim', +b.dataset.j !== j));
      if (j < 0) { out.textContent = 'n/a'; return; }
      const r = p.rel[j];
      if (r.when) document.getElementById(`lt${ri}_${i}`).innerHTML = laneText(p, r.when);
      if (p.lottery) linkSpan(r.a, r.b, y); else link(r.a, y);
      const wholeMonth = Math.abs(r.a - Math.round(r.a)) < 0.01 && Math.abs(r.b - r.a - 1) < 0.01;
      out.textContent = (p.lottery ? 'apply ' + relRange(r)
        : 'opens ' + (wholeMonth ? 'in ' + MN[(Math.round(r.a) + 12) % 12] : fmt(r.a))) + (r.a < 0 ? ' prev yr' : '');
      return;
    }
    const raw = x - p.shift, far = raw < MIN, bx = far ? MIN : raw;
    if (p.lottery && p.period) {
      const [wa, wb] = lotteryWindow(p, x);
      if (wb > MIN) linkSpan(Math.max(MIN, wa), wb, y, true);
      out.textContent = 'apply ' + relRange({ a: wa, b: wb }) + (wa < MIN ? ' 1+ yr out' : wa < 0 ? ' prev yr' : '');
      return;
    }
    link(bx, y);
    out.textContent = p.daysBefore === 0 ? 'day of' : (p.lottery ? 'apply ' : 'opens ') + fmt(raw) + (far ? ' 1+ yr out' : raw < 0 ? ' prev yr' : '');
  });
  cn.innerHTML = s; dy.innerHTML = h;
}

function setOpen(row, on) {
  const ri = +row.dataset.r, t = TRIPS[ri];
  if (OPTS.alwaysOpen) on = true;
  row.classList.toggle('open', on);
  row.style.height = on ? row.dataset.h + 'px' : ROW + 'px';
  if (on) {
    const first = t.seasons.find(s => s.type === 'peak') || t.seasons[0];
    if (first) show(ri, first.a + Math.min(0.25, (first.b - first.a) / 2));
  }
}

function wire() {
  document.querySelectorAll('.r').forEach(row => {
    const ri = +row.dataset.r, tr = row.querySelector('.tr');
    row.querySelectorAll('.sg').forEach(bar => bar.addEventListener('mouseenter', () => { if (!row.classList.contains('open')) setOpen(row, true); }));
    row.addEventListener('mouseleave', () => setOpen(row, false));
    row.addEventListener('focus', () => setOpen(row, true));
    row.addEventListener('blur', () => setOpen(row, false));
    row.addEventListener('click', e => { if (e.pointerType === 'touch') setOpen(row, !row.classList.contains('open')); });
    tr.addEventListener('mousemove', e => {
      if (!row.classList.contains('open')) return;
      const r = tr.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width * SPAN;
      show(ri, u < CW ? MIN + u / CW * (BRK - MIN) : BRK + (u - CW));
    });
  });
}

/* PNG export: the compact view as a light-theme SVG, rasterized at 2x */
function exportSVG() {
  const W = 1400, L = 200, R = 300, top = 84, rowH = 40, cw = W - L - R;
  const GH = 26, ys = []; let acc = top;
  TRIPS.forEach((t, r) => { if (OPTS.groups !== false && t.group && (r === 0 || TRIPS[r - 1].group !== t.group)) acc += GH; ys.push(acc); acc += rowH; });
  const bottom = acc, H = bottom + 84;
  const x = v => L + P(v) / 100 * cw;
  const col = { peak: '#5a9a2a', shoulder: '#efa22e', bpeak: '#6fa6e0', bshoulder: '#c4dbf4', fixed: '#1f5fa8',
    grid: '#e9ece4', line: '#dde1d7', divider: '#b9bfb1', prior: '#f3f5f0', text: '#1c211a', muted: '#62695e', faint: '#8b9286' };
  const bandCol = k => k === 'fixed' || k === 'window' ? col.fixed : k === 'peak' ? col.bpeak : col.bshoulder;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif">`;
  s += `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse"><rect x="4" width="2" height="6" fill="#ffffff"/></pattern></defs>`;
  s += `<rect width="${W}" height="${H}" fill="#ffffff"/>`;
  s += `<text x="${W / 2}" y="36" text-anchor="middle" font-size="19" font-weight="600" fill="${col.text}">${esc(DATA.title || '')}</text>`;
  s += `<text x="${x(MIN) / 2 + x(0) / 2}" y="${top - 10}" text-anchor="middle" font-size="11" fill="${col.faint}">Previous year</text>`;
  s += `<text x="${x(0) / 2 + x(MAX) / 2}" y="${top - 10}" text-anchor="middle" font-size="11" fill="${col.faint}">Trip year</text>`;
  s += `<rect x="${x(MIN)}" y="${top}" width="${x(0) - x(MIN)}" height="${bottom - top}" fill="${col.prior}"/>`;
  s += `<rect x="${x(MIN)}" y="${top}" width="${x(BRK) - x(MIN)}" height="${bottom - top}" fill="${col.grid}"/>`;
  for (let i = BRK; i <= MAX; i++) s += `<line x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${bottom}" stroke="${i === 0 ? col.divider : col.grid}"/>`;
  TRIPS.forEach((t, r) => {
    const y = ys[r];
    if (OPTS.groups !== false && t.group && (r === 0 || TRIPS[r - 1].group !== t.group)) {
      s += `<rect x="0" y="${y - GH}" width="${W}" height="${GH}" fill="#ffffff"/><line x1="0" x2="${W}" y1="${y - GH}" y2="${y - GH}" stroke="${col.line}"/>`;
      s += `<text x="14" y="${y - 8}" font-size="11" font-weight="600" letter-spacing=".7" fill="${col.faint}">${esc(t.group.toUpperCase())}</text>`;
    }
    s += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="${col.line}"/>`;
    s += `<text x="${L - 46}" y="${y + 22}" text-anchor="end" font-size="13" fill="${col.text}">${esc(t.name)}</text>`;
    if (t.difficulty) [0, 1, 2].forEach(i => s += i < t.difficulty
      ? `<circle cx="${L - 36 + i * 9}" cy="${y + 18}" r="3" fill="${col.muted}"/>`
      : `<circle cx="${L - 36 + i * 9}" cy="${y + 18}" r="2.5" fill="none" stroke="${col.faint}"/>`);
    t.seasons.forEach(se => {
      const sx = x(se.a), sw = x(se.b) - x(se.a);
      s += `<rect x="${sx}" y="${y + 11}" width="${sw}" height="12" rx="2" fill="${col[se.type] || col.peak}"/>`;
    });
    const ps = t.permits.filter((p, i) => i === 0 || p.compact);
    ps.forEach(p => {
      const { bands, over } = bandsFor(t, p);
      bands.forEach(b => {
        const bw = Math.max(x(b.b) - x(b.a), 2), by = y + 28, bh = 4;
        s += `<rect x="${x(b.a)}" y="${by}" width="${bw}" height="${bh}" rx="2" fill="${bandCol(b.k)}"${b.k === 'window' ? ' fill-opacity=".3"' : ''}/>`;
        if (b.lot) s += `<rect x="${x(b.a)}" y="${by}" width="${bw}" height="${bh}" rx="2" fill="url(#hatch)"/>`;
      });
      if (over) s += `<text x="${x(MIN) + 3}" y="${y + 38}" font-size="10" fill="${col.fixed}">‹ 1+ yr out</text>`;
    });
    s += `<text x="${L + cw + 14}" y="${y + 22}" font-size="12" fill="${col.muted}">${esc(t.rule)}</text>`;
  });
  s += `<line x1="0" x2="${W}" y1="${bottom}" y2="${bottom}" stroke="${col.line}"/>`;
  s += `<text x="${x((MIN + BRK) / 2)}" y="${bottom + 18}" text-anchor="middle" font-size="10" fill="${col.faint}">Jan–Sep</text>`;
  for (let i = BRK; i < MAX; i++) s += `<text x="${x(i + .5)}" y="${bottom + 18}" text-anchor="middle" font-size="11" fill="${i < 0 ? col.faint : col.muted}">${MN[(i + 12) % 12]}</text>`;
  const items = [[col.peak, 12, 8, 'Peak'], [col.shoulder, 12, 8, 'Shoulder'], [col.bpeak, 16, 4, 'Book for peak'], [col.bshoulder, 16, 4, 'Book for shoulder'], ['lot', 18, 4, 'Lottery: apply during window']];
  TODAYS.forEach((v, n) => {
    s += `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${bottom}" stroke="#c2412d" stroke-width="1" stroke-dasharray="3 3" stroke-opacity=".55"/>`;
    s += `<text x="${x(v)}" y="${bottom + 34}" text-anchor="middle" font-size="11" fill="#c2412d">Today</text>`;
  });
  let lx = L, ly = bottom + 62;
  items.forEach(([c, w, h, label]) => {
    if (c === 'lot') s += `<rect x="${lx}" y="${ly - 4 - h / 2}" width="${w}" height="${h}" rx="2" fill="${col.bpeak}"/><rect x="${lx}" y="${ly - 4 - h / 2}" width="${w}" height="${h}" rx="2" fill="url(#hatch)"/>`;
    else s += `<rect x="${lx}" y="${ly - 4 - h / 2}" width="${w}" height="${h}" rx="2" fill="${c}"/>`;
    s += `<text x="${lx + w + 6}" y="${ly}" font-size="12" fill="${col.muted}">${label}</text>`;
    lx += w + 6 + label.length * 6.6 + 22;
  });
  [[3, 'Very hard'], [2, 'Competitive'], [1, 'Book ahead']].forEach(([n, label]) => {
    [0, 1, 2].forEach(i => s += i < n ? `<circle cx="${lx + 3 + i * 9}" cy="${ly - 4}" r="3" fill="${col.muted}"/>` : `<circle cx="${lx + 3 + i * 9}" cy="${ly - 4}" r="2.5" fill="none" stroke="${col.faint}"/>`);
    s += `<text x="${lx + 30}" y="${ly}" font-size="12" fill="${col.muted}">${label}</text>`;
    lx += 30 + label.length * 6.6 + 22;
  });
  return { svg: s + '</svg>', W, H };
}

function makePng() {
  if (!TRIPS.length) return;
  const { svg, W, H } = exportSVG(), scale = 2;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = W * scale; c.height = H * scale;
    const g = c.getContext('2d'); g.scale(scale, scale); g.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    document.getElementById('pngImg').src = c.toDataURL('image/png');
    const out = document.getElementById('pngOut'); out.hidden = false;
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  img.src = url;
}

const pngBtn = document.getElementById('png');
if (pngBtn) pngBtn.addEventListener('click', makePng);
window.addEventListener('resize', () => document.querySelectorAll('.r.open').forEach(r => setOpen(r, true)));
const dataEl = document.getElementById('chart-data');
if (dataEl) render(JSON.parse(dataEl.textContent), JSON.parse(dataEl.dataset.options || '{}'));
