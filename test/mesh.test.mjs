import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel } from '../src/level.js';
import { buildBrushGeometry, countTJunctions, faceHidden } from '../src/render/worldgeo.js';
import { Sim } from '../src/sim.js';

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

test('no holes: every face that is not buried gets drawn', () => {
  // Splitting faces into cells and fixing T-junctions keeps the area, so the drawn triangles must
  // cover exactly the area of all faces that aren't buried. (Guessing which faces players can never
  // see once left holes in the far mountains you could look through.) Buried: in the ground between the
  // park and the Poolrooms, or explicitly never drawn (material 'none').
  const level = buildLevel();
  const polyArea = (poly) => {
    let a = { x: 0, y: 0, z: 0 };
    for (let i = 1; i + 1 < poly.length; i++) {
      const u = { x: poly[i].x - poly[0].x, y: poly[i].y - poly[0].y, z: poly[i].z - poly[0].z };
      const v = { x: poly[i + 1].x - poly[0].x, y: poly[i + 1].y - poly[0].y, z: poly[i + 1].z - poly[0].z };
      a = { x: a.x + u.y * v.z - u.z * v.y, y: a.y + u.z * v.x - u.x * v.z, z: a.z + u.x * v.y - u.y * v.x };
    }
    return Math.hypot(a.x, a.y, a.z) / 2;
  };
  let expected = 0;
  for (const b of level.brushes) {
    if (b.invisible) continue;
    for (const f of b.faces) {
      if (!faceHidden(b, f)) expected += polyArea(f.poly);
    }
  }
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

test('no flicker: no two drawn faces anywhere overlap in the same plane', () => {
  // Coplanar faces facing the same way fight over the same pixels (z-fighting), unless they're sealed
  // inside solid geometry where nobody can see them.
  const sim = new Sim(level);
  const planes = new Map();
  for (const b of level.brushes) {
    if (b.invisible) continue;
    for (const f of b.faces) {
      if (faceHidden(b, f)) continue;
      const k = [f.n.x, f.n.y, f.n.z].map((v) => Math.round(v * 1000)).join() + ',' + Math.round(f.d * 2);
      if (!planes.has(k)) planes.set(k, []);
      planes.get(k).push({ b, f });
    }
  }
  // project onto the plane's dominant axes and clip convex polygons
  const flat = (f) => {
    const a = Math.abs(f.n.x) > Math.abs(f.n.y) && Math.abs(f.n.x) > Math.abs(f.n.z) ? 'x' : Math.abs(f.n.y) > Math.abs(f.n.z) ? 'y' : 'z';
    const [u, v] = { x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y'] }[a];
    const pts = f.poly.map((q) => [q[u], q[v], q]);
    const area = pts.reduce((s2, q, i) => s2 + q[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * q[1], 0);
    return area < 0 ? pts.reverse() : pts;
  };
  const clip = (A, B) => {
    let out = A.map(([x, y]) => [x, y]);
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
  for (const list of planes.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [A, B] = [list[i], list[j]];
        const o = clip(flat(A.f), flat(B.f));
        if (o.length < 3) continue;
        const area = Math.abs(o.reduce((s2, q, k) => s2 + q[0] * o[(k + 1) % o.length][1] - o[(k + 1) % o.length][0] * q[1], 0)) / 2;
        if (area < 1) continue;
        // a point in the middle of the overlap, just in front of the faces: sealed inside a solid?
        const c = o.reduce((m, q) => [m[0] + q[0] / o.length, m[1] + q[1] / o.length], [0, 0]);
        const n = A.f.n;
        const a = Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z) ? 'x' : Math.abs(n.y) > Math.abs(n.z) ? 'y' : 'z';
        const [u, v] = { x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y'] }[a];
        const pt = { [u]: c[0], [v]: c[1] };
        pt[a] = (A.f.d - n[u] * pt[u] - n[v] * pt[v]) / n[a];
        const front = { x: pt.x + n.x, y: pt.y + n.y, z: pt.z + n.z };
        if (sim.world.trace(front, front).startsolid) continue;
        bad.push(`${area.toFixed(0)} units² at ${JSON.stringify(front)}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
