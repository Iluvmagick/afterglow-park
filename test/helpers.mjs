import { createBrush } from '../src/brush.js';
import { World } from '../src/collision.js';
import { Player, EMPTY_CMD } from '../src/player.js';
import { DT } from '../src/sim.js';

export { DT };

export function boxBrush(x0, y0, z0, x1, y1, z1, props = {}) {
  const pts = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push({ x, y, z });
  return createBrush(pts, props);
}

export function floor(size = 20000) {
  return boxBrush(-size, -64, -size, size, 0, size);
}

export function makePlayer(brushes, pos = { x: 0, y: 0, z: 0 }, yaw = 0, overrides) {
  const world = new World(brushes);
  const p = new Player(world, overrides);
  // rest a hair above surfaces like the trace epsilon would leave us
  p.reset({ x: pos.x, y: pos.y + 0.125, z: pos.z }, yaw);
  return p;
}

export function cmd(over = {}) {
  return { ...EMPTY_CMD, ...over };
}

// Run n ticks. cmdFn(tickIndex, player) returns a partial command (yaw defaults to player yaw).
export function run(p, n, cmdFn = () => ({}), onTick) {
  for (let i = 0; i < n; i++) {
    const c = cmd({ yaw: p.yaw, pitch: p.pitch, ...cmdFn(i, p) });
    p.tick(c, DT);
    if (onTick) onTick(i, p);
  }
  return p;
}

export const hspeed = (p) => Math.hypot(p.vel.x, p.vel.z);

export function assertFree(assert, p, msg = '') {
  const h = p.hull;
  const tr = p.world.trace(p.pos, p.pos, h.mins, h.maxs);
  assert.ok(!tr.startsolid, `player inside solid at ${JSON.stringify(p.pos)} ${msg}`);
}
