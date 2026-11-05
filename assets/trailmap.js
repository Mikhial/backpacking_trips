// Trail map on trip pages: the trails in the area from OpenStreetMap on a USGS topo base.
// Click a trail to see its length, gain and elevation profile; hover the profile to follow it on the map.
// Right-click (or long-press) anywhere, or on a trailhead, camp or peak, for its NWS forecast.
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
  const extras = { trailheads: [], camps: [], routes: [], ...(extrasEl ? JSON.parse(extrasEl.textContent) : {}) };
  const empty = { boundary: [], trails: [], pois: [], bounds: null, fetched: null };
  if (box.dataset.src) fetch(box.dataset.src).then(r => r.json()).then(draw).catch(() => extrasEl ? draw(empty) : (box.hidden = true));
  else draw(empty);

  function draw(data) {
    const map = L.map(mapEl, { preferCanvas: true, scrollWheelZoom: false, zoomSnap: 0.5 });
    map.on('focus', () => map.scrollWheelZoom.enable());
    // Credit links Leaflet adds itself (e.g. "Leaflet") also open in a new tab
    mapEl.addEventListener('click', e => {
      const a = e.target.closest('a[href^="http"]');
      if (a) { a.target = '_blank'; a.rel = 'noopener'; }
    }, true);
    mapEl.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
    L.tileLayer(box.dataset.tiles || 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16, maxNativeZoom: +(box.dataset.tileZoom || 16),
      attribution: 'Topo: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS</a> · Trails: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    const renderer = L.canvas({ tolerance: 7 });

    // Right-click (or long-press) anywhere for a menu: NWS forecast, hourly graph, copy coordinates.
    // On a trailhead, camp or peak the menu is for that place.
    const spotMenu = (ll, title) => {
      ll = L.latLng(ll);
      const lat = ll.lat.toFixed(4), lon = ll.lng.toFixed(4), nws = `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`;
      const el = L.DomUtil.create('div');
      el.innerHTML = `<div class="tm-menu-h">${title ? `<b>${title}</b>` : ''}<span class="tm-ll">${lat}, ${lon}</span></div>` +
        `<a href="${nws}" target="_blank" rel="noopener">NWS forecast ↗</a>` +
        `<a href="${nws}&unit=0&lg=english&FcstType=graphical" target="_blank" rel="noopener">Hourly weather graph ↗</a>` +
        `<button type="button">Copy coordinates</button>`;
      const btn = el.querySelector('button');
      btn.addEventListener('click', () => {
        const done = () => { btn.textContent = 'Copied'; };
        const fallback = () => { const r = document.createRange(); r.selectNodeContents(el.querySelector('.tm-ll')); getSelection().removeAllRanges(); getSelection().addRange(r); btn.textContent = 'Selected, press ⌘C'; };
        try { navigator.clipboard.writeText(`${lat}, ${lon}`).then(done, fallback); } catch (e) { fallback(); }
      });
      el.addEventListener('click', e => { if (e.target.closest('a')) map.closePopup(); });
      L.popup({ className: 'tm-menu', offset: [0, -2], closeButton: false, autoPanPadding: [16, 16] }).setLatLng(ll).setContent(el).openOn(map);
    };
    map.on('contextmenu', e => spotMenu(e.latlng));

    // A one-route trip ("route:" + "gpx:" in the header): the route is always shown, with its profile open,
    // over the other trails, water, peaks and so on within a few miles of it (the map data only covers that area)
    const single = box.hasAttribute('data-single') && extras.routes.length === 1;
    data.boundary.forEach(r => L.polyline(r, { renderer, color: '#3b2f5c', weight: 2, opacity: .6, dashArray: '8 6', interactive: false }).addTo(map));

    // Keep only what belongs to the area: lines that enter the boundary, points inside it,
    // and trailheads near a kept trail. A one-route trip keeps everything near its route, inside the park or not.
    const rings = data.boundary.filter(r => r.length > 2);
    const inside = ([lat, lon]) => {
      let c = false;
      for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [yi, xi] = r[i], [yj, xj] = r[j];
        if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const trails = rings.length && !single ? data.trails.filter(t => t.p.some(inside)) : data.trails;

    // Overview: named trails and trailheads. Zoomed in: everything else.
    const overview = L.layerGroup().addTo(map), detail = L.layerGroup();
    const color = { trail: '#b5462f', road: '#8a6a4b' };
    let selected = null, hoverDot = null, hoverAt = null;
    // Long-distance trails (PCT, Tahoe Rim Trail…) are drawn last, thicker and darker
    const isBig = t => !!t.b && t.k === 'trail' && !t.x;
    trails.slice().sort((a, b) => isBig(a) - isBig(b)).forEach(t => {
      // dirt roads are drawn at every zoom, not just zoomed in
      const big = isBig(t), main = big || (!!t.n && t.k === 'trail') || t.k === 'road';
      const style = {
        renderer, color: big ? '#7e2413' : color[t.k], weight: main ? 2 : 1.3, opacity: t.x ? .45 : big ? .95 : main ? .85 : .55,
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

    // The legend only lists line kinds this map has
    const legendHas = { big: trails.some(isBig), road: trails.some(t => t.k === 'road'), closed: trails.some(t => t.x),
      peak: data.pois.some(p => p.t === 'peak'), water: data.pois.some(p => p.t === 'water'), 'unnamed paths': trails.some(t => !t.n && t.k === 'trail') };
    legendHas.peaks = legendHas.peak;
    box.querySelectorAll('.tm-legend [data-legend]').forEach(el => { if (!legendHas[el.dataset.legend]) el.remove(); });
    // "Zoom in for …" names only what this map has
    const more = box.querySelector('.tm-legend .tm-more[data-words]');
    if (more) {
      const words = more.dataset.words.split(',').filter(w => legendHas[w]);
      if (words.length) more.textContent = 'Zoom in for ' + (words.length < 2 ? words[0] : words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1]);
      else more.remove();
    }

    // Your routes: hidden until turned on (from the buttons above the map or the notes), then on top in blue with a white edge
    const routeLines = extras.routes.map(r => {
      const t = { ...r, k: 'route' };
      const ll = r.p.map(p => [p[0], p[1]]);
      const halo = L.polyline(ll, { renderer, color: '#fff', weight: 6, opacity: .9, interactive: false });
      const style = { renderer, color: '#1f5fa8', weight: 3, opacity: .95, dashArray: null };
      const line = L.polyline(ll, style);
      line.trail = t; line.base = style; line.halo = halo;
      // light-blue preview while hovering the route's button above the map
      // same width as the route line, in magenta (light blue looked like water), no white edge
      line.preview = L.polyline(ll, { renderer, color: '#c0399e', weight: style.weight, opacity: 1, interactive: false });
      line.bindTooltip(label(t), { sticky: true, direction: 'top', offset: [0, -6], className: 'tm-tip' });
      line.on('mouseover', () => { if (line !== selected) line.setStyle({ weight: 5 }); });
      line.on('mouseout', () => { if (line !== selected) line.setStyle({ weight: 3 }); else if (hoverAt) hoverAt(null); });
      line.on('mousemove', e => { if (line === selected && hoverAt) hoverAt(e.latlng); });
      line.on('click', e => { L.DomEvent.stop(e); select(line); });
      return line;
    });
    // Turn a route on (draw it, zoom to it, open its profile) or off
    const isOn = line => map.hasLayer(line);
    const setOn = (line, on) => {
      if (on === isOn(line)) return;
      if (on) { line.preview.remove(); line.halo.addTo(map); line.addTo(map); }
      else { if (line === selected) select(null); line.remove(); line.halo.remove(); }
    };
    // from the buttons above the map: turn one route on or off, keeping the current view
    // from the notes (solo): show only this route and zoom to it
    const toggle = (line, solo) => {
      // a one-route trip's route can't be hidden: just select it and zoom to it
      if (single) { select(line); map.fitBounds(line.getBounds(), { padding: [24, 24] }); return true; }
      const on = !isOn(line);
      if (on && solo) routeLines.forEach(l => { if (l !== line) setOn(l, false); });
      setOn(line, on);
      if (on) { select(line); if (solo) map.fitBounds(line.getBounds(), { padding: [24, 24] }); }
      document.querySelectorAll('.notes .rt-show, .tm-routes button').forEach(b => {
        const l = routeLines[+(b.dataset.route ?? b.dataset.i)], pressed = !!l && isOn(l);
        b.setAttribute('aria-pressed', String(pressed));
        b.title = pressed ? 'Hide from map' : 'Show on map';
      });
      box.querySelector('.tm-has-routes').hidden = !routeLines.some(isOn);
      return on;
    };
    // Links in the notes that match a route get a "Map" toggle
    const noteLink = i => document.querySelector(`.notes a[data-route="${i}"]`);
    routeLines.forEach((l, i) => { const a = noteLink(i); if (a) l.trail.url = a.href; });
    document.querySelectorAll('.notes .rt-show').forEach(b => {
      const line = routeLines[+b.dataset.route]; if (!line) { b.remove(); return; }
      b.addEventListener('click', () => { if (toggle(line, true)) box.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    });
    const list = box.querySelector('.tm-routes');
    if (routeLines.length && !single) {
      list.hidden = false;
      list.innerHTML = '<span class="tm-rl">Your routes</span>' + routeLines.map((l, i) =>
        `<button type="button" data-i="${i}" aria-pressed="false" title="Show on map">${esc(l.trail.n)} <span>${mi(l.trail.len)} mi</span></button>`).join('');
      list.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        const line = routeLines[+b.dataset.i]; line.preview.remove(); toggle(line);
      });
      // hover a button: the route in fainter blue until the pointer leaves
      list.querySelectorAll('button').forEach(b => {
        const line = routeLines[+b.dataset.i];
        b.addEventListener('mouseenter', () => { if (!isOn(line)) line.preview.addTo(map); });
        b.addEventListener('mouseleave', () => line.preview.remove());
      });
    }

    const near = (pt, km) => trails.some(t => t.n && t.p.some(p => map.distance(pt, p) < km * 1000));
    const icon = cls => L.divIcon({ className: 'tm-poi ' + cls, iconSize: [12, 12], html: '' });
    const names = { trailhead: 'Trailhead', camp: 'Camp', peak: 'Peak', water: 'Water' };
    const camps = [...extras.camps]; // yours, then OpenStreetMap's (even at the same place)
    data.pois.forEach(p => {
      const keep = single || !rings.length || inside(p.at) || (p.t === 'trailhead' && near(p.at, 1));
      if (!keep) return;
      // camps are drawn at every zoom with your own camps, below
      if (p.t === 'camp') { camps.push({ n: p.n, at: p.at }); return; }
      const m = L.marker(p.at, { icon: icon(p.t), keyboard: false }).addTo(p.t === 'trailhead' ? overview : detail);
      const text = (p.n || names[p.t]) + (p.e ? ` · ${fmt(p.e * M_TO_FT)} ft` : '') + (p.n ? ` <span>${names[p.t]}</span>` : '');
      m.bindTooltip(text, { direction: 'top', offset: [0, -6], className: 'tm-tip' });
      m.on('contextmenu', e => { L.DomEvent.stop(e); m.closeTooltip(); spotMenu(p.at, `${esc(p.n || names[p.t])}${p.e ? ` · ${fmt(p.e * M_TO_FT)} ft` : ''}`); });
    });
    extras.trailheads.forEach(p => {
      const m = L.marker(p.at, { icon: icon('trailhead mine'), keyboard: false }).addTo(overview)
        .bindTooltip(`${esc(p.n)} <span>Trailhead</span>`, { direction: 'top', offset: [0, -6], className: 'tm-tip' });
      m.on('contextmenu', e => { L.DomEvent.stop(e); m.closeTooltip(); spotMenu(p.at, esc(p.n)); });
    });

    // Camps (yours and OpenStreetMap's), at every zoom: ones that would overlap at this zoom are drawn
    // as one dot with a count; click it (or zoom in) to see them separately
    const campLayer = L.layerGroup().addTo(map);
    const drawCamps = () => {
      campLayer.clearLayers();
      const groups = [];
      camps.forEach(p => {
        const xy = map.latLngToLayerPoint(p.at);
        // join every group this camp is close to (close to any camp in it), so a chain of nearby sites stays together
        const hit = groups.filter(g => g.xys.some(q => q.distanceTo(xy) < 18));
        const g = { xys: [xy, ...hit.flatMap(g => g.xys)], list: [p, ...hit.flatMap(g => g.list)] };
        hit.forEach(h => groups.splice(groups.indexOf(h), 1)); groups.push(g);
      });
      groups.forEach(({ list }) => {
        if (list.length === 1) {
          const p = list[0];
          const m = L.marker(p.at, { icon: icon('camp mine'), keyboard: false }).addTo(campLayer)
            .bindTooltip(`${esc(p.n || 'Camp')}${p.n ? ' <span>Camp</span>' : ''}`, { direction: 'top', offset: [0, -6], className: 'tm-tip' });
          m.on('contextmenu', e => { L.DomEvent.stop(e); m.closeTooltip(); spotMenu(p.at, esc(p.n || 'Camp')); });
          return;
        }
        const b = L.latLngBounds(list.map(p => p.at));
        L.marker(b.getCenter(), { icon: L.divIcon({ className: 'tm-poi camp mine tm-group', iconSize: [18, 18], html: String(list.length) }), keyboard: false })
          .addTo(campLayer)
          .bindTooltip(`${list.length} camps <span>${list.map(p => esc(p.n || 'unnamed')).join(', ')}</span>`, { direction: 'top', offset: [0, -9], className: 'tm-tip' })
          .on('click', e => { L.DomEvent.stop(e); map.fitBounds(b.pad(0.5), { maxZoom: 15 }); });
      });
    };
    map.on('zoomend', drawCamps);

    // The map starts on your own routes, trailheads and camps with ~11 km around them (a one-route trip:
    // just the route), so a trip in a big park like Hetch Hetchy in Yosemite doesn't open on the whole park.
    // A trip with none of those starts on the whole park.
    let bounds = null;
    const grow = ll => { bounds = bounds ? bounds.extend(ll) : L.latLngBounds(ll, ll); };
    extras.routes.forEach(r => r.p.forEach(p => grow([p[0], p[1]])));
    extras.trailheads.forEach(p => grow(p.at));
    extras.camps.forEach(p => grow(p.at));
    if (bounds && !single && data.bounds) {
      const park = L.latLngBounds(data.bounds), m = 0.1;
      const near = L.latLngBounds([bounds.getSouth() - m, bounds.getWest() - m], [bounds.getNorth() + m, bounds.getEast() + m]);
      bounds = park.intersects(near) ? L.latLngBounds(
        [Math.max(near.getSouth(), park.getSouth()), Math.max(near.getWest(), park.getWest())],
        [Math.min(near.getNorth(), park.getNorth()), Math.min(near.getEast(), park.getEast())]).extend(bounds) : bounds.extend(park);
    } else if (!bounds && data.bounds && !single) bounds = L.latLngBounds(data.bounds);
    if (!bounds) { box.hidden = true; return; }
    map.fitBounds(bounds, { padding: [12, 12], maxZoom: 14 });
    drawCamps();
    const detailZoom = Math.ceil(map.getZoom()) + 1;
    const toggleDetail = () => {
      const on = map.getZoom() >= detailZoom;
      on ? detail.addTo(map) : detail.remove();
      box.classList.toggle('tm-zoomed', on);
      routeLines.forEach(l => { if (isOn(l)) { l.halo.bringToFront(); l.bringToFront(); } });
      if (selected) selected.bringToFront();
    };
    map.on('zoomend', toggleDetail); toggleDetail();

    // "Plan this trip" links open CalTopo and Gaia GPS on the current map view
    const ext = box.querySelectorAll('.tm-ext');
    const syncLinks = () => {
      const c = map.getCenter(), z = Math.round(map.getZoom()), lat = c.lat.toFixed(5), lon = c.lng.toFixed(5);
      ext.forEach(a => {
        a.href = a.dataset.app === 'caltopo' ? `https://caltopo.com/map.html#ll=${lat},${lon}&z=${z}&b=mbt` : `https://www.gaiagps.com/map/?loc=${z}/${lon}/${lat}`;
        a.hidden = false;
      });
    };
    map.on('moveend', syncLinks); syncLinks();
    let lastW = prof.clientWidth;
    window.addEventListener('resize', () => { if (selected && hasEle(selected.trail) && prof.clientWidth !== lastW) { lastW = prof.clientWidth; const t = selected.trail, e = t.p.map(p => p[2]); profile(t, Math.min(...e), Math.max(...e)); } });
    // clicking the map clears the selection; on a one-route trip it goes back to the route
    map.on('click', () => select(single ? routeLines[0] : null));
    info.addEventListener('click', e => {
      const a = e.target.closest('.tm-tonote'); if (!a) return;
      const n = document.getElementById(a.getAttribute('href').slice(1)); if (!n) return;
      e.preventDefault();
      const li = n.closest('li, p') || n;
      li.scrollIntoView({ behavior: 'smooth', block: 'center' });
      li.classList.remove('rt-flash'); void li.offsetWidth; li.classList.add('rt-flash');
    });

    function name(t) { return esc(t.n || (t.k === 'road' ? 'Unnamed road' : 'Unnamed path')); }
    function label(t) {
      return `<b>${name(t)}</b> ${mi(t.len)} mi${t.x ? ' · closed or abandoned' : ''}${t.k === 'route' ? ' <span>Your route</span>' : ''}${isBig(t) ? ` <span>${t.b.map(esc).join(' · ')}</span>` : ''}`;
    }
    function hasEle(t) { return t.p.every(p => Number.isFinite(p[2])); }

    function select(line) {
      if (selected) { selected.setStyle(selected.base); }
      selected = line;
      if (hoverDot) { hoverDot.remove(); hoverDot = null; }
      hoverAt = null;
      if (!line) { info.innerHTML = box.dataset.hint; prof.innerHTML = ''; prof.hidden = true; return; }
      line.setStyle({ color: '#1f5fa8', weight: 5, opacity: 1, dashArray: null });
      line.bringToFront();
      const t = line.trail, i = routeLines.indexOf(line);
      const site = t.url ? (/alltrails\.com/.test(t.url) ? 'AllTrails' : new URL(t.url).hostname.replace(/^www\./, '')) : '';
      const gpx = (t.url ? ` <a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(site)} ↗</a>` : '') +
        (t.url ? ` <a href="#route-${i}" class="tm-tonote">In notes ↓</a>` : '') +
        (t.file ? ` <a href="${box.dataset.base || '/'}${esc(t.file)}" download>GPX</a>` : '');
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
        if (!hoverDot) hoverDot = L.circleMarker(t.p[k], { renderer, radius: 6, color: '#fff', weight: 2, fillColor: css('--fix') || '#1f5fa8', fillOpacity: 1, interactive: false }).addTo(map);
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
    if (single) { setOn(routeLines[0], true); select(routeLines[0]); }
    // (a one-route trip's distance and gain are already in the line under the map)
    box.querySelector('.tm-count').textContent = single ? ''
      : data.fetched
      ? `${trails.filter(t => t.n && t.k === 'trail').length} named trails · from OpenStreetMap, ${new Date(data.fetched).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`
      : `${extras.routes.length} route${extras.routes.length === 1 ? '' : 's'}`;
  }
})();
