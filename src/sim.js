// Deterministic game simulation: player + rockets + pickups + triggers. No DOM, no three.js,
// so it runs in node tests exactly like in the browser.
import * as M from './math.js';
import { World } from './collision.js';
import { Player } from './player.js';

export const TICK_RATE = 125;
export const DT = 1 / TICK_RATE;

export const WEAPON = {
  rocketSpeed: 1900,
  fireInterval: 0.8,
  radius: 170,
  selfKnock: 640,
};
const ROCKET_HALF = { x: 2, y: 2, z: 2 };
const ROCKET_HALF_NEG = { x: -2, y: -2, z: -2 };
const KILL_Y = -600;

export class Sim {
  constructor(level, moveOverrides) {
    this.level = level;
    this.world = new World(level.brushes);
    this.player = new Player(this.world, moveOverrides);
    this.rockets = [];
    this.events = [];
    this.orbs = level.orbs.map((o, i) => ({ ...o, id: i, taken: false }));
    this.targets = level.targets.map((t, i) => ({ ...t, id: i, alive: true, respawn: 0 }));
    this.pads = level.pads;
    this.rings = level.rings.map((r, i) => ({ ...r, id: i, cd: 0 }));
    this.time = 0;
    this.ticks = 0;
    this.fireCd = 0;
    this.rocketId = 0;
    this.stats = { orbs: 0, targets: 0, topSpeed: 0, ascensions: 0, awake: false };
    this.ascendLatch = false;
    this.respawn();
  }

  respawn() {
    const s = this.level.spawn;
    this.player.reset({ x: s.pos.x, y: s.pos.y + 0.25, z: s.pos.z }, s.yaw);
    this.eye = this.player.eye();
    this.prevEye = M.clone(this.eye);
    this.events.push({ type: 'respawn', yaw: s.yaw });
  }

  tick(cmd) {
    const p = this.player;
    const prevCenter = p.center();
    this.prevEye = this.eye;
    p.gravityScale = this.gravityAt(p.pos);
    p.tick(cmd, DT);
    for (const e of p.events) this.events.push(e);

    // weapon
    this.fireCd = Math.max(0, this.fireCd - DT);
    if (cmd.fire && this.fireCd <= 0) this.fireRocket();
    this.updateRockets();

    // triggers
    const pc = p.center();
    const h = p.hull;
    const pmin = M.add(p.pos, h.mins);
    const pmax = M.add(p.pos, h.maxs);
    for (const pad of this.pads) {
      if (p.t.pad > 0) break;
      if (pmax.x > pad.mins.x && pmin.x < pad.maxs.x && pmax.y > pad.mins.y && pmin.y < pad.maxs.y && pmax.z > pad.mins.z && pmin.z < pad.maxs.z) {
        p.launch(pad.launch);
        p.t.pad = 0.4;
        this.events.push({ type: 'pad', pos: pad.pos });
      }
    }
    for (const r of this.rings) {
      r.cd = Math.max(0, r.cd - DT);
      if (r.cd > 0) continue;
      const d0 = M.dot(M.sub(prevCenter, r.pos), r.axis);
      const d1 = M.dot(M.sub(pc, r.pos), r.axis);
      if ((d0 <= 0 && d1 > 0) || (d0 >= 0 && d1 < 0)) {
        const t = d0 / (d0 - d1);
        const hit = M.lerp(prevCenter, pc, t);
        if (M.dist(hit, r.pos) < r.radius) {
          const dir = d1 > d0 ? r.axis : M.scale(r.axis, -1);
          const sp = r.exact ? r.speed : Math.max(r.speed, M.length(p.vel));
          let v = M.scale(dir, sp);
          if (r.exact) {
            // restart from the exact crossing point (we're up to a tick past it), so precomputed
            // ring chains don't drift. We just swept through that spot, so it's free space.
            const back = { x: hit.x, y: hit.y - h.maxs.y * 0.5, z: hit.z };
            if (this.world.boxFree(back, h.mins, h.maxs)) p.pos = back;
          }
          if (r.target) {
            // homing ring: ballistic arc from here to the next ring's center in flightTime
            const c = p.center();
            const T = r.flightTime;
            v = { x: (r.target.x - c.x) / T, y: (r.target.y - c.y + 0.5 * r.gravity * T * T) / T, z: (r.target.z - c.z) / T };
          }
          p.launch(v);
          if (r.target) p.t.homing = r.flightTime;
          r.cd = 0.5;
          this.events.push({ type: 'ring', pos: r.pos });
        }
      }
    }
    for (const o of this.orbs) {
      if (o.taken) continue;
      const d = M.sub(o.pos, pc);
      if (Math.abs(d.x) < 44 && Math.abs(d.z) < 44 && Math.abs(d.y) < 60) {
        o.taken = true;
        this.stats.orbs++;
        this.events.push({ type: 'orb', pos: o.pos, count: this.stats.orbs, total: this.orbs.length });
      }
    }
    for (const t of this.targets) {
      if (!t.alive) {
        t.respawn -= DT;
        if (t.respawn <= 0) {
          t.alive = true;
          this.events.push({ type: 'targetBack', pos: t.pos });
        }
      }
    }

    this.checkSummit();
    if (p.pos.y < KILL_Y) this.respawn();
    this.stats.topSpeed = Math.max(this.stats.topSpeed, M.hlen(p.vel));
    const e = p.eye();
    e.y += p.viewSmooth;
    this.eye = e;
    this.time += DT;
    this.ticks++;
  }

  // Low-gravity fields (the obelisk). Fades in over the outer 150 units.
  gravityAt(pos) {
    let gs = 1;
    for (const z of this.level.gravityZones || []) {
      const k = M.clamp((z.r - Math.hypot(pos.x - z.x, pos.z - z.z)) / 150, 0, 1);
      gs = Math.min(gs, 1 + (z.scale - 1) * k);
    }
    return gs;
  }

  checkSummit() {
    const ob = this.level.obelisk;
    if (!ob) return;
    const p = this.player;
    const d = Math.hypot(p.pos.x - ob.x, p.pos.z - ob.z);
    if (!this.ascendLatch && d < ob.summitR && p.pos.y > ob.summitY) {
      this.ascendLatch = true;
      this.stats.ascensions++;
      this.stats.awake = true;
      this.events.push({ type: 'ascend', pos: { x: ob.x, y: ob.tip, z: ob.z }, count: this.stats.ascensions });
    } else if (this.ascendLatch && p.pos.y < ob.summitY - 1200) this.ascendLatch = false;
  }

  fireRocket() {
    const p = this.player;
    this.fireCd = WEAPON.fireInterval;
    const dir = M.viewDir(p.yaw, p.pitch);
    const eye = p.eye();
    this.rockets.push({ id: this.rocketId++, pos: eye, prev: eye, vel: M.scale(dir, WEAPON.rocketSpeed), life: 3 });
    this.events.push({ type: 'fire' });
  }

  updateRockets() {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.prev = r.pos;
      const end = M.madd(r.pos, r.vel, DT);
      const tr = this.world.trace(r.pos, end, ROCKET_HALF_NEG, ROCKET_HALF);
      let hitFrac = tr.fraction;
      // targets (segment vs sphere)
      const seg = M.sub(end, r.pos);
      const segLen = M.length(seg);
      for (const t of this.targets) {
        if (!t.alive) continue;
        const f = segSphere(r.pos, seg, segLen, t.pos, t.radius);
        if (f !== null && f < hitFrac) hitFrac = f;
      }
      r.life -= DT;
      if (hitFrac < 1) {
        const pt = M.madd(r.pos, seg, hitFrac);
        this.explode(pt);
        this.rockets.splice(i, 1);
      } else if (r.life <= 0) {
        this.rockets.splice(i, 1);
      } else r.pos = end;
    }
  }

  explode(pt) {
    const p = this.player;
    const h = p.hull;
    const closest = {
      x: M.clamp(pt.x, p.pos.x + h.mins.x, p.pos.x + h.maxs.x),
      y: M.clamp(pt.y, p.pos.y + h.mins.y, p.pos.y + h.maxs.y),
      z: M.clamp(pt.z, p.pos.z + h.mins.z, p.pos.z + h.maxs.z),
    };
    const d = M.dist(pt, closest);
    if (d < WEAPON.radius) {
      const f = 1 - d / WEAPON.radius;
      let dir = M.sub(p.center(), pt);
      dir = M.length(dir) < 1e-3 ? { x: 0, y: 1, z: 0 } : M.normalize(dir);
      p.applyImpulse(M.scale(dir, WEAPON.selfKnock * f));
    }
    for (const t of this.targets) {
      if (!t.alive) continue;
      if (M.dist(t.pos, pt) < WEAPON.radius * 0.6 + t.radius) {
        t.alive = false;
        t.respawn = 10;
        this.stats.targets++;
        this.events.push({ type: 'target', pos: t.pos });
      }
    }
    this.events.push({ type: 'explosion', pos: pt });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

// Returns fraction along seg (0..1) where it first hits the sphere, or null.
function segSphere(o, seg, segLen, c, r) {
  if (segLen < 1e-6) return null;
  const d = M.scale(seg, 1 / segLen);
  const oc = M.sub(o, c);
  const b = M.dot(oc, d);
  const cc = M.dot(oc, oc) - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > segLen) return cc < 0 ? 0 : null;
  return t / segLen;
}
