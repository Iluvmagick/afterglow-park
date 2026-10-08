import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrush } from '../src/brush.js';
import { boxBrush, floor, makePlayer, run, hspeed, assertFree } from './helpers.mjs';

const deg = (d) => (d * Math.PI) / 180;

test('ice: you keep sliding after letting go; normal ground stops you', () => {
  const ice = boxBrush(-20000, -64, -20000, 20000, 0, 20000, { phys: 'ice' });
  const p = makePlayer([ice], { x: 0, y: 0, z: 0 });
  run(p, 400, () => ({ forward: 1 }));
  assert.ok(hspeed(p) > 250, `ice run speed ${hspeed(p)}`);
  run(p, 250); // 2 seconds of coasting
  assert.ok(hspeed(p) > 150, `still gliding ${hspeed(p)}`);
  const q = makePlayer([floor()], { x: 0, y: 0, z: 0 });
  run(q, 200, () => ({ forward: 1 }));
  run(q, 250);
  assert.ok(hspeed(q) < 1);
});

test('ice: slopes pull you downhill even when standing still', () => {
  const len = 2000;
  const h = Math.tan(deg(20)) * len;
  const slope = createBrush(
    [
      { x: -400, y: 0, z: 0 },
      { x: 400, y: 0, z: 0 },
      { x: -400, y: h, z: 0 },
      { x: 400, y: h, z: 0 },
      { x: -400, y: 0, z: -len },
      { x: 400, y: 0, z: -len },
    ],
    { phys: 'ice' },
  );
  const p = makePlayer([floor(), slope], { x: 0, y: h - Math.tan(deg(20)) * 100 + 1, z: -100 });
  run(p, 125, () => ({}), () => assertFree(assert, p));
  assert.ok(p.pos.z < -200, `should slide downhill, z=${p.pos.z}`);
});

test('bounce: landing on a trampoline rebounds; crouch sticks the landing', () => {
  const tramp = boxBrush(-300, -64, -300, 300, 0, 300, { phys: 'bounce' });
  const p = makePlayer([floor(), tramp], { x: 0, y: 400, z: 0 });
  let maxY = 0;
  let bounced = false;
  run(p, 250, () => ({}), (i, pl) => {
    if (pl.events.some((e) => e.type === 'bounce')) bounced = true;
    if (bounced) maxY = Math.max(maxY, pl.pos.y);
    assertFree(assert, pl);
  });
  assert.ok(bounced, 'should bounce');
  assert.ok(maxY > 250, `rebound apex ${maxY}`);

  const q = makePlayer([floor(), tramp], { x: 0, y: 300, z: 0 });
  run(q, 200, () => ({ crouch: true }));
  assert.ok(q.onGround, 'crouching should stick the landing');
});

test('bounce: walking onto a flush trampoline launches you; holding jump pumps higher', () => {
  const tramp = boxBrush(-2000, -64, -3000, 2000, 0, -400, { phys: 'bounce' });
  const ground = boxBrush(-2000, -64, -400, 2000, 0, 2000);
  const p = makePlayer([ground, tramp], { x: 0, y: 0, z: 0 });
  let launched = false;
  run(p, 250, () => ({ forward: 1 }), (i, pl) => {
    if (pl.vel.y >= 550) launched = true;
  });
  assert.ok(launched, 'walking onto the trampoline should launch');
  // pump: hold jump for several bounces
  let apexes = [];
  let lastVy = 0;
  run(p, 125 * 10, () => ({ jump: true }), (i, pl) => {
    if (lastVy > 0 && pl.vel.y <= 0) apexes.push(pl.pos.y);
    lastVy = pl.vel.y;
  });
  assert.ok(apexes.length >= 3, `bounces ${apexes.length}`);
  assert.ok(apexes[apexes.length - 1] > apexes[0] + 100 && apexes[apexes.length - 1] > 450, `apexes ${apexes.map((a) => a.toFixed(0))}`);
});

test('bounce: bouncy walls reflect you', () => {
  const wall = boxBrush(200, 0, -2000, 232, 800, 2000, { phys: 'bounce' });
  const p = makePlayer([floor(), wall], { x: 0, y: 200, z: 0 });
  p.vel = { x: 600, y: 0, z: 100 };
  run(p, 60, () => ({}), () => assertFree(assert, p));
  assert.ok(p.vel.x < -300, `should bounce back, vx=${p.vel.x}`);
});

test('boost strips shoot you along their direction', () => {
  const strip = boxBrush(-100, -64, -3000, 100, 0, 3000, { phys: 'boost', boostDir: { x: 0, y: 0, z: -1 }, boostSpeed: 1200 });
  const p = makePlayer([floor(), strip], { x: 0, y: 0, z: 2500 });
  run(p, 60);
  assert.ok(-p.vel.z > 1000, `boosted vz=${p.vel.z}`);
});

test('sticky walls: crawl up by looking up, hang by letting go, pop over the top', () => {
  const pillar = boxBrush(-100, 0, -300, 100, 600, -100, { phys: 'sticky' });
  const p = makePlayer([floor(), pillar], { x: 0, y: 0, z: -60 }, 0);
  run(p, 5);
  // jump at the wall, look up, hold W
  run(p, 25, (i) => ({ forward: 1, jump: i === 0, pitch: deg(60) }));
  assert.ok(p.wall.active && p.wall.sticky, 'should stick');
  const y0 = p.pos.y;
  run(p, 60, () => ({ forward: 1, pitch: deg(60) }), () => assertFree(assert, p));
  assert.ok(p.pos.y - y0 > 120, `climbed ${p.pos.y - y0}`);
  run(p, 60, () => ({ pitch: deg(60) })); // let go of W: coast to a stop
  const y1 = p.pos.y;
  run(p, 60, () => ({ pitch: deg(60) }));
  assert.ok(p.wall.active && Math.abs(p.pos.y - y1) < 10, `hang drift ${p.pos.y - y1}`);
  let landedOnTop = false;
  run(p, 300, () => (landedOnTop ? {} : { forward: 1, pitch: deg(60) }), (i, pl) => {
    assertFree(assert, pl);
    if (pl.onGround && Math.abs(pl.pos.y - 600) < 1) landedOnTop = true;
  });
  assert.ok(landedOnTop, `should end up standing on top, y=${p.pos.y}`);
});

test('low gravity zones make you jump higher', () => {
  const p = makePlayer([floor()], { x: 0, y: 0, z: 0 });
  p.gravityScale = 0.45;
  run(p, 3);
  let maxY = 0;
  run(p, 200, (i) => ({ jump: i === 0 }), (i, pl) => (maxY = Math.max(maxY, pl.pos.y)));
  assert.ok(maxY > 100, `moon jump ${maxY}`);
});
