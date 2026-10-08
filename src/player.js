// Player movement: Quake 3 / Half-Life style core (ground accel, friction, air strafing,
// slide-move collision with stair stepping) plus modern movement tech:
// slide, wallrun, wall jump, double jump, dash, mantle and a grappling hook.
//
// Surfaces: brushes may carry a physics material in `brush.phys`:
//   'ice'    - almost no grip, slopes pull you downhill
//   'bounce' - trampolines / bouncy walls (hold jump to pump higher, crouch to stick the landing)
//   'boost'  - speed strips, push you along brush.boostDir up to brush.boostSpeed
//   'sticky' - wall-crawl: move wherever you look, hang by letting go of W
import * as M from './math.js';

export const MOVE = {
  gravity: 800,
  maxSpeed: 320,
  crouchSpeed: 150,
  accel: 10,
  friction: 6,
  stopSpeed: 100,
  airAccel: 12,
  airWishCap: 30, // classic bhop/surf air-strafe cap
  airControl: 100, // CPMA-style W-only steering
  jumpVel: 290,
  airJumps: 1,
  autoHop: true,
  stepSize: 18,
  coyoteTime: 0.12,
  jumpBuffer: 0.12,
  // slide
  slideStartSpeed: 230,
  slideEndSpeed: 110,
  slideFriction: 1.0,
  slideFrictionSlope: 0.2,
  slideBoost: 120,
  slideBoostMax: 620,
  slideBoostCooldown: 1.2,
  slideSteer: 8,
  // wallrun
  wallRunMinSpeed: 180,
  wallRunSpeed: 420,
  wallRunAccel: 3,
  wallRunGravity: 240,
  wallRunMaxTime: 2.2,
  wallJumpOut: 300,
  wallJumpUp: 330,
  // dash
  dashSpeed: 600,
  dashAdd: 90,
  dashTime: 0.16,
  dashCooldown: 1.0,
  // grapple
  hookRange: 2600,
  hookSpeed: 7000,
  hookPull: 1900,
  hookYank: 380,
  hookMaxSpeed: 1100,
  hookCooldown: 0.25,
  // mantle
  mantleHeight: 60,
  speedClamp: 4000,
  // surfaces
  iceFriction: 0.1,
  iceAccel: 1.5,
  iceSlideFriction: 0.04,
  bounce: 0.9, // restitution
  bounceMin: 560, // trampolines always give at least this much
  bounceWallMin: 300,
  bouncePump: 140, // extra per bounce while holding jump
  bounceMax: 1500,
  boostAccel: 2600,
  stickySpeed: 380,
  stickyGravity: 40,
  stickyMaxTime: 12,
};

export const STAND = { mins: M.vec(-16, 0, -16), maxs: M.vec(16, 72, 16), eye: 64 };
export const CROUCH = { mins: M.vec(-16, 0, -16), maxs: M.vec(16, 40, 16), eye: 34 };
const OVERCLIP = 1.001;
const MIN_WALK_NORMAL = 0.7;
const ZERO = M.vec();
const TIMERS = ['coyote', 'jumpBuf', 'slideBoost', 'dash', 'dashCd', 'wallCd', 'sameWall', 'knock', 'mantleCd', 'hook', 'pad'];

export function clipVelocity(v, n, overbounce) {
  let backoff = v.x * n.x + v.y * n.y + v.z * n.z;
  backoff = backoff < 0 ? backoff * overbounce : backoff / overbounce;
  return { x: v.x - n.x * backoff, y: v.y - n.y * backoff, z: v.z - n.z * backoff };
}

export const EMPTY_CMD = Object.freeze({
  forward: 0,
  right: 0,
  yaw: 0,
  pitch: 0,
  jump: false,
  crouch: false,
  dash: false,
  grapple: false,
  fire: false,
});

export class Player {
  constructor(world, moveOverrides = {}) {
    this.world = world;
    this.move = { ...MOVE, ...moveOverrides };
    this.reset(M.vec(), 0);
  }

  reset(pos, yaw = 0) {
    this.pos = M.clone(pos);
    this.vel = M.vec();
    this.yaw = yaw;
    this.pitch = 0;
    this.onGround = false;
    this.groundNormal = null;
    this.crouched = false;
    this.sliding = false;
    this.airJumps = this.move.airJumps;
    this.t = {};
    for (const k of TIMERS) this.t[k] = 0;
    this.noForward = 0;
    this.wall = { active: false, normal: null, time: 0, lastNormal: null, sticky: false };
    this.hook = { state: 'none', pos: null, origin: null, dir: null, target: null, anchor: null, hit: false, ropeLen: 0, travel: 0, maxTravel: 0 };
    this.prev = { jump: false, crouch: false, dash: false, grapple: false };
    this.events = [];
    this.contacts = [];
    this.groundBrush = null;
    this.gravityScale = 1; // set by the sim (low-gravity zones)
    this.viewSmooth = 0;
    this.lastAirVelY = 0;
    this.jumpedThisTick = false;
    this.time = 0;
    this.cmd = EMPTY_CMD;
  }

  get hull() {
    return this.crouched ? CROUCH : STAND;
  }
  get gravity() {
    return this.move.gravity * this.gravityScale;
  }
  get surface() {
    return this.groundBrush ? this.groundBrush.phys || null : null;
  }
  eye() {
    return { x: this.pos.x, y: this.pos.y + this.hull.eye, z: this.pos.z };
  }
  center() {
    return { x: this.pos.x, y: this.pos.y + this.hull.maxs.y * 0.5, z: this.pos.z };
  }
  trace(start, end) {
    const h = this.hull;
    return this.world.trace(start, end, h.mins, h.maxs);
  }
  emit(type, data) {
    this.events.push(data ? { type, ...data } : { type });
  }

  // ------------------------------------------------------------------ main tick
  tick(cmd, dt) {
    const mv = this.move;
    this.events.length = 0;
    this.contacts.length = 0;
    this.jumpedThisTick = false;
    this.time += dt;
    this.cmd = cmd;
    const jumpPressed = cmd.jump && !this.prev.jump;
    const crouchPressed = cmd.crouch && !this.prev.crouch;
    const dashPressed = cmd.dash && !this.prev.dash;
    const grapplePressed = cmd.grapple && !this.prev.grapple;
    this.yaw = cmd.yaw;
    this.pitch = cmd.pitch;
    for (const k of TIMERS) if (this.t[k] > 0) this.t[k] = Math.max(0, this.t[k] - dt);
    this.noForward = cmd.forward > 0 ? 0 : this.noForward + dt;

    this.updateDuck(cmd);
    this.groundTrace();

    // grappling hook
    if (grapplePressed && this.hook.state === 'none' && this.t.hook <= 0) this.fireHook();
    if (!cmd.grapple && (this.hook.state === 'flying' || this.hook.state === 'attached')) this.releaseHook();
    this.updateHook(dt);
    if (this.hook.state === 'attached') this.applyHook(dt);

    // dash
    if (dashPressed && this.t.dashCd <= 0) this.startDash(cmd);
    if (this.t.dash > 0 && (jumpPressed || (this.onGround && cmd.jump && mv.autoHop))) this.t.dash = 0;

    if (this.t.dash > 0) this.dashMove(dt);
    else if (this.wall.active) this.wallRunMove(cmd, dt, jumpPressed, crouchPressed);
    else if (this.onGround) this.walkMove(cmd, dt, jumpPressed, crouchPressed);
    else this.airMove(cmd, dt, jumpPressed);

    this.groundTrace();
    if (this.onGround) {
      if (this.wall.active) this.endWallRun();
    } else if (!this.wall.active && this.t.dash <= 0) {
      this.tryWallRun(cmd);
      if (!this.wall.active) this.tryMantle(cmd);
    }

    if (this.sliding) {
      if (!this.crouched) this.sliding = false;
      else if (this.onGround && M.hlen(this.vel) < mv.slideEndSpeed) {
        this.sliding = false;
        this.emit('slideEnd');
      }
    }

    const sp = M.length(this.vel);
    if (sp > mv.speedClamp) this.vel = M.scale(this.vel, mv.speedClamp / sp);
    this.viewSmooth *= Math.exp(-dt * 16);
    if (Math.abs(this.viewSmooth) < 0.01) this.viewSmooth = 0;
    this.prev = { jump: cmd.jump, crouch: cmd.crouch, dash: cmd.dash, grapple: cmd.grapple };
  }

  // ------------------------------------------------------------------ ground
  groundTrace() {
    const was = this.onGround;
    const end = { x: this.pos.x, y: this.pos.y - 0.25, z: this.pos.z };
    let tr = this.trace(this.pos, end);
    if (tr.allsolid) {
      this.unstick();
      tr = this.trace(this.pos, { x: this.pos.x, y: this.pos.y - 0.25, z: this.pos.z });
    }
    let ground = false;
    if (tr.fraction < 1 && !tr.allsolid) {
      if (this.vel.y > 0 && M.dot(this.vel, tr.normal) > 10) ground = false; // kicked off
      else ground = tr.normal.y >= MIN_WALK_NORMAL;
    }
    if (this.jumpedThisTick) ground = false;
    if (this.t.knock > 0 && this.vel.y > 0) ground = false;
    if (this.hook.state === 'attached' && this.hook.lift) ground = false;
    this.onGround = ground;
    this.groundNormal = ground ? tr.normal : null;
    const brush = ground ? tr.brush : null;
    const phys = brush ? brush.phys : null;
    if (phys && phys !== this.surface) this.emit('surface', { kind: phys });
    this.groundBrush = brush;
    if (ground && !was && phys === 'bounce' && !this.crouched) {
      // touched down on a trampoline without a hard collision (inside the trace epsilon): bounce anyway
      this.bounceLanding(Math.max(0, -this.lastAirVelY));
      return;
    }
    if (ground && !was) this.onLand();
    else if (!ground && was && !this.jumpedThisTick) this.t.coyote = this.move.coyoteTime;
  }

  onLand() {
    const mv = this.move;
    this.airJumps = mv.airJumps;
    this.t.coyote = 0;
    if (this.wall.active) this.endWallRun();
    const impact = Math.max(0, -this.lastAirVelY);
    this.emit('land', { speed: impact });
    if (this.crouched && !this.sliding && M.hlen(this.vel) > mv.slideStartSpeed && !(mv.autoHop && this.cmd.jump)) {
      this.startSlide();
    }
  }

  unstick() {
    const h = this.hull;
    for (const r of [1, 4, 12, 24]) {
      for (const dy of [0, 1, -1]) {
        for (const dx of [0, 1, -1]) {
          for (const dz of [0, 1, -1]) {
            const p = { x: this.pos.x + dx * r, y: this.pos.y + dy * r, z: this.pos.z + dz * r };
            if (this.world.boxFree(p, h.mins, h.maxs)) {
              this.pos = p;
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ crouch
  updateDuck(cmd) {
    if (cmd.crouch && !this.crouched) {
      const eyeBefore = this.pos.y + STAND.eye;
      if (!this.onGround) {
        // tuck the legs up so the head stays put (crouch-jump)
        const up = { x: this.pos.x, y: this.pos.y + (STAND.maxs.y - CROUCH.maxs.y), z: this.pos.z };
        if (this.world.boxFree(up, CROUCH.mins, CROUCH.maxs)) this.pos = up;
      }
      this.crouched = true;
      this.viewSmooth += eyeBefore - (this.pos.y + CROUCH.eye);
    } else if (!cmd.crouch && this.crouched) {
      this.tryStand();
    }
  }

  tryStand() {
    const eyeBefore = this.pos.y + CROUCH.eye;
    let target = null;
    if (!this.onGround) {
      const diff = STAND.maxs.y - CROUCH.maxs.y;
      const tr = this.world.trace(this.pos, { x: this.pos.x, y: this.pos.y - diff, z: this.pos.z }, CROUCH.mins, CROUCH.maxs);
      if (!tr.startsolid && this.world.boxFree(tr.endpos, STAND.mins, STAND.maxs)) target = tr.endpos;
    }
    if (!target && this.world.boxFree(this.pos, STAND.mins, STAND.maxs)) target = M.clone(this.pos);
    if (!target) return false;
    this.pos = target;
    this.crouched = false;
    this.sliding = false;
    this.viewSmooth += eyeBefore - (this.pos.y + STAND.eye);
    return true;
  }

  // ------------------------------------------------------------------ helpers
  wish(cmd, n) {
    let f = M.forwardH(this.yaw);
    let r = M.rightH(this.yaw);
    if (n) {
      f = M.normalize(clipVelocity(f, n, OVERCLIP));
      r = M.normalize(clipVelocity(r, n, OVERCLIP));
    }
    const w = {
      x: f.x * cmd.forward + r.x * cmd.right,
      y: f.y * cmd.forward + r.y * cmd.right,
      z: f.z * cmd.forward + r.z * cmd.right,
    };
    const l = M.length(w);
    return l < 1e-6 ? null : M.scale(w, 1 / l);
  }

  friction(dt, fric, useStop) {
    const v = this.vel;
    const speed = Math.sqrt(v.x * v.x + v.z * v.z);
    if (speed < 1) {
      this.vel = { x: 0, y: v.y, z: 0 };
      return;
    }
    const control = useStop && speed < this.move.stopSpeed ? this.move.stopSpeed : speed;
    let ns = speed - control * fric * dt;
    if (ns < 0) ns = 0;
    ns /= speed;
    this.vel = { x: v.x * ns, y: v.y * ns, z: v.z * ns };
  }

  accelerate(wishdir, wishspeed, accel, dt) {
    const cur = M.dot(this.vel, wishdir);
    const add = wishspeed - cur;
    if (add <= 0) return;
    let as = accel * dt * wishspeed;
    if (as > add) as = add;
    this.vel = M.madd(this.vel, wishdir, as);
  }

  airAccelerate(wishdir, wishspeed, accel, dt) {
    const capped = Math.min(wishspeed, this.move.airWishCap);
    const cur = M.dot(this.vel, wishdir);
    const add = capped - cur;
    if (add <= 0) return;
    let as = accel * wishspeed * dt;
    if (as > add) as = add;
    this.vel = M.madd(this.vel, wishdir, as);
  }

  airControl(cmd, wishdir, dt) {
    if (cmd.forward === 0 || cmd.right !== 0 || this.hook.state === 'attached') return;
    const speed = M.hlen(this.vel);
    if (speed < 1) return;
    let hx = this.vel.x / speed;
    let hz = this.vel.z / speed;
    const d = hx * wishdir.x + hz * wishdir.z;
    if (d <= 0) return;
    const k = 32 * this.move.airControl * d * d * dt;
    hx = hx * speed + wishdir.x * k;
    hz = hz * speed + wishdir.z * k;
    const l = Math.hypot(hx, hz);
    this.vel = { x: (hx / l) * speed, y: this.vel.y, z: (hz / l) * speed };
  }

  // ------------------------------------------------------------------ jumping
  doJump() {
    const mv = this.move;
    this.t.jumpBuf = 0;
    this.t.coyote = 0;
    this.onGround = false;
    this.groundNormal = null;
    this.jumpedThisTick = true;
    this.vel = { x: this.vel.x, y: Math.max(this.vel.y, 0) * 0.5 + mv.jumpVel, z: this.vel.z };
    this.emit(this.sliding ? 'slideJump' : 'jump');
    this.sliding = false;
  }

  doubleJump(cmd) {
    const mv = this.move;
    this.airJumps--;
    const wishdir = this.wish(cmd, null);
    const hs = M.hlen(this.vel);
    let vx = this.vel.x;
    let vz = this.vel.z;
    if (wishdir) {
      // partial redirect toward the input direction, keeping speed
      let cx = hs > 1 ? vx / hs : wishdir.x;
      let cz = hs > 1 ? vz / hs : wishdir.z;
      let nx = cx * 0.4 + wishdir.x * 0.6;
      let nz = cz * 0.4 + wishdir.z * 0.6;
      const l = Math.hypot(nx, nz);
      if (l < 1e-3) {
        nx = wishdir.x;
        nz = wishdir.z;
      } else {
        nx /= l;
        nz /= l;
      }
      const s = Math.max(hs, mv.maxSpeed * 0.75);
      vx = nx * s;
      vz = nz * s;
    }
    this.vel = { x: vx, y: Math.max(this.vel.y, mv.jumpVel), z: vz };
    this.t.jumpBuf = 0;
    this.emit('doubleJump');
  }

  // ------------------------------------------------------------------ move modes
  walkMove(cmd, dt, jumpPressed, crouchPressed) {
    const mv = this.move;
    if (this.surface === 'bounce' && !this.crouched) {
      this.trampoline();
      this.airMove(cmd, dt, false);
      return;
    }
    if ((mv.autoHop && cmd.jump) || jumpPressed || this.t.jumpBuf > 0) {
      this.doJump();
      this.airMove(cmd, dt, false);
      return;
    }
    const n = this.groundNormal;
    const surf = this.surface;
    if (!this.sliding && this.crouched && crouchPressed && M.hlen(this.vel) > mv.slideStartSpeed) this.startSlide();
    // gravity along the slope (used by slides and ice): downhill speeds you up
    const g = M.vec(0, -this.gravity, 0);
    const slopeGravity = M.sub(g, M.scale(n, M.dot(g, n)));

    if (this.sliding) {
      // grippy on flat ground, slippery on slopes (full effect from ~10 degrees)
      const steep = M.clamp((1 - n.y) / 0.015, 0, 1);
      const fric = surf === 'ice' ? mv.iceSlideFriction : mv.slideFriction + (mv.slideFrictionSlope - mv.slideFriction) * steep;
      this.friction(dt, fric, false);
      this.vel = M.madd(this.vel, slopeGravity, dt);
      const wishdir = this.wish(cmd, n);
      if (wishdir) this.airAccelerate(wishdir, mv.maxSpeed, mv.slideSteer, dt);
    } else {
      if (this.t.knock <= 0 && surf !== 'boost') this.friction(dt, surf === 'ice' ? mv.iceFriction : mv.friction, true);
      if (surf === 'ice') this.vel = M.madd(this.vel, slopeGravity, dt);
      const wishdir = this.wish(cmd, n);
      if (wishdir) this.accelerate(wishdir, this.crouched ? mv.crouchSpeed : mv.maxSpeed, surf === 'ice' ? mv.iceAccel : mv.accel, dt);
    }
    if (surf === 'boost') {
      const b = this.groundBrush;
      const cur = M.dot(this.vel, b.boostDir);
      if (cur < b.boostSpeed) this.vel = M.madd(this.vel, b.boostDir, Math.min(mv.boostAccel * dt, b.boostSpeed - cur));
    }

    const speed = M.length(this.vel);
    this.vel = clipVelocity(this.vel, n, OVERCLIP);
    const l = M.length(this.vel);
    if (l > 1e-6) this.vel = M.scale(this.vel, speed / l);
    if (Math.abs(this.vel.x) < 1e-6 && Math.abs(this.vel.z) < 1e-6) return;
    this.stepSlideMove(false, dt);
    if (this.t.knock <= 0) this.stayOnGround();
  }

  airMove(cmd, dt, jumpPressed) {
    const mv = this.move;
    if (jumpPressed) {
      if (this.hook.state === 'attached') {
        this.releaseHook();
        this.vel = { x: this.vel.x, y: Math.max(this.vel.y, mv.jumpVel * 0.9), z: this.vel.z };
        this.emit('jump');
      } else if (this.t.coyote > 0) {
        this.doJump();
      } else if (this.airJumps > 0) {
        this.doubleJump(cmd);
      } else {
        this.t.jumpBuf = mv.jumpBuffer;
      }
    }
    const wishdir = this.wish(cmd, null);
    if (wishdir) {
      this.airAccelerate(wishdir, mv.maxSpeed, mv.airAccel, dt);
      this.airControl(cmd, wishdir, dt);
    }
    this.lastAirVelY = this.vel.y - this.gravity * dt;
    this.slideMove(true, dt);
  }

  // Standing (or walking) onto a trampoline launches you.
  trampoline() {
    this.bounceLanding(0);
  }

  bounceLanding(impact) {
    const mv = this.move;
    const vy = M.clamp(impact * mv.bounce + (this.cmd.jump ? mv.bouncePump : 0), mv.bounceMin, mv.bounceMax);
    this.vel = { x: this.vel.x, y: Math.max(this.vel.y, vy), z: this.vel.z };
    this.onGround = false;
    this.groundNormal = null;
    this.groundBrush = null;
    this.jumpedThisTick = true;
    this.sliding = false;
    this.airJumps = mv.airJumps;
    this.emit('bounce', { speed: vy });
  }

  // Hitting a bouncy surface: reflect instead of sliding along it. Returns true if we bounced.
  bounceOff(n) {
    const mv = this.move;
    const into = M.dot(this.vel, n);
    if (into > -60) return false;
    const floor = n.y >= MIN_WALK_NORMAL;
    if (floor && this.crouched) return false; // crouch to stick the landing
    let out = -into * mv.bounce;
    if (floor) out = Math.max(out + (this.cmd.jump ? mv.bouncePump : 0), mv.bounceMin);
    else out = Math.max(out, mv.bounceWallMin);
    out = Math.min(out, mv.bounceMax);
    this.vel = M.madd(this.vel, n, out - into);
    if (this.wall.active) this.endWallRun();
    this.airJumps = mv.airJumps;
    this.sliding = false;
    this.emit('bounce', { speed: out, wall: !floor });
    return true;
  }

  startSlide() {
    const mv = this.move;
    this.sliding = true;
    const hs = M.hlen(this.vel);
    if (this.t.slideBoost <= 0 && hs < mv.slideBoostMax && hs > 1) {
      const ns = Math.min(hs + mv.slideBoost, mv.slideBoostMax);
      this.vel = { x: (this.vel.x * ns) / hs, y: this.vel.y, z: (this.vel.z * ns) / hs };
      this.t.slideBoost = mv.slideBoostCooldown;
    }
    this.emit('slide');
  }

  // ------------------------------------------------------------------ dash
  startDash(cmd) {
    const mv = this.move;
    const dir = this.wish(cmd, null) || M.forwardH(this.yaw);
    const hs = M.hlen(this.vel);
    const ns = Math.max(mv.dashSpeed, hs + mv.dashAdd);
    this.vel = { x: dir.x * ns, y: this.onGround ? this.vel.y : Math.max(this.vel.y, 0), z: dir.z * ns };
    this.t.dash = mv.dashTime;
    this.t.dashCd = mv.dashCooldown;
    if (this.wall.active) this.endWallRun();
    this.emit('dash');
  }

  dashMove(dt) {
    if (this.onGround) {
      const speed = M.length(this.vel);
      this.vel = clipVelocity(this.vel, this.groundNormal, OVERCLIP);
      const l = M.length(this.vel);
      if (l > 1e-6) this.vel = M.scale(this.vel, speed / l);
      this.stepSlideMove(false, dt);
      this.stayOnGround();
    } else {
      this.lastAirVelY = this.vel.y;
      this.slideMove(false, dt);
    }
  }

  // ------------------------------------------------------------------ wallrun
  tryWallRun(cmd) {
    const mv = this.move;
    if (this.crouched || this.t.wallCd > 0 || this.hook.state === 'attached' || cmd.forward <= 0) return;
    // need some air under the feet
    if (this.trace(this.pos, { x: this.pos.x, y: this.pos.y - 24, z: this.pos.z }).fraction < 1) return;
    const hs = M.hlen(this.vel);
    const hv = hs > 1 ? { x: this.vel.x / hs, y: 0, z: this.vel.z / hs } : null;
    const probes = [M.forwardH(this.yaw)]; // straight ahead: sticky walls grab you head-on
    if (hv) probes.push({ x: -hv.z, y: 0, z: hv.x }, { x: hv.z, y: 0, z: -hv.x });
    const candidates = [];
    for (const d of probes) {
      const tr = this.trace(this.pos, M.madd(this.pos, d, 20));
      if (tr.fraction < 1 && !tr.startsolid) candidates.push({ n: tr.normal, brush: tr.brush });
    }
    for (const c of this.contacts) candidates.push(c);
    let best = null;
    let bestAlong = 0.75;
    for (const { n, brush } of candidates) {
      if (Math.abs(n.y) > 0.2) continue;
      const nh = M.hnorm(n);
      if (!nh) continue;
      if (this.wall.lastNormal && this.t.sameWall > 0 && M.dot(nh, this.wall.lastNormal) > 0.9) continue;
      // the wall must be right beside us (the same check that keeps a wallrun going), otherwise a
      // probe that clipped the wall's end corner would start a wallrun that drops on the next tick
      const chk = this.trace(this.pos, M.madd(this.pos, nh, -24));
      const cn = chk.fraction < 1 && !chk.startsolid && Math.abs(chk.normal.y) <= 0.2 ? M.hnorm(chk.normal) : null;
      if (!cn || M.dot(cn, nh) < 0.7) continue;
      if (brush && brush.phys === 'sticky') {
        this.startWallRun(nh, true); // goo grabs you at any speed and angle
        return;
      }
      if (!hv || hs < mv.wallRunMinSpeed) continue;
      const along = Math.abs(hv.x * nh.x + hv.z * nh.z);
      if (along >= bestAlong) continue;
      best = nh;
      bestAlong = along;
    }
    if (best) this.startWallRun(best, false);
  }

  startWallRun(n, sticky) {
    const into = M.dot(this.vel, n);
    let v = into < 0 ? M.madd(this.vel, n, -into) : M.clone(this.vel);
    v.y = v.y < 0 ? v.y * 0.25 : Math.min(v.y, 260);
    this.vel = v;
    this.wall.active = true;
    this.wall.normal = n;
    this.wall.time = 0;
    this.wall.sticky = sticky;
    this.airJumps = this.move.airJumps;
    this.emit(sticky ? 'stick' : 'wallrun');
  }

  endWallRun() {
    this.wall.active = false;
    this.wall.sticky = false;
    this.wall.lastNormal = this.wall.normal;
    this.t.sameWall = 0.5;
    this.t.wallCd = 0.2;
  }

  wallRunMove(cmd, dt, jumpPressed, crouchPressed) {
    const mv = this.move;
    const w = this.wall;
    w.time += dt;
    const tr = this.trace(this.pos, M.madd(this.pos, w.normal, -24));
    let lost = tr.fraction >= 1 || tr.startsolid || Math.abs(tr.normal.y) > 0.2;
    if (!lost) {
      const nh = M.hnorm(tr.normal);
      if (!nh || M.dot(nh, w.normal) < 0.7) lost = true;
      else {
        w.normal = nh;
        w.sticky = !!tr.brush && tr.brush.phys === 'sticky';
      }
    }
    if (jumpPressed && !lost) {
      this.wallJump();
      this.airMove(cmd, dt, false);
      return;
    }
    if (lost && w.sticky && this.vel.y > 60) {
      // crawled over the top edge: pop up and over so you land on top instead of sliding back
      this.vel = { x: this.vel.x - w.normal.x * 170, y: M.clamp(this.vel.y, 140, 210), z: this.vel.z - w.normal.z * 170 };
    }
    const maxTime = w.sticky ? mv.stickyMaxTime : mv.wallRunMaxTime;
    if (lost || crouchPressed || this.crouched || w.time > maxTime || (!w.sticky && this.noForward > 0.15)) {
      this.endWallRun();
      this.airMove(cmd, dt, false);
      return;
    }
    const n = w.normal;
    if (w.sticky) {
      this.stickyMove(cmd, dt, n);
      return;
    }
    const vn = this.vel.x * n.x + this.vel.z * n.z;
    let tx = this.vel.x - n.x * vn;
    let tz = this.vel.z - n.z * vn;
    let tl = Math.hypot(tx, tz);
    if (tl < 1) {
      const f = M.forwardH(this.yaw);
      const fn = f.x * n.x + f.z * n.z;
      tx = f.x - n.x * fn;
      tz = f.z - n.z * fn;
      const l = Math.hypot(tx, tz);
      if (l < 1e-3) {
        this.endWallRun();
        this.airMove(cmd, dt, false);
        return;
      }
      tx /= l;
      tz /= l;
      tl = 0;
    } else {
      tx /= tl;
      tz /= tl;
    }
    let along = tl;
    if (along < mv.wallRunSpeed) along += (mv.wallRunSpeed - along) * Math.min(1, mv.wallRunAccel * dt);
    const g = (w.time < 0.3 ? mv.wallRunGravity * 0.3 : mv.wallRunGravity * (1 + (w.time - 0.3) * 0.7)) * this.gravityScale;
    const vy = Math.max(-500, this.vel.y - g * dt);
    this.vel = { x: tx * along - n.x * 40, y: vy, z: tz * along - n.z * 40 };
    this.lastAirVelY = vy;
    this.slideMove(false, dt);
  }

  // Wall-crawl on goo: W moves where you look (look up to climb), A/D strafe, let go to hang.
  stickyMove(cmd, dt, n) {
    const mv = this.move;
    const look = M.viewDir(this.yaw, this.pitch);
    const right = M.rightH(this.yaw);
    let d = M.add(M.scale(look, cmd.forward), M.scale(right, cmd.right));
    d = M.sub(d, M.scale(n, M.dot(d, n)));
    const dl = M.length(d);
    const want = dl > 1e-3 ? M.scale(d, mv.stickySpeed / dl) : M.vec();
    let vw = M.sub(this.vel, M.scale(n, M.dot(this.vel, n)));
    vw = M.add(vw, M.scale(M.sub(want, vw), Math.min(1, dt * 7)));
    vw.y -= mv.stickyGravity * this.gravityScale * dt;
    this.vel = M.madd(vw, n, -40);
    this.lastAirVelY = this.vel.y;
    this.slideMove(false, dt);
  }

  wallJump() {
    const mv = this.move;
    const n = this.wall.normal;
    const f = M.forwardH(this.yaw);
    let vx = this.vel.x + n.x * mv.wallJumpOut;
    let vz = this.vel.z + n.z * mv.wallJumpOut;
    if (f.x * n.x + f.z * n.z > 0) {
      vx += f.x * 80;
      vz += f.z * 80;
    }
    this.vel = { x: vx, y: Math.max(this.vel.y, mv.wallJumpUp), z: vz };
    this.wall.active = false;
    this.wall.sticky = false;
    this.wall.lastNormal = n;
    this.t.sameWall = 0.6;
    this.t.wallCd = 0.12;
    this.airJumps = mv.airJumps;
    this.emit('wallJump');
  }

  // ------------------------------------------------------------------ mantle
  tryMantle(cmd) {
    const mv = this.move;
    if (cmd.forward <= 0 || this.t.mantleCd > 0 || this.hook.state === 'attached' || this.vel.y > 220) return;
    const f = M.forwardH(this.yaw);
    const ahead = this.trace(this.pos, M.madd(this.pos, f, 6));
    if (ahead.fraction >= 1 || ahead.startsolid || Math.abs(ahead.normal.y) > 0.3) return;
    const nh = M.hnorm(ahead.normal);
    if (!nh || M.dot(nh, f) > -0.5) return;
    const up = this.trace(this.pos, { x: this.pos.x, y: this.pos.y + mv.mantleHeight, z: this.pos.z });
    const over = this.trace(up.endpos, M.madd(up.endpos, f, 24));
    if (over.fraction < 0.5 || over.startsolid) return;
    const dn = this.trace(over.endpos, { x: over.endpos.x, y: over.endpos.y - mv.mantleHeight - 2, z: over.endpos.z });
    if (dn.fraction >= 1 || dn.startsolid || dn.normal.y < MIN_WALK_NORMAL) return;
    const rise = dn.endpos.y - this.pos.y;
    if (rise < 4) return;
    this.viewSmooth -= rise;
    this.pos = dn.endpos;
    const hs = M.hlen(this.vel);
    const s = Math.max(hs * 0.7, 180);
    this.vel = { x: f.x * s, y: 0, z: f.z * s };
    this.t.mantleCd = 0.3;
    this.emit('mantle', { rise });
  }

  // ------------------------------------------------------------------ grapple
  fireHook() {
    const mv = this.move;
    const eye = this.eye();
    const dir = M.viewDir(this.yaw, this.pitch);
    const tr = this.world.trace(eye, M.madd(eye, dir, mv.hookRange), ZERO, ZERO);
    const hit = tr.fraction < 1 && !tr.startsolid;
    this.hook = {
      state: 'flying',
      origin: eye,
      pos: eye,
      dir,
      target: tr.endpos,
      anchor: null,
      hit,
      normal: tr.normal,
      ropeLen: 0,
      travel: 0,
      maxTravel: tr.fraction * mv.hookRange,
      lift: false,
    };
    this.emit('hookFire');
  }

  updateHook(dt) {
    const hk = this.hook;
    const mv = this.move;
    if (hk.state === 'flying') {
      hk.travel += mv.hookSpeed * dt;
      if (hk.travel >= hk.maxTravel) {
        hk.pos = hk.target;
        if (hk.hit) {
          hk.state = 'attached';
          hk.anchor = hk.target;
          hk.ropeLen = M.dist(this.center(), hk.anchor);
          // initial yank toward the anchor
          const dir = M.normalize(M.sub(hk.anchor, this.center()));
          const toward = M.dot(this.vel, dir);
          if (toward < mv.hookYank) this.vel = M.madd(this.vel, dir, mv.hookYank - Math.max(0, toward));
          this.emit('hookAttach');
        } else hk.state = 'retract';
      } else hk.pos = M.madd(hk.origin, hk.dir, hk.travel);
    } else if (hk.state === 'retract') {
      const e = this.eye();
      const d = M.sub(e, hk.pos);
      const l = M.length(d);
      const step = mv.hookSpeed * 1.2 * dt;
      if (l <= step) hk.state = 'none';
      else hk.pos = M.madd(hk.pos, d, step / l);
    }
  }

  applyHook(dt) {
    const hk = this.hook;
    const c = this.center();
    const d = M.sub(hk.anchor, c);
    const dist = M.length(d);
    if (dist < 48) {
      this.releaseHook();
      return;
    }
    const dir = M.scale(d, 1 / dist);
    // pull fades out as we approach the max reel-in speed, so it never turns into a slingshot
    const toward = M.dot(this.vel, dir);
    const pull = M.clamp(1 - toward / this.move.hookMaxSpeed, 0, 1);
    this.vel = M.madd(this.vel, dir, this.move.hookPull * pull * dt);
    if (dist < hk.ropeLen) hk.ropeLen = dist;
    else {
      const radial = M.dot(this.vel, dir);
      if (radial < 0) this.vel = M.madd(this.vel, dir, -radial);
    }
    hk.lift = hk.anchor.y > this.pos.y + 24;
    if (hk.lift && this.onGround) {
      this.onGround = false;
      this.groundNormal = null;
    }
    if (this.wall.active) this.endWallRun();
  }

  releaseHook() {
    this.hook.state = 'retract';
    this.hook.lift = false;
    this.t.hook = this.move.hookCooldown;
    this.emit('hookRelease');
  }

  // ------------------------------------------------------------------ external forces
  applyImpulse(v) {
    this.vel = M.add(this.vel, v);
    if (v.y > 0) {
      this.onGround = false;
      this.groundNormal = null;
    }
    this.t.knock = 0.12;
    if (this.wall.active) this.endWallRun();
  }

  launch(v) {
    this.vel = M.clone(v);
    this.onGround = false;
    this.groundNormal = null;
    this.t.knock = 0.2;
    this.airJumps = this.move.airJumps;
    this.sliding = false;
    if (this.wall.active) this.endWallRun();
  }

  // ------------------------------------------------------------------ collision response
  // Quake 3 PM_SlideMove. Returns true if the move was blocked by something.
  slideMove(gravity, dt) {
    const mv = this.move;
    let endVel = null;
    if (gravity) {
      endVel = { x: this.vel.x, y: this.vel.y - this.gravity * dt, z: this.vel.z };
      this.vel = { x: this.vel.x, y: (this.vel.y + endVel.y) * 0.5, z: this.vel.z };
      if (this.groundNormal) this.vel = clipVelocity(this.vel, this.groundNormal, OVERCLIP);
    }
    let timeLeft = dt;
    const planes = [];
    if (this.groundNormal) planes.push(this.groundNormal);
    planes.push(M.normalize(this.vel));
    let bump;
    for (bump = 0; bump < 4; bump++) {
      const end = M.madd(this.pos, this.vel, timeLeft);
      const tr = this.trace(this.pos, end);
      if (tr.allsolid) {
        this.vel = { x: this.vel.x, y: 0, z: this.vel.z };
        return true;
      }
      if (tr.fraction > 0) this.pos = tr.endpos;
      if (tr.fraction === 1) break;
      this.contacts.push({ n: tr.normal, brush: tr.brush });
      timeLeft -= timeLeft * tr.fraction;
      if (tr.brush && tr.brush.phys === 'bounce' && this.bounceOff(tr.normal)) {
        if (gravity) endVel = M.clone(this.vel);
        continue; // moving away from it now, no clipping needed
      }
      if (planes.length >= 5) {
        this.vel = M.vec();
        return true;
      }
      let dup = false;
      for (const p of planes) {
        if (M.dot(tr.normal, p) > 0.99) {
          this.vel = M.add(tr.normal, this.vel);
          dup = true;
          break;
        }
      }
      if (dup) continue;
      planes.push(tr.normal);
      for (let i = 0; i < planes.length; i++) {
        if (M.dot(this.vel, planes[i]) >= 0.1) continue;
        let clipV = clipVelocity(this.vel, planes[i], OVERCLIP);
        let endClip = gravity ? clipVelocity(endVel, planes[i], OVERCLIP) : null;
        for (let j = 0; j < planes.length; j++) {
          if (j === i) continue;
          if (M.dot(clipV, planes[j]) >= 0.1) continue;
          clipV = clipVelocity(clipV, planes[j], OVERCLIP);
          if (gravity) endClip = clipVelocity(endClip, planes[j], OVERCLIP);
          if (M.dot(clipV, planes[i]) >= 0) continue;
          // slide along the crease
          const dir = M.normalize(M.cross(planes[i], planes[j]));
          clipV = M.scale(dir, M.dot(dir, this.vel));
          if (gravity) endClip = M.scale(dir, M.dot(dir, endVel));
          for (let k = 0; k < planes.length; k++) {
            if (k === i || k === j) continue;
            if (M.dot(clipV, planes[k]) >= 0.1) continue;
            this.vel = M.vec(); // stop dead at a triple plane interaction
            return true;
          }
        }
        this.vel = clipV;
        if (gravity) endVel = endClip;
        break;
      }
    }
    if (gravity) this.vel = endVel;
    return bump !== 0;
  }

  // Slide move that can climb stairs; picks whichever of (plain, stepped) went further.
  stepSlideMove(gravity, dt) {
    const mv = this.move;
    const startPos = M.clone(this.pos);
    const startVel = M.clone(this.vel);
    if (!this.slideMove(gravity, dt)) return;
    const downPos = M.clone(this.pos);
    const downVel = M.clone(this.vel);
    const upTr = this.trace(startPos, { x: startPos.x, y: startPos.y + mv.stepSize, z: startPos.z });
    if (upTr.allsolid || upTr.startsolid) return;
    const stepUp = upTr.endpos.y - startPos.y;
    if (stepUp < 1) return;
    this.pos = upTr.endpos;
    this.vel = startVel;
    this.slideMove(gravity, dt);
    const dn = this.trace(this.pos, { x: this.pos.x, y: this.pos.y - stepUp, z: this.pos.z });
    if (!dn.allsolid && !dn.startsolid) this.pos = dn.endpos;
    const steppedOnSteep = dn.fraction < 1 && dn.normal.y < MIN_WALK_NORMAL;
    const dDown = (downPos.x - startPos.x) ** 2 + (downPos.z - startPos.z) ** 2;
    const dUp = (this.pos.x - startPos.x) ** 2 + (this.pos.z - startPos.z) ** 2;
    if (dDown >= dUp - 1e-6 || steppedOnSteep || dn.startsolid) {
      this.pos = downPos;
      this.vel = downVel;
      return;
    }
    if (dn.fraction < 1) this.vel = clipVelocity(this.vel, dn.normal, OVERCLIP);
    this.vel = { x: this.vel.x, y: downVel.y, z: this.vel.z };
    const rise = this.pos.y - downPos.y;
    if (rise > 0.5) {
      this.viewSmooth -= rise;
      this.emit('step');
    }
  }

  // Source-style: keep walking players glued to the ground when going down stairs/slopes.
  stayOnGround() {
    const up = this.trace(this.pos, { x: this.pos.x, y: this.pos.y + 2, z: this.pos.z });
    const start = up.endpos;
    const tr = this.trace(start, { x: this.pos.x, y: this.pos.y - this.move.stepSize, z: this.pos.z });
    if (tr.fraction > 0 && tr.fraction < 1 && !tr.startsolid && tr.normal.y >= MIN_WALK_NORMAL) {
      const dy = tr.endpos.y - this.pos.y;
      if (Math.abs(dy) > 0.5) this.viewSmooth -= dy;
      this.pos = tr.endpos;
    }
  }
}
