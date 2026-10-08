import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrush } from '../src/brush.js';
import { World } from '../src/collision.js';
import { STAND } from '../src/player.js';
import { boxBrush, floor, makePlayer, run, hspeed, assertFree, DT } from './helpers.mjs';

const deg = (d) => (d * Math.PI) / 180;

test('trace: point ray hits top of box at the right fraction', () => {
  const w = new World([boxBrush(-100, 0, -100, 100, 100, 100)]);
  const tr = w.trace({ x: 0, y: 300, z: 0 }, { x: 0, y: -300, z: 0 });
  assert.ok(Math.abs(tr.endpos.y - 100) < 0.2, `endpos ${tr.endpos.y}`);
  assert.equal(tr.normal.y, 1);
});

test('trace: box sweep stops against wall, startsolid detected', () => {
  const w = new World([boxBrush(100, 0, -100, 200, 100, 100)]);
  const tr = w.trace({ x: 0, y: 10, z: 0 }, { x: 300, y: 10, z: 0 }, STAND.mins, STAND.maxs);
  assert.ok(Math.abs(tr.endpos.x - 84) < 0.2, `endpos ${tr.endpos.x}`);
  assert.equal(tr.normal.x, -1);
  const inside = w.trace({ x: 150, y: 10, z: 0 }, { x: 150, y: 10, z: 0 }, STAND.mins, STAND.maxs);
  assert.ok(inside.startsolid);
});

test('brush hull: wedge has 5 faces and correct slope normal', () => {
  const b = createBrush([
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 0 },
    { x: 0, y: 0, z: 100 },
    { x: 100, y: 0, z: 100 },
    { x: 100, y: 100, z: 0 },
    { x: 100, y: 100, z: 100 },
  ]);
  assert.equal(b.faces.length, 5);
  const slope = b.faces.find((f) => f.n.y > 0.1 && f.n.y < 0.9);
  assert.ok(slope);
  assert.ok(Math.abs(slope.n.y - Math.SQRT1_2) < 1e-6);
});

test('lands on the floor and comes to rest', () => {
  const p = makePlayer([floor()], { x: 0, y: 100, z: 0 });
  run(p, 250);
  assert.ok(p.onGround);
  assert.ok(Math.abs(p.pos.y) < 0.3, `y=${p.pos.y}`);
  assert.ok(Math.abs(p.vel.y) < 1e-6);
});

test('ground run reaches max speed, friction stops quickly', () => {
  const p = makePlayer([floor()], { x: 0, y: 0, z: 0 });
  run(p, 250, () => ({ forward: 1 }));
  assert.ok(Math.abs(hspeed(p) - 320) < 2, `speed ${hspeed(p)}`);
  run(p, 60);
  assert.ok(hspeed(p) < 1, `still moving ${hspeed(p)}`);
});

test('cannot run through a wall', () => {
  const p = makePlayer([floor(), boxBrush(-500, 0, -300, 500, 300, -200)], { x: 0, y: 0, z: 0 });
  run(p, 400, (i) => ({ forward: 1, yaw: deg(Math.sin(i * 0.05) * 60) }), () => assertFree(assert, p));
  assert.ok(p.pos.z > -200 + 16 - 0.01, `z=${p.pos.z}`);
});

test('climbs 16-unit stairs but not a 40-unit ledge', () => {
  const stairs = [];
  for (let i = 0; i < 8; i++) stairs.push(boxBrush(-200, 0, -100 - i * 32, 200, 16 + i * 16, -132 - i * 32));
  const p = makePlayer([floor(), ...stairs], { x: 0, y: 0, z: 0 });
  let maxY = 0;
  run(p, 300, () => ({ forward: 1 }), () => {
    assertFree(assert, p);
    maxY = Math.max(maxY, p.pos.y);
  });
  assert.ok(maxY > 127, `stairs y=${maxY}`);

  const q = makePlayer([floor(), boxBrush(-200, 0, -500, 200, 40, -100)], { x: 0, y: 0, z: 0 });
  run(q, 200, () => ({ forward: 1 }));
  assert.ok(q.pos.y < 1, `ledge y=${q.pos.y}`);
});

function wedgeBrush(angleDeg, len = 2000, width = 400) {
  const h = Math.tan(deg(angleDeg)) * len;
  return createBrush([
    { x: -width, y: 0, z: 0 },
    { x: width, y: 0, z: 0 },
    { x: -width, y: 0, z: -len },
    { x: width, y: 0, z: -len },
    { x: -width, y: h, z: -len },
    { x: width, y: h, z: -len },
  ]);
}

test('walks up a 30 degree slope', () => {
  const p = makePlayer([floor(), wedgeBrush(30)], { x: 0, y: 0, z: 100 });
  run(p, 500, () => ({ forward: 1 }), () => assertFree(assert, p));
  assert.ok(p.pos.y > 400, `y=${p.pos.y}`);
});

test('slides down a 60 degree slope (not walkable)', () => {
  const ramp = wedgeBrush(60, 400);
  const p = makePlayer([floor(), ramp], { x: 0, y: 400, z: -200 });
  let ever = false;
  run(p, 120, () => ({}), () => {
    if (p.onGround && p.pos.y > 20) ever = true;
  });
  assert.ok(!ever, 'should never be grounded on steep slope');
  assert.ok(p.pos.y < 300, `y=${p.pos.y}`);
});

test('bunny hop + air strafe gains speed', () => {
  const p = makePlayer([floor()], { x: 0, y: 0, z: 0 });
  run(p, 120, () => ({ forward: 1 }));
  run(p, 125 * 8, (i, pl) => {
    const v = pl.vel;
    const sp = Math.hypot(v.x, v.z);
    const vAng = Math.atan2(-v.z, v.x); // angle convention matching rightH(yaw)
    // keep wishdir (=right) just under 90 degrees from velocity (optimal strafe)
    return { right: 1, jump: true, yaw: vAng + Math.acos(Math.min(1, 15 / sp)) };
  });
  assert.ok(hspeed(p) > 600, `speed ${hspeed(p)}`);
});

test('surfing: strafing into a 60 degree ramp keeps you on it at speed', () => {
  // ridge along z, faces at 60 degrees
  const hw = 400 / Math.tan(deg(60));
  const ridge = createBrush([
    { x: -hw, y: 600, z: 2000 },
    { x: hw, y: 600, z: 2000 },
    { x: 0, y: 1000, z: 2000 },
    { x: -hw, y: 600, z: -2000 },
    { x: hw, y: 600, z: -2000 },
    { x: 0, y: 1000, z: -2000 },
  ]);
  // start just off the west face, moving along -z (yaw 0 faces -z; right = +x = into the ramp)
  const p = makePlayer([floor(), ridge], { x: -hw / 2 - 40, y: 800, z: 1500 }, 0);
  p.vel = { x: 0, y: 0, z: -700 };
  let minDist = Infinity;
  run(p, 125 * 2, () => ({ right: 1 }), (i, pl) => {
    if (i > 30) {
      const tr = pl.trace(pl.pos, { x: pl.pos.x + 8, y: pl.pos.y, z: pl.pos.z });
      if (tr.fraction < 1) minDist = Math.min(minDist, 1);
    }
  });
  assert.ok(p.pos.y > 600, `fell off: y=${p.pos.y}`);
  assert.ok(-p.vel.z > 680, `lost speed: vz=${p.vel.z}`);
  assert.equal(minDist, 1, 'should be touching the ramp');
});

test('slide: keeps speed far better than walking, and boosts', () => {
  const p = makePlayer([floor()], { x: 0, y: 0, z: 0 });
  run(p, 200, () => ({ forward: 1 }));
  run(p, 2, () => ({ forward: 1, crouch: true }));
  assert.ok(p.sliding, 'should be sliding');
  assert.ok(hspeed(p) > 400, `boost ${hspeed(p)}`);
  run(p, 60, () => ({ crouch: true }));
  assert.ok(hspeed(p) > 250, `slide speed after 0.5s ${hspeed(p)}`);
  run(p, 250, () => ({ crouch: true }));
  assert.ok(!p.sliding, 'flat-ground slide should end within a couple of seconds');
});

test('slide: accelerates downhill', () => {
  // slope going down toward -z
  const len = 3000;
  const h = Math.tan(deg(15)) * len;
  const slope = createBrush([
    { x: -400, y: 0, z: 0 },
    { x: 400, y: 0, z: 0 },
    { x: -400, y: h, z: 0 },
    { x: 400, y: h, z: 0 },
    { x: -400, y: 0, z: -len },
    { x: 400, y: 0, z: -len },
  ]);
  const p = makePlayer([floor(), slope], { x: 0, y: h + 2, z: -10 });
  run(p, 30, () => ({ forward: 1 }));
  const s0 = hspeed(p);
  run(p, 190, () => ({ forward: 1, crouch: true }), () => assertFree(assert, p));
  assert.ok(p.sliding);
  assert.ok(hspeed(p) > s0 + 250, `downhill slide speed ${s0} -> ${hspeed(p)}`);
});

test('wallrun: catches the wall, falls slowly, wall jump pushes off', () => {
  const wall = boxBrush(100, 0, -3000, 132, 800, 3000);
  const p = makePlayer([floor(), wall], { x: 80, y: 200, z: 0 }, 0);
  p.vel = { x: 0, y: 120, z: -420 };
  run(p, 2, () => ({ forward: 1 }));
  assert.ok(p.wall.active, 'wallrun should start');
  const y0 = p.pos.y;
  run(p, 125, () => ({ forward: 1 }), () => assertFree(assert, p));
  assert.ok(p.wall.active, 'still wallrunning after 1s');
  assert.ok(y0 - p.pos.y < 150, `dropped ${y0 - p.pos.y}`);
  assert.ok(hspeed(p) > 400, `wallrun speed ${hspeed(p)}`);
  run(p, 1, () => ({ forward: 1, jump: true }));
  assert.ok(!p.wall.active);
  assert.ok(p.vel.x < -250, `wall jump out vx=${p.vel.x}`);
  assert.ok(p.vel.y > 250, `wall jump up vy=${p.vel.y}`);
});

test('double jump only on a fresh press, once per air time', () => {
  const p = makePlayer([floor()], { x: 0, y: 0, z: 0 }, 0, { autoHop: false });
  run(p, 10);
  assert.ok(p.onGround);
  run(p, 1, () => ({ jump: true }));
  assert.ok(!p.onGround);
  run(p, 30, () => ({ jump: true })); // held: no double jump
  assert.equal(p.airJumps, 1);
  run(p, 2);
  const vyBefore = p.vel.y;
  run(p, 1, () => ({ jump: true }));
  assert.equal(p.airJumps, 0);
  assert.ok(p.vel.y > vyBefore && p.vel.y >= 280, `vy=${p.vel.y}`);
  run(p, 2);
  const vy2 = p.vel.y;
  run(p, 1, () => ({ jump: true }));
  assert.ok(p.vel.y < vy2, 'no third jump');
});

test('dash bursts to dash speed from standstill', () => {
  const p = makePlayer([floor()], { x: 0, y: 0, z: 0 });
  run(p, 5);
  run(p, 1, () => ({ dash: true }));
  assert.ok(hspeed(p) > 590, `dash speed ${hspeed(p)}`);
  const z0 = p.pos.z;
  run(p, 20);
  assert.ok(z0 - p.pos.z > 80, `dash distance ${z0 - p.pos.z}`);
});

test('mantle: jumping into a 90-unit ledge climbs it', () => {
  const p = makePlayer([floor(), boxBrush(-300, 0, -600, 300, 90, -100)], { x: 0, y: 0, z: -70 }, 0);
  run(p, 3);
  run(p, 150, (i) => ({ forward: 1, jump: i < 2 }), () => assertFree(assert, p));
  assert.ok(Math.abs(p.pos.y - 90) < 1, `y=${p.pos.y}`);
  assert.ok(p.onGround);
});

test('grapple pulls you toward the anchor and off the ground', () => {
  const p = makePlayer([floor(), boxBrush(-300, 0, -1300, 300, 2000, -1200)], { x: 0, y: 0, z: 0 }, 0);
  run(p, 3);
  p.pitch = deg(25);
  let air = false;
  run(p, 100, () => ({ grapple: true, pitch: deg(25) }), (i, pl) => {
    if (!pl.onGround) air = true;
    assertFree(assert, pl);
  });
  assert.ok(air, 'should leave the ground');
  assert.equal(p.hook.state, 'attached');
  assert.ok(p.pos.z < -330, `z=${p.pos.z}`);
});

test('crouch-jump: crouching in air keeps the head still and clears higher ledges', () => {
  const p = makePlayer([floor()], { x: 0, y: 0, z: 0 });
  run(p, 2);
  run(p, 10, () => ({ jump: true }));
  const eye0 = p.pos.y + p.hull.eye;
  run(p, 1, () => ({ crouch: true }));
  const eye1 = p.pos.y + p.hull.eye;
  assert.ok(p.crouched);
  assert.ok(Math.abs(eye1 + p.viewSmooth - eye0) < 6, `eye jumped ${eye0} -> ${eye1}`);
  run(p, 200, () => ({ crouch: true }));
  run(p, 50);
  assert.ok(!p.crouched && p.onGround, 'stands back up on the ground');
  assertFree(assert, p);
});
