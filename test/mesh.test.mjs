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
