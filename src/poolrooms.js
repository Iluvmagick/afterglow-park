// THE POOLROOMS: what's under the park. Endless halls of white and aqua ceramic, flooded ankle-deep,
// under a tiled ceiling of soft light panels. One palette down here and nothing else: no grass, no
// neon, no sunset.
//
// The only ways in are the four piers beyond the far mountains (the world's wall): on each compass
// axis a tiled pier runs out over the void to a pool deck with a giant glowing doorway. Dive into the
// pool (it has no bottom) or walk through the door and you noclip out of reality: you fall out of the
// ceiling into a pool in one of the halls. The way out is the drain in the south-west hall (or R).
//
// Nine tall halls (2600 square, 1088 high) in a 3 x 3 grid under the park, joined by arched doorways
// (north = -z):
//   NW the Drained Pool    N the Wave Pool     NE the Helter-Skelter
//   W  the Wallrun Baths   C the Natatorium    E  the Diving Hall
//   SW the Drain           S the Steps         SE the Maze
// Around them a colonnade opens onto a forest of pillars in the fog, sealed by a tiled wall far out.
// Deep water is swimmable (see Player.swimMove).
import { mulberry32 } from './math.js';

const GRAVITY = 800;

// floor: where you stand; ceil: the ceiling (the underside of the ground "crust" below the park);
// water: the surface of the water that floods everything; half: the sealing wall is this far out.
export const POOL = { floor: -1600, ceil: -512, water: -1588, half: 12000 };

// Splits rectangle [x0, z0, x1, z1] into rectangles that cover it minus the (non-overlapping) holes.
export function rectsMinus([X0, Z0, X1, Z1], holes) {
  const xs = new Set([X0, X1]);
  for (const [a, , b] of holes) {
    if (a > X0 && a < X1) xs.add(a);
    if (b > X0 && b < X1) xs.add(b);
  }
  const sx = [...xs].sort((p, q) => p - q);
  const out = [];
  let open = new Map(); // rects still growing along x, keyed by their z interval
  for (let i = 0; i + 1 < sx.length; i++) {
    const x0 = sx[i];
    const x1 = sx[i + 1];
    let iv = [[Z0, Z1]];
    for (const [hx0, hz0, hx1, hz1] of holes) {
      if (hx1 <= x0 || hx0 >= x1) continue;
      iv = iv.flatMap(([a, b]) =>
        hz1 <= a || hz0 >= b ? [[a, b]] : [[a, Math.min(b, hz0)], [Math.max(a, hz1), b]].filter(([p, q]) => q - p > 0.5),
      );
    }
    const next = new Map();
    for (const [a, b] of iv) {
      const k = `${a},${b}`;
      let r = open.get(k);
      if (r) r[2] = x1;
      else out.push((r = [x0, a, x1, b]));
      next.set(k, r);
    }
    open = next;
  }
  return out;
}

export function buildPoolrooms(api) {
  const { add, box, cylinder, wedge, pad, orb, target, ring } = api;
  const F = POOL.floor;
  const C = POOL.ceil;
  const HALF = POOL.half;
  const M = { cell: 1024 };
  // 'none' faces are never drawn (they're buried in the floor, the ceiling or another brush)
  const TILE = { top: 'pooltile', side: 'pooltile', bottom: 'none' };
  const AQUA = { top: 'poolaqua', side: 'poolaqua', bottom: 'none' };
  const TRIM = { top: 'pooltrim', side: 'pooltrim', bottom: 'none' };
  const SOLID = { top: 'pooltile', side: 'pooltile', bottom: 'pooltile' }; // floating: seen from below
  const TALL = { top: 'none', side: 'pooltileM', bottom: 'none' }; // reaches the ceiling
  const BAND = { top: 'none', side: 'pooltrimM', bottom: 'none' }; // the teal stripe at the waterline
  const BIG = { cell: 512 }; // big faces: coarse cells (with the perspective-correct M materials)
  const BOARD = { top: 'poolboard', side: 'poolboard', bottom: 'poolboard' };
  const CURRENT = { top: 'current', side: 'pooltrim', bottom: 'none' };
  const holes = []; // deep pools cut into the floor
  const portals = [];
  const spots = {}; // named places, for the tests
  const P = (c, r, a, y) => ({ x: c.x + Math.cos(a) * r, y, z: c.z + Math.sin(a) * r });
  const UP = { x: 0, y: 1, z: 0 };

  // a floor-to-ceiling column with the teal band at its foot
  const tall = (x0, z0, x1, z1) => {
    box(x0, F, z0, x1, F + 64, z1, BAND, BIG);
    box(x0, F + 64, z0, x1, C, z1, TALL, BIG);
  };
  // a deep pool: a hole in the floor slab (its sides are the pool walls) with a floor at the bottom
  const deep = (x0, z0, x1, z1, depth, floor = 'poolaqua') => {
    holes.push([x0, z0, x1, z1]);
    box(x0, F - depth - 32, z0, x1, F - depth, z1, { top: floor, side: 'none', bottom: 'none' });
  };
  // a square ring of boxes: between half-widths a (outside) and b (inside) around c
  const squareRing = (c, a, b, y0, y1, mat) => {
    box(c.x - a, y0, c.z - a, c.x + a, y1, c.z - b, mat, BIG);
    box(c.x - a, y0, c.z + b, c.x + a, y1, c.z + a, mat, BIG);
    box(c.x - a, y0, c.z - b, c.x - b, y1, c.z + b, mat, BIG);
    box(c.x + b, y0, c.z - b, c.x + a, y1, c.z + b, mat, BIG);
  };
  // A chain of homing rings ("bubbles"): each throws you on the arc that threads the next one, the last
  // one throws you at `land`. One-way, so falling back down through them does nothing.
  const bubbles = (pts, land, times, axes) =>
    pts.forEach((p, k) => {
      const next = k < pts.length - 1 ? pts[k + 1] : land;
      const T = times[k];
      const v = { x: (next.x - p.x) / T, y: (next.y - p.y + 0.5 * GRAVITY * T * T) / T, z: (next.z - p.z) / T };
      const a = axes[k];
      ring(p.x, p.y, p.z, a.x, a.y, a.z, Math.hypot(v.x, v.y, v.z), { exact: true, oneWay: true, target: next, flightTime: T, gravity: GRAVITY, style: 'bubble' });
    });
  const poolPad = (x, z, to, apex, y = F) => pad(x, y, z, to, apex, 64, 'pool');
  // a lifeguard chair: four legs, rungs up the front, a seat and a backrest
  const chair = (x, z, h = 300) => {
    for (const dx of [-70, 70]) for (const dz of [-70, 70]) box(x + dx - 10, F, z + dz - 10, x + dx + 10, F + h, z + dz + 10, TRIM);
    for (let k = 1; k * 48 < h; k++) box(x - 60, F + 48 * k - 8, z + 62, x + 60, F + 48 * k, z + 78, { top: 'pooltile', side: 'pooltile', bottom: 'pooltile' });
    box(x - 90, F + h, z - 90, x + 90, F + h + 16, z + 90, SOLID);
    box(x - 90, F + h + 16, z - 90, x + 90, F + h + 150, z - 74, SOLID);
  };

  // A wall along x (alongX) or z at `c`, from s0 to s1, with an arched doorway centered at sd.
  const archWall = (alongX, c, s0, s1, sd, o = {}) => {
    const { hw = 320, y0 = F, spring = F + 440, top = C, t = 32, mat = TALL } = o;
    const Pt = (s, y, tt) => (alongX ? { x: s, y, z: c + tt } : { x: c + tt, y, z: s });
    const slab = (sa, sb, ya, yb, m) => {
      if (sb - sa < 1) return;
      const pts = [];
      for (const s of [sa, sb]) for (const y of [ya, yb]) for (const tt of [-t, t]) pts.push(Pt(s, y, tt));
      add(pts, m, BIG);
    };
    const crown = spring + hw;
    for (const [sa, sb] of [
      [s0, sd - hw],
      [sd + hw, s1],
    ]) {
      slab(sa, sb, y0, y0 + 64, BAND);
      slab(sa, sb, y0 + 64, top, mat);
    }
    slab(sd - hw, sd + hw, crown, top, mat);
    const N = 8;
    for (let i = 0; i < N; i++) {
      const pts = [];
      for (const a of [Math.PI - (i * Math.PI) / N, Math.PI - ((i + 1) * Math.PI) / N]) {
        const s = sd + Math.cos(a) * hw;
        for (const y of [spring + Math.sin(a) * hw, crown]) for (const tt of [-t, t]) pts.push(Pt(s, y, tt));
      }
      add(pts, { top: 'none', side: mat.side, bottom: 'pooltrimM' }, BIG);
    }
    return { crown };
  };

  // ================================================================ the halls: walls and doorways
  const R = 1300; // hall walls at x, z = +-R
  const O = 3900; // the colonnade round the outside
  for (const c of [-R, R]) {
    for (const [s0, s1] of [
      [-O, -R],
      [-R, R],
      [R, O],
    ])
      archWall(false, c, s0, s1, (s0 + s1) / 2);
    for (const [s0, s1] of [
      [-O, -R - 32],
      [-R + 32, R - 32],
      [R + 32, O],
    ])
      archWall(true, c, s0, s1, (s0 + s1) / 2);
  }
  {
    const seen = new Set();
    for (let k = 0; k <= 15; k++) {
      const s = -O + 520 * k;
      for (const [x, z] of [
        [-O, s],
        [O, s],
        [s, -O],
        [s, O],
      ]) {
        const key = `${x},${z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tall(x - 56, z - 56, x + 56, z + 56);
      }
    }
  }

  // ================================================================ SW: the Drain (the way out)
  // Dive to the grate at the bottom and you wake up back in the park.
  {
    const c = { x: -2600, z: 2600 };
    deep(c.x - 280, c.z - 280, c.x + 280, c.z + 280, 480);
    cylinder(c.x, c.z, 200, F - 480, F - 474, 12, TRIM); // the grate
    squareRing(c, 330, 280, F, F + 8, { top: 'pooltrimM', side: 'pooltrimM', bottom: 'none' }); // coping
    portals.push({ mins: { x: c.x - 280, y: F - 600, z: c.z - 280 }, maxs: { x: c.x + 280, y: F - 330, z: c.z + 280 }, wake: true });
    spots.drain = c;
    chair(-3300, 3300);
    orb(-3300, F + 380, 3300);
    orb(c.x, F - 260, c.z); // dive down the middle and you get it on your way out (above the grate's pull)
    target(-2000, F + 600, 2000);
  }

  // ================================================================ C: the Natatorium
  // A lap pool between two colonnades, bleachers along the east wall, and the Bubble Line: a current
  // from the west doorway feeds a ring that lifts you into a loop of rings under the ceiling, and the
  // last one drops you into the deep end.
  {
    deep(-520, -1000, 520, 1000, 320);
    for (let i = 0; i < 8; i++) {
      const xc = -455 + 130 * i;
      box(xc - 12, F - 320, -900, xc + 12, F - 318, 900, TRIM); // lane lines
      if (i < 3 || i > 4) box(xc - 40, F, -1090, xc + 40, F + 56, -1010, { top: 'pooltrim', side: 'pooltile', bottom: 'none' }); // starting blocks
    }
    for (const x of [-760, 760]) for (let z = -1000; z <= 1000; z += 400) tall(x - 56, z - 56, x + 56, z + 56);
    for (const [z0, z1] of [
      [-1100, -380],
      [380, 1100],
    ])
      for (let i = 0; i < 6; i++) box(920 + 56 * i, F, z0, i < 5 ? 976 + 56 * i : 1268, F + 48 * (i + 1), z1, i % 2 ? TRIM : TILE); // side by side, not overlapping (or their faces flicker)
    // the Bubble Line
    box(-1650, F, -60, -700, F + 8, 60, CURRENT, { phys: 'boost', boostDir: { x: 1, y: 0, z: 0 }, boostSpeed: 900 });
    const loopY = F + 800;
    const pts = [{ x: -640, y: F + 70, z: 0 }];
    for (let k = 0; k < 8; k++) {
      const phi = ((270 + 45 * k) * Math.PI) / 180;
      pts.push({ x: 600 * Math.sin(phi), y: loopY, z: 600 * Math.cos(phi) });
    }
    const axes = pts.map((p, k) => {
      if (k === 0) return { x: 1, y: 0, z: 0 };
      if (k === 1) return UP;
      const q = pts[k - 1];
      const l = Math.hypot(p.x - q.x, p.z - q.z);
      return { x: (p.x - q.x) / l, y: 0, z: (p.z - q.z) / l };
    });
    bubbles(pts, { x: 0, y: F - 80, z: 0 }, [0.6, ...Array(7).fill(0.42), 0.85], axes);
    spots.bubbleLine = { start: { x: -1500, z: 0 }, rings: pts.length };
    orb(260, F - 280, -600);
    orb(1240, F + 340, 740);
    orb(0, F + 960, 0);
    target(0, F + 520, -1150);
  }

  // ================================================================ N: the Wave Pool
  // Three tiled waves rise out of a deep pool. Run off the platform at the north end onto the first,
  // hold strafe into the face and surf south over all three.
  const arrivals = {};
  {
    deep(-900, -3700, 900, -1500, 300);
    const waves = [
      [-3650, -2950, F + 840, F + 620],
      [-2900, -2200, F + 580, F + 400],
      [-2150, -1550, F + 360, F + 180],
    ];
    waves.forEach(([z0, z1, t0, t1], i) => {
      const h = t0 - (F - 300); // the high end reaches down to the pool floor
      const hw = h / Math.tan(Math.PI / 3);
      add(
        [
          { x: -hw, y: t0 - h, z: z0 },
          { x: hw, y: t0 - h, z: z0 },
          { x: 0, y: t0, z: z0 },
          { x: -hw, y: t1 - h, z: z1 },
          { x: hw, y: t1 - h, z: z1 },
          { x: 0, y: t1, z: z1 },
        ],
        { top: 'poolaquaM', side: 'poolaquaM', bottom: 'none' },
        { ...BIG, tint: i % 2 ? [0.9, 1, 1] : [1, 1, 1] },
      );
      orb(-hw * 0.45, (t0 + t1) / 2 - h * 0.45 + 70, (z0 + z1) / 2);
    });
    box(-150, F + 840, -3880, 150, F + 900, -3700, SOLID); // the platform
    box(-50, F, -3840, 50, F + 840, -3740, TILE);
    orb(0, F + 950, -3790);
    poolPad(-1080, -3500, { x: 0, y: F + 900, z: -3790 }, F + 980);
    spots.wavePool = { platform: { x: 0, y: F + 900, z: -3790 }, waves };
    arrivals.N = { x: 650, y: C - 120, z: -1700 };
  }

  // ================================================================ NE: the Helter-Skelter
  // A tiled tower with a banked slide spiralling round it, down into a splash pool.
  // Crouch to slide.
  {
    const c = { x: 3050, z: -3050 };
    const top = F + 900;
    cylinder(c.x, c.z, 280, F, top, 16, { top: 'pooltile', side: 'pooltileM', bottom: 'none' }, BIG);
    const rin = 270;
    const rout = 520;
    // one and three quarter turns in 5-degree segments (in coarser ones the creases between segments
    // were sharp enough to bump you into the air on the way up)
    const SUB = 3;
    const step = Math.PI / 12 / SUB;
    const K = 42 * SUB;
    const aEnd = Math.PI / 4; // the exit points south-west, into the room
    const a0 = aEnd - K * step;
    const y0 = top - 20;
    const y1 = F + 60;
    const yAt = (k) => y0 - ((y0 - y1) * k) / K;
    const BANK = 40;
    const bankAt = (k) => BANK * Math.min(1, k / (3 * SUB), (K - k) / (3 * SUB)); // banked turns (flat at both ends)
    for (let k = 0; k < K; k++) {
      const aA = a0 + k * step;
      const aB = aA + step;
      const yA = yAt(k);
      const yB = yAt(k + 1);
      const bA = bankAt(k);
      const bB = bankAt(k + 1);
      // A spiral's surface twists, and flat pieces of it meet at slight angles: walking up over a crease
      // like that counts as being thrown off the ground (as in Quake), so a coarse slide bumped you into
      // the air a few times a second (a wobbly climb). So: narrow radial strips (the creases across them
      // are what the twist makes, and they shrink with the strip width), each two flat triangles split
      // along the lower diagonal (a shallow valley, not a ridge), in 5-degree steps (the bank tilts each
      // step against the next).
      const STRIPS = 5;
      for (let j = 0; j < STRIPS; j++) {
        const r0 = rin + ((rout - rin) * j) / STRIPS;
        const r1 = rin + ((rout - rin) * (j + 1)) / STRIPS;
        const q = [P(c, r0, aA, yA + (bA * j) / STRIPS), P(c, r1, aA, yA + (bA * (j + 1)) / STRIPS), P(c, r0, aB, yB + (bB * j) / STRIPS), P(c, r1, aB, yB + (bB * (j + 1)) / STRIPS)];
        const tris = q[0].y + q[3].y <= q[1].y + q[2].y ? [[0, 1, 3], [0, 3, 2]] : [[0, 1, 2], [1, 3, 2]];
        const ends = k === 0 || k === K - 1 ? 'pooltile' : 'none'; // the sides are all hidden, but at the two ends
        for (const t of tris) add(t.flatMap((i) => [q[i], { ...q[i], y: q[i].y - 40 }]), { top: 'poolslide', side: ends, bottom: 'pooltile' }, { phys: 'ice', uvFromAbove: true });
      }
      add([P(c, rout, aA, yA - 40 + bA), P(c, rout + 40, aA, yA - 40 + bA), P(c, rout, aA, yA + 80 + bA), P(c, rout + 40, aA, yA + 80 + bA), P(c, rout, aB, yB - 40 + bB), P(c, rout + 40, aB, yB - 40 + bB), P(c, rout, aB, yB + 80 + bB), P(c, rout + 40, aB, yB + 80 + bB)], SOLID);
    }
    // straight run-out off the bottom, between two rails
    const t = { x: -Math.sin(aEnd), z: Math.cos(aEnd) };
    const L = 360;
    const A = P(c, rin, aEnd, y1);
    const B = P(c, rout + 40, aEnd, y1);
    const Ax = { x: A.x + t.x * L, z: A.z + t.z * L };
    const Bx = { x: B.x + t.x * L, z: B.z + t.z * L };
    const yo = F + 40;
    add([A, { ...A, y: y1 - 40 }, B, { ...B, y: y1 - 40 }, { ...Ax, y: yo }, { ...Ax, y: yo - 40 }, { ...Bx, y: yo }, { ...Bx, y: yo - 40 }], { top: 'poolslide', side: 'pooltile', bottom: 'pooltile' }, { phys: 'ice', uvFromAbove: true });
    const n = { x: Bx.x - Ax.x, z: Bx.z - Ax.z };
    const nl = Math.hypot(n.x, n.z);
    for (const [E0, E1, sgn] of [
      [A, Ax, -1],
      [B, Bx, 1],
    ]) {
      const o = { x: (n.x / nl) * 40 * sgn, z: (n.z / nl) * 40 * sgn };
      add(
        [
          { x: E0.x, y: y1 - 40, z: E0.z },
          { x: E0.x + o.x, y: y1 - 40, z: E0.z + o.z },
          { x: E0.x, y: y1 + 80, z: E0.z },
          { x: E0.x + o.x, y: y1 + 80, z: E0.z + o.z },
          { x: E1.x, y: yo - 40, z: E1.z },
          { x: E1.x + o.x, y: yo - 40, z: E1.z + o.z },
          { x: E1.x, y: yo + 80, z: E1.z },
          { x: E1.x + o.x, y: yo + 80, z: E1.z + o.z },
        ],
        SOLID,
      );
    }
    // the splash pool
    const mid = { x: (Ax.x + Bx.x) / 2, z: (Ax.z + Bx.z) / 2 };
    const pc = { x: Math.round(mid.x + t.x * 520), z: Math.round(mid.z + t.z * 520) };
    deep(pc.x - 340, pc.z - 340, pc.x + 340, pc.z + 340, 420);
    orb(c.x, top + 60, c.z);
    for (const k of [20 * SUB, 42 * SUB - 12]) {
      const p = P(c, (rin + rout) / 2, a0 + (k + 0.5) * step, yAt(k + 0.5) + 50);
      orb(p.x, p.y, p.z);
    }
    poolPad(3300, -1700, { x: c.x, y: top, z: c.z }, F + 980); // from the south, where the slide is lowest
    spots.helterSkelter = { c, top, start: P(c, (rin + rout) / 2, a0 + 0.5 * step, y0), splash: pc, rin, rout };
  }

  // ================================================================ E: the Diving Hall
  // A diving tower (crawl up the ladder on its back) with a high board and two lower springboards over
  // a deep pool: walk onto a springboard and it throws you up (hold jump to go higher).
  {
    deep(2100, -700, 3500, 700, 640);
    const top = F + 880;
    box(1600, F, -300, 1900, top, 300, { top: 'pooltile', side: 'pooltileM', bottom: 'none' }, BIG);
    box(1580, F, -60, 1600, top, 60, { top: 'poolladder', side: 'poolladder', bottom: 'none' }, { phys: 'sticky' });
    // the high board is a plain platform (a springboard up here would bump you into the ceiling)
    box(1900, top - 24, -70, 2420, top, 70, { top: 'pooltrim', side: 'pooltile', bottom: 'pooltile' });
    for (const [z0, z1, y] of [
      [150, 290, F + 300],
      [-290, -150, F + 560],
    ]) {
      box(1900, y - 24, z0, 2240, y, z1, SOLID);
      box(2240, y - 12, z0, 2400, y, z1, BOARD, { phys: 'bounce' });
    }
    // two low springboards off the deck
    for (const s of [-1, 1]) {
      box(1960, F, 470 * s - 60, 2100, F + 16, 470 * s + 60, TILE);
      box(2100, F + 4, 470 * s - 40, 2300, F + 16, 470 * s + 40, BOARD, { phys: 'bounce' });
    }
    orb(1750, top + 50, 0);
    orb(2800, F + 900, 0);
    orb(2800, F - 600, 0);
    target(3300, F + 500, -1000);
    spots.divingHall = { top: { x: 1750, y: top, z: 0 }, ladder: { x: 1560, z: 0 }, board: { x: 2000, y: F + 300, z: 220 } };
    arrivals.E = { x: 3150, y: C - 120, z: 450 };
  }

  // ================================================================ NW: the Drained Pool
  // An empty pool raised on a tiled plinth: a round bowl of glossy (slippery) tile to skate. Ramp on the
  // west side.
  {
    const c = { x: -2600, z: -2600 };
    const SEG = 16;
    const R0 = 440;
    const Q = 400;
    const base = F + 100;
    const rim = base + Q;
    const prof = [0, 15, 30, 45, 60, 72, 82, 88, 90].map((d) => {
      const p = (d * Math.PI) / 180;
      return { r: R0 + Q * Math.sin(p), y: base + Q * (1 - Math.cos(p)) };
    });
    const sq = (a) => 900 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    const BOWL = { top: 'poolice', side: 'poolice', bottom: 'none' };
    // the bowl is a 40-thick shell inside the plinth's walls (solid pieces would hide huge faces)
    const shell = (A, B, a0, a1) => [A, B].flatMap((Q) => [a0, a1].flatMap((a) => [P(c, Q.r, a, Q.y), P(c, Q.r + 40, a, Q.y - 40)]));
    for (let k = 0; k < SEG; k++) {
      const a0 = (k * Math.PI * 2) / SEG;
      const a1 = ((k + 1) * Math.PI * 2) / SEG;
      for (let i = 0; i + 1 < prof.length; i++) add(shell(prof[i], prof[i + 1], a0, a1), BOWL, { phys: 'ice' });
      add([P(c, 840, a0, rim), P(c, 840, a1, rim), P(c, 900, a0, rim), P(c, 900, a1, rim), P(c, 840, a0, rim - 40), P(c, 840, a1, rim - 40), P(c, 900, a0, rim - 40), P(c, 900, a1, rim - 40)], { ...TRIM, bottom: 'pooltrim' });
      add([P(c, 900, a0, rim), P(c, 900, a1, rim), P(c, sq(a0), a0, rim), P(c, sq(a1), a1, rim), P(c, 900, a0, rim - 40), P(c, 900, a1, rim - 40), P(c, sq(a0), a0, rim - 40), P(c, sq(a1), a1, rim - 40)], TILE);
    }
    squareRing(c, 900, 860, F, rim - 40, { top: 'none', side: 'pooltileM', bottom: 'none' });
    cylinder(c.x, c.z, R0, base - 40, base, SEG, { top: 'poolice', side: 'none', bottom: 'none' }, { phys: 'ice' }, 0);
    wedge(-3820, -2800, -3500, -1800, F, rim, F, 'z', TILE);
    orb(c.x, base + 50, c.z);
    orb(c.x, F + 800, c.z);
    orb(c.x + 820, rim + 50, c.z + 820);
    spots.drainedPool = { c, base, rim };
  }

  // ================================================================ W: the Wallrun Baths
  // A deep channel runs the length of the hall with tiled walls standing in it, alternating sides. Come
  // in through the south doorway at speed and wallrun from wall to wall to the north end.
  {
    deep(-2900, -1150, -2300, 1150, 400);
    const WX = -2600;
    for (const [side, za, zb] of [
      [-1, 1150, 500],
      [1, 760, 160],
      [-1, 420, -180],
      [1, 80, -520],
      [-1, -260, -860],
      [1, -600, -1150],
    ]) {
      const xin = WX + side * 128;
      const xout = WX + side * 160;
      box(Math.min(xin, xout), F - 400, zb, Math.max(xin, xout), F + 700, za, { top: 'pooltrimM', side: 'pooltileM', bottom: 'none' }, { ...BIG, tint: side < 0 ? [0.88, 1, 1] : [1, 1, 1] });
    }
    wedge(WX - 110, 1150, WX + 110, 1268, F, F + 100, F, 'z', TILE); // a kicker at the doorway: hit the first wall high
    orb(WX, F + 250, 500);
    orb(WX, F + 260, -300);
    orb(WX, F + 240, -900);
    arrivals.W = { x: WX, y: C - 120, z: 0 };
  }

  // ================================================================ S: the Steps
  // A square pool sunk into the floor with steps all the way round, going down under the water. In the
  // middle, an island with a jet (a springboard: hold jump to pump up to the ceiling); stepping stones
  // lead out to it.
  {
    const c = { x: 0, z: 2600 };
    const half = 900;
    deep(c.x - half, c.z - half, c.x + half, c.z + half, 520);
    for (let i = 0; i < 20; i++) squareRing(c, half - 30 * i, half - 30 * (i + 1), F - 520, F - 16 * (i + 1), i % 4 === 3 ? { top: 'pooltrimM', side: 'pooltrimM', bottom: 'none' } : { top: 'poolaquaM', side: 'poolaquaM', bottom: 'none' });
    // the island is a ring round the jet (not under it: their tops would flicker against each other)
    for (let k = 0; k < 16; k++) {
      const a0 = (k * Math.PI) / 8;
      const a1 = ((k + 1) * Math.PI) / 8;
      add([a0, a1].flatMap((a) => [110, 260].flatMap((r) => [P(c, r, a, F - 520), P(c, r, a, F + 16)])), TILE);
    }
    cylinder(c.x, c.z, 110, F - 520, F + 16, 16, { top: 'poolboard', side: 'pooltrim', bottom: 'none' }, { phys: 'bounce' }, 0);
    for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      for (const r of [740, 580, 420]) {
        const p = P(c, r, a, 0);
        cylinder(p.x, p.z, 50, F - 520, F + 16, 10, TILE);
      }
    }
    orb(c.x, F + 900, c.z);
    orb(c.x + 200, F - 480, c.z - 200);
    spots.steps = { c, jet: { x: c.x, y: F + 16, z: c.z } };
    arrivals.S = { x: 220, y: C - 120, z: 2820 };
  }

  // ================================================================ SE: the Maze
  // A low-ceilinged warren of tiled partitions (a random maze with a few loops), a couple of light wells
  // up into the hall above.
  {
    const x0 = 1332;
    const z0 = 1332;
    const N = 8;
    const cs = (O - 32 - x0) / N;
    const H = 320;
    const rand = mulberry32(371);
    // walls: v[i][j] between cell (i, j) and (i + 1, j); h[i][j] between (i, j) and (i, j + 1)
    const v = Array.from({ length: N + 1 }, () => Array(N).fill(true));
    const h = Array.from({ length: N }, () => Array(N + 1).fill(true));
    const seen = Array.from({ length: N }, () => Array(N).fill(false));
    const stack = [[0, 4]];
    seen[0][4] = true;
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      const nb = [
        [i + 1, j],
        [i - 1, j],
        [i, j + 1],
        [i, j - 1],
      ].filter(([a, b]) => a >= 0 && b >= 0 && a < N && b < N && !seen[a][b]);
      if (!nb.length) {
        stack.pop();
        continue;
      }
      const [a, b] = nb[Math.floor(rand() * nb.length)];
      if (a !== i) v[Math.max(a, i)][j] = false;
      else h[i][Math.max(b, j)] = false;
      seen[a][b] = true;
      stack.push([a, b]);
    }
    // knock out some more walls for loops; the west and north sides are the hall's walls already, and the
    // south and east sides get two openings each
    for (let i = 1; i < N; i++) for (let j = 0; j < N; j++) if (rand() < 0.18) v[i][j] = false;
    for (let i = 0; i < N; i++) for (let j = 1; j < N; j++) if (rand() < 0.18) h[i][j] = false;
    for (let j = 0; j < N; j++) v[0][j] = false;
    for (let i = 0; i < N; i++) h[i][0] = false;
    v[N][2] = v[N][6] = false;
    h[1][N] = h[5][N] = false;
    const WALL = { top: 'none', side: 'pooltileM', bottom: 'none' };
    // merge runs of wall into single brushes; their ends stop just inside the walls they meet (flush, the
    // faces would flicker against each other)
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j < N; ) {
        if (!v[i][j]) {
          j++;
          continue;
        }
        let k = j;
        while (k < N && v[i][k]) k++;
        const x = x0 + i * cs;
        box(x - 16, F, z0 + j * cs - 12, x + 16, F + H, z0 + k * cs + 12, WALL, BIG);
        j = k;
      }
    }
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i < N; ) {
        if (!h[i][j]) {
          i++;
          continue;
        }
        let k = i;
        while (k < N && h[k][j]) k++;
        const z = z0 + j * cs;
        box(x0 + i * cs - 12, F, z - 16, x0 + k * cs + 12, F + H, z + 16, WALL, BIG);
        i = k;
      }
    }
    const cell = (i, j) => [x0 + i * cs + 16, z0 + j * cs + 16, x0 + (i + 1) * cs - 16, z0 + (j + 1) * cs - 16];
    const wells = [cell(2, 5), cell(5, 2), cell(6, 6)];
    for (const [a, b, c2, d] of rectsMinus([x0, z0, O - 32, O - 32], wells)) box(a, F + H, b, c2, F + H + 40, d, { top: 'pooltileM', side: 'pooltileM', bottom: 'poolceil' }, BIG);
    for (const [i, j] of [
      [7, 7],
      [3, 6],
      [6, 3],
    ])
      orb(x0 + (i + 0.5) * cs, F + 60, z0 + (j + 0.5) * cs);
    target(x0 + 4.5 * cs, F + 200, z0 + 4.5 * cs);
    spots.maze = { x0, z0, cs, N, H };
  }

  // ================================================================ the pillar forest and the sealing wall
  for (let i = -5; i <= 5; i++) {
    for (let j = -5; j <= 5; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) < 3 || i === 0 || j === 0) continue; // the axes stay clear
      tall(i * 2000 - 90, j * 2000 - 90, i * 2000 + 90, j * 2000 + 90);
    }
  }
  // things out in the fog, one down each axis
  archWall(true, -9000, -800, 800, 0); // N: a doorway on its own
  orb(0, F + 300, -9000);
  box(8800, F, -70, 9000, F + 16, 70, TILE); // E: a lone springboard
  box(9000, F + 4, -50, 9300, F + 16, 50, BOARD, { phys: 'bounce' });
  orb(9250, F + 700, 0);
  for (let i = 0; i < 56; i++) box(-160, F, 7600 + 40 * i, 160, F + 16 * (i + 1), 7640 + 40 * i, i % 8 === 7 ? { top: 'pooltrimM', side: 'pooltrimM', bottom: 'none' } : { top: 'pooltileM', side: 'pooltileM', bottom: 'none' }, BIG); // S: stairs up to nothing
  orb(0, F + 16 * 56 + 50, 7600 + 40 * 55 + 20);
  chair(-9000, 0, 420); // W: a lifeguard chair
  orb(-9000, F + 500, 0);
  // the sealing wall, far out in the fog
  const SEAL = { top: 'none', side: 'pooltileM', bottom: 'none' };
  box(-HALF - 64, F - 640, -HALF - 64, HALF + 64, C, -HALF, SEAL, M);
  box(-HALF - 64, F - 640, HALF, HALF + 64, C, HALF + 64, SEAL, M);
  box(-HALF - 64, F - 640, -HALF, -HALF, C, HALF, SEAL, M);
  box(HALF, F - 640, -HALF, HALF + 64, C, HALF, SEAL, M);

  // ================================================================ the floor and the ceiling
  // The floor slab is cut around the deep pools (its sides are their walls). The ceiling is a slab
  // under the park's ground; with the ground it makes the "crust" between the two worlds.
  for (const [x0, z0, x1, z1] of rectsMinus([-HALF, -HALF, HALF, HALF], holes)) {
    box(x0, F - 640, z0, x1, F, z1, { top: 'pooltileM', side: 'poolaquaM', bottom: 'none' }, M);
  }
  box(-HALF - 64, C, -HALF - 64, HALF + 64, -128, HALF + 64, { top: 'none', side: 'pooltileM', bottom: 'poolceil' }, { ...M, crust: true });

  return {
    ...POOL,
    waterRects: [[-HALF, -HALF, HALF, HALF]], // flooded everywhere, up to POOL.water
    holes,
    portals,
    arrivals,
    spots,
  };
}

// ================================================================ THE PIERS: the only ways in
// Beyond the far mountains, on each compass axis: a landing at the foot of the mountains (where the
// ground ends), a tiled pier out over the void on pylons, and a pool deck with a bottomless pool and a
// giant glowing doorway. A pale beam rises from the pool (it shows once you're out at the wall).
// Both the pool and the doorway drop you into the Poolrooms, at `arrivals[side]`.
export function buildPiers(api, arrivals) {
  const { add, box, orb } = api;
  const portals = [];
  const beams = [];
  const glows = [];
  const water = [];
  const SIDES = {
    N: (s, d) => ({ x: s, z: -d }),
    S: (s, d) => ({ x: -s, z: d }),
    E: (s, d) => ({ x: d, z: s }),
    W: (s, d) => ({ x: -d, z: -s }),
  };
  const DECK = { top: 'pooltileM', side: 'pooltileM', bottom: 'pooltileM' };
  const TRIM = { top: 'pooltrimM', side: 'pooltrimM', bottom: 'pooltrimM' };
  const AQUA = { top: 'poolaquaM', side: 'poolaquaM', bottom: 'poolaquaM' };
  const BIG = { cell: 512 };
  for (const [name, map] of Object.entries(SIDES)) {
    const alongX = name === 'N' || name === 'S';
    const rect = (s0, d0, s1, d1) => {
      const a = map(s0, d0);
      const b = map(s1, d1);
      return [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)];
    };
    const lbox = (s0, d0, s1, d1, y0, y1, mat) => {
      const [x0, z0, x1, z1] = rect(s0, d0, s1, d1);
      box(x0, y0, z0, x1, y1, z1, mat, BIG);
    };
    lbox(-900, 18500, 900, 19300, -60, 0, DECK); // the landing, where the ground ends
    lbox(-260, 19300, 260, 21000, -40, 0, DECK); // the pier
    for (const s of [-260, 236]) lbox(s, 19300, s + 24, 21000, 0, 24, TRIM); // curbs
    for (const d of [18900, 19900, 20700]) for (const s of [-180, 180]) lbox(s - 40, d - 40, s + 40, d + 40, -2600, d < 19300 ? -60 : -40, DECK);
    // the deck, the coping and the bottomless pool
    const deckR = rect(-900, 21000, 900, 22800);
    const copeR = rect(-360, 21460, 360, 22180);
    const holeR = rect(-320, 21500, 320, 22140);
    for (const [x0, z0, x1, z1] of rectsMinus(deckR, [copeR])) box(x0, -200, z0, x1, 0, z1, DECK, BIG);
    for (const [x0, z0, x1, z1] of rectsMinus(copeR, [holeR])) box(x0, -200, z0, x1, 0, z1, TRIM, BIG);
    for (const [s, d] of [
      [-820, 21080],
      [820, 21080],
      [-820, 22720],
      [820, 22720],
    ])
      lbox(s - 60, d - 60, s + 60, d + 60, -2600, -200, DECK);
    // the shaft under the pool (you never reach its bottom: the portal takes you first)
    const [hx0, hz0, hx1, hz1] = holeR;
    for (const [x0, z0, x1, z1] of rectsMinus([hx0 - 40, hz0 - 40, hx1 + 40, hz1 + 40], [holeR])) box(x0, -940, z0, x1, -200, z1, AQUA, BIG);
    box(hx0, -940, hz0, hx1, -900, hz1, AQUA, BIG);
    water.push({ rect: holeR, y: -30 });
    portals.push({ mins: { x: hx0, y: -700, z: hz0 }, maxs: { x: hx1, y: -260, z: hz1 }, to: arrivals[name], side: name });
    // the doorway: an arch in a freestanding wall at the far end of the deck
    const c = alongX ? map(0, 22680).z : map(0, 22680).x;
    const hw = 450;
    const spring = 1700;
    archWallOver(add, alongX, c, -800, 800, 0, { hw, y0: 0, spring, top: 2700, t: 80 });
    glows.push({ alongX, c, s0: -hw, s1: hw, y0: 0, y1: spring + hw });
    const [dx0, dz0, dx1, dz1] = rect(-hw, 22600, hw, 22760);
    portals.push({ mins: { x: dx0, y: 0, z: dz0 }, maxs: { x: dx1, y: spring, z: dz1 }, to: arrivals[name], side: name });
    const pc = map(0, 21820);
    beams.push({ x: pc.x, y: -30, z: pc.z, kind: 'pool' });
    const o = map(600, 22300);
    orb(o.x, 60, o.z);
  }
  return { portals, beams, glows, water };
}

// The doorway on the piers: same arch as the halls', but standing on its own (all faces drawn).
function archWallOver(add, alongX, c, s0, s1, sd, { hw, y0, spring, top, t }) {
  const Pt = (s, y, tt) => (alongX ? { x: s, y, z: c + tt } : { x: c + tt, y, z: s });
  const slab = (sa, sb, ya, yb, m) => {
    const pts = [];
    for (const s of [sa, sb]) for (const y of [ya, yb]) for (const tt of [-t, t]) pts.push(Pt(s, y, tt));
    add(pts, m, { cell: 512 });
  };
  const WALL = { top: 'pooltileM', side: 'pooltileM', bottom: 'pooltileM' };
  const BAND = { top: 'pooltrimM', side: 'pooltrimM', bottom: 'pooltrimM' };
  const crown = spring + hw;
  for (const [sa, sb] of [
    [s0, sd - hw],
    [sd + hw, s1],
  ]) {
    slab(sa, sb, y0, y0 + 64, BAND);
    slab(sa, sb, y0 + 64, top, WALL);
  }
  slab(sd - hw, sd + hw, crown, top, WALL);
  slab(s0 - 40, s1 + 40, top, top + 60, BAND); // cornice
  const N = 10;
  for (let i = 0; i < N; i++) {
    const pts = [];
    for (const a of [Math.PI - (i * Math.PI) / N, Math.PI - ((i + 1) * Math.PI) / N]) {
      const s = sd + Math.cos(a) * hw;
      for (const y of [spring + Math.sin(a) * hw, crown]) for (const tt of [-t, t]) pts.push(Pt(s, y, tt));
    }
    add(pts, { top: 'pooltileM', side: 'pooltileM', bottom: 'pooltrimM' }, { cell: 512 });
  }
}
