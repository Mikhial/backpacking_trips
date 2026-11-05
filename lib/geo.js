// Small geometry helpers shared by the trail map build steps.

const R = 6371008.8, rad = Math.PI / 180;

// Distance in meters between [lat, lon] points
export function dist(a, b) {
  const x = (b[1] - a[1]) * rad * Math.cos((a[0] + b[0]) / 2 * rad), y = (b[0] - a[0]) * rad;
  return Math.sqrt(x * x + y * y) * R;
}

// Douglas-Peucker in meters; keeps the first and last point and any extra values (like elevation)
export function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const xy = pts.map(p => [p[1] * rad * Math.cos(pts[0][0] * rad) * R, p[0] * rad * R]);
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let best = 0, bi = -1;
    for (let k = a + 1; k < b; k++) {
      const [px, py] = xy[k];
      const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > best) { best = d; bi = k; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, k) => keep[k]);
}

// Length, climb and descent for [lat, lon, ele] points. Elevations are smoothed and
// small wiggles (under 3 m) ignored, so the numbers are close to what mapping apps show.
export function measure(pts) {
  let len = 0;
  for (let k = 1; k < pts.length; k++) len += dist(pts[k - 1], pts[k]);
  const hasEle = pts.every(p => Number.isFinite(p[2]));
  if (!hasEle) return { len: Math.round(len), up: null, down: null };
  const raw = pts.map(p => p[2]);
  const sm = raw.map((_, k) => { let s = 0, c = 0; for (let w = -2; w <= 2; w++) { const v = raw[k + w]; if (v != null) { s += v; c++; } } return s / c; });
  let up = 0, down = 0, ref = sm[0];
  for (let k = 1; k < sm.length; k++) {
    const d = sm[k] - ref;
    if (Math.abs(d) >= 3) { d > 0 ? (up += d) : (down -= d); ref = sm[k]; }
  }
  return { len: Math.round(len), up: Math.round(up), down: Math.round(down) };
}

// Points from a GPX file (tracks, then routes), as [lat, lon, ele?]
export function parseGpx(text) {
  const pts = [];
  const re = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  let m, kind = null;
  while ((m = re.exec(text))) {
    if (kind && m[1] !== kind) continue;
    kind = kind || m[1];
    const lat = parseFloat((m[2].match(/lat="([^"]+)"/) || [])[1]);
    const lon = parseFloat((m[2].match(/lon="([^"]+)"/) || [])[1]);
    const ele = m[4] && parseFloat((m[4].match(/<ele>([^<]+)<\/ele>/) || [])[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push(Number.isFinite(ele) ? [lat, lon, ele] : [lat, lon]);
  }
  return pts;
}

// "38.8466, -120.2353" -> [38.8466, -120.2353], or null if it can't be read
export function parseLatLon(text) {
  const m = String(text ?? '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

// Distance in meters from a [lat, lon] point to the nearest point of a line of [lat, lon] points
export function distToLine(p, line) {
  const k = Math.cos(p[0] * rad);
  const xy = q => [(q[1] - p[1]) * rad * k * R, (q[0] - p[0]) * rad * R];
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const [ax, ay] = xy(line[i]);
    if (i === line.length - 1 || line.length === 1) { best = Math.min(best, Math.hypot(ax, ay)); break; }
    const [bx, by] = xy(line[i + 1]), dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
