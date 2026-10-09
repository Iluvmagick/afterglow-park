// The Poolrooms: the sealed tiled halls under the world, the piers that are the only ways in, and
// swimming. Bots play the set pieces in the real level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel } from '../src/level.js';
import { Sim } from '../src/sim.js';
import { EMPTY_CMD, STAND } from '../src/player.js';

const level = buildLevel();
const pool = level.pool;
const F = pool.floor;

function runBot(sim, ticks, policy) {
  const events = [];
  for (let i = 0; i < ticks; i++) {
    const c = policy(i, sim.player);
    if (!c) break;
    sim.tick({ ...EMPTY_CMD, ...c });
    for (const e of sim.events) events.push(e);
    sim.events.length = 0;
    const h = sim.player.hull;
    assert.ok(!sim.world.trace(sim.player.pos, sim.player.pos, h.mins, h.maxs).startsolid, `stuck at tick ${i}: ${JSON.stringify(sim.player.pos)}`);
  }
  return events;
}
const count = (events, type) => events.filter((e) => e.type === type).length;
const fresh = () => {
  const sim = new Sim(level);
  sim.events.length = 0;
  return sim;
};
// outward along each compass axis: d is the distance from the middle of the world
const SIDES = {
  N: { at: (d, s = 0) => ({ x: s, z: -d }), yaw: 0 },
  S: { at: (d, s = 0) => ({ x: -s, z: d }), yaw: Math.PI },
  E: { at: (d, s = 0) => ({ x: d, z: s }), yaw: -Math.PI / 2 },
  W: { at: (d, s = 0) => ({ x: -d, z: -s }), yaw: Math.PI / 2 },
};

test('the Poolrooms are under the world: nothing from above reaches down through the ceiling', () => {
  const inside = (b) => b.maxs.x > -pool.half && b.mins.x < pool.half && b.maxs.z > -pool.half && b.mins.z < pool.half;
  for (const b of level.brushes) {
    if (!inside(b)) continue;
    assert.ok(b.maxs.y <= pool.ceil + 0.01 || b.mins.y >= pool.ceil - 0.01, `brush crosses the ceiling: ${JSON.stringify(b.mins)} ${JSON.stringify(b.maxs)}`);
  }
});

for (const [side, { at, yaw }] of Object.entries(SIDES)) {
  test(`${side} pier: walk from the foot of the mountains into the pool, noclip into a hall's pool`, () => {
    const sim = fresh();
    const p = sim.player;
    const s = at(18700);
    p.reset({ x: s.x, y: 0.25, z: s.z }, yaw);
    const events = runBot(sim, 125 * 20, (i, pl) => (pl.swimming ? null : { yaw, forward: 1 }));
    assert.equal(count(events, 'noclip'), 1, 'should noclip once');
    assert.equal(count(events, 'respawn'), 0);
    assert.ok(sim.inPoolrooms(p.pos) && p.swimming, `should be swimming in the Poolrooms, at ${JSON.stringify(p.pos)}`);
  });
}

test('the piers: walking through the glowing doorway noclips you too', () => {
  for (const [side, { at, yaw }] of Object.entries(SIDES)) {
    const sim = fresh();
    const p = sim.player;
    const s = at(21300, 380); // beside the pool, lined up with the doorway
    p.reset({ x: s.x, y: 0.25, z: s.z }, yaw);
    const events = runBot(sim, 125 * 8, (i, pl) => (sim.inPoolrooms(pl.pos) ? null : { yaw, forward: 1 }));
    assert.equal(count(events, 'noclip'), 1, `${side}: should noclip through the door`);
  }
});

test('the piers are the only ways in: falling off the edge of the world anywhere else still respawns you', () => {
  for (const [side, { at, yaw }] of Object.entries(SIDES)) {
    for (let s = -17000; s <= 17000; s += 2125) {
      if (Math.abs(s) < 1200) continue; // the pier's landing
      const sim = fresh();
      const p = sim.player;
      const q = at(18400, s);
      p.reset({ x: q.x, y: 0.25, z: q.z }, yaw);
      let below = false;
      const events = runBot(sim, 125 * 4, (i, pl) => {
        below ||= sim.inPoolrooms(pl.pos);
        return { yaw, forward: 1 };
      });
      assert.ok(!below && count(events, 'noclip') === 0, `${side} s=${s}: got into the Poolrooms`);
      assert.equal(count(events, 'respawn'), 1, `${side} s=${s}: should fall off and respawn`);
    }
  }
});

test('every orb can be reached: none sits where a portal would take you away first', () => {
  for (const o of level.orbs) {
    // the player's box with its center on the orb
    const lo = { x: o.pos.x - 16, y: o.pos.y - 36, z: o.pos.z - 16 };
    const hi = { x: o.pos.x + 16, y: o.pos.y + 36, z: o.pos.z + 16 };
    for (const pt of pool.portals) {
      const overlap = hi.x >= pt.mins.x && lo.x <= pt.maxs.x && hi.y >= pt.mins.y && lo.y <= pt.maxs.y && hi.z >= pt.mins.z && lo.z <= pt.maxs.z;
      assert.ok(!overlap, `orb at ${JSON.stringify(o.pos)} is inside a portal's reach`);
    }
  }
});

test('the drain: dive to the grate and you wake up in the park', () => {
  const sim = fresh();
  const p = sim.player;
  const d = pool.spots.drain;
  p.reset({ x: d.x, y: F - 60, z: d.z }, 0);
  const events = runBot(sim, 125 * 8, (i, pl) => (pl.pos.y > 0 ? null : { yaw: 0, pitch: -1.4, forward: 1, crouch: true }));
  assert.equal(count(events, 'wake'), 1);
  const order = events.filter((e) => e.type === 'orb' || e.type === 'wake').map((e) => e.type);
  assert.deepEqual(order, ['orb', 'wake'], 'diving down the middle collects the drain orb on the way out');
  assert.ok(Math.abs(p.pos.y - 16) < 1 && Math.hypot(p.pos.x - level.spawn.pos.x, p.pos.z - level.spawn.pos.z) < 1, 'back at the spawn');
});

test('swimming: you float, and holding jump swims you up and out over the side', () => {
  const sim = fresh();
  const p = sim.player;
  p.reset({ x: 0, y: F - 200, z: 0 }, 0); // deep in the lap pool, idle
  runBot(sim, 125 * 6, () => ({}));
  assert.ok(Math.abs(p.waterDepth - p.move.swimFloat) < 4 && Math.abs(p.vel.y) < 5, `should bob at the surface, depth ${p.waterDepth}`);
  // from the bottom, facing the west side of the pool
  p.reset({ x: -400, y: F - 320 + 0.25, z: 0 }, Math.PI / 2);
  let out = false;
  runBot(sim, 125 * 6, (i, pl) => ((out = pl.onGround && pl.pos.y > F - 1) ? null : { yaw: Math.PI / 2, forward: 1, jump: true }));
  assert.ok(out, `should climb out onto the side, at ${JSON.stringify(p.pos)}`);
});

test('water: diving in slows your fall, but bunnyhopping through the shallows costs nothing', () => {
  const sim = fresh();
  const p = sim.player;
  p.reset({ x: 2800, y: F + 600, z: 0 }, 0); // above the diving pool
  let deepest = 0;
  runBot(sim, 125 * 3, (i, pl) => {
    deepest = Math.max(deepest, pl.waterDepth);
    return {};
  });
  assert.ok(deepest > 100 && deepest < 640, `dive depth ${deepest.toFixed(0)}`);
  // the shallows: a hop that lands fast keeps its speed
  p.reset({ x: -6000, y: F + 300, z: 1000 }, 0);
  p.vel = { x: 900, y: -500, z: 0 };
  runBot(sim, 40, () => ({}));
  assert.ok(Math.abs(p.vel.x) > 800, `kept speed through the shallows: ${p.vel.x.toFixed(0)}`);
});

test('the Natatorium: ride the Bubble Line from the west doorway round the hall into the deep end', () => {
  const sim = fresh();
  const p = sim.player;
  const b = pool.spots.bubbleLine;
  p.reset({ x: b.start.x, y: F + 8.25, z: b.start.z }, -Math.PI / 2);
  const events = runBot(sim, 125 * 10, (i, pl) => (i > 200 && pl.swimming ? null : { yaw: -Math.PI / 2, forward: i < 30 ? 1 : 0 }));
  assert.equal(count(events, 'ring'), b.rings);
  assert.ok(p.swimming && Math.hypot(p.pos.x, p.pos.z) < 300, `should end up in the lap pool, at ${JSON.stringify(p.pos)}`);
});

test('the Wave Pool: run off the platform and surf all three waves', () => {
  const sim = fresh();
  const p = sim.player;
  const w = pool.spots.wavePool;
  p.reset({ x: -40, y: w.platform.y + 0.25, z: w.platform.z - 60 }, Math.PI);
  const surfed = new Set();
  let top = 0;
  runBot(sim, 125 * 10, (i, pl) => {
    if (pl.swimming) return null;
    if (pl.pos.y > w.platform.y - 10) return { yaw: Math.PI, forward: 1 };
    const tr = pl.trace(pl.pos, { x: pl.pos.x, y: pl.pos.y - 6, z: pl.pos.z });
    if (tr.fraction < 1 && tr.normal.y < 0.7) surfed.add(w.waves.findIndex(([z0, z1]) => pl.pos.z > z0 - 20 && pl.pos.z < z1 + 20));
    top = Math.max(top, Math.hypot(pl.vel.x, pl.vel.z));
    return { yaw: Math.PI + (pl.pos.x < 0 ? -0.1 : 0.1), right: pl.pos.x < 0 ? -1 : 1 };
  });
  assert.deepEqual([...surfed].sort(), [0, 1, 2]);
  assert.ok(top > 900, `surf speed ${top.toFixed(0)}`);
});

test('the Helter-Skelter: from the top of the tower, slide all the way round and down into the splash pool', () => {
  const sim = fresh();
  const p = sim.player;
  const hs = pool.spots.helterSkelter;
  p.reset({ x: hs.c.x, y: hs.top + 0.25, z: hs.c.z }, 0);
  let fast = 0;
  runBot(sim, 125 * 25, (i, pl) => {
    if (pl.swimming) return null;
    const dx = pl.pos.x - hs.c.x;
    const dz = pl.pos.z - hs.c.z;
    const r = Math.hypot(dx, dz);
    if (r < 285 && pl.pos.y > hs.top - 1) return { yaw: Math.atan2(-(hs.start.x - pl.pos.x), -(hs.start.z - pl.pos.z)), forward: 1 };
    // look along the slide (it winds the way the angle grows), steering for the middle of the chute
    const a = Math.atan2(dz, dx);
    const k = ((hs.rin + hs.rout) / 2 - r) / 400;
    const d = { x: -Math.sin(a) + Math.cos(a) * k, z: Math.cos(a) + Math.sin(a) * k };
    fast = Math.max(fast, Math.hypot(pl.vel.x, pl.vel.z));
    return { yaw: Math.atan2(-d.x, -d.z), forward: 1, crouch: pl.onGround };
  });
  assert.ok(p.swimming && Math.hypot(p.pos.x - hs.splash.x, p.pos.z - hs.splash.z) < 500, `should splash into the pool, at ${JSON.stringify(p.pos)}`);
  assert.ok(fast > 550, `slide speed ${fast.toFixed(0)}`);
});

test('the Helter-Skelter: walking up the slide keeps your feet on it (no bumpy, wobbly climb)', () => {
  const sim = fresh();
  const p = sim.player;
  const hs = pool.spots.helterSkelter;
  const a0 = Math.PI / 4 - 0.05; // the bottom of the spiral
  p.reset({ x: hs.c.x + Math.cos(a0) * 395, y: F + 140, z: hs.c.z + Math.sin(a0) * 395 }, 0);
  let leaves = 0;
  let top = 0;
  let grounded = false;
  runBot(sim, 125 * 10, (i, pl) => {
    const dx = pl.pos.x - hs.c.x;
    const dz = pl.pos.z - hs.c.z;
    const a = Math.atan2(dz, dx);
    const k = ((hs.rin + hs.rout) / 2 - Math.hypot(dx, dz)) / 400;
    const d = { x: Math.sin(a) + Math.cos(a) * k, z: -Math.cos(a) + Math.sin(a) * k }; // up the slide
    if (grounded && !pl.onGround) leaves++;
    grounded = pl.onGround;
    top = Math.max(top, pl.pos.y - F);
    return { yaw: Math.atan2(-d.x, -d.z), forward: 1 };
  });
  assert.ok(top > 500, `climbed ${top.toFixed(0)}`);
  assert.ok(leaves <= 6, `left the ground ${leaves} times on the way up`);
});

test('the Diving Hall: crawl up the ladder; the springboards throw you up', () => {
  const sim = fresh();
  const p = sim.player;
  const d = pool.spots.divingHall;
  p.reset({ x: d.ladder.x - 120, y: F + 0.25, z: 0 }, -Math.PI / 2);
  let top = false;
  runBot(sim, 125 * 10, (i, pl) => ((top = pl.onGround && pl.pos.y > d.top.y - 2) ? null : { yaw: -Math.PI / 2, pitch: i < 20 ? 0 : 1.2, forward: 1, jump: i === 20 }));
  assert.ok(top, `should reach the top of the tower, at ${JSON.stringify(p.pos)}`);
  p.reset({ x: d.board.x, y: d.board.y + 0.25, z: d.board.z }, -Math.PI / 2);
  let peak = 0;
  const events = runBot(sim, 125 * 4, (i, pl) => {
    peak = Math.max(peak, pl.pos.y - d.board.y);
    return pl.swimming ? null : { yaw: -Math.PI / 2, forward: 1 };
  });
  assert.ok(count(events, 'bounce') > 0 && peak > 150, `springboard peak ${peak.toFixed(0)}`);
  assert.ok(p.swimming, 'and you land in the pool');
});

test('the Wallrun Baths: in through the south doorway, wall to wall along the channel to the north end', () => {
  const sim = fresh();
  const p = sim.player;
  const WX = -2600;
  p.reset({ x: WX, y: F + 0.25, z: 1700 }, 0);
  let side = -1;
  let held = 0;
  let landed = false;
  const events = runBot(sim, 125 * 12, (i, pl) => {
    if ((landed = pl.onGround && pl.pos.z < -1160) || pl.swimming) return null;
    if (pl.wall.active) {
      held++;
      return { yaw: 0, forward: 1, jump: held > 20 }; // run along the wall, then kick off
    }
    if (held) side = -side; // off a wall: go for the one on the other side
    held = 0;
    if (pl.pos.z > 1450) return { yaw: 0, forward: 1 };
    // aim at the next wall a little way ahead
    const tx = WX + side * 112;
    const tz = pl.pos.z - 200;
    return { yaw: Math.atan2(-(tx - pl.pos.x), -(tz - pl.pos.z)), forward: 1 };
  });
  assert.ok(count(events, 'wallrun') >= 5, `wallruns: ${count(events, 'wallrun')}`);
  assert.ok(landed, `should make it to the north end, at ${JSON.stringify(p.pos)}`);
});

test('the Drained Pool: up the ramp, drop into the bowl and skate it (slippery tile)', () => {
  const sim = fresh();
  const p = sim.player;
  const d = pool.spots.drainedPool;
  p.reset({ x: -3660, y: F + 0.25, z: -1850 }, 0);
  let onRim = false;
  let skate = 0;
  let fast = 0;
  runBot(sim, 125 * 14, (i, pl) => {
    if (!onRim) {
      onRim = pl.onGround && pl.pos.y > d.rim - 2 && pl.pos.x > -3480;
      return { yaw: pl.pos.z < -2770 ? -Math.PI / 2 : 0, forward: 1 };
    }
    if (pl.onGround && pl.surface === 'ice') skate++;
    fast = Math.max(fast, Math.hypot(pl.vel.x, pl.vel.z));
    return { yaw: Math.atan2(-(d.c.x - pl.pos.x), -(d.c.z - pl.pos.z)), forward: 1 };
  });
  assert.ok(onRim, 'should walk up the ramp onto the rim');
  assert.ok(skate > 500 && fast > 400, `skated ${skate} ticks, top speed ${fast.toFixed(0)}`);
});

test('the Steps: hop the stepping stones to the island, and the jet throws you up', () => {
  const sim = fresh();
  const p = sim.player;
  const s = pool.spots.steps;
  p.reset({ x: s.c.x, y: F + 0.25, z: s.c.z - 1000 }, Math.PI);
  let peak = 0;
  const events = runBot(sim, 125 * 6, (i, pl) => {
    const r = Math.hypot(pl.pos.x - s.c.x, pl.pos.z - s.c.z);
    peak = Math.max(peak, pl.pos.y - F);
    return { yaw: Math.PI, forward: r > 60 ? 1 : 0, jump: r < 930 };
  });
  assert.ok(count(events, 'bounce') > 0 && peak > 180, `jet peak ${peak.toFixed(0)}`);
});

test('fuzz: random inputs in the Poolrooms never leave the player inside geometry or let them out', () => {
  // a cheap deterministic RNG
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const sim = fresh();
  const p = sim.player;
  let c = { ...EMPTY_CMD };
  let yaw = 0;
  let away = true;
  for (let i = 0; i < 125 * 120; i++) {
    if (i % 1500 === 0 || away) {
      away = false;
      for (let k = 0; k < 30; k++) {
        const pos = { x: (rand() * 2 - 1) * 11000, y: F + 10 + rand() * 900, z: (rand() * 2 - 1) * 11000 };
        if (sim.world.boxFree(pos, STAND.mins, STAND.maxs)) {
          p.reset(pos, yaw);
          break;
        }
      }
    }
    if (i % 40 === 0) {
      c = { forward: [-1, 0, 1, 1][Math.floor(rand() * 4)], right: [-1, 0, 1][Math.floor(rand() * 3)], jump: rand() < 0.5, crouch: rand() < 0.25, dash: rand() < 0.15, grapple: rand() < 0.3, fire: rand() < 0.1 };
      yaw += (rand() - 0.5) * 3;
    }
    sim.tick({ ...EMPTY_CMD, ...c, yaw, pitch: Math.sin(i * 0.01) });
    away = sim.events.some((e) => e.type === 'respawn' || e.type === 'wake');
    sim.events.length = 0;
    if (away) continue; // the drain woke us up in the park: back down
    assert.ok(sim.inPoolrooms(p.pos), `got out of the Poolrooms at tick ${i}: ${JSON.stringify(p.pos)}`);
    const h = p.hull;
    assert.ok(!sim.world.trace(p.pos, p.pos, h.mins, h.maxs).startsolid, `stuck in solid at tick ${i}: ${JSON.stringify(p.pos)}`);
  }
});
