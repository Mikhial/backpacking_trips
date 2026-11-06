// "All map data" page: everything saved in parkdata/ for one park, from assets/parks/<park>.json.
// A switch for each kind of data (grouped by OpenStreetMap category) shows or hides it; it opens with the kinds the
// trip map uses. "Grey out what the trip map drops" shows what the cleanup removes.
(function () {
  const box = document.getElementById('parkmap');
  if (!box || !window.L) return;
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const about = box.querySelector('.pm-about'), sw = box.querySelector('.pm-switches'), info = box.querySelector('.tm-info');
  const COLORS = {
    'highway=path': '#b5462f', 'highway=footway': '#d9822b', 'highway=bridleway': '#8e44ad', 'highway=cycleway': '#2a9d8f',
    'highway=track': '#8a6a4b', 'highway=steps': '#c0399e', 'highway=trailhead': '#1c211a', 'tourism=camp_site': '#5a9a2a',
    'tourism=wilderness_hut': '#2e6b1f', 'tourism=alpine_hut': '#2e6b1f', 'natural=peak': '#8a5a2b', 'natural=spring': '#3db6d6',
    'amenity=drinking_water': '#1f5fa8'
  };
  const BY_KEY = { highway: '#6b6b6b', waterway: '#3d8fd6', natural: '#7a8a3a', water: '#3d8fd6', tourism: '#4a8a2a', amenity: '#a05a9a',
    building: '#9a7a5a', landuse: '#8a9a6a', leisure: '#5a8a7a', boundary: '#5a4a8a', power: '#9a9a3a', barrier: '#7a5a3a' };
  const GROUPS = { highway: 'Trails', natural: 'Natural', water: 'Water', waterway: 'Water', tourism: 'Tourism', amenity: 'Amenities',
    leisure: 'Leisure', landuse: 'Land use', landcover: 'Land use', building: 'Buildings', boundary: 'Boundaries', protect_class: 'Boundaries' };
  const GREY = '#a3a3a3';
  const fmt = n => n.toLocaleString('en-US');

  // index.json: what's there; <kind>.json: that kind's features, fetched when it's first switched on
  const base = box.dataset.src;
  // Layout: switches above the map, or side by side with it (remembered in this browser)
  const layoutBtn = box.querySelector('.pm-layout');
  const setLayout = side => {
    box.classList.toggle('pm-side', side);
    layoutBtn.setAttribute('aria-pressed', String(side));
    layoutBtn.textContent = side ? 'Stacked' : 'Side by side';
    window.dispatchEvent(new Event('resize')); // the map re-measures itself
  };
  let side = false;
  try { side = localStorage.getItem('pm-layout') === 'side'; } catch (e) {}
  setLayout(side);
  layoutBtn.addEventListener('click', () => {
    side = !side; setLayout(side);
    try { localStorage.setItem('pm-layout', side ? 'side' : 'stacked'); } catch (e) {}
  });

  fetch(base + 'index.json').then(r => r.json()).then(draw).catch(() => { about.textContent = 'Couldn’t load the map data.'; });

  function draw(d) {
    const date = new Date(d.fetched).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const [type, id] = d.source.replace('OpenStreetMap ', '').split('/');
    const state = d.region.replace(/^us\//, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    about.innerHTML = `What OpenStreetMap has in this area for hiking: ${fmt(d.total)} features from the ${esc(state)} map file, ` +
      `downloaded ${date}. Lines are simplified; buildings, town streets and the like are left out. <a href="https://www.openstreetmap.org/${type}/${id}" target="_blank" rel="noopener">Boundary on OpenStreetMap ↗</a>`;

    const map = L.map(box.querySelector('.pm-map'), { preferCanvas: true, zoomSnap: 0.5 });
    L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, maxNativeZoom: 16,
      attribution: 'Topo: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS</a> · Data: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    const renderer = L.canvas({ tolerance: 6 });
    map.fitBounds(d.bounds, { padding: [8, 8] });

    const nameOf = f => f.tags.name || f.tags.ref || d.kinds[f.k].label;
    const show = (f, color) => {
      const rows = Object.entries(f.tags).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
      const osm = `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[f.id[0]]}/${f.id.slice(1)}`;
      info.innerHTML = `<b style="color:${color}">${esc(nameOf(f))}</b><span>${esc(d.kinds[f.k].label)}</span>` +
        (f.b ? `<span>${f.b.map(esc).join(' · ')}</span>` : '') +
        `<span class="${f.d ? 'tm-x' : ''}">${f.d ? 'Not on the trip map' : 'On the trip map'}</span>` +
        `<a href="${osm}" target="_blank" rel="noopener">OpenStreetMap ↗</a><table class="pm-tags">${rows}</table>`;
    };

    // Each kind: its features, drawn the first time it's switched on
    let grey = false;
    const files = {};
    const load = file => files[file] ||= fetch(base + file + '.json').then(r => r.json());
    const kinds = Object.entries(d.kinds).map(([k, x], i) => {
      const key = k.split('=')[0];
      return { k, ...x, key, color: COLORS[k] || BY_KEY[key] || ['#6b6b9a', '#9a6b6b', '#6b9a8a', '#9a8a6b'][i % 4],
        // on at first: kinds with something on the trip map
        on: !!x.on };
    });
    const restyle = (layer, f, color) => {
      const g = grey && f.d;
      if (layer instanceof L.CircleMarker) layer.setStyle({ fillColor: g ? GREY : color, fillOpacity: g ? .6 : 1 });
      else layer.setStyle({ color: g ? GREY : color, opacity: g ? .5 : .9 });
    };
    // One-route trips: "Hide what's too far from <route>" keeps only what's within ~3 mi of the switched-on routes
    // (their line and trailheads, the same rule as the trip page); with several on, anything near any of them stays
    const RAD = Math.PI / 180, R = 6371008.8;
    const distToLine = (p, line) => { // meters
      const k = Math.cos(p[0] * RAD), xy = q => [(q[1] - p[1]) * RAD * k * R, (q[0] - p[0]) * RAD * R];
      let best = Infinity;
      for (let i = 0; i < line.length; i++) {
        const [ax, ay] = xy(line[i]);
        if (i === line.length - 1) { best = Math.min(best, Math.hypot(ax, ay)); break; }
        const [bx, by] = xy(line[i + 1]), dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
      }
      return best;
    };
    const areas = (d.routeAreas || []).map(a => {
      const bounds = L.latLngBounds(a.box);
      return { ...a, on: false, near: q => bounds.contains(q) && (distToLine(q, a.line) < a.meters || a.trailheads.some(h => distToLine(q, [h]) < a.meters)) };
    });
    const pointsOf = f => f.at ? [f.at] : f.g.flat();
    // whether each thing is near each route, worked out once
    const nearCache = new WeakMap();
    const isNear = (key, pts, i) => { let c = nearCache.get(key); if (!c) nearCache.set(key, c = []); return c[i] ??= pts.some(areas[i].near); };
    const visible = (pts, key) => !areas.some(a => a.on) || areas.some((a, i) => a.on && isNear(key, pts, i));
    const refilter = () => {
      kinds.forEach(x => { if (!groupOf[x.k]) return; groupOf[x.k].clearLayers(); x.layers.forEach(l => { if (visible(pointsOf(l.f), l)) groupOf[x.k].addLayer(l); }); });
      const big = extra.find(x => x.k === '#big');
      if (big) { big.group.clearLayers(); big.layers.forEach(l => { if (visible(l.pts, l)) big.group.addLayer(l); }); }
      bigOnTop();
    };
    const groupOf = {};
    const layerFor = async x => {
      if (groupOf[x.k]) return groupOf[x.k];
      const group = L.layerGroup();
      x.layers = [];
      for (const f of (await load(x.file)).filter(f => f.k === x.k)) {
        const layer = f.g
          ? L.polyline(f.g, { renderer, color: x.color, weight: 1.6, opacity: .9, dashArray: x.k === 'highway=track' ? '6 4' : null })
          : L.circleMarker(f.at, { renderer, radius: 4.5, color: '#fff', weight: 1.2, fillColor: x.color, fillOpacity: 1 });
        layer.bindTooltip(`<b>${esc(nameOf(f))}</b> <span>${esc(x.label)}${f.d ? ' · not on trip map' : ''}</span>`,
          { sticky: !!f.g, direction: 'top', offset: [0, -6], className: 'tm-tip' });
        layer.on('click', e => { L.DomEvent.stop(e); show(f, x.color); });
        if (f.g) { layer.on('mouseover', () => layer.setStyle({ weight: 4 })); layer.on('mouseout', () => layer.setStyle({ weight: 1.6 })); }
        layer.f = f;
        restyle(layer, f, x.color);
        x.layers.push(layer);
        if (visible(pointsOf(f), layer)) group.addLayer(layer);
      }
      return groupOf[x.k] = group;
    };

    // Boundary and long-distance trails, drawn underneath
    const extra = [{ k: '#boundary', label: 'Park boundary', n: d.boundary.length, color: '#3b2f5c', on: d.boundaryOn !== false,
      group: L.layerGroup(d.boundary.map(l => L.polyline(l, { renderer, color: '#3b2f5c', weight: 2, opacity: .7, dashArray: '8 6', interactive: false }))) }];
    // drawn like on the trip map: a dark red line on top of everything else, named on hover
    if (d.big.length) {
      const layers = d.big.map(({ g, b }) => Object.assign(L.polyline(g, { renderer, color: '#7e2413', weight: 2, opacity: .95 })
        .bindTooltip(`<b>${b.map(esc).join(' · ')}</b> <span>Long-distance trail</span>`, { sticky: true, direction: 'top', offset: [0, -6], className: 'tm-tip' }), { pts: g.flat() }));
      extra.push({ k: '#big', label: 'Long-distance trail', n: d.big.length, color: '#7e2413', on: true, layers, group: L.layerGroup(layers) });
    }
    // the trips' own GPX routes, in blue with a white edge like on the trip page
    if ((d.routeLines || []).length) {
      const layers = d.routeLines.flatMap(({ trip, g }) => [L.polyline(g, { renderer, color: '#fff', weight: 6, opacity: .9, interactive: false }),
        L.polyline(g, { renderer, color: '#1f5fa8', weight: 3, opacity: .95 }).bindTooltip(`<b>${esc(trip)}</b> <span>Your route</span>`, { sticky: true, direction: 'top', offset: [0, -6], className: 'tm-tip' })]);
      extra.push({ k: '#routes', label: 'Your routes', n: d.routeLines.length, color: '#1f5fa8', on: true, group: L.layerGroup(layers) });
    }
    const bigOnTop = () => ['#big', '#routes'].forEach(k => { const x = extra.find(x => x.k === k); if (x && map.hasLayer(x.group)) x.group.eachLayer(l => l.bringToFront()); });
    extra.forEach(x => { if (x.on) x.group.addTo(map); });

    // Switches, grouped; each group has an "all" switch
    const chip = (x) => `<label class="pm-sw"><input type="checkbox" data-k="${esc(x.k)}"${x.on ? ' checked' : ''}>` +
      `<i class="${x.geom === 'point' ? 'pm-pt' : 'pm-ln'}" style="--c:${x.color}"></i>${esc(x.label)} <span>${fmt(x.n)}</span></label>`;
    const groups = {};
    // roads (service, forest and minor roads, highways) get their own group, after trails
    const groupName = x => /^highway=(trunk|primary|secondary|tertiary|unclassified|service)$/.test(x.k) ? 'Roads' : GROUPS[x.key] || 'Other';
    kinds.forEach(x => (groups[groupName(x)] ||= []).push(x));
    const order = ['Trails', 'Roads', 'Tourism', 'Natural', 'Water', 'Amenities', 'Leisure', 'Boundaries', 'Land use', 'Buildings', 'Other'];
    sw.innerHTML = `<div class="pm-group"><b>Map</b>${extra.map(chip).join('')}` +
      `<label class="pm-sw pm-grey"><input type="checkbox" data-k="#grey">Grey out what the trip map drops <span>${fmt(d.dropped)}</span></label>` +
      areas.map((a, i) => `<label class="pm-sw pm-grey"><input type="checkbox" data-area="${i}">Hide what's more than 3 mi from ${esc(a.route)}</label>`).join('') + `</div>` +
      Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(g => {
        const list = groups[g].sort((a, b) => b.n - a.n);
        return `<div class="pm-group"><b>${esc(g)}</b><label class="pm-sw pm-all"><input type="checkbox" data-group="${esc(g)}"${list.every(x => x.on) ? ' checked' : ''}>all</label>${list.map(chip).join('')}</div>`;
      }).join('');
    const set = async (x, on) => {
      x.on = on;
      if (!on) return groupOf[x.k]?.remove();
      const g = await layerFor(x);
      if (x.on) { g.addTo(map); bigOnTop(); } // still on once loaded
    };
    kinds.forEach(x => { if (x.on) set(x, true); });
    sw.addEventListener('change', e => {
      const t = e.target, k = t.dataset.k;
      if (t.dataset.area) { areas[+t.dataset.area].on = t.checked; refilter(); return; }
      if (t.dataset.group) {
        groups[t.dataset.group].forEach(x => set(x, t.checked));
        t.closest('.pm-group').querySelectorAll('input[data-k]').forEach(i => { i.checked = t.checked; });
        return;
      }
      if (k === '#grey') { grey = t.checked; kinds.forEach(x => groupOf[x.k]?.eachLayer(l => restyle(l, l.f, x.color))); return; }
      const x = extra.find(x => x.k === k);
      if (x) { t.checked ? x.group.addTo(map) : x.group.remove(); return; }
      set(kinds.find(x => x.k === k), t.checked);
    });
  }
})();
