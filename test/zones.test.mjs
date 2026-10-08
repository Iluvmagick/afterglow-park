// Bot runs through the special zones of the real level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel } from '../src/level.js';
import { Sim } from '../src/sim.js';
import { EMPTY_CMD } from '../src/player.js';

const level = buildLevel();
const deg = (d) => (d * Math.PI) / 180;

function runBot(sim, ticks, policy) {
  const events = [];
  for (let i = 0; i < ticks; i++) {
    const c = policy(i, sim.player);
    if (!c) break;
    sim.tick({ ...EMPTY_CMD, ...c });
    for (const e of sim.events) events.push(e);
    sim.events.length = 0;
    const h = sim.player.hull;
    assert.ok(!sim.world.trace(sim.player.pos, sim.player.pos, h.mins, h.maxs).startsolid, `stuck at tick ${i}`);
  }
  return events;
}

test('obelisk express: hold W on the feeder strip, ride all 16 rings to the halo', () => {
  const sim = new Sim(level);
  const p = sim.player;
  const helix = level.rings.filter((r) => r.style === 'obelisk');
  assert.equal(helix.length, 16);
  const r0 = helix[0];
  const d = { x: helix[1].pos.x - r0.pos.x, z: helix[1].pos.z - r0.pos.z };
  const l = Math.hypot(d.x, d.z);
  const yaw = Math.atan2(d.x / l, d.z / l) + Math.PI;
  p.reset({ x: r0.pos.x - (d.x / l) * 560, y: 8.25, z: r0.pos.z - (d.z / l) * 560 }, yaw);
  let ascended = false;
  const hit = new Set();
  runBot(sim, 125 * 14, (i, pl) => (ascended && pl.onGround ? null : { yaw, forward: i < 60 ? 1 : 0 })).forEach((e) => {
    if (e.type === 'ring') hit.add(helix.findIndex((r) => r.pos === e.pos));
    if (e.type === 'ascend') ascended = true;
  });
  assert.equal(hit.size, 16, `rings hit: ${[...hit]}`);
  assert.ok(ascended, 'should reach the summit');
  assert.ok(p.onGround && Math.abs(p.pos.y - level.obelisk.halo.y) < 1, `should land on the halo, y=${p.pos.y}`);
  assert.ok(sim.stats.awake);
});

test('obelisk: low gravity near it, normal gravity elsewhere', () => {
  const sim = new Sim(level);
  assert.ok(sim.gravityAt({ x: level.obelisk.x + 300, y: 0, z: level.obelisk.z }) < 0.5);
  assert.equal(sim.gravityAt({ x: 0, y: 0, z: 0 }), 1);
});

test('obelisk: you can wall-crawl its sticky faces to the summit', () => {
  const sim = new Sim(level);
  const p = sim.player;
  const ob = level.obelisk;
  // it floats above the pedestal: run at its south face, jump into it, look up and crawl
  p.reset({ x: ob.x, y: 32.25, z: ob.z + ob.hb + 150 }, 0);
  let ascended = false;
  runBot(sim, 125 * 14, (i, pl) => (ascended ? null : { yaw: 0, pitch: i < 25 ? 0 : deg(70), forward: 1, jump: i === 25 })).forEach((e) => {
    if (e.type === 'ascend') ascended = true;
  });
  assert.ok(ascended, `crawl should reach the summit, got to y=${p.pos.y.toFixed(0)}`);
});

test('east runway: the speed strip + kicker throws you clear over the surf line', () => {
  const sim = new Sim(level);
  const p = sim.player;
  p.reset({ x: 700, y: 16.25, z: 0 }, -Math.PI / 2);
  let maxX = 0;
  let airborne = false;
  runBot(sim, 125 * 4, (i, pl) => {
    if (pl.pos.x > 1800 && !pl.onGround) airborne = true;
    maxX = Math.max(maxX, pl.pos.x);
    if (airborne && pl.onGround) return null;
    return { yaw: -Math.PI / 2, forward: 1 };
  });
  assert.ok(airborne, 'should launch off the kicker');
  assert.ok(maxX > 3400, `should fly past the surf ramps, reached x=${maxX.toFixed(0)}`);
});

test('beanstalk: crawl the goo plank up onto the high sky island', () => {
  const sim = new Sim(level);
  const p = sim.player;
  // the plank spans z -2480..-2440; stand south of it facing north
  p.reset({ x: -500, y: 0.25, z: -2400 }, 0);
  let top = false;
  runBot(sim, 125 * 10, (i, pl) => {
    if (pl.onGround && pl.pos.y > 2000) top = true;
    if (top) return null;
    return { yaw: 0, pitch: deg(75), forward: 1, jump: i === 3 };
  });
  assert.ok(top, `should stand on the island, y=${p.pos.y.toFixed(0)}`);
});

test('ice bowl: the boost face flings you over the rim onto the ice', () => {
  const sim = new Sim(level);
  const p = sim.player;
  p.reset({ x: 1200, y: 0.25, z: -2600 + 900 }, 0); // south of the crater, facing north
  let onIce = false;
  runBot(sim, 125 * 5, (i, pl) => {
    if (pl.onGround && pl.surface === 'ice') onIce = true;
    return onIce ? null : { yaw: 0, forward: 1 };
  });
  assert.ok(onIce, 'should end up skating on the ice');
});

test('trampoline field: walking onto a trampoline launches you', () => {
  const sim = new Sim(level);
  const p = sim.player;
  p.reset({ x: -1150, y: 0.25, z: -1600 }, 0);
  let maxY = 0;
  runBot(sim, 125 * 3, (i, pl) => {
    maxY = Math.max(maxY, pl.pos.y);
    return { yaw: 0, forward: i < 60 ? 1 : 0 };
  });
  assert.ok(maxY > 150, `bounce height ${maxY}`);
});

test('vaporwave pass: the west lane carries you through both cliff walls, the east lane brings you back', () => {
  const sim = new Sim(level);
  const p = sim.player;
  p.reset({ x: -3900, y: 0.25, z: -160 }, Math.PI / 2); // facing west
  runBot(sim, 125 * 5, (i, pl) => (pl.pos.x < level.vapor.minX - 100 ? null : { yaw: Math.PI / 2, forward: 1 }));
  assert.ok(p.pos.x < level.vapor.minX - 100, `should reach the acropolis, x=${p.pos.x.toFixed(0)}`);
  p.reset({ x: level.vapor.minX - 150, y: 8.25, z: 160 }, -Math.PI / 2); // facing east
  runBot(sim, 125 * 5, (i, pl) => (pl.pos.x > -3950 ? null : { yaw: -Math.PI / 2, forward: 1 }));
  assert.ok(p.pos.x > -3950, `should get back into the park, x=${p.pos.x.toFixed(0)}`);
});

test('vaporwave: the glassy pool is skateable ice', () => {
  const sim = new Sim(level);
  const p = sim.player;
  p.reset({ x: -6000, y: 12.25, z: 0 }, Math.PI / 2);
  runBot(sim, 10, () => ({ yaw: Math.PI / 2 }));
  assert.equal(p.surface, 'ice');
});

test('megacity: the Sky Elevator carries you from the street up to the supertall sky deck', () => {
  const sim = new Sim(level);
  const p = sim.player;
  p.reset({ x: 0, y: 8.25, z: -6000 }, 0); // on the feeder strip, facing north
  let rings = 0;
  runBot(sim, 125 * 8, (i, pl) => (pl.onGround && pl.pos.y > 4900 ? null : { yaw: 0, forward: i < 40 ? 1 : 0 })).forEach((e) => {
    if (e.type === 'ring') rings++;
  });
  assert.ok(p.onGround && Math.abs(p.pos.y - 5000) < 2, `should stand on the sky deck, y=${p.pos.y.toFixed(0)} after ${rings} rings`);
});

test('megacity: the golden frame ring throws you onto the sky deck', () => {
  const sim = new Sim(level);
  const p = sim.player;
  // just park-side of the frame's ring, flying through it outward
  p.reset({ x: 6500 - 200, y: 1560, z: -6500 + 200 }, 0);
  p.vel = { x: 500, y: 0, z: -500 };
  runBot(sim, 125 * 6, (i, pl) => (pl.onGround ? null : {}));
  assert.ok(p.onGround && Math.abs(p.pos.y - 5000) < 2, `should land on the deck, at ${p.pos.x.toFixed(0)},${p.pos.y.toFixed(0)},${p.pos.z.toFixed(0)}`);
});

test('megacity: the Vaporway keeps you cruising on the deck at highway speed', () => {
  const sim = new Sim(level);
  const p = sim.player;
  const a = (0.5 * Math.PI * 2) / 16;
  p.reset({ x: Math.cos(a) * 11500, y: 320.25, z: Math.sin(a) * 11500 }, 0);
  let minY = Infinity;
  let maxSpeed = 0;
  runBot(sim, 125 * 10, (i, pl) => {
    if (i > 125) minY = Math.min(minY, pl.pos.y);
    maxSpeed = Math.max(maxSpeed, Math.hypot(pl.vel.x, pl.vel.z));
    return {};
  });
  assert.ok(minY > 300, `fell off the highway (min y ${minY.toFixed(0)})`);
  assert.ok(maxSpeed > 2200, `highway speed ${maxSpeed.toFixed(0)}`);
});

test('megacity: dropping into the Sail builds huge speed', () => {
  const sim = new Sim(level);
  const p = sim.player;
  p.reset({ x: 6000, y: 3600.25, z: -3300 }, Math.PI); // on the top deck facing south (down the sail)
  let maxSpeed = 0;
  runBot(sim, 125 * 8, (i, pl) => {
    maxSpeed = Math.max(maxSpeed, Math.hypot(pl.vel.x, pl.vel.y, pl.vel.z));
    return { yaw: Math.PI, forward: 1 };
  });
  assert.ok(maxSpeed > 1800, `sail speed ${maxSpeed.toFixed(0)}`);
});
