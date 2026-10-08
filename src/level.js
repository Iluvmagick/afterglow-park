// The playground. Everything is built from convex brushes plus a few entity lists.
// Zones: central plaza + spire (north of spawn), wallrun gauntlet (north), surf ramps (east),
// slide mountain (south), parkour blocks + tower (west), floating sky islands everywhere,
// an ice bowl, a trampoline yard with goo pillars, speed strips, and THE OBELISK (south-east).
import { createBrush } from './brush.js';
import { mulberry32 } from './math.js';
import { buildMegacity } from './megacity.js';
import { buildMegaParthenon } from './parthenon.js';

const GRAVITY = 800;

// Velocity that flies from `from` to `to`, peaking at `apex` (Quake 3 trigger_push math).
export function launchVelocity(from, to, apex, g = GRAVITY) {
  const top = Math.max(apex, from.y + 1, to.y + 1);
  const vy = Math.sqrt(2 * g * (top - from.y));
  const tUp = vy / g;
  const tDown = Math.sqrt((2 * (top - to.y)) / g);
  const T = tUp + tDown;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return { x: dx / T, y: vy, z: dz / T };
}

// Pine foliage: three stacked 7-sided cones. Shared by the renderer and the collision brushes
// (so the hook, rockets and your feet all agree with what you see).
export const PINE_SIDES = 7;
export function pineTiers(d) {
  const tiers = [];
  for (let t = 0; t < 3; t++) {
    const base = d.h * (0.3 + t * 0.2);
    tiers.push({ base, top: base + d.h * (0.45 - t * 0.05), r: d.r * (1 - t * 0.25), rot: t });
  }
  return tiers;
}

export function buildLevel() {
  const brushes = [];
  const pads = [];
  const rings = [];
  const orbs = [];
  const targets = [];
  const decor = [];
  const rand = mulberry32(1337);

  const add = (points, mat, extra = {}) => {
    const b = createBrush(points, { mat, ...extra });
    brushes.push(b);
    return b;
  };
  const box = (x0, y0, z0, x1, y1, z1, mat, extra) => {
    const pts = [];
    for (const x of [Math.min(x0, x1), Math.max(x0, x1)])
      for (const y of [Math.min(y0, y1), Math.max(y0, y1)])
        for (const z of [Math.min(z0, z1), Math.max(z0, z1)]) pts.push({ x, y, z });
    return add(pts, mat, extra);
  };
  // Box rotated around Y. (cx, cz) center, hx/hz half extents.
  const obox = (cx, cz, hx, hz, y0, y1, yaw, mat, extra) => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const pts = [];
    for (const [ax, az] of [
      [-hx, -hz],
      [hx, -hz],
      [hx, hz],
      [-hx, hz],
    ]) {
      const x = cx + ax * c + az * s;
      const z = cz - ax * s + az * c;
      pts.push({ x, y: y0, z }, { x, y: y1, z });
    }
    return add(pts, mat, extra);
  };
  const cylinder = (cx, cz, r, y0, y1, sides, mat, extra, rot = 0) => {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      pts.push({ x, y: y0, z }, { x, y: y1, z });
    }
    return add(pts, mat, extra);
  };
  // Sloped block over [x0,x1]x[z0,z1] with flat bottom at yb. Height h0 at the low end of the
  // axis and h1 at the high end. axis: 'x' or 'z'.
  const wedge = (x0, z0, x1, z1, yb, h0, h1, axis, mat, extra) => {
    const pts = [];
    for (const x of [x0, x1])
      for (const z of [z0, z1]) {
        const t = axis === 'x' ? (x === x0 ? 0 : 1) : z === z0 ? 0 : 1;
        pts.push({ x, y: yb, z }, { x, y: t ? h1 : h0, z });
      }
    return add(pts, mat, extra);
  };
  // Surf ridge: triangular prism running along z.
  const ridgeZ = (cx, hw, yb, yt, z0, z1, mat, extra) =>
    add(
      [
        { x: cx - hw, y: yb, z: z0 },
        { x: cx + hw, y: yb, z: z0 },
        { x: cx, y: yt, z: z0 },
        { x: cx - hw, y: yb, z: z1 },
        { x: cx + hw, y: yb, z: z1 },
        { x: cx, y: yt, z: z1 },
      ],
      mat,
      extra,
    );
  const pad = (x, y, z, target, apex, r = 56) => {
    cylinder(x, z, r, y, y + 8, 10, { top: 'pad', side: 'hazard' });
    const from = { x, y: y + 8, z };
    pads.push({
      pos: from,
      mins: { x: x - r, y: y + 8, z: z - r },
      maxs: { x: x + r, y: y + 40, z: z + r },
      launch: launchVelocity(from, target, apex),
      target,
      radius: r,
    });
  };
  const orb = (x, y, z) => orbs.push({ pos: { x, y, z } });
  const target = (x, y, z) => targets.push({ pos: { x, y, z }, radius: 30 });
  // exact rings set your speed to exactly `speed` (for precomputed ring chains)
  const ring = (x, y, z, dx, dy, dz, speed = 1100, extra = {}) => {
    const l = Math.hypot(dx, dy, dz);
    rings.push({ pos: { x, y, z }, axis: { x: dx / l, y: dy / l, z: dz / l }, radius: 96, speed, ...extra });
  };
  const island = (x, y, z, r, mat = { top: 'grass', side: 'dirt', bottom: 'rock' }) => {
    cylinder(x, z, r, y - 40, y, 8, mat, {}, Math.PI / 8);
    // rocky underside (inverted cone)
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
      pts.push({ x: x + Math.cos(a) * r * 0.92, y: y - 40, z: z + Math.sin(a) * r * 0.92 });
    }
    pts.push({ x: x + r * 0.1, y: y - 40 - r * 1.3, z: z - r * 0.1 });
    add(pts, 'rock');
  };

  // a cylinder lying along an arbitrary axis (for fallen columns)
  const tiltedColumn = (c, axis, r, len, sides, mat, extra) => {
    const al = Math.hypot(axis.x, axis.y, axis.z);
    const a = { x: axis.x / al, y: axis.y / al, z: axis.z / al };
    const ref = Math.abs(a.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    let u = { x: a.y * ref.z - a.z * ref.y, y: a.z * ref.x - a.x * ref.z, z: a.x * ref.y - a.y * ref.x };
    const ul = Math.hypot(u.x, u.y, u.z);
    u = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
    const v = { x: a.y * u.z - a.z * u.y, y: a.z * u.x - a.x * u.z, z: a.x * u.y - a.y * u.x };
    const pts = [];
    for (const e of [-0.5, 0.5]) {
      for (let i = 0; i < sides; i++) {
        const t = (i / sides) * Math.PI * 2;
        const ct = Math.cos(t) * r;
        const st = Math.sin(t) * r;
        pts.push({
          x: c.x + a.x * len * e + u.x * ct + v.x * st,
          y: c.y + a.y * len * e + u.y * ct + v.y * st,
          z: c.z + a.z * len * e + u.z * ct + v.z * st,
        });
      }
    }
    return add(pts, mat, extra);
  };
  // low-poly ellipsoid (for the bust's head)
  const ellipsoid = (c, rx, ry, rz, mat, extra, rings = 5, seg = 10) => {
    const pts = [{ x: c.x, y: c.y + ry, z: c.z }, { x: c.x, y: c.y - ry, z: c.z }];
    for (let i = 1; i < rings; i++) {
      const phi = -Math.PI / 2 + (i / rings) * Math.PI;
      for (let j = 0; j < seg; j++) {
        const th = (j / seg) * Math.PI * 2 + (i % 2) * (Math.PI / seg);
        pts.push({ x: c.x + Math.cos(phi) * Math.cos(th) * rx, y: c.y + Math.sin(phi) * ry, z: c.z + Math.cos(phi) * Math.sin(th) * rz });
      }
    }
    return add(pts, mat, extra);
  };


  // ---------------------------------------------------------------- ground + bounds
  const W = 4096;
  box(-4600, -128, -4600, 4600, 0, 4600, { top: 'grass', side: 'dirt', bottom: 'dirt' }, { name: 'ground' });
  // outside the park wall: the megacity's neon grid (four slabs framing the park, no overlap)
  const G = 18500;
  const megaGround = { top: 'megagrid', side: 'megamarble', bottom: 'megamarble' };
  box(-G, -128, -G, G, 0, -4600, megaGround, { cell: 2048 });
  box(-G, -128, 4600, G, 0, G, megaGround, { cell: 2048 });
  box(-G, -128, -4600, -4600, 0, 4600, megaGround, { cell: 2048 });
  box(4600, -128, -4600, G, 0, 4600, megaGround, { cell: 2048 });
  // jagged cliff rings: an inner wall around the park and taller hazy peaks behind it
  // Jagged cliff rings. Own RNG so editing cliffs never reshuffles the rest of the level.
  // opts.sides[N|S|E|W] can override dIn / heights / s-range / extra props, and cut gaps.
  const crand = mulberry32(4242);
  const SIDES = { N: [1, 0, 0, -1], S: [-1, 0, 0, 1], E: [0, 1, 1, 0], W: [0, -1, -1, 0] };
  const cliffRing = (dIn, depth, hMin, hMax, jitter, lean, segMin, segMax, tint, extra = {}, opts = {}) => {
    for (const [name, [ax, az, nx, nz]] of Object.entries(SIDES)) {
      // (ax, az): direction along the side, (nx, nz): outward normal
      const so = (opts.sides && opts.sides[name]) || {};
      const dI = so.dIn ?? dIn;
      const dOut = dI + depth;
      const hLo = so.hMin ?? hMin;
      const hHi = so.hMax ?? hMax;
      const [sA, sB] = so.sRange ?? [-dOut, dOut];
      const gaps = so.gaps ?? [];
      const ex = { ...extra, ...(so.extra || {}) };
      const P = (sv, d, y) => ({ x: ax * sv + nx * d, y, z: az * sv + nz * d });
      let s0 = sA;
      while (s0 < sB) {
        const s1 = Math.min(sB, s0 + segMin + crand() * (segMax - segMin));
        const din = dI + crand() * jitter;
        const h0 = hLo + crand() * (hHi - hLo);
        const h1 = h0 * (0.75 + crand() * 0.5);
        const ln = lean * (0.6 + crand() * 0.8);
        const k = 0.9 + crand() * 0.2;
        // cut the segment around any gaps (passes through the cliffs)
        let pieces = [[s0, s1]];
        for (const [g0, g1] of gaps) {
          pieces = pieces.flatMap(([a, b]) =>
            b <= g0 || a >= g1 ? [[a, b]] : [[a, Math.min(b, g0)], [Math.max(a, g1), b]].filter(([x, y]) => y - x > 1),
          );
        }
        const hAt = (sv) => h0 + (h1 - h0) * ((sv - s0) / (s1 - s0));
        for (const [a, b] of pieces) {
          add(
            [
              P(a, din, 0),
              P(b, din, 0),
              P(a, dOut, 0),
              P(b, dOut, 0),
              P(a, din + ln, hAt(a)),
              P(b, din + ln, hAt(b)),
              P(a, dOut, hAt(a) * 1.1),
              P(b, dOut, hAt(b) * 1.1),
            ],
            opts.mat || { top: 'rock', side: 'cliff' },
            { tint: [tint[0] * k, tint[1] * k, tint[2] * k], ...ex },
          );
        }
        s0 = s1;
      }
    }
  };
  // The park wall, with a canyon gate on each side out to the megacity. Gate positions (in each
  // side's own s coordinate) avoid the zones inside the park.
  const GATES = { W: [-300, 300], N: [600, 1200], E: [3000, 3600], S: [1100, 1700] };
  cliffRing(W, 420, 650, 1300, 36, 70, 380, 650, [1, 0.95, 0.95], {}, {
    sides: Object.fromEntries(Object.entries(GATES).map(([k, g]) => [k, { gaps: [g] }])),
  });
  // far mega-mountains framing the whole megacity
  cliffRing(16500, 1500, 3500, 7500, 600, 1600, 1600, 2800, [0.7, 0.66, 0.86], { cell: 1024 }, {
    mat: { top: 'megarock', side: 'megacliff' },
  });

  // ---------------------------------------------------------------- plaza + spire
  box(-768, 0, -768, 768, 16, 768, { top: 'tiles', side: 'stone' });
  cylinder(0, 0, 150, 16, 1500, 12, 'stone', { tint: [0.95, 0.9, 1.0] });
  const LEDGES = 22;
  for (let i = 0; i < LEDGES; i++) {
    const a = Math.PI + i * ((Math.PI * 2) / 9);
    const y = 16 + 64 * (i + 1);
    obox(Math.sin(a) * 225, Math.cos(a) * 225, 90, 75, y - 20, y, a, { top: 'wood', side: 'wood' });
    if (i % 6 === 5) orb(Math.sin(a) * 225, y + 40, Math.cos(a) * 225);
  }
  cylinder(0, 0, 280, 1500, 1530, 12, { top: 'tiles', side: 'stone' });
  orb(0, 1580, 0);
  // decorative pillars ring
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 600;
    const z = Math.sin(a) * 600;
    cylinder(x, z, 40, 16, 360, 8, 'stone', { tint: [1, 0.92, 0.85] });
    cylinder(x, z, 60, 360, 380, 8, 'stone');
  }
  target(0, 260, -420);
  target(420, 200, 0);
  target(-420, 300, 0);

  // ---------------------------------------------------------------- north: wallrun gauntlet
  box(-320, 0, -1400, 320, 320, -1100, { top: 'tiles', side: 'brick' });
  wedge(-760, -1400, -320, -1100, 0, 0, 320, 'x', { top: 'metal', side: 'brick' }); // ramp up
  pad(0, 16, -640, { x: 0, y: 320, z: -1250 }, 560);
  const segs = [
    [-1, -1480, -2080],
    [1, -1820, -2420],
    [-1, -2160, -2760],
    [1, -2500, -3100],
    [-1, -2840, -3440],
    [1, -3180, -3480],
  ];
  for (const [side, za, zb] of segs) {
    const xin = side * 144;
    const xout = side * 176;
    box(xin, 120, za, xout, 760, zb, 'metal', { tint: side < 0 ? [1, 0.85, 0.85] : [0.85, 0.9, 1] });
    box(xin, 760, za, xout + side * 16, 784, zb, 'hazard'); // cap
  }
  orb(0, 420, -2100);
  orb(0, 430, -2800);
  box(-320, 0, -3800, 320, 320, -3480, { top: 'tiles', side: 'brick' });
  orb(0, 370, -3700);
  pad(0, 320, -3700, { x: 0, y: 16, z: -500 }, 1000);
  target(0, 600, -1700);
  target(0, 650, -3000);

  // ---------------------------------------------------------------- east: surf ramps
  // Three descending 60-degree ridges in a line. Drop onto the west face from the start
  // platform, hold strafe into the ramp, and gravity does the rest.
  const SX = 2300;
  cylinder(2200, -3625, 90, 0, 1100, 8, 'stone');
  box(2050, 1100, -3800, 2350, 1180, -3450, { top: 'tiles', side: 'metal' });
  orb(2200, 1230, -3700);
  pad(560, 16, -560, { x: 2200, y: 1180, z: -3620 }, 1700);
  const surf = [
    [-3400, -1850, 1100, 800],
    [-1650, -100, 740, 440],
    [100, 1650, 400, 160],
  ];
  surf.forEach(([z0, z1, t0, t1], i) => {
    const h = 400;
    const hw = h / Math.tan((60 * Math.PI) / 180);
    add(
      [
        { x: SX - hw, y: t0 - h, z: z0 },
        { x: SX + hw, y: t0 - h, z: z0 },
        { x: SX, y: t0, z: z0 },
        { x: SX - hw, y: t1 - h, z: z1 },
        { x: SX + hw, y: t1 - h, z: z1 },
        { x: SX, y: t1, z: z1 },
      ],
      'surf',
      { tint: i % 2 ? [0.8, 1, 1] : [1, 0.85, 1] },
    );
    orb(SX - hw * 0.45, (t0 + t1) / 2 - h * 0.45 + 70, (z0 + z1) / 2);
  });
  box(1900, 0, 1750, 2700, 24, 2200, { top: 'tiles', side: 'stone' });
  orb(2600, 80, 2100);
  pad(2300, 24, 1830, { x: 2200, y: 1180, z: -3620 }, 1700); // kept outside the obelisk's low gravity
  target(3300, 500, -2200);
  target(3300, 400, 600);
  target(1500, 350, 2400);

  // ---------------------------------------------------------------- south: slide mountain
  box(-640, 0, 3300, 640, 640, 3900, { top: 'tiles', side: 'brick' });
  wedge(-640, 1300, 640, 3300, 0, 0, 640, 'z', { top: 'slide', side: 'brick' });
  // banked surf walls along the slope
  for (const s of [-1, 1]) {
    const xi = s * 640;
    const xo = s * 900;
    add(
      [
        { x: xi, y: 0, z: 1300 },
        { x: xo, y: 0, z: 1300 },
        { x: xo, y: 300, z: 1300 },
        { x: xi, y: 0, z: 3300 },
        { x: xo, y: 0, z: 3300 },
        { x: xi, y: 640, z: 3300 },
        { x: xo, y: 940, z: 3300 },
      ],
      'surf',
      { tint: [1, 0.9, 0.7] },
    );
  }
  // launch kicker at the bottom
  wedge(-200, 950, 200, 1180, 0, 110, 0, 'z', { top: 'hazard', side: 'brick' });
  pad(560, 16, 560, { x: 0, y: 640, z: 3600 }, 1100);
  orb(0, 700, 3600);
  orb(-300, 520, 2600);
  orb(300, 300, 1900);
  orb(0, 420, 820);
  ring(0, 110, 1400, 0, 0.25, -1, 1300);
  target(-450, 900, 2400);
  target(450, 700, 2000);

  // ---------------------------------------------------------------- west: parkour blocks + tower
  box(-2800, 0, -200, -2400, 1000, 200, 'brick');
  box(-2830, 1000, -230, -2370, 1024, 230, { top: 'tiles', side: 'stone' });
  orb(-2600, 1070, 0);
  for (let gx = 0; gx < 8; gx++) {
    for (let gz = 0; gz < 15; gz++) {
      const x = -1450 - gx * 300 + (rand() - 0.5) * 140;
      const z = -2700 + gz * 310 + (rand() - 0.5) * 140;
      if (x < -2300 && x > -2950 && Math.abs(z) < 400) continue; // tower clearing
      if (rand() < 0.28) continue;
      const toTower = Math.hypot(x + 2600, z) / 2800;
      const h = Math.round(32 + rand() * 120 + (1 - Math.min(1, toTower)) * 520 * rand());
      const hx = 48 + Math.round(rand() * 60);
      const hz = 48 + Math.round(rand() * 60);
      const kind = rand();
      const mat = kind < 0.45 ? 'crate' : kind < 0.8 ? 'checker' : 'metal';
      if (rand() < 0.2) obox(x, z, hx, hz, 0, h, rand() * Math.PI, mat);
      else box(x - hx, 0, z - hz, x + hx, h, z + hz, mat);
      if (h > 360 && rand() < 0.5) orb(x, h + 50, z);
    }
  }
  // floating stepping stones toward the tower top
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9;
    const x = -2600 + Math.cos(a) * 560;
    const z = Math.sin(a) * 560;
    const y = 300 + i * 110;
    box(x - 70, y - 24, z - 70, x + 70, y, z + 70, { top: 'wood', side: 'wood' });
  }
  // balance beams
  box(-2370, 1000, -12, -1300, 1016, 12, 'wood');
  box(-1300, 0, -80, -1140, 1016, 80, 'brick');
  orb(-1220, 1060, 0);
  pad(-560, 16, 560, { x: -2600, y: 1024, z: 100 }, 1400);
  target(-2000, 500, -1500);
  target(-3300, 700, 1200);
  target(-1800, 300, 2200);

  // ---------------------------------------------------------------- sky islands
  const isles = [
    [-1600, 1500, -1800, 200],
    [1200, 1700, 1600, 220],
    [-1800, 1900, 2300, 180],
    [3000, 1600, 200, 220],
    [-500, 2100, -2700, 200],
    [700, 1350, -1500, 170],
    [-3200, 1500, -2600, 200],
  ];
  for (const [x, y, z, r] of isles) {
    island(x, y, z, r);
    orb(x, y + 50, z);
  }
  ring(0, 1650, -800, 0, 0.15, -1, 1200);
  ring(-1000, 1750, -2200, -0.4, 0.2, -0.6, 1200);
  ring(2200, 1500, 1000, 0.7, 0.2, -0.7, 1200);

  // ---------------------------------------------------------------- corners + misc
  // north-west corner: stairs to a lookout
  for (let i = 0; i < 24; i++) {
    box(-3900 + i * 48, 0, -3900, -3852 + i * 48, 16 + i * 16, -3700, { top: 'tiles', side: 'stone' });
  }
  box(-2748, 0, -3900, -2500, 384, -3600, { top: 'tiles', side: 'stone' });
  orb(-2620, 430, -3750);
  // south-east quarter pipe along the wall
  wedge(3700, -2600, 4096, 2600, 0, 0, 600, 'x', 'surf', { tint: [0.8, 1, 0.85] });
  orb(3900, 520, -1200);
  orb(3900, 520, 1300);
  // south-west hills
  wedge(-3800, 1600, -2800, 2400, 0, 0, 240, 'z', { top: 'grass', side: 'dirt' });
  wedge(-3800, 2400, -2800, 3400, 0, 240, 0, 'z', { top: 'grass', side: 'dirt' });
  orb(-3300, 330, 2400);
  target(-3300, 450, 3000);


  // ---------------------------------------------------------------- speed strips
  const DIRS = { N: { x: 0, y: 0, z: -1 }, S: { x: 0, y: 0, z: 1 }, E: { x: 1, y: 0, z: 0 }, W: { x: -1, y: 0, z: 0 } };
  const strip = (x0, z0, x1, z1, y, dir, speed = 1300) =>
    box(x0, y - 8, z0, x1, y, z1, { top: 'boostN', side: 'hazard' }, { phys: 'boost', boostDir: DIRS[dir], boostSpeed: speed });
  // east runway off the plaza into a kicker: clears the surf line and lands on the far quarter pipe
  strip(790, -64, 1600, 64, 8, 'E', 1350);
  // the kicker is part of the strip (no friction), otherwise ground friction eats the speed
  wedge(1600, -64, 1800, 64, 0, 8, 150, 'x', { top: 'boostN', side: 'metal' }, { phys: 'boost', boostDir: DIRS.E, boostSpeed: 1350 });
  orb(2700, 560, 0);
  // slide mountain summit strip: hit the slope already flying
  strip(-90, 3350, 90, 3880, 648, 'N', 1100);

  // ---------------------------------------------------------------- north-east: the ice bowl
  // A crater: climb the stone outside, skate the frictionless ice inside (slopes pull you down).
  const IC = { x: 1200, z: -2600 };
  const octSeg = (c, k, ri, ro, yi, yo, mat, extra) => {
    const a0 = Math.PI / 8 + (k * Math.PI) / 4;
    const a1 = a0 + Math.PI / 4;
    const P = (r, a, y) => ({ x: c.x + Math.cos(a) * r, y, z: c.z + Math.sin(a) * r });
    return add([P(ri, a0, yi), P(ri, a1, yi), P(ro, a0, yo), P(ro, a1, yo), P(ri, a0, 0), P(ri, a1, 0), P(ro, a0, 0), P(ro, a1, 0)], mat, extra);
  };
  cylinder(IC.x, IC.z, 300, 0, 8, 8, 'ice', { phys: 'ice' }, Math.PI / 8);
  for (let k = 0; k < 8; k++) octSeg(IC, k, 300, 560, 8, 180, 'ice', { phys: 'ice' });
  for (let k = 0; k < 8; k++) {
    // the south face of the crater is a speed strip that flings you over the rim
    if (k === 1) octSeg(IC, k, 560, 800, 180, 0, { top: 'boostN', side: 'stone' }, { phys: 'boost', boostDir: DIRS.N, boostSpeed: 670 });
    else octSeg(IC, k, 560, 800, 180, 0, { top: 'stone', side: 'stone' });
  }
  // ice mound in the middle
  {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      pts.push({ x: IC.x + Math.cos(a) * 150, y: 8, z: IC.z + Math.sin(a) * 150 });
      pts.push({ x: IC.x + Math.cos(a) * 55, y: 64, z: IC.z + Math.sin(a) * 55 });
    }
    add(pts, 'ice', { phys: 'ice' });
  }
  orb(IC.x, 120, IC.z);
  orb(IC.x, 260, IC.z - 680);

  // ---------------------------------------------------------------- north-west: trampoline yard
  const tramp = (x, z, r, top) => {
    if (top > 24) cylinder(x, z, r * 0.45, 0, top - 20, 8, 'stone');
    cylinder(x, z, r, top - 20, top, 10, { top: 'bounce', side: 'hazard' }, { phys: 'bounce' });
  };
  tramp(-1150, -1850, 120, 16); // 16 high: low enough to walk onto
  tramp(-850, -1850, 120, 16);
  tramp(-1150, -2200, 120, 16);
  tramp(-850, -2200, 120, 16);
  // trampoline staircase toward the high sky island (hold jump to pump each bounce higher)
  tramp(-600, -1950, 90, 260);
  tramp(-560, -2330, 90, 560);
  tramp(-780, -2950, 100, 900);
  orb(-780, 1000, -2950);
  // pinball alley: bouncy walls + bouncy floor
  box(-1300, 0, -3550, -1268, 520, -3150, 'bounce', { phys: 'bounce' });
  box(-800, 0, -3550, -768, 520, -3150, 'bounce', { phys: 'bounce' });
  box(-1268, 0, -3550, -800, 12, -3150, { top: 'bounce', side: 'hazard' }, { phys: 'bounce' });
  orb(-1034, 400, -3350);
  // goo pillars: wall-crawl up (W goes where you look)
  box(-1260, 0, -2750, -1100, 1000, -2590, { top: 'stone', side: 'goo' }, { phys: 'sticky' });
  box(-1000, 0, -2700, -880, 650, -2580, { top: 'stone', side: 'goo' }, { phys: 'sticky' });
  orb(-1180, 1050, -2670);
  orb(-940, 700, -2640);
  // the beanstalk: a goo plank all the way up to the sky island above
  box(-560, 0, -2480, -440, 2110, -2440, { top: 'stone', side: 'goo' }, { phys: 'sticky' });

  // ---------------------------------------------------------------- south-east: THE OBELISK
  // A colossal floating obelisk in a low-gravity field. Its faces are sticky (crawl up), a spiral
  // of rings (the Obelisk Express) whips you around it up to a golden halo above the capstone,
  // and reaching the summit awakens it.
  const O = { x: 2300, z: 3000 };
  const OB = { base: 130, top: 2560, tip: 2820, hb: 170, ht: 110 }; // base leaves room to walk under
  const OB_GRAV = 0.45;
  const HALO = { y: 2960, ri: 170, ro: 400 };
  box(O.x - 460, 0, O.z - 460, O.x + 460, 16, O.z + 460, { top: 'tiles', side: 'stone' });
  box(O.x - 340, 16, O.z - 340, O.x + 340, 32, O.z + 340, { top: 'obsidian', side: 'stone' });
  const square = (h, y) =>
    [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ].map(([dx, dz]) => ({ x: O.x + dx, y, z: O.z + dz }));
  add([...square(OB.hb, OB.base), ...square(OB.ht, OB.top)], 'obsidian', { phys: 'sticky', name: 'obelisk' });
  add([...square(OB.ht, OB.top), { x: O.x, y: OB.tip, z: O.z }], 'gold', { name: 'capstone' });
  // the halo: eight thin floating slabs in a ring above the capstone
  for (let k = 0; k < 8; k++) {
    const a0 = Math.PI / 8 + (k * Math.PI) / 4;
    const a1 = a0 + Math.PI / 4;
    const pts = [];
    for (const r of [HALO.ri, HALO.ro])
      for (const a of [a0, a1])
        for (const y of [HALO.y - 24, HALO.y]) pts.push({ x: O.x + Math.cos(a) * r, y, z: O.z + Math.sin(a) * r });
    add(pts, { top: 'gold', side: 'gold', bottom: 'obsidian' });
  }
  orb(O.x - 285, HALO.y + 50, O.z);
  // The Obelisk Express: a helix of homing rings, each one launching you on the arc (in the low
  // gravity) that threads the next ring. The last one drops you onto the halo.
  {
    const R = 720;
    const N = 16;
    const dTheta = (Math.PI * 2) / 10;
    const T = 0.42;
    const g = GRAVITY * OB_GRAV;
    const th0 = Math.PI;
    const pts = [];
    for (let k = 0; k < N; k++) {
      const a = th0 + k * dTheta;
      pts.push({ x: O.x + Math.cos(a) * R, y: 50 + k * 170, z: O.z + Math.sin(a) * R });
    }
    const aEnd = th0 + N * dTheta;
    const landing = { x: O.x + Math.cos(aEnd) * 285, y: HALO.y + 40, z: O.z + Math.sin(aEnd) * 285 };
    pts.forEach((p, k) => {
      const next = k < N - 1 ? pts[k + 1] : landing;
      const t = k < N - 1 ? T : 2.2;
      const v = { x: (next.x - p.x) / t, y: (next.y - p.y + 0.5 * g * t * t) / t, z: (next.z - p.z) / t };
      // homing: the sim re-aims from wherever you actually crossed, so small offsets never add up
      ring(p.x, p.y, p.z, v.x, v.y, v.z, Math.hypot(v.x, v.y, v.z), { exact: true, target: next, flightTime: t, gravity: g, style: 'obelisk', index: k });
    });
    // speed strip that feeds you into the first ring
    const p0 = pts[0];
    const d = { x: pts[1].x - p0.x, z: pts[1].z - p0.z };
    const dl = Math.hypot(d.x, d.z);
    const dir = { x: d.x / dl, y: 0, z: d.z / dl };
    obox(p0.x - dir.x * 300, p0.z - dir.z * 300, 60, 280, 0, 8, Math.atan2(dir.x, dir.z), { top: 'boostN', side: 'hazard' }, { phys: 'boost', boostDir: dir, boostSpeed: 1100 });
  }


  // ---------------------------------------------------------------- west, beyond the walls: VAPORWAVE ACROPOLIS
  // Through a canyon cut in both cliff walls lies a neon-grid plateau of pink marble: an avenue
  // with a glassy skating pool, arches with boost rings, wallrun stoas, a round tholos, a
  // Parthenon with a walkable roof, a giant Helios bust to climb and fallen columns drifting in the air.
  const VX = -5500; // where the zone starts (outside the middle cliff ring)
  const marble = (tint) => ({ mat: { top: 'marble', side: 'marble' }, extra: tint ? { tint } : {} });
  const PINK = [1, 0.84, 0.94];
  const CYAN = [0.84, 0.97, 1];
  // the pass: speed lanes through the canyon (west lane goes out, east lane brings you home)
  strip(VX - 20, -250, -4100, -70, 8, 'W', 1200);
  strip(VX - 20, 70, -4100, 250, 8, 'E', 1200);
  // greek gateway on the park side
  for (const gz of [-340, 340]) {
    cylinder(-3990, gz, 42, 0, 620, 10, 'marble', { tint: PINK });
    box(-4040, 620, gz - 55, -3940, 650, gz + 55, 'marble');
  }
  box(-4050, 650, -420, -3930, 740, 420, 'marble', { tint: CYAN });
  orb(-3990, 790, 0);

  // the plateau
  box(-9400, 0, -3700, VX, 8, 3700, { top: 'vaporgrid', side: 'marble' });
  // avenue: a glassy pool you can skate on
  box(-6900, 8, -140, -5800, 12, 140, { top: 'water', side: 'marble' }, { phys: 'ice' });
  // arches over the avenue, each with a boost ring pointing at the tholos
  for (const ax of [-6150, -6650]) {
    for (const az of [-300, 260]) box(ax - 40, 8, az, ax + 40, 470, az + 40, 'marble', { tint: PINK });
    box(ax - 50, 470, -320, ax + 50, 550, 320, 'marble', { tint: CYAN });
    ring(ax, 210, 0, -1, 0.12, 0, 1100);
  }
  orb(-6400, 600, 0);
  // stoas: long wallrun walls flanking the avenue
  for (const [z0, z1] of [
    [-760, -720],
    [720, 760],
  ]) {
    box(-7050, 8, z0, -5850, 520, z1, 'marble', { tint: z0 < 0 ? PINK : CYAN });
    box(-7070, 520, z0 - 20, -5830, 548, z1 + 20, 'marble');
  }
  orb(-6450, 600, -740);

  // tholos: a round temple at the end of the avenue
  const TH = { x: -7450, z: 0 };
  cylinder(TH.x, TH.z, 430, 8, 40, 16, { top: 'marble', side: 'marble' }, { tint: CYAN });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    cylinder(TH.x + Math.cos(a) * 345, TH.z + Math.sin(a) * 345, 30, 40, 500, 8, 'marble', { tint: PINK });
  }
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2;
    const a1 = ((i + 1) / 12) * Math.PI * 2;
    const pts = [];
    for (const r of [300, 395]) for (const a of [a0, a1]) for (const y of [500, 560]) pts.push({ x: TH.x + Math.cos(a) * r, y, z: TH.z + Math.sin(a) * r });
    add(pts, 'marble');
  }
  {
    const pts = [{ x: TH.x, y: 770, z: TH.z }];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      pts.push({ x: TH.x + Math.cos(a) * 410, y: 560, z: TH.z + Math.sin(a) * 410 });
    }
    add(pts, { top: 'marble', side: 'marble', bottom: 'marble' }, { tint: CYAN });
  }
  cylinder(TH.x, TH.z, 60, 40, 120, 8, 'marble', { tint: PINK }); // altar
  orb(TH.x, 165, TH.z);
  orb(TH.x, 820, TH.z);

  // the Parthenon (north side, facing the avenue): steps, peristyle, cella, walkable roof
  const PX0 = -8240;
  const PX1 = -6960;
  const PZ0 = -2690;
  const PZ1 = -1710;
  box(PX0 - 60, 8, PZ0 - 60, PX1 + 60, 24, PZ1 + 60, 'marble');
  box(PX0 - 30, 24, PZ0 - 30, PX1 + 30, 40, PZ1 + 30, 'marble');
  box(PX0, 40, PZ0, PX1, 56, PZ1, 'marble', { tint: PINK });
  const colAt = (x, z) => {
    cylinder(x, z, 36, 56, 600, 10, 'marble', { tint: [1, 0.92, 0.97] });
    box(x - 48, 600, z - 48, x + 48, 624, z + 48, 'marble');
  };
  for (let i = 0; i < 8; i++) {
    const x = PX0 + 60 + (i * (PX1 - PX0 - 120)) / 7;
    colAt(x, PZ0 + 60);
    colAt(x, PZ1 - 60);
  }
  for (let i = 1; i < 5; i++) {
    const z = PZ0 + 60 + (i * (PZ1 - PZ0 - 120)) / 5;
    colAt(PX0 + 60, z);
    colAt(PX1 - 60, z);
  }
  box(PX0 + 300, 56, PZ0 + 240, PX1 - 300, 560, PZ1 - 240, 'marble', { tint: CYAN }); // cella
  box(PX0, 624, PZ0, PX1, 700, PZ1, 'marble', { tint: PINK }); // entablature
  add(
    [
      { x: PX0, y: 700, z: PZ0 },
      { x: PX0, y: 700, z: PZ1 },
      { x: PX0, y: 850, z: (PZ0 + PZ1) / 2 },
      { x: PX1, y: 700, z: PZ0 },
      { x: PX1, y: 700, z: PZ1 },
      { x: PX1, y: 850, z: (PZ0 + PZ1) / 2 },
    ],
    'marble',
    { tint: CYAN },
  );
  orb((PX0 + PX1) / 2, 900, (PZ0 + PZ1) / 2);
  orb((PX0 + PX1) / 2, 120, PZ1 - 120);

  // Helios: a giant marble bust (south side), facing the canyon. Shoulders surf, head climbs.
  const HB = { x: -7600, z: 2200 };
  box(HB.x - 260, 8, HB.z - 260, HB.x + 260, 220, HB.z + 260, 'marble', { tint: CYAN });
  add(
    [
      { x: HB.x - 170, y: 220, z: HB.z - 330 },
      { x: HB.x + 170, y: 220, z: HB.z - 330 },
      { x: HB.x - 170, y: 220, z: HB.z + 330 },
      { x: HB.x + 170, y: 220, z: HB.z + 330 },
      { x: HB.x - 110, y: 560, z: HB.z - 210 },
      { x: HB.x + 110, y: 560, z: HB.z - 210 },
      { x: HB.x - 110, y: 560, z: HB.z + 210 },
      { x: HB.x + 110, y: 560, z: HB.z + 210 },
    ],
    'marble',
    { tint: PINK },
  );
  cylinder(HB.x + 10, HB.z, 85, 560, 700, 10, 'marble', { tint: PINK });
  ellipsoid({ x: HB.x + 20, y: 870, z: HB.z }, 150, 200, 135, 'marble', { tint: [0.95, 0.9, 1] });
  ellipsoid({ x: HB.x - 10, y: 975, z: HB.z }, 150, 95, 142, 'marble', { tint: [0.75, 0.95, 1] }); // hair
  add(
    [
      { x: HB.x + 160, y: 820, z: HB.z - 20 },
      { x: HB.x + 160, y: 820, z: HB.z + 20 },
      { x: HB.x + 160, y: 900, z: HB.z },
      { x: HB.x + 205, y: 830, z: HB.z },
    ],
    'marble',
    { tint: [0.95, 0.9, 1] },
  ); // nose
  orb(HB.x - 10, 1120, HB.z);

  // fallen columns drifting in the air
  tiltedColumn({ x: -6600, y: 520, z: -430 }, { x: 1, y: 0.35, z: 0.3 }, 48, 700, 10, 'marble', { tint: PINK });
  tiltedColumn({ x: -7050, y: 820, z: 540 }, { x: 0.4, y: -0.25, z: 1 }, 55, 800, 10, 'marble', { tint: CYAN });
  tiltedColumn({ x: -8250, y: 1100, z: -700 }, { x: 1, y: 0.1, z: -0.6 }, 60, 900, 10, 'marble', { tint: PINK });
  tiltedColumn({ x: -8500, y: 650, z: 950 }, { x: 0.3, y: 0.15, z: 1 }, 52, 750, 10, 'marble', { tint: CYAN });
  tiltedColumn({ x: -6250, y: 1350, z: 1250 }, { x: 1, y: 0, z: 0.2 }, 60, 820, 10, 'marble', { tint: PINK });
  orb(-7050, 920, 540);
  orb(-6250, 1460, 1250);
  // broken column stumps
  for (const [x, z, h] of [
    [-5950, -1300, 260],
    [-6300, -1600, 140],
    [-5900, 1500, 320],
    [-8800, -150, 200],
    [-8700, 300, 380],
    [-6600, 2800, 240],
  ]) {
    cylinder(x, z, 40, 8, 8 + h, 10, 'marble', { tint: PINK });
  }
  // pads up to the roofs
  pad(-7000, 8, -950, { x: (PX0 + PX1) / 2, y: 850, z: (PZ0 + PZ1) / 2 }, 1300); // onto the roof ridge
  pad(-7000, 8, 950, { x: HB.x - 10, y: 1072, z: HB.z }, 1500); // onto Helios' head
  target(-6400, 420, 1700);
  target(-8000, 500, -1200);
  // palms
  for (let i = 0; i < 5; i++) {
    for (const pz of [-360, 360]) {
      const x = -5900 - i * 260;
      const h = 300 + ((i * 53 + (pz > 0 ? 31 : 0)) % 120);
      cylinder(x, pz, 13, 8, 8 + h, 6, 'bark', { tint: [1, 0.7, 0.8] });
      decor.push({ type: 'palm', x, z: pz, h: 8 + h, r: 150 });
    }
  }
  for (const [x, z] of [
    [-8900, -3200],
    [-8900, 3200],
    [-6000, -3100],
    [-6000, 3100],
    [-8950, -1200],
    [-8950, 1300],
  ]) {
    cylinder(x, z, 14, 8, 400, 6, 'bark', { tint: [1, 0.7, 0.8] });
    decor.push({ type: 'palm', x, z, h: 400, r: 170 });
  }

  // ---------------------------------------------------------------- the other canyon gates
  const gateway = (x, z, alongX) => {
    for (const o of [-340, 340]) {
      const gx = alongX ? x + o : x;
      const gz = alongX ? z : z + o;
      cylinder(gx, gz, 42, 0, 620, 10, 'marble', { tint: PINK });
      box(gx - 55, 620, gz - 55, gx + 55, 650, gz + 55, 'marble');
    }
    if (alongX) box(x - 420, 650, z - 60, x + 420, 740, z + 60, 'marble', { tint: CYAN });
    else box(x - 60, 650, z - 420, x + 60, 740, z + 420, 'marble', { tint: CYAN });
  };
  // north gate (x 600..1200)
  strip(640, -4950, 860, -4000, 8, 'N', 1200);
  strip(940, -4950, 1160, -4000, 8, 'S', 1200);
  gateway(900, -3990, true);
  // east gate (z 3000..3600)
  strip(4000, 3040, 4950, 3260, 8, 'E', 1200);
  strip(4000, 3340, 4950, 3560, 8, 'W', 1200);
  gateway(3990, 3300, false);
  // south gate (x -1700..-1100)
  strip(-1660, 4000, -1440, 4950, 8, 'S', 1200);
  strip(-1360, 4000, -1140, 4950, 8, 'N', 1200);
  gateway(-1400, 3990, true);

  // ---------------------------------------------------------------- the megacity, all around the park
  const mega = buildMegacity({ add, box, obox, cylinder, wedge, pad, orb, target, ring, tiltedColumn, ellipsoid, decor, PINK, CYAN });
  const parthenon = buildMegaParthenon({ add, box, cylinder, pad, orb, tiltedColumn, ellipsoid, PINK, CYAN });

  // ---------------------------------------------------------------- trees (trunks collide)
  const treeSpots = [];
  for (let i = 0; i < 70; i++) {
    const x = (rand() * 2 - 1) * 3900;
    const z = (rand() * 2 - 1) * 3900;
    const clear =
      (Math.abs(x) < 950 && Math.abs(z) < 950) || // plaza
      (Math.abs(x) < 520 && z < -900) || // gauntlet
      (x > 1400 && x < 3200) || // surf
      (Math.abs(x) < 1000 && z > 900) || // slide
      (x < -1200 && x > -3900 && z > -2900 && z < 2800) || // parkour
      (Math.abs(z) < 300 && x < 2000) || // east runway
      (Math.abs(x - 1200) < 900 && Math.abs(z + 2600) < 900) || // ice bowl
      (x < -350 && x > -1450 && z < -1550) || // trampoline yard
      (Math.abs(x - 2300) < 1050 && Math.abs(z - 3000) < 1050) || // obelisk
      (x < -3600 && Math.abs(z) < 700) || // west gate
      (x > 300 && x < 1500 && z < -3500) || // north gate
      (x > 3500 && z > 2700 && z < 3900) || // east gate
      (x > -2000 && x < -800 && z > 3500) || // south gate
      x > 3600;
    if (clear) continue;
    if (treeSpots.some(([a, b]) => Math.hypot(a - x, b - z) < 260)) continue;
    treeSpots.push([x, z]);
    const h = 260 + rand() * 260;
    cylinder(x, z, 14, 0, h * 0.45, 6, 'bark');
    const tree = { type: 'pine', x, z, h, r: 70 + rand() * 50 };
    decor.push(tree);
    for (const tier of pineTiers(tree)) {
      const pts = [{ x, y: tier.top, z }];
      for (let i = 0; i < PINE_SIDES; i++) {
        const a = (i / PINE_SIDES) * Math.PI * 2 + tier.rot;
        pts.push({ x: x + Math.cos(a) * tier.r, y: tier.base, z: z + Math.sin(a) * tier.r });
      }
      add(pts, 'pine', { invisible: true });
    }
  }

  return {
    brushes,
    pads,
    rings,
    orbs,
    targets,
    decor,
    gravityZones: [{ x: O.x, z: O.z, r: 1100, scale: OB_GRAV }],
    vapor: { minX: VX, parkHalf: 4600 }, // everything outside the park square is the megacity
    mega,
    parthenon,
    beams: [{ x: O.x, y: OB.tip, z: O.z, kind: 'obelisk' }, ...mega.beams],
    obelisk: { x: O.x, z: O.z, base: OB.base, top: OB.top, tip: OB.tip, hb: OB.hb, ht: OB.ht, halo: HALO, summitY: 2580, summitR: 450 },
    spawn: { pos: { x: 0, y: 16, z: 560 }, yaw: 0 },
  };
}
