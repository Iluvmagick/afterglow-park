import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel } from '../src/level.js';
import { buildBrushGeometry, carveFaces, countTJunctions, faceHidden } from '../src/render/worldgeo.js';
import { mulberry32 } from '../src/math.js';
import { POOL } from '../src/poolrooms.js';
import { boxBrush } from './helpers.mjs';

const level = buildLevel();

test('world mesh is watertight: no T-junctions left to crack under vertex snapping', () => {
  assert.equal(countTJunctions(level.brushes), 0);
});

test('world mesh stays within a sane triangle budget', () => {
  // the world above and the Poolrooms below are never drawn at the same time
  const tris = { over: 0, under: 0 };
  for (const { geometry, layer } of buildBrushGeometry(level.brushes)) tris[layer] += geometry.attributes.position.count / 3;
  assert.ok(tris.over < 250000, `triangles above: ${tris.over}`);
  assert.ok(tris.under < 100000, `triangles in the Poolrooms: ${tris.under}`);
});

const polyArea = (poly) => {
  let a = { x: 0, y: 0, z: 0 };
  for (let i = 1; i + 1 < poly.length; i++) {
    const u = { x: poly[i].x - poly[0].x, y: poly[i].y - poly[0].y, z: poly[i].z - poly[0].z };
    const v = { x: poly[i + 1].x - poly[0].x, y: poly[i + 1].y - poly[0].y, z: poly[i + 1].z - poly[0].z };
    a = { x: a.x + u.y * v.z - u.z * v.y, y: a.y + u.z * v.x - u.x * v.z, z: a.z + u.x * v.y - u.y * v.x };
  }
  return Math.hypot(a.x, a.y, a.z) / 2;
};
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const carved = carveFaces(level.brushes);
const pieces = carved.flatMap(({ f, pieces: polys }) =>
  polys.map((poly) => {
    const lo = { x: Infinity, y: Infinity, z: Infinity };
    const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const p of poly) for (const k of ['x', 'y', 'z']) [lo[k], hi[k]] = [Math.min(lo[k], p[k]), Math.max(hi[k], p[k])];
    return { f, poly, lo, hi, under: Math.max(...f.poly.map((p) => p.y)) <= POOL.ceil + 0.01 };
  }),
);
// a spatial hash of things with bounds lo..hi
const spatial = (items, size, pad = 0) => {
  const grid = new Map();
  const range = (lo, hi, fn) => {
    for (let x = Math.floor((lo.x - pad) / size); x <= Math.floor((hi.x + pad) / size); x++)
      for (let y = Math.floor((lo.y - pad) / size); y <= Math.floor((hi.y + pad) / size); y++)
        for (let z = Math.floor((lo.z - pad) / size); z <= Math.floor((hi.z + pad) / size); z++) fn(`${x},${y},${z}`);
  };
  for (const it of items) {
    range(it.lo, it.hi, (k) => {
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(it);
    });
  }
  return { grid, at: (p) => grid.get(`${Math.floor(p.x / size)},${Math.floor(p.y / size)},${Math.floor(p.z / size)}`) || [] };
};

test('every brush face is a convex polygon (carving relies on it)', () => {
  const dented = [];
  for (const b of level.brushes) {
    for (const f of b.faces) {
      const vs = f.poly;
      for (let i = 0; i < vs.length; i++) {
        const [a, c, d] = [vs[i], vs[(i + 1) % vs.length], vs[(i + 2) % vs.length]];
        const e1 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
        const e2 = { x: d.x - c.x, y: d.y - c.y, z: d.z - c.z };
        const turn = dot({ x: e1.y * e2.z - e1.z * e2.y, y: e1.z * e2.x - e1.x * e2.z, z: e1.x * e2.y - e1.y * e2.x }, f.n);
        if (turn <= 0) dented.push(JSON.stringify(c));
      }
    }
  }
  assert.deepEqual(dented, []);
});

test('carving: buried faces go, of two faces in the same place exactly one stays', () => {
  const UP = { x: 0, y: 1, z: 0 };
  const area = (brushes, b, n) =>
    carveFaces(brushes)
      .filter((c) => c.b === b && dot(c.f.n, n) > 0.99)
      .reduce((s, c) => s + c.pieces.reduce((t, poly) => t + polyArea(poly), 0), 0);
  const close = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, b);
  // a crate on the ground: the ground under it and its bottom are hidden
  const ground = boxBrush(-500, -64, -500, 500, 0, 500, { mat: 'grass' });
  const crate = boxBrush(-50, 0, -50, 50, 100, 50, { mat: 'crate' });
  assert.ok(close(area([ground, crate], ground, UP), 1000 * 1000 - 100 * 100));
  assert.ok(close(area([ground, crate], crate, { x: 0, y: -1, z: 0 }), 0));
  // overlapping blocks, one a unit lower: its top inside the other goes, and the other's side inside it
  const A = boxBrush(0, 0, 0, 200, 40, 200, { mat: 'stone' });
  const B = boxBrush(100, 0, 0, 300, 39, 200, { mat: 'stone' });
  assert.ok(close(area([A, B], B, UP), 100 * 200));
  assert.ok(close(area([A, B], A, { x: 1, y: 0, z: 0 }), 1 * 200));
  assert.ok(close(area([A, B], B, { x: -1, y: 0, z: 0 }), 0));
  // tops at the same height: drawn once, by the brush added later
  const C = boxBrush(100, 0, 0, 300, 40, 200, { mat: 'stone' });
  assert.ok(close(area([A, C], A, UP), 100 * 200));
  assert.ok(close(area([A, C], C, UP), 200 * 200));
  assert.ok(close(area([C, A], A, UP), 200 * 200));
  // ...unless the later one's top is never drawn: then it can't hide the other one's
  const D = boxBrush(100, 0, 0, 300, 40, 200, { mat: { top: 'none', side: 'stone' } });
  assert.ok(close(area([A, D], A, UP), 200 * 200));
  // collision-only brushes hide nothing
  const E = boxBrush(-50, 0, -50, 400, 400, 400, { mat: 'stone', invisible: true });
  assert.ok(close(area([A, E], A, UP), 200 * 200));
});

test('no holes: the drawn triangles cover exactly the carved faces', () => {
  // Cutting faces into cells and fixing T-junctions keeps the area, so the drawn triangles must
  // cover exactly the area of the faces' carved pieces (see the next test for the carving itself).
  let expected = 0;
  for (const { poly } of pieces) expected += polyArea(poly);
  let drawn = 0;
  for (const { geometry } of buildBrushGeometry(level.brushes)) {
    const pos = geometry.attributes.position.array;
    for (let i = 0; i < pos.length; i += 9) {
      drawn += polyArea([
        { x: pos[i], y: pos[i + 1], z: pos[i + 2] },
        { x: pos[i + 3], y: pos[i + 4], z: pos[i + 5] },
        { x: pos[i + 6], y: pos[i + 7], z: pos[i + 8] },
      ]);
    }
  }
  assert.ok(Math.abs(drawn - expected) / expected < 1e-4, `drawn ${drawn.toExponential(4)} vs faces ${expected.toExponential(4)}`);
});

test('carving: every bit of surface you can see is drawn exactly once, and nothing inside the world is', () => {
  // Random points all over every face of every drawn brush. Just in front of a point there's either
  // open air, and then looking back at the point you must see exactly one drawn surface facing you
  // (none: a hole; two: they'd flicker), or another brush, and then nothing may be drawn there.
  // (Points right at an edge or in a corner are skipped.)
  const M = 0.05;
  const OUT = 0.25;
  const solids = level.brushes.filter((b) => !b.invisible).map((b) => ({ b, lo: b.mins, hi: b.maxs }));
  const brushAt = spatial(solids, 512);
  const pieceAt = spatial(pieces, 256, 1);
  const rand = mulberry32(7);
  const holes = [];
  const doubled = [];
  const drawnInside = [];
  let samples = 0;
  for (const b of level.brushes) {
    if (b.invisible) continue;
    for (const f of b.faces) {
      if (faceHidden(b, f)) continue;
      const tris = [];
      for (let i = 1; i + 1 < f.poly.length; i++) tris.push([f.poly[0], f.poly[i], f.poly[i + 1]]);
      const areas = tris.map(polyArea);
      const total = areas.reduce((s, a) => s + a, 0);
      const count = Math.min(32, Math.max(6, Math.round(total / 20000)));
      for (let k = 0; k < count; k++) {
        let r = rand() * total;
        let t = 0;
        while (t < tris.length - 1 && r > areas[t]) r -= areas[t++];
        const [A, B, C] = tris[t];
        const s1 = Math.sqrt(rand());
        const s2 = rand();
        const w = [1 - s1, s1 * (1 - s2), s1 * s2];
        const p = { x: w[0] * A.x + w[1] * B.x + w[2] * C.x, y: w[0] * A.y + w[1] * B.y + w[2] * C.y, z: w[0] * A.z + w[1] * B.z + w[2] * C.z };
        const q = { x: p.x + f.n.x * OUT, y: p.y + f.n.y * OUT, z: p.z + f.n.z * OUT };
        // just in front of p: open air, or a brush p is pressed flat against or buried in
        let buried = false;
        let unsure = false; // q inside a brush p is neither pressed against nor in: a corner
        for (const { b: o } of brushAt.at(q)) {
          if (q.x < o.mins.x - M || q.x > o.maxs.x + M || q.y < o.mins.y - M || q.y > o.maxs.y + M || q.z < o.mins.z - M || q.z > o.maxs.z + M) continue;
          const dq = Math.min(...o.faces.map((g) => g.d - dot(q, g.n)));
          if (dq < -M) continue;
          const pressed = o.faces.some((g) => dot(g.n, f.n) < -0.9999 && Math.abs(dot(p, g.n) - g.d) < M);
          if (dq > M && (pressed || Math.min(...o.faces.map((g) => g.d - dot(p, g.n))) > M)) buried = true;
          else unsure = true;
        }
        // drawn pieces facing q that the line from q back to p crosses: well inside them / at least at their edge
        let strict = 0;
        let loose = 0;
        let parallel = 0; // of those, the ones (nearly) parallel to p's face
        let here = 0; // and the ones in p's own plane
        for (const pc of pieceAt.at(p)) {
          const n = pc.f.n;
          const cos = dot(n, f.n);
          if (cos < 0.05) continue;
          const along = (pc.f.d - dot(p, n)) / cos; // from p towards q
          if (along < -M || along > OUT + M) continue;
          const x = { x: p.x + f.n.x * along, y: p.y + f.n.y * along, z: p.z + f.n.z * along };
          let edge = Infinity;
          const vs = pc.poly;
          for (let i = 0; i < vs.length; i++) {
            const a = vs[i];
            const c = vs[(i + 1) % vs.length];
            const e = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
            const inward = { x: n.y * e.z - n.z * e.y, y: n.z * e.x - n.x * e.z, z: n.x * e.y - n.y * e.x };
            const l = Math.hypot(inward.x, inward.y, inward.z);
            if (l < 1e-9) continue;
            edge = Math.min(edge, ((x.x - a.x) * inward.x + (x.y - a.y) * inward.y + (x.z - a.z) * inward.z) / l);
          }
          if (edge > M) strict++;
          if (edge > -M) loose++;
          if (edge > -M && cos > 0.99) parallel++;
          if (edge > -M && Math.abs(along) <= M) here++;
        }
        if (strict !== loose || (unsure && !buried)) continue; // right at an edge
        samples++;
        const at = JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) });
        if (buried) {
          if (here) drawnInside.push(at);
        } else if (!loose) holes.push(at);
        else if (parallel > 1) doubled.push(at);
      }
    }
  }
  assert.ok(samples > 100000, `only ${samples} samples`);
  assert.deepEqual({ holes, doubled, drawnInside }, { holes: [], doubled: [], drawnInside: [] });
});

test('no flicker: drawn faces facing the same way never overlap closer than the depth buffer can tell apart', () => {
  // Two faces facing the same way, one a little behind the other, fight over the same pixels
  // (z-fighting) when the depth buffer can't tell which is in front. A 24-bit depth buffer with the
  // near plane at 4 units resolves about z²/(4 * 2^24) units at distance z (a few times that in
  // practice), and looking down from height h at two faces a gap g apart, they're g * z / h apart
  // along the line of sight: from ~10000 units up and 40000 away (the default view distance), that
  // takes a gap of about 32. Up close, the PS1 vertex snapping moves every face by up to half a
  // (low-res) pixel: at the lowest resolution and widest field of view, two faces can shift ~15
  // units apart, so even in the Poolrooms (where the haze ends at 6500) the gap must be 16.
  // Carving (worldgeo.js) already removed every face that's buried in or pressed against another
  // brush, so brushes can overlap freely; what's left are faces really standing apart.
  const MIN_GAP = { over: 32, under: 16 };
  const pad = MIN_GAP.over;
  const cells = spatial(pieces, 512, pad);
  const key = (p) => `${Math.floor((p.x - pad) / 512)},${Math.floor((p.y - pad) / 512)},${Math.floor((p.z - pad) / 512)}`;
  const axes = (n) => {
    const a = Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z) ? 'x' : Math.abs(n.y) > Math.abs(n.z) ? 'y' : 'z';
    return [a, ...{ x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y'] }[a]];
  };
  // project onto the plane's dominant axes and clip convex polygons
  const flat = (poly, u, v) => {
    const pts = poly.map((q) => [q[u], q[v]]);
    const area = pts.reduce((s2, q, i) => s2 + q[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * q[1], 0);
    return area < 0 ? pts.reverse() : pts;
  };
  const clip = (A, B) => {
    let out = A;
    for (let i = 0; i < B.length && out.length; i++) {
      const [c0, c1] = [B[i], B[(i + 1) % B.length]];
      const side = (q) => (c1[0] - c0[0]) * (q[1] - c0[1]) - (c1[1] - c0[1]) * (q[0] - c0[0]);
      const cut = out;
      out = [];
      for (let j = 0; j < cut.length; j++) {
        const [p0, p1] = [cut[j], cut[(j + 1) % cut.length]];
        const [s0, s1] = [side(p0), side(p1)];
        if (s0 > 1e-6) out.push(p0);
        if (s0 > 1e-6 !== s1 > 1e-6) out.push([p0[0] + ((p1[0] - p0[0]) * s0) / (s0 - s1), p0[1] + ((p1[1] - p0[1]) * s0) / (s0 - s1)]);
      }
    }
    return out;
  };
  const bad = [];
  for (const [cell, list] of cells.grid) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [A, B] = [list[i], list[j]];
        if (dot(A.f.n, B.f.n) < 0.99) continue; // (pieces of one face too: they may only meet at their edges)
        const gapMax = MIN_GAP[A.under ? 'under' : 'over'];
        if (A.lo.x > B.hi.x + gapMax || B.lo.x > A.hi.x + gapMax || A.lo.y > B.hi.y + gapMax || B.lo.y > A.hi.y + gapMax || A.lo.z > B.hi.z + gapMax || B.lo.z > A.hi.z + gapMax) continue;
        // each pair once: in the cell holding the corner where their boxes start overlapping
        if (key({ x: Math.max(A.lo.x, B.lo.x), y: Math.max(A.lo.y, B.lo.y), z: Math.max(A.lo.z, B.lo.z) }) !== cell) continue;
        const n = A.f.n;
        const m = B.f.n;
        const [a, u, v] = axes(n);
        const o = clip(flat(A.poly, u, v), flat(B.poly, u, v));
        if (o.length < 3) continue;
        const area = Math.abs(o.reduce((s2, q, k) => s2 + q[0] * o[(k + 1) % o.length][1] - o[(k + 1) % o.length][0] * q[1], 0)) / 2 / Math.abs(n[a]);
        if (area < 1) continue;
        // the gap between the two planes over the overlap
        let gap = Infinity;
        for (const [pu, pv] of o) {
          const ya = (A.f.d - n[u] * pu - n[v] * pv) / n[a];
          const yb = (B.f.d - m[u] * pu - m[v] * pv) / m[a];
          gap = Math.min(gap, Math.abs(ya - yb) * Math.abs(n[a]));
        }
        if (gap >= gapMax) continue;
        const c = o.reduce((s2, q) => [s2[0] + q[0] / o.length, s2[1] + q[1] / o.length], [0, 0]);
        const at = { [u]: Math.round(c[0]), [v]: Math.round(c[1]) };
        at[a] = Math.round((A.f.d - n[u] * c[0] - n[v] * c[1]) / n[a]);
        bad.push(`${area.toFixed(0)} units² ${gap.toFixed(1)} apart at ${JSON.stringify(at)}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
