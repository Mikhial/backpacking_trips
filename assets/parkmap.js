// "All map data" page: everything saved in parkdata/ for one park, from assets/parks/<park>.json.
// A switch for each kind of data shows or hides it; "Grey out what the trip map drops" shows what the cleanup removes.
(function () {
  const box = document.getElementById('parkmap');
  if (!box || !window.L) return;
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const about = box.querySelector('.pm-about'), sw = box.querySelector('.pm-switches'), info = box.querySelector('.tm-info');
  const COLORS = {
    'highway=path': '#b5462f', 'highway=footway': '#d9822b', 'highway=bridleway': '#8e44ad', 'highway=track': '#8a6a4b', 'highway=steps': '#c0399e',
    'highway=trailhead': '#1c211a', 'tourism=camp_site': '#5a9a2a', 'tourism=wilderness_hut': '#2e6b1f', 'tourism=alpine_hut': '#2e6b1f',
    'natural=peak': '#8a5a2b', 'natural=spring': '#3db6d6', 'amenity=drinking_water': '#1f5fa8'
  };
  const OTHER = ['#6b6b9a', '#9a6b6b', '#6b9a8a', '#9a8a6b'];
  const GREY = '#a3a3a3';

  fetch(box.dataset.src).then(r => r.json()).then(draw).catch(() => { about.textContent = 'Couldn’t load the map data.'; });

  function draw(d) {
    const dropped = d.features.filter(f => f.d).length;
    const date = new Date(d.fetched).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const [type, id] = d.source.replace('OpenStreetMap ', '').split('/');
    about.innerHTML = `Everything saved for this park: ${d.features.length.toLocaleString('en-US')} features from the ` +
      `${esc(d.region.replace(/^us\//, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))} map file, downloaded ${date}. ` +
      `Lines are simplified. <a href="https://www.openstreetmap.org/${type}/${id}" target="_blank" rel="noopener">Boundary on OpenStreetMap ↗</a>`;

    const map = L.map(box.querySelector('.pm-map'), { preferCanvas: true, zoomSnap: 0.5 });
    L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 17, maxNativeZoom: 16,
      attribution: 'Topo: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS</a> · Data: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    const renderer = L.canvas({ tolerance: 6 });
    map.fitBounds(d.bounds, { padding: [8, 8] });

    let grey = false;
    const layers = {}; // kind -> { group, items: [{ layer, f, color }] }
    const restyle = it => {
      const g = grey && it.f.d;
      if (it.layer.setStyle) it.layer.setStyle(it.layer instanceof L.CircleMarker
        ? { color: '#fff', fillColor: g ? GREY : it.color, fillOpacity: g ? .6 : 1 }
        : { color: g ? GREY : it.color, opacity: g ? .55 : .9 });
    };
    const show = (f, color) => {
      const t = f.tags || {};
      const rows = Object.entries(t).sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
      const osm = `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[f.id[0]]}/${f.id.slice(1)}`;
      info.innerHTML = `<b style="color:${color}">${esc(t.name || t.ref || d.kinds[f.k].label)}</b>` +
        `<span>${esc(d.kinds[f.k].label)}</span>` + (f.b ? `<span>${f.b.map(esc).join(' · ')}</span>` : '') +
        `<span class="${f.d ? 'tm-x' : ''}">${f.d ? 'Dropped from the trip map' : 'On the trip map'}</span>` +
        `<a href="${osm}" target="_blank" rel="noopener">OpenStreetMap ↗</a>` +
        `<table class="pm-tags">${rows}</table>`;
    };

    // Boundary and long-distance trails first, so everything else draws on top
    const extra = {
      boundary: { label: 'Boundary', geom: 'line', n: d.boundary.length, color: '#3b2f5c',
        group: L.layerGroup(d.boundary.map(l => L.polyline(l, { renderer, color: '#3b2f5c', weight: 2, opacity: .7, dashArray: '8 6', interactive: false }))) }
    };
    const big = d.features.filter(f => f.b && f.g);
    if (big.length) extra.big = { label: 'Long-distance trail', geom: 'line', n: big.length, color: '#7e2413',
      group: L.layerGroup(big.map(f => L.polyline(f.g, { renderer, color: '#7e2413', weight: 6, opacity: .35, interactive: false }))) };

    const kinds = Object.entries(d.kinds).sort(([, a], [, b]) => (a.geom === 'line' ? 0 : 1) - (b.geom === 'line' ? 0 : 1) || b.n - a.n);
    kinds.forEach(([k], i) => {
      const color = COLORS[k] || OTHER[i % OTHER.length];
      layers[k] = { group: L.layerGroup(), items: [], color };
    });
    d.features.forEach(f => {
      const L_ = layers[f.k], color = L_.color;
      const layer = f.g
        ? L.polyline(f.g, { renderer, color, weight: 1.6, opacity: .9, dashArray: f.k === 'highway=track' ? '6 4' : null })
        : L.circleMarker(f.at, { renderer, radius: 4.5, color: '#fff', weight: 1.2, fillColor: color, fillOpacity: 1 });
      const t = f.tags || {};
      layer.bindTooltip(`<b>${esc(t.name || t.ref || d.kinds[f.k].label)}</b> <span>${esc(d.kinds[f.k].label)}${f.d ? ' · dropped' : ''}</span>`,
        { sticky: !!f.g, direction: 'top', offset: [0, -6], className: 'tm-tip' });
      layer.on('click', e => { L.DomEvent.stop(e); show(f, color); });
      if (f.g) {
        layer.on('mouseover', () => layer.setStyle({ weight: 4 }));
        layer.on('mouseout', () => layer.setStyle({ weight: 1.6 }));
      }
      L_.items.push({ layer, f, color });
      L_.group.addLayer(layer);
    });

    // Switches: boundary, long-distance trails, each kind of line, each kind of point, then grey-out
    const chip = (id, label, n, color, geom, on) =>
      `<label class="pm-sw"><input type="checkbox" data-k="${esc(id)}"${on ? ' checked' : ''}>` +
      `<i class="${geom === 'line' ? 'pm-ln' : 'pm-pt'}" style="--c:${color}"></i>${esc(label)} <span>${n.toLocaleString('en-US')}</span></label>`;
    sw.innerHTML = Object.entries(extra).map(([k, x]) => chip(k, x.label, x.n, x.color, 'line', true)).join('') +
      kinds.map(([k, x]) => chip(k, x.label, x.n, layers[k].color, x.geom, true)).join('') +
      `<label class="pm-sw pm-grey"><input type="checkbox" data-k="#grey">Grey out what the trip map drops <span>${dropped.toLocaleString('en-US')}</span></label>`;
    Object.values(extra).forEach(x => x.group.addTo(map));
    kinds.forEach(([k]) => layers[k].group.addTo(map));
    sw.addEventListener('change', e => {
      const k = e.target.dataset.k, on = e.target.checked;
      if (k === '#grey') { grey = on; Object.values(layers).forEach(l => l.items.forEach(restyle)); return; }
      const g = (extra[k] || layers[k]).group;
      on ? g.addTo(map) : g.remove();
    });
  }
})();
