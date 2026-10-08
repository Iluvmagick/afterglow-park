// Convex "brushes" (Quake-style solids) built from a cloud of points.
// Each brush gets:
//  - faces: render polygons (CCW seen from outside)
//  - planes: collision planes = hull faces + axial bevels + edge bevels, which
//    makes "expand planes by the player box" an exact Minkowski sum.
import { sub, cross, dot, length, scale, normalize } from './math.js';

const EPS = 0.01;
const AXES = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
];

function addPlane(list, n, d) {
  for (const p of list) {
    if (dot(p.n, n) > 0.99999 && Math.abs(p.d - d) < 0.01) return false;
  }
  list.push({ n, d });
  return true;
}

function dedupePoints(points) {
  const out = [];
  for (const p of points) {
    if (!out.some((q) => Math.abs(q.x - p.x) < EPS && Math.abs(q.y - p.y) < EPS && Math.abs(q.z - p.z) < EPS)) {
      out.push({ x: p.x, y: p.y, z: p.z });
    }
  }
  return out;
}

function hullPlanes(pts) {
  const planes = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const c = cross(sub(pts[j], pts[i]), sub(pts[k], pts[i]));
        const l = length(c);
        if (l < 1e-6) continue;
        let nn = scale(c, 1 / l);
        let d = dot(nn, pts[i]);
        let front = 0;
        let back = 0;
        for (const p of pts) {
          const s = dot(nn, p) - d;
          if (s > EPS) front++;
          else if (s < -EPS) back++;
          if (front && back) break;
        }
        if (front && back) continue;
        if (!front && !back) continue; // degenerate (flat) point set
        if (front) {
          nn = scale(nn, -1);
          d = -d;
        }
        addPlane(planes, nn, d);
      }
    }
  }
  return planes;
}

function facePolygon(pts, plane) {
  const on = pts.filter((p) => Math.abs(dot(plane.n, p) - plane.d) < 0.05);
  if (on.length < 3) return [];
  const c = { x: 0, y: 0, z: 0 };
  for (const p of on) {
    c.x += p.x / on.length;
    c.y += p.y / on.length;
    c.z += p.z / on.length;
  }
  let u = normalize(sub(on[0], c));
  const v = cross(plane.n, u);
  const sorted = on
    .map((p) => {
      const r = sub(p, c);
      return { p, a: Math.atan2(dot(r, v), dot(r, u)) };
    })
    .sort((a, b) => a.a - b.a)
    .map((e) => e.p);
  // drop collinear points
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[(i + sorted.length - 1) % sorted.length];
    const b = sorted[i];
    const cc = sorted[(i + 1) % sorted.length];
    if (length(cross(sub(b, a), sub(cc, b))) > 1e-4) out.push(b);
  }
  return out;
}

export function createBrush(points, props = {}) {
  const pts = dedupePoints(points);
  const hp = hullPlanes(pts);
  const faces = [];
  for (const pl of hp) {
    const poly = facePolygon(pts, pl);
    if (poly.length >= 3) faces.push({ n: pl.n, d: pl.d, poly });
  }
  const mins = { x: Infinity, y: Infinity, z: Infinity };
  const maxs = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) {
    mins.x = Math.min(mins.x, p.x);
    mins.y = Math.min(mins.y, p.y);
    mins.z = Math.min(mins.z, p.z);
    maxs.x = Math.max(maxs.x, p.x);
    maxs.y = Math.max(maxs.y, p.y);
    maxs.z = Math.max(maxs.z, p.z);
  }
  const planes = hp.map((p) => ({ n: p.n, d: p.d }));
  // axial bevels (box faces of the Minkowski sum)
  addPlane(planes, { x: 1, y: 0, z: 0 }, maxs.x);
  addPlane(planes, { x: -1, y: 0, z: 0 }, -mins.x);
  addPlane(planes, { x: 0, y: 1, z: 0 }, maxs.y);
  addPlane(planes, { x: 0, y: -1, z: 0 }, -mins.y);
  addPlane(planes, { x: 0, y: 0, z: 1 }, maxs.z);
  addPlane(planes, { x: 0, y: 0, z: -1 }, -mins.z);
  // edge bevels (brush edge x box axis)
  for (const f of faces) {
    for (let i = 0; i < f.poly.length; i++) {
      const a = f.poly[i];
      const b = f.poly[(i + 1) % f.poly.length];
      const e = normalize(sub(b, a));
      for (const ax of AXES) {
        const c = cross(e, ax);
        const l = length(c);
        if (l < 1e-6) continue;
        for (const s of [1, -1]) {
          const nn = scale(c, s / l);
          let d = -Infinity;
          for (const p of pts) d = Math.max(d, dot(nn, p));
          if (Math.abs(dot(nn, a) - d) < 0.01) addPlane(planes, nn, d);
        }
      }
    }
  }
  return { points: pts, faces, planes, mins, maxs, ...props };
}
