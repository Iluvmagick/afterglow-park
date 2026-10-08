import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel } from '../src/level.js';
import { Sim, DT } from '../src/sim.js';
import { EMPTY_CMD, STAND } from '../src/player.js';
import { mulberry32 } from '../src/math.js';

const level = buildLevel();
const ZERO = { x: 0, y: 0, z: 0 };
const cmd = (o = {}) => ({ ...EMPTY_CMD, ...o });

test('level builds with sane brushes', () => {
  assert.ok(level.brushes.length > 100);
  for (const b of level.brushes) {
    assert.ok(b.faces.length >= 4, 'brush with too few faces');
    for (const pl of b.planes) assert.ok(Number.isFinite(pl.d));
  }
});

test('spawn is free and the player lands on the plaza', () => {
  const sim = new Sim(level);
  const p = sim.player;
  assert.ok(sim.world.boxFree(p.pos, STAND.mins, STAND.maxs));
  for (let i = 0; i < 60; i++) sim.tick(cmd({ yaw: p.yaw }));
  assert.ok(p.onGround);
  assert.ok(Math.abs(p.pos.y - 16) < 1);
});

test('orbs and targets are not buried in geometry', () => {
  const sim = new Sim(level);
  for (const o of level.orbs) {
    const tr = sim.world.trace(o.pos, o.pos, { x: -10, y: -10, z: -10 }, { x: 10, y: 10, z: 10 });
    assert.ok(!tr.startsolid, `orb inside solid at ${JSON.stringify(o.pos)}`);
  }
  for (const t of level.targets) {
    const tr = sim.world.trace(t.pos, t.pos, ZERO, ZERO);
    assert.ok(!tr.startsolid, `target inside solid at ${JSON.stringify(t.pos)}`);
  }
});

test('every jump pad delivers the player to its target', () => {
  for (const [i, pad] of level.pads.entries()) {
    const sim = new Sim(level);
    const p = sim.player;
    p.reset({ x: pad.pos.x, y: pad.pos.y + 0.2, z: pad.pos.z }, 0);
    let launched = false;
    let ticks = 0;
    for (; ticks < 125 * 8; ticks++) {
      sim.tick(cmd({ yaw: p.yaw }));
      if (p.vel.y > 300) launched = true;
      if (launched && p.onGround) break;
    }
    assert.ok(launched, `pad ${i} did not launch`);
    const err = Math.hypot(p.pos.x - pad.target.x, p.pos.z - pad.target.z);
    assert.ok(err < 120, `pad ${i} landed ${err.toFixed(0)} units off target at ${JSON.stringify(p.pos)}`);
    assert.ok(Math.abs(p.pos.y - pad.target.y) < 40, `pad ${i} landed at wrong height ${p.pos.y}`);
  }
});

test('rocket jump launches you high', () => {
  const sim = new Sim(level);
  const p = sim.player;
  for (let i = 0; i < 30; i++) sim.tick(cmd({ yaw: p.yaw }));
  const y0 = p.pos.y;
  let maxY = y0;
  const pitch = -Math.PI / 2 + 0.05;
  for (let i = 0; i < 200; i++) {
    sim.tick(cmd({ yaw: p.yaw, pitch, fire: i === 0, jump: i === 2 }));
    maxY = Math.max(maxY, p.pos.y);
  }
  assert.ok(maxY - y0 > 180, `rocket jump height ${maxY - y0}`);
});

test('fuzz: random inputs never leave the player inside geometry', () => {
  const rand = mulberry32(42);
  const sim = new Sim(level);
  const p = sim.player;
  let c = cmd();
  let yaw = 0;
  let pitch = 0;
  let yawRate = 0;
  const N = 125 * 240; // four minutes of chaos
  let respawns = 0;
  for (let i = 0; i < N; i++) {
    if (i % 40 === 0) {
      c = cmd({
        forward: [-1, 0, 1, 1][Math.floor(rand() * 4)],
        right: [-1, 0, 1][Math.floor(rand() * 3)],
        jump: rand() < 0.5,
        crouch: rand() < 0.25,
        dash: rand() < 0.15,
        grapple: rand() < 0.3,
        fire: rand() < 0.1,
      });
      yawRate = (rand() - 0.5) * 0.08;
      pitch = (rand() - 0.4) * 1.4;
    }
    if (i % 1500 === 0) {
      // teleport somewhere random in the air to explore the whole map
      for (let k = 0; k < 20; k++) {
        const span = k % 2 ? 16000 : 3800; // half the time somewhere in the megacity
        const pos = { x: (rand() * 2 - 1) * span, y: 50 + rand() * (k % 2 ? 6000 : 1600), z: (rand() * 2 - 1) * span };
        if (sim.world.boxFree(pos, STAND.mins, STAND.maxs)) {
          p.reset(pos, yaw);
          break;
        }
      }
    }
    yaw += yawRate;
    const before = sim.events.length;
    sim.tick({ ...c, yaw, pitch });
    for (let k = before; k < sim.events.length; k++) if (sim.events[k].type === 'respawn') respawns++;
    if (sim.events.length > 1000) sim.events.length = 0;
    const h = p.hull;
    assert.ok(Number.isFinite(p.pos.x + p.pos.y + p.pos.z + p.vel.x + p.vel.y + p.vel.z), `NaN at tick ${i}`);
    const tr = sim.world.trace(p.pos, p.pos, h.mins, h.maxs);
    assert.ok(!tr.startsolid, `stuck in solid at tick ${i}: ${JSON.stringify(p.pos)} crouched=${p.crouched}`);
  }
  assert.ok(respawns < 20, `too many respawns (${respawns})`);
});
