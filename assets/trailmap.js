// Trail map on trip pages: the trails in the area from OpenStreetMap on a USGS topo base.
// Click a trail to see its length, gain and elevation profile; hover the profile to follow it on the map.
(function () {
  const box = document.getElementById('trailmap');
  if (!box || !window.L) return;
  const M_TO_FT = 3.28084, M_TO_MI = 1 / 1609.344;
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const mi = m => (m * M_TO_MI).toFixed(m * M_TO_MI < 10 ? 1 : 0);
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const mapEl = box.querySelector('.tm-map'), info = box.querySelector('.tm-info'), prof = box.querySelector('.tm-prof');

  // Your own routes and trailheads from the trip header
  const extrasEl = box.querySelector('.tm-extras');
  const extras = extrasEl ? JSON.parse(extrasEl.textContent) : { trailheads: [], routes: [] };
  const empty = { boundary: [], trails: [], pois: [], bounds: null, fetched: null };
  if (box.dataset.src) fetch(box.dataset.src).then(r => r.json()).then(draw).catch(() => extrasEl ? draw(empty) : (box.hidden = true));
  else draw(empty);

  function draw(data) {
    const map = L.map(mapEl, { preferCanvas: true, scrollWheelZoom: false, zoomSnap: 0.5 });
    map.on('focus', () => map.scrollWheelZoom.enable());
    mapEl.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
    L.tileLayer(box.dataset.tiles || 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16, maxNativeZoom: +(box.dataset.tileZoom || 16),
      attribution: 'Topo: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS</a> · Trails: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    const renderer = L.canvas({ tolerance: 7 });

    data.boundary.forEach(r => L.polyline(r, { renderer, color: '#3b2f5c', weight: 2, opacity: .6, dashArray: '8 6', interactive: false }).addTo(map));

    // Keep only what belongs to the area: lines that enter the boundary, points inside it,
    // and trailheads near a kept trail
    const rings = data.boundary.filter(r => r.length > 2);
    const inside = ([lat, lon]) => {
      let c = false;
      for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [yi, xi] = r[i], [yj, xj] = r[j];
        if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const trails = rings.length ? data.trails.filter(t => t.p.some(inside)) : data.trails;

    // Overview: named trails and trailheads. Zoomed in: everything else.
    const overview = L.layerGroup().addTo(map), detail = L.layerGroup();
    const color = { trail: '#b5462f', road: '#8a6a4b' };
    let selected = null, hoverDot = null, hoverAt = null;
    trails.forEach(t => {
      const main = !!t.n && t.k === 'trail';
      const style = {
        renderer, color: color[t.k], weight: main ? 2 : 1.3, opacity: t.x ? .45 : main ? .85 : .55,
        dashArray: t.x ? '2 5' : t.k === 'road' ? '6 4' : null
      };
      const line = L.polyline(t.p.map(p => [p[0], p[1]]), style).addTo(main ? overview : detail);
      line.trail = t; line.base = style;
      line.bindTooltip(label(t), { sticky: true, direction: 'top', offset: [0, -6], className: 'tm-tip' });
      line.on('mouseover', () => { if (line !== selected) line.setStyle({ weight: style.weight + 2.5, opacity: 1 }); });
      line.on('mouseout', () => { if (line !== selected) line.setStyle({ weight: style.weight, opacity: style.opacity }); else if (hoverAt) hoverAt(null); });
      line.on('mousemove', e => { if (line === selected && hoverAt) hoverAt(e.latlng); });
      line.on('click', e => { L.DomEvent.stop(e); select(line); });
    });

    // Your routes: always shown, on top, in blue with a white edge
    const routeLines = extras.routes.map(r => {
      const t = { ...r, k: 'route' };
      const ll = r.p.map(p => [p[0], p[1]]);
      L.polyline(ll, { renderer, color: '#fff', weight: 6, opacity: .9, interactive: false }).addTo(map);
      const style = { renderer, color: '#1f5fa8', weight: 3, opacity: .95, dashArray: null };
      const line = L.polyline(ll, style).addTo(map);
      line.trail = t; line.base = style;
      line.bindTooltip(label(t), { sticky: true, direction: 'top', offset: [0, -6], className: 'tm-tip' });
      line.on('mouseover', () => { if (line !== selected) line.setStyle({ weight: 5 }); });
      line.on('mouseout', () => { if (line !== selected) line.setStyle({ weight: 3 }); else if (hoverAt) hoverAt(null); });
      line.on('mousemove', e => { if (line === selected && hoverAt) hoverAt(e.latlng); });
      line.on('click', e => { L.DomEvent.stop(e); select(line); });
      return line;
    });
    const list = box.querySelector('.tm-routes');
    if (routeLines.length) {
      list.hidden = false;
      box.querySelector('.tm-has-routes').hidden = false;
      list.innerHTML = '<span class="tm-rl">Your routes</span>' + routeLines.map((l, i) =>
        `<button type="button" data-i="${i}">${esc(l.trail.n)} <span>${mi(l.trail.len)} mi</span></button>`).join('');
      list.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        const line = routeLines[+b.dataset.i];
        select(line); map.fitBounds(line.getBounds(), { padding: [24, 24] });
      });
    }

    const near = (pt, km) => trails.some(t => t.n && t.p.some(p => map.distance(pt, p) < km * 1000));
    const icon = cls => L.divIcon({ className: 'tm-poi ' + cls, iconSize: [12, 12], html: '' });
    const names = { trailhead: 'Trailhead', camp: 'Camp', peak: 'Peak', water: 'Water' };
    data.pois.forEach(p => {
      const keep = !rings.length || inside(p.at) || (p.t === 'trailhead' && near(p.at, 1));
      if (!keep) return;
      const m = L.marker(p.at, { icon: icon(p.t), keyboard: false }).addTo(p.t === 'trailhead' ? overview : detail);
      const text = (p.n || names[p.t]) + (p.e ? ` · ${fmt(p.e * M_TO_FT)} ft` : '') + (p.n ? ` <span>${names[p.t]}</span>` : '');
      m.bindTooltip(text, { direction: 'top', offset: [0, -6], className: 'tm-tip' });
    });
    extras.trailheads.forEach(p => {
      L.marker(p.at, { icon: icon('trailhead mine'), keyboard: false }).addTo(overview)
        .bindTooltip(`${esc(p.n)} <span>Trailhead</span>`, { direction: 'top', offset: [0, -6], className: 'tm-tip' });
    });

    let bounds = data.bounds ? L.latLngBounds(data.bounds) : null;
    const grow = ll => { bounds = bounds ? bounds.extend(ll) : L.latLngBounds(ll, ll); };
    extras.routes.forEach(r => r.p.forEach(p => grow([p[0], p[1]])));
    extras.trailheads.forEach(p => grow(p.at));
    if (!bounds) { box.hidden = true; return; }
    map.fitBounds(bounds, { padding: [12, 12], maxZoom: 14 });
    const detailZoom = Math.ceil(map.getZoom()) + 1;
    const toggleDetail = () => {
      const on = map.getZoom() >= detailZoom;
      on ? detail.addTo(map) : detail.remove();
      box.classList.toggle('tm-zoomed', on);
      routeLines.forEach(l => l.bringToFront());
      if (selected) selected.bringToFront();
    };
    map.on('zoomend', toggleDetail); toggleDetail();
    let lastW = prof.clientWidth;
    window.addEventListener('resize', () => { if (selected && hasEle(selected.trail) && prof.clientWidth !== lastW) { lastW = prof.clientWidth; const t = selected.trail, e = t.p.map(p => p[2]); profile(t, Math.min(...e), Math.max(...e)); } });
    map.on('click', () => select(null));

    function name(t) { return esc(t.n || (t.k === 'road' ? 'Unnamed road' : 'Unnamed path')); }
    function label(t) {
      return `<b>${name(t)}</b> ${mi(t.len)} mi${t.x ? ' · closed or abandoned' : ''}${t.k === 'route' ? ' <span>Your route</span>' : ''}`;
    }
    function hasEle(t) { return t.p.every(p => Number.isFinite(p[2])); }

    function select(line) {
      if (selected) { selected.setStyle(selected.base); }
      if (!line) list.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
      selected = line;
      if (hoverDot) { hoverDot.remove(); hoverDot = null; }
      hoverAt = null;
      if (!line) { info.innerHTML = box.dataset.hint; prof.innerHTML = ''; prof.hidden = true; return; }
      line.setStyle({ color: '#1f5fa8', weight: 5, opacity: 1, dashArray: null });
      line.bringToFront();
      list.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(routeLines[+b.dataset.i] === line)));
      const t = line.trail, gpx = t.file ? ` <a href="${box.dataset.base || '/'}${esc(t.file)}" download>GPX</a>` : '';
      if (!hasEle(t)) {
        info.innerHTML = `<b>${name(t)}</b><span>${mi(t.len)} mi</span><span class="hint">No elevation in this GPX file</span>${gpx}`;
        prof.innerHTML = ''; prof.hidden = true; return;
      }
      const eles = t.p.map(p => p[2]), lo = Math.min(...eles), hi = Math.max(...eles);
      info.innerHTML = `<b>${name(t)}</b>` +
        `<span>${mi(t.len)} mi</span><span>↑ ${fmt(t.up * M_TO_FT)} ft</span><span>↓ ${fmt(t.down * M_TO_FT)} ft</span>` +
        `<span>${fmt(lo * M_TO_FT)}–${fmt(hi * M_TO_FT)} ft</span>` + (t.x ? '<span class="tm-x">Closed or abandoned</span>' : '') + gpx;
      profile(t, lo, hi);
    }

    function profile(t, lo, hi) {
      prof.hidden = false;
      // cumulative distance along the line
      const d = [0];
      for (let k = 1; k < t.p.length; k++) d.push(d[k - 1] + map.distance(t.p[k - 1], t.p[k]));
      const total = d[d.length - 1] || 1;
      const W = prof.clientWidth || 600, H = W < 500 ? 100 : 120, padL = 44, padR = 8, padT = 18, padB = 20;
      const loF = lo * M_TO_FT, hiF = hi * M_TO_FT;
      const span = Math.max(200, hiF - loF), y0 = Math.floor((loF - span * .1) / 100) * 100, y1 = Math.ceil((hiF + span * .1) / 100) * 100;
      const X = m => padL + m / total * (W - padL - padR), Y = ft => padT + (1 - (ft - y0) / (y1 - y0)) * (H - padT - padB);
      const pts = t.p.map((p, k) => `${X(d[k]).toFixed(1)},${Y(p[2] * M_TO_FT).toFixed(1)}`);
      const step = niceStep((y1 - y0) / 3), ticks = [];
      for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) ticks.push(v);
      const xStep = niceStep(total * M_TO_MI / (W < 500 ? 3 : 5)), xt = [];
      for (let v = 0; v <= total * M_TO_MI + 1e-9; v += xStep) xt.push(v);
      prof.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Elevation profile">
        ${ticks.map(v => `<line class="g" x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}"/><text class="yl" x="${padL - 6}" y="${Y(v) + 4}">${fmt(v)}</text>`).join('')}
        ${xt.map(v => `<text class="xl" x="${X(v / M_TO_MI)}" y="${H - 5}">${+v.toFixed(1)}${v === xt[xt.length - 1] ? ' mi' : ''}</text>`).join('')}
        <text class="yl" x="${padL - 6}" y="9">ft</text>
        <polygon class="area" points="${X(0)},${Y(y0)} ${pts.join(' ')} ${X(total)},${Y(y0)}"/>
        <polyline class="ln" points="${pts.join(' ')}"/>
        <line class="cur" x1="0" x2="0" y1="${padT}" y2="${H - padB}" visibility="hidden"/>
        <circle class="cd" r="3.5" visibility="hidden"/>
        <text class="ct" y="${padT + 10}" visibility="hidden"></text>
        <rect x="${padL}" y="0" width="${W - padL - padR}" height="${H}" fill="transparent"/>
      </svg>`;
      const svg = prof.querySelector('svg'), cur = svg.querySelector('.cur'), cd = svg.querySelector('.cd'), ct = svg.querySelector('.ct');
      const show = k => {
        const x = X(d[k]), y = Y(t.p[k][2] * M_TO_FT);
        [cur, cd, ct].forEach(el => el.setAttribute('visibility', 'visible'));
        cur.setAttribute('x1', x); cur.setAttribute('x2', x); cd.setAttribute('cx', x); cd.setAttribute('cy', y);
        ct.textContent = `${(d[k] * M_TO_MI).toFixed(1)} mi · ${fmt(t.p[k][2] * M_TO_FT)} ft`;
        const right = x > W - 130;
        ct.setAttribute('x', right ? x - 6 : x + 6); ct.setAttribute('text-anchor', right ? 'end' : 'start');
        if (!hoverDot) hoverDot = L.circleMarker(t.p[k], { radius: 6, color: '#fff', weight: 2, fillColor: css('--fix') || '#1f5fa8', fillOpacity: 1, interactive: false }).addTo(map);
        else hoverDot.setLatLng(t.p[k]);
      };
      const hide = () => { [cur, cd, ct].forEach(el => el.setAttribute('visibility', 'hidden')); if (hoverDot) { hoverDot.remove(); hoverDot = null; } };
      const nearestByX = px => { const m = (px - padL) / (W - padL - padR) * total; let k = 0; while (k < d.length - 1 && d[k + 1] < m) k++; return (k < d.length - 1 && d[k + 1] - m < m - d[k]) ? k + 1 : k; };
      const move = e => { const r = svg.getBoundingClientRect(); show(nearestByX((e.clientX - r.left) / r.width * W)); };
      svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', hide);
      // hovering the selected line on the map moves the profile cursor too
      hoverAt = latlng => {
        if (!latlng) return hide();
        let best = 0, bd = Infinity;
        t.p.forEach((p, k) => { const dd = map.distance(p, latlng); if (dd < bd) { bd = dd; best = k; } });
        show(best);
      };
    }

    function niceStep(raw) {
      const p = 10 ** Math.floor(Math.log10(raw || 1)), n = raw / p;
      return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
    }

    info.innerHTML = box.dataset.hint;
    box.querySelector('.tm-count').textContent = data.fetched
      ? `${trails.filter(t => t.n && t.k === 'trail').length} named trails · from OpenStreetMap, ${new Date(data.fetched).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`
      : `${extras.routes.length} route${extras.routes.length === 1 ? '' : 's'}`;
  }
})();
