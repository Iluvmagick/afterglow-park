import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel } from '../src/level.js';
import { buildBrushGeometry, countTJunctions } from '../src/render/worldgeo.js';

const level = buildLevel();

test('world mesh is watertight: no T-junctions left to crack under vertex snapping', () => {
  assert.equal(countTJunctions(level.brushes), 0);
});

test('world mesh stays within a sane triangle budget', () => {
  let tris = 0;
  for (const { geometry } of buildBrushGeometry(level.brushes)) tris += geometry.attributes.position.count / 3;
  assert.ok(tris < 250000, `triangles: ${tris}`);
});

test('no holes: every face above the ground gets drawn', () => {
  // Splitting faces into cells and fixing T-junctions keeps the area, so the drawn triangles must
  // cover exactly the area of all faces that aren't buried. (Guessing which faces players can never
  // see once left holes in the far mountains you could look through.)
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
      const buried = Math.max(...f.poly.map((p) => p.y)) <= 0.01 && f.n.y < 0.5;
      if (!buried) expected += polyArea(f.poly);
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
