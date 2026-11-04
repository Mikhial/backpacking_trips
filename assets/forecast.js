// Weather forecast table on trip pages: the NWS 7-day forecast for a few places along each route
// (start, high point, camps, end), fetched live from api.weather.gov when the page opens.
(function () {
  const box = document.getElementById('forecast');
  if (!box) return;
  const routes = JSON.parse(box.querySelector('.fc-data').textContent);
  const table = box.querySelector('table.fc'), tabs = box.querySelector('.fc-tabs'), when = box.querySelector('.fc-when');
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmt = n => n.toLocaleString('en-US');
  const nwsPage = at => `https://forecast.weather.gov/MapClick.php?lat=${at[0]}&lon=${at[1]}`;

  // JSON from the NWS API, retried a couple of times (it sometimes answers 500 at first).
  // A preview build can swap in a saved copy of the responses (data-snapshot).
  const snapshot = box.dataset.snapshot ? fetch(box.dataset.snapshot).then(r => r.json()) : null;
  const cache = new Map();
  const getJSON = url => {
    if (!cache.has(url)) cache.set(url, snapshot
      ? snapshot.then(s => { if (!s[url]) throw new Error('missing'); return s[url]; })
      : (async () => {
        for (let i = 0; ; i++) {
          try {
            const r = await fetch(url, { headers: { Accept: 'application/geo+json' } });
            if (r.ok) return r.json();
            if (i >= 2 || r.status < 500) throw new Error(r.status);
          } catch (e) { if (i >= 2) throw e; }
          await new Promise(res => setTimeout(res, 800 * (i + 1)));
        }
      })());
    return cache.get(url);
  };
  const forecastFor = at => getJSON(`https://api.weather.gov/points/${at[0]},${at[1]}`).then(p => getJSON(p.properties.forecast));

  // One table cell per day: high / low, then rain or snow chance and strong wind if any
  const maxNum = s => Math.max(0, ...(String(s || '').match(/\d+/g) || []).map(Number));
  const kindOf = t => /thunder|t-storm/i.test(t) ? 'storms' : /snow|flurr|sleet|ice/i.test(t) ? 'snow' : /rain|shower|drizzle/i.test(t) ? 'rain' : 'precip';
  const days = periods => {
    const out = new Map();
    periods.forEach(p => {
      const d = p.startTime.slice(0, 10);
      if (!out.has(d)) out.set(d, {});
      out.get(d)[p.isDaytime ? 'day' : 'night'] = p;
    });
    return out;
  };
  const cell = ({ day, night } = {}) => {
    if (!day && !night) return '<td></td>';
    const ps = [day, night].filter(Boolean);
    const wet = ps.reduce((a, p) => ((p.probabilityOfPrecipitation || {}).value || 0) > ((a.probabilityOfPrecipitation || {}).value || 0) ? p : a, ps[0]);
    const pop = (wet.probabilityOfPrecipitation || {}).value || 0;
    const wind = Math.max(...ps.map(p => maxNum(p.windSpeed)));
    const t = (p, cls) => p ? `<span class="${cls}${p.temperature <= 32 ? ' frz' : p.temperature >= 90 ? ' hot' : ''}">${p.temperature}°</span>` : `<span class="${cls} none">–</span>`;
    const notes = [pop >= 20 ? `<span class="wx">${pop}% ${kindOf(wet.shortForecast)}</span>` : '', wind >= 20 ? `<span class="wx">wind ${wind}</span>` : ''].join('');
    const title = ps.map(p => `${p.name}: ${p.detailedForecast}`).join('\n\n');
    return `<td title="${esc(title)}"><span class="t">${t(day, 'hi')}${t(night, 'lo')}</span>${notes}</td>`;
  };

  // Row label: the place, linked to its full NWS forecast, with what it is and its elevation
  const label = pt => {
    const sub = pt.kind === 'High point' ? (pt.near ? `near ${pt.near}` : 'on the route')
      : pt.kind === 'On the route' ? (pt.near ? `near ${pt.near}` : 'on the route') : pt.kind;
    const also = pt.also ? ` <span class="also" title="${esc('Also covers ' + pt.also.join(', '))}">+${pt.also.length}</span>` : '';
    return `<th scope="row"><a href="${nwsPage(pt.at)}" target="_blank" rel="noopener">${esc(pt.n)}</a>${also}` +
      `<span class="sub">${esc(sub)}${pt.ft != null ? ` · <span class="el">${fmt(Math.round(pt.ft / 10) * 10)} ft</span>` : ''}</span></th>`;
  };

  let shown = -1;
  function show(i) {
    if (i === shown) return;
    shown = i;
    tabs.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
    const pts = routes[i].pts;
    table.innerHTML = `<thead><tr><th></th><th class="loading" colspan="7"></th></tr></thead><tbody>` +
      pts.map(pt => `<tr>${label(pt)}<td class="loading" colspan="7">Loading forecast…</td></tr>`).join('') + '</tbody>';
    const rows = [...table.tBodies[0].rows];
    let cols = null;
    const head = dates => {
      cols = dates;
      table.tHead.rows[0].innerHTML = '<th></th>' + dates.map(d => {
        const dt = new Date(d + 'T12:00:00');
        const wd = dt.toLocaleDateString('en-US', { weekday: 'short' }), we = dt.getDay() % 6 === 0;
        return `<th scope="col"${we ? ' class="we"' : ''}>${wd}<span>${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></th>`;
      }).join('');
    };
    // Fill rows in place order as each forecast arrives; the first one sets the day columns
    const loads = pts.map(pt => forecastFor(pt.at));
    loads.reduce((prev, load, k) => prev.then(() => load.then(f => {
      if (i !== shown) return;
      const byDay = days(f.properties.periods);
      if (!cols) head([...byDay.keys()].slice(0, 7));
      const grid = f.properties.elevation && f.properties.elevation.value;
      if (grid != null) {
        const el = rows[k].querySelector('.el');
        if (el) el.title = `NWS forecasts this spot for ${fmt(Math.round(grid * 3.28084 / 10) * 10)} ft, the average of its 2.5 km square`;
      }
      rows[k].innerHTML = rows[k].cells[0].outerHTML + cols.map(d => cell(byDay.get(d))).join('');
      const t = new Date(f.properties.updateTime || f.properties.generatedAt);
      if (!isNaN(t) && !when.textContent) when.textContent = `NWS forecast, updated ${t.toLocaleDateString('en-US', { weekday: 'short' })} ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
    }, () => {
      if (i !== shown) return;
      rows[k].cells[1].className = 'err';
      rows[k].cells[1].innerHTML = `Couldn't load this forecast. <a href="${nwsPage(pts[k].at)}" target="_blank" rel="noopener">Open it on weather.gov ↗</a>`;
    })), Promise.resolve()).then(() => {
      if (i === shown && !cols) table.tHead.rows[0].cells[1].textContent = '';
    });
  }

  if (routes.length > 1) {
    tabs.hidden = false;
    tabs.innerHTML = '<span class="tm-rl">Route</span>' + routes.map((r, i) => `<button type="button" aria-pressed="false">${esc(r.n)}</button>`).join('');
    tabs.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => show(i)));
  }
  show(0);
})();
