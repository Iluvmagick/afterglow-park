// The Mega-Parthenon's parkour routes: every single jump must be makeable (and there are no timers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel } from '../src/level.js';
import { Sim } from '../src/sim.js';
import { EMPTY_CMD } from '../src/player.js';

const level = buildLevel();
const deg = (d) => (d * Math.PI) / 180;

// Run up across step A and jump (with the mantle's help) onto step B. Returns true on success.
function hop(A, B) {
  const sim = new Sim(level);
  const p = sim.player;
  const dx = B.x - A.x;
  const dz = B.z - A.z;
  const l = Math.hypot(dx, dz);
  const dir = { x: dx / l, z: dz / l };
  const yaw = Math.atan2(-dir.x, -dir.z);
  const back = A.half - 22;
  p.reset({ x: A.x - dir.x * back, y: A.top + 0.25, z: A.z - dir.z * back }, yaw);
  let jumped = false;
  let done = false;
  for (let i = 0; i < 125 * 3 && !done; i++) {
    const along = (p.pos.x - A.x) * dir.x + (p.pos.z - A.z) * dir.z;
    const jump = !jumped && p.onGround && along > A.half - 24;
    if (jump) jumped = true;
    sim.tick({ ...EMPTY_CMD, yaw, forward: 1, jump });
    sim.events.length = 0;
    const onB = Math.abs(p.pos.x - B.x) < (B.beam ? 400 : B.half + 16) && Math.abs(p.pos.z - B.z) < (B.beam ? 400 : B.half + 16);
    if (B.crest) done = p.center().y > 1330 && Math.abs(p.pos.z - B.z) < 160;
    else done = p.onGround && onB && Math.abs(p.pos.y - B.top) < 2;
  }
  return done;
}

for (const course of ['peristyle', 'naos']) {
  test(`mega-parthenon: every jump of ${course} is makeable`, () => {
    const steps = level.parthenon.steps[course];
    assert.ok(steps.length > 5);
    const fails = [];
    for (let i = 0; i + 1 < steps.length; i++) {
      if (steps[i + 1].restart || steps[i].crest) continue;
      if (!hop(steps[i], steps[i + 1])) fails.push(`${i}->${i + 1} (top ${steps[i].top} -> ${steps[i + 1].top})`);
    }
    assert.deepEqual(fails, []);
  });
}

test('mega-parthenon: walking up the north pediment reaches its apex', () => {
  const sim = new Sim(level);
  const p = sim.player;
  const XC = level.parthenon.center.x;
  p.reset({ x: -12520, y: 1790, z: -3900 }, Math.PI / 2); // on the pediment's east end, facing west
  let reached = false;
  for (let i = 0; i < 125 * 8 && !reached; i++) {
    sim.tick({ ...EMPTY_CMD, yaw: Math.PI / 2, forward: 1 });
    reached = Math.abs(p.pos.x - XC) < 250 && p.pos.y > 2120;
  }
  assert.ok(reached, `got to ${p.pos.x.toFixed(0)},${p.pos.y.toFixed(0)}`);
});

test('no timers anywhere: walking the routes never starts a clock', () => {
  assert.equal(level.courses, undefined);
  const sim = new Sim(level);
  const p = sim.player;
  const walks = [
    [{ x: -14200, y: 180.25, z: -3400 }, Math.PI], // through the main door
    [{ x: -12300, y: 180.25, z: 0 }, Math.PI / 2], // off the east ramp into the colonnade
  ];
  for (const [pos, yaw] of walks) {
    p.reset(pos, yaw);
    for (let i = 0; i < 125 * 2; i++) {
      sim.tick({ ...EMPTY_CMD, yaw, forward: 1 });
      assert.ok(!sim.events.some((e) => e.type.startsWith('course')), 'no course events');
      sim.events.length = 0;
    }
  }
  assert.equal(sim.course, undefined);
});
