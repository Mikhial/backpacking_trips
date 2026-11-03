// Trail map on trip pages: every trail in the area from OpenStreetMap on a USGS topo base.
// Click a trail to see its length, gain and elevation profile; hover the profile to follow it on the map.
(function () {
  const box = document.getElementById('trailmap');
  if (!box || !window.L) return;
  const M_TO_FT = 3.28084, M_TO_MI = 1 / 1609.344;
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const mi = m => (m * M_TO_MI).toFixed(m * M_TO_MI < 10 ? 1 : 0);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const mapEl = box.querySelector('.tm-map'), info = box.querySelector('.tm-info'), prof = box.querySelector('.tm-prof');

  fetch(box.dataset.src).then(r => r.json()).then(draw).catch(() => { box.hidden = true; });

  function draw(data) {
    const map = L.map(mapEl, { preferCanvas: true, scrollWheelZoom: false, zoomSnap: 0.5 });
    map.on('focus', () => map.scrollWheelZoom.enable());
    mapEl.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
    L.tileLayer(box.dataset.tiles || 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16, maxNativeZoom: +(box.dataset.tileZoom || 16),
      attribution: 'Topo: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS</a> · Trails: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    const renderer = L.canvas({ tolerance: 7 });

    data.boundary.forEach(r => L.polyline(r, { renderer, color: '#2d6a1f', weight: 2, opacity: .55, dashArray: '6 5', interactive: false }).addTo(map));

    const color = { trail: '#c2412d', road: '#8a5a2b' };
    let selected = null, hoverDot = null, hoverAt = null;
    const lines = data.trails.map(t => {
      const named = !!t.n;
      const style = {
        renderer, color: color[t.k], weight: named ? 2.6 : 1.6, opacity: t.x ? .5 : named ? .9 : .6,
        dashArray: t.x ? '2 5' : t.k === 'road' ? '7 4' : null
      };
      const line = L.polyline(t.p.map(p => [p[0], p[1]]), style).addTo(map);
      line.trail = t; line.base = style;
      line.bindTooltip(label(t), { sticky: true, direction: 'top', offset: [0, -6], className: 'tm-tip' });
      line.on('mouseover', () => { if (line !== selected) line.setStyle({ weight: style.weight + 2 }); });
      line.on('mouseout', () => { if (line !== selected) line.setStyle({ weight: style.weight }); else if (hoverAt) hoverAt(null); });
      line.on('mousemove', e => { if (line === selected && hoverAt) hoverAt(e.latlng); });
      line.on('click', e => { L.DomEvent.stop(e); select(line); });
      return line;
    });

    const icon = cls => L.divIcon({ className: 'tm-poi ' + cls, iconSize: [12, 12], html: '' });
    const names = { trailhead: 'Trailhead', camp: 'Camp', peak: 'Peak', water: 'Water' };
    data.pois.forEach(p => {
      const m = L.marker(p.at, { icon: icon(p.t), keyboard: false }).addTo(map);
      const text = (p.n || names[p.t]) + (p.e ? ` · ${fmt(p.e * M_TO_FT)} ft` : '') + (p.n ? ` <span>${names[p.t]}</span>` : '');
      m.bindTooltip(text, { direction: 'top', offset: [0, -6], className: 'tm-tip' });
    });

    map.fitBounds(data.bounds, { padding: [8, 8] });
    map.on('click', () => select(null));

    function label(t) {
      return `<b>${t.n || (t.k === 'road' ? 'Unnamed road' : 'Unnamed path')}</b> ${mi(t.len)} mi${t.x ? ' · closed or abandoned' : ''}`;
    }

    function select(line) {
      if (selected) { selected.setStyle(selected.base); }
      selected = line;
      if (hoverDot) { hoverDot.remove(); hoverDot = null; }
      hoverAt = null;
      if (!line) { info.innerHTML = box.dataset.hint; prof.innerHTML = ''; prof.hidden = true; return; }
      line.setStyle({ color: css('--fix') || '#1f5fa8', weight: 5, opacity: 1, dashArray: null });
      line.bringToFront();
      const t = line.trail, eles = t.p.map(p => p[2]);
      const lo = Math.min(...eles), hi = Math.max(...eles);
      info.innerHTML = `<b>${t.n || (t.k === 'road' ? 'Unnamed road' : 'Unnamed path')}</b>` +
        `<span>${mi(t.len)} mi</span><span>↑ ${fmt(t.up * M_TO_FT)} ft</span><span>↓ ${fmt(t.down * M_TO_FT)} ft</span>` +
        `<span>${fmt(lo * M_TO_FT)}–${fmt(hi * M_TO_FT)} ft</span>` + (t.x ? '<span class="tm-x">Closed or abandoned</span>' : '');
      profile(t, lo, hi);
    }

    function profile(t, lo, hi) {
      prof.hidden = false;
      // cumulative distance along the line
      const d = [0];
      for (let k = 1; k < t.p.length; k++) d.push(d[k - 1] + map.distance(t.p[k - 1], t.p[k]));
      const total = d[d.length - 1] || 1;
      const W = prof.clientWidth || 600, H = 120, padL = 44, padR = 8, padT = 8, padB = 20;
      const loF = lo * M_TO_FT, hiF = hi * M_TO_FT;
      const span = Math.max(200, hiF - loF), y0 = Math.floor((loF - span * .1) / 100) * 100, y1 = Math.ceil((hiF + span * .1) / 100) * 100;
      const X = m => padL + m / total * (W - padL - padR), Y = ft => padT + (1 - (ft - y0) / (y1 - y0)) * (H - padT - padB);
      const pts = t.p.map((p, k) => `${X(d[k]).toFixed(1)},${Y(p[2] * M_TO_FT).toFixed(1)}`);
      const step = niceStep((y1 - y0) / 3), ticks = [];
      for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) ticks.push(v);
      const xStep = niceStep(total * M_TO_MI / 5), xt = [];
      for (let v = 0; v <= total * M_TO_MI + 1e-9; v += xStep) xt.push(v);
      prof.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Elevation profile">
        ${ticks.map(v => `<line class="g" x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}"/><text class="yl" x="${padL - 6}" y="${Y(v) + 4}">${fmt(v)}</text>`).join('')}
        ${xt.map(v => `<text class="xl" x="${X(v / M_TO_MI)}" y="${H - 5}">${+v.toFixed(1)}</text>`).join('')}
        <text class="xl" x="${W - padR}" y="${H - 5}" text-anchor="end">mi</text>
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
    box.querySelector('.tm-count').textContent = `${data.trails.filter(t => t.n).length} named trails and roads · from OpenStreetMap, ${new Date(data.fetched).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  }
})();
