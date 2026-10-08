// THE MEGACITY: a ring of absurdly oversized vaporwave megastructures around the park.
// Everything here is huge, so it uses the "mega" materials: perspective-correct (no affine warp)
// and coarse mesh cells, which keeps the triangle count sane.
//
// Compass: north = -z, east = +x. Standard angles (atan2(z, x)) are used for the ring road.
//
//   N   supertall tower (twisting tiers, Sky Elevator ring chain to a sky deck, sticky crown)
//   NW  three glass towers + a sky-ship deck with an infinity pool (middle tower is sticky)
//   NE  golden frame with a homing ring that throws you onto the supertall's sky deck
//   E   the Sail: a 3600-high curved ice drop -> runout -> kicker...
//   SE  ...onto a black glass pyramid you surf (with a sky beam)
//   S   a buried colossal Helios head with a golden crown of rays
//   SW  the Palm: a skateable ice palm island inside a wallrun crescent
//   all around: the Vaporway ring highway (speed strips, rails, arches, ramps), giant floating columns
const GRAVITY = 800;

export function buildMegacity(api) {
  const { add, box, obox, cylinder, pad, orb, target, ring, tiltedColumn, ellipsoid, decor, PINK, CYAN } = api;
  const beams = [];
  const M = { cell: 1024 };
  const at = (r, a) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  const yawOf = (d) => Math.atan2(d.x, d.z); // obox yaw whose long (hz) axis points along d
  const norm = (d) => {
    const l = Math.hypot(d.x, d.z);
    return { x: d.x / l, y: 0, z: d.z / l };
  };
  // a slab from A to B (x/z), half width hw, between y0..y1
  const slab = (A, B, hw, y0, y1, mat, extra) => {
    const d = { x: B.x - A.x, z: B.z - A.z };
    const len = Math.hypot(d.x, d.z);
    return obox((A.x + B.x) / 2, (A.z + B.z) / 2, hw, len / 2, y0, y1, yawOf(d), mat, { ...M, ...extra });
  };
  // a ramp from A (height h0) to B (height h1), half width hw, solid down to the ground
  const ramp = (A, B, hw, h0, h1, mat, extra) => {
    const d = norm({ x: B.x - A.x, z: B.z - A.z });
    const p = { x: -d.z, z: d.x };
    const pts = [];
    for (const [P, h] of [
      [A, h0],
      [B, h1],
    ])
      for (const s of [-1, 1]) {
        const x = P.x + p.x * hw * s;
        const z = P.z + p.z * hw * s;
        pts.push({ x, y: 0, z }, { x, y: h, z });
      }
    return add(pts, mat, { ...M, ...extra });
  };
  // ring segment between radii (centered at c), angles a0..a1, heights y0..y1
  const arcSeg = (c, r0, r1, a0, a1, y0, y1, mat, extra) => {
    const pts = [];
    for (const r of [r0, r1]) for (const a of [a0, a1]) for (const y of [y0, y1]) pts.push({ x: c.x + Math.cos(a) * r, y, z: c.z + Math.sin(a) * r });
    return add(pts, mat, { ...M, ...extra });
  };
  const megaPad = (x, z, to, apex, y = 0) => pad(x, y, z, to, apex, 110);

  // ================================================================ the Vaporway (ring highway)
  const HW = { R: 11500, N: 16, half: 350, top: 320, speed: 2400 };
  const vert = (k) => at(HW.R, (k * Math.PI * 2) / HW.N);
  const radial = (k, r) => at(r, (k * Math.PI * 2) / HW.N);
  const RAMP_SEGMENTS = [12, 1, 5, 9]; // ramps enter mid-segment; those segments get no inner rail
  for (let k = 0; k < HW.N; k++) {
    const k1 = (k + 1) % HW.N;
    const dir = norm({ x: vert(k1).x - vert(k).x, z: vert(k1).z - vert(k).z });
    const quad = (r0, r1, y0, y1, mat, extra) => {
      const pts = [];
      for (const r of [r0, r1]) for (const kk of [k, k1]) for (const y of [y0, y1]) pts.push({ ...radial(kk, r), y });
      return add(pts, mat, { ...M, ...extra });
    };
    quad(HW.R - HW.half, HW.R + HW.half, HW.top - 40, HW.top, { top: 'megaboost', side: 'neon', bottom: 'megamarble' }, {
      phys: 'boost',
      boostDir: dir,
      boostSpeed: HW.speed,
    });
    if (!RAMP_SEGMENTS.includes(k)) quad(HW.R - HW.half, HW.R - HW.half + 40, HW.top, HW.top + 80, 'neon');
    quad(HW.R + HW.half - 40, HW.R + HW.half, HW.top, HW.top + 80, 'neon');
    const v = vert(k);
    cylinder(v.x, v.z, 110, 0, HW.top - 40, 8, 'megamarble', { ...M, tint: PINK });
  }
  // access ramps (mid-segment, rising radially onto the deck)
  for (const k of RAMP_SEGMENTS) {
    const a = ((k + 0.5) * Math.PI * 2) / HW.N;
    const rEnd = (HW.R - HW.half) * Math.cos(Math.PI / HW.N); // the deck's inner edge, mid-segment
    const d = { x: Math.cos(a), y: 0, z: Math.sin(a) };
    ramp(at(9300, a), at(rEnd, a), 300, 0, HW.top, { top: 'megaboost', side: 'neon' }, { phys: 'boost', boostDir: d, boostSpeed: 1800 });
  }
  // giant arches over the road, each with a big ring that boosts you along it
  for (const k of [3, 7, 11, 15]) {
    const a = ((k + 0.5) * Math.PI * 2) / HW.N;
    const t = { x: -Math.sin(a), z: Math.cos(a) }; // direction of travel
    for (const r of [10850, 12150]) {
      const p = at(r, a);
      obox(p.x, p.z, 160, 160, 0, 1500, a, 'megamarble', { ...M, tint: k % 2 ? PINK : CYAN });
    }
    slab(at(10690, a), at(12310, a), 160, 1500, 1700, 'megagold');
    const c = at(HW.R, a);
    ring(c.x, 560, c.z, t.x, 0, t.z, 2800, { radius: 260, style: 'mega' });
  }
  orb(at(HW.R, 0.5 * (Math.PI / 8)).x, 500, at(HW.R, 0.5 * (Math.PI / 8)).z);
  orb(at(HW.R, 8.5 * (Math.PI / 8)).x, 500, at(HW.R, 8.5 * (Math.PI / 8)).z);

  // feeder speed roads from the canyon gates to the ramps
  const feeder = (from, rampSeg) => {
    const a = ((rampSeg + 0.5) * Math.PI * 2) / HW.N;
    const to = at(9300, a);
    const d = norm({ x: to.x - from.x, z: to.z - from.z });
    slab(from, to, 150, 0, 8, { top: 'megaboost', side: 'neon' }, { phys: 'boost', boostDir: d, boostSpeed: 1600 });
  };
  feeder({ x: 900, z: -4960 }, 12);
  feeder({ x: 4960, z: 3300 }, 1);
  feeder({ x: -1400, z: 4960 }, 5);

  // ================================================================ N: the supertall
  const BJ = { x: 0, z: -8500 };
  cylinder(BJ.x, BJ.z, 1000, 0, 240, 8, 'megamarble', { ...M, tint: CYAN }, Math.PI / 8);
  for (let i = 0; i < 11; i++) {
    const sticky = i >= 9;
    cylinder(BJ.x, BJ.z, 760 - 58 * i, 240 + 560 * i, 800 + 560 * i, 8, sticky ? 'glassgoo' : 'glass', { ...M, ...(sticky ? { phys: 'sticky' } : {}) }, Math.PI / 8 + i * 0.13);
  }
  {
    const pts = [{ x: BJ.x, y: 8400, z: BJ.z }];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + 11 * 0.13 + (i / 8) * Math.PI * 2;
      pts.push({ x: BJ.x + Math.cos(a) * 180, y: 6400, z: BJ.z + Math.sin(a) * 180 });
    }
    add(pts, 'glassgoo', { ...M, phys: 'sticky' });
  }
  // sky deck ring at 5000
  for (let i = 0; i < 12; i++) arcSeg(BJ, 280, 900, (i / 12) * Math.PI * 2, ((i + 1) / 12) * Math.PI * 2, 4960, 5000, { top: 'megamarble', side: 'megagold' }, { tint: PINK });
  orb(BJ.x, 5070, BJ.z + 620);
  orb(BJ.x, 8470, BJ.z); // the very top
  // Sky Elevator: a feeder strip into a horizontal ring, then a vertical chain of homing rings
  slab({ x: 0, z: -5900 }, { x: 0, z: -7080 }, 90, 0, 8, { top: 'megaboost', side: 'neon' }, { phys: 'boost', boostDir: { x: 0, y: 0, z: -1 }, boostSpeed: 1000 });
  {
    const pts = [{ x: 0, y: 70, z: -7150 }];
    for (let k = 1; k <= 12; k++) pts.push({ x: 0, y: 120 + k * 400, z: -7200 });
    const deck = { x: 0, y: 5040, z: BJ.z + 650 };
    pts.forEach((p, k) => {
      const next = k < pts.length - 1 ? pts[k + 1] : deck;
      const T = k === 0 ? 0.5 : k < pts.length - 1 ? 0.36 : 1.0;
      const v = { x: (next.x - p.x) / T, y: (next.y - p.y + 0.5 * GRAVITY * T * T) / T, z: (next.z - p.z) / T };
      const axis = k === 0 ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 };
      ring(p.x, p.y, p.z, axis.x, axis.y, axis.z, Math.hypot(v.x, v.y, v.z), { exact: true, target: next, flightTime: T, gravity: GRAVITY, style: 'elevator' });
    });
  }

  // ================================================================ NW: towers + sky-ship + infinity pool
  for (const [i, x] of [-7000, -5600, -4200].entries()) {
    const sticky = i === 1;
    box(x - 260, 0, -7850, x + 260, 3500, -6550, sticky ? 'glassgoo' : 'glass', { ...M, ...(sticky ? { phys: 'sticky' } : {}) });
  }
  box(-7550, 3500, -7500, -3650, 3600, -6900, { top: 'megamarble', side: 'megamarble' }, { ...M, tint: CYAN });
  box(-7300, 3600, -7380, -4000, 3608, -7020, { top: 'megaice', side: 'megamarble' }, { ...M, phys: 'ice' });
  orb(-5600, 3680, -7200);
  megaPad(1500, -5100, { x: -5600, y: 3608, z: -7200 }, 5000);

  // ================================================================ NE: the golden frame
  {
    const c = { x: 6500, z: -6500 };
    const t = { x: Math.SQRT1_2, z: Math.SQRT1_2 };
    const A = { x: c.x - t.x * 1300, z: c.z - t.z * 1300 };
    const B = { x: c.x + t.x * 1300, z: c.z + t.z * 1300 };
    for (const p of [A, B]) obox(p.x, p.z, 250, 250, 0, 3200, Math.PI / 4, 'megagold', M);
    slab({ x: A.x - t.x * 250, z: A.z - t.z * 250 }, { x: B.x + t.x * 250, z: B.z + t.z * 250 }, 250, 3200, 3450, 'megagold');
    orb(c.x, 3520, c.z);
    // homing ring: whatever way you fly through, it throws you onto the supertall's sky deck
    const deck = { x: BJ.x, y: 5040, z: BJ.z + 650 };
    ring(c.x, 1600, c.z, Math.SQRT1_2, 0, -Math.SQRT1_2, 2600, { radius: 900, target: deck, flightTime: 3.4, gravity: GRAVITY, style: 'mega' });
    megaPad(c.x - 600, c.z + 600, { x: c.x, y: 3450, z: c.z }, 4200); // in front of the frame, park side
  }

  // ================================================================ E: the Sail (a giant curved ice drop)
  const SAIL = { x0: 5300, x1: 6700, zTop: -3000, top: 3600 };
  {
    const angles = [75, 65, 55, 45, 35, 25, 17, 10];
    const L = SAIL.top / angles.reduce((s, a) => s + Math.sin((a * Math.PI) / 180), 0);
    let z0 = SAIL.zTop;
    let y0 = SAIL.top;
    for (const a of angles) {
      const r = (a * Math.PI) / 180;
      const z1 = z0 + L * Math.cos(r);
      const y1 = Math.max(0, y0 - L * Math.sin(r));
      const pts = [];
      for (const x of [SAIL.x0, SAIL.x1]) pts.push({ x, y: y0, z: z0 }, { x, y: y1, z: z1 }, { x, y: 0, z: z0 }, { x, y: 0, z: z1 });
      add(pts, 'megasurf', { ...M, phys: 'ice', tint: [1, 0.9, 1] });
      z0 = z1;
      y0 = y1;
    }
    SAIL.zBottom = z0;
  }
  box(SAIL.x0, SAIL.top - 100, -3700, SAIL.x1, SAIL.top, SAIL.zTop, { top: 'megamarble', side: 'glass' }, M);
  box(5900, 0, -3900, 6100, 4800, -3700, 'glass', M);
  add([{ x: 5900, y: 4800, z: -3900 }, { x: 6100, y: 4800, z: -3900 }, { x: 5900, y: 4800, z: -3700 }, { x: 6100, y: 4800, z: -3700 }, { x: 6000, y: 5200, z: -3800 }], 'megagold', M);
  // runout + kicker toward the pyramid
  box(SAIL.x0, 0, SAIL.zBottom, SAIL.x1, 2, 2200, { top: 'megaice', side: 'megamarble' }, { ...M, phys: 'ice' });
  ramp({ x: 6000, z: 2200 }, { x: 6000, z: 2700 }, 700, 2, 320, { top: 'megasurf', side: 'megamarble' }, { phys: 'ice' });
  orb(6000, SAIL.top + 80, -3350);
  megaPad(5300, 3900, { x: 6000, y: SAIL.top, z: -3350 }, 4600);

  // ================================================================ SE: black glass pyramid
  {
    const c = { x: 5800, z: 6700 };
    const h = 1500;
    add(
      [
        { x: c.x - h, y: 0, z: c.z - h },
        { x: c.x + h, y: 0, z: c.z - h },
        { x: c.x - h, y: 0, z: c.z + h },
        { x: c.x + h, y: 0, z: c.z + h },
        { x: c.x, y: 2400, z: c.z },
      ],
      'megaobsidian',
      M,
    );
    beams.push({ x: c.x, y: 2400, z: c.z, kind: 'pyramid' });
    orb(c.x, 2470, c.z);
  }

  // ================================================================ S: the buried colossus
  {
    const c = { x: 0, z: 8650 };
    add(
      [
        { x: -2300, y: 0, z: 7900 },
        { x: 2300, y: 0, z: 7900 },
        { x: -2300, y: 0, z: 9700 },
        { x: 2300, y: 0, z: 9700 },
        { x: -1400, y: 500, z: 8250 },
        { x: 1400, y: 500, z: 8250 },
        { x: -1400, y: 500, z: 9350 },
        { x: 1400, y: 500, z: 9350 },
      ],
      'megamarble',
      { ...M, tint: PINK },
    );
    ellipsoid({ x: c.x, y: 1000, z: c.z }, 1000, 1500, 1050, 'megamarble', { ...M, tint: [0.95, 0.9, 1] }, 6, 12);
    ellipsoid({ x: c.x, y: 2050, z: c.z + 150 }, 1040, 600, 1050, 'megamarble', { ...M, tint: [0.72, 0.92, 1] }, 5, 12);
    add(
      [
        { x: -110, y: 1150, z: 7700 },
        { x: 110, y: 1150, z: 7700 },
        { x: 0, y: 1460, z: 7700 },
        { x: 0, y: 1180, z: 7470 },
      ],
      'megamarble',
      { ...M, tint: [0.95, 0.9, 1] },
    );
    // Helios' crown of golden rays
    const C = { x: 0, y: 1500, z: 8900 };
    for (let i = 0; i < 11; i++) {
      const ph = ((15 + (i * 150) / 10) * Math.PI) / 180;
      const d = { x: Math.cos(ph), y: Math.sin(ph) };
      const base = { x: C.x + d.x * 950, y: C.y + d.y * 950, z: C.z };
      const tip = { x: C.x + d.x * 2100, y: C.y + d.y * 2100, z: C.z };
      add(
        [
          { x: base.x, y: base.y, z: base.z - 150 },
          { x: base.x, y: base.y, z: base.z + 150 },
          { x: base.x - d.y * 150, y: base.y + d.x * 150, z: base.z },
          { x: base.x + d.y * 150, y: base.y - d.x * 150, z: base.z },
          tip,
        ],
        'megagold',
        M,
      );
    }
    // (in front of the crown's vertical ray)
    orb(0, 2690, c.z - 200);
    megaPad(-2000, 5100, { x: 0, y: 2616, z: c.z - 200 }, 3600);
  }

  // ================================================================ SW: the Palm
  {
    const crown = { x: -5900, z: 5900 };
    const ICE = { top: 'megaice', side: 'megamarble' };
    cylinder(crown.x, crown.z, 300, 0, 40, 12, ICE, { ...M, phys: 'ice' });
    slab(crown, { x: -4800, z: 4800 }, 260, 0, 40, ICE, { phys: 'ice' });
    const out = Math.atan2(Math.SQRT1_2, -Math.SQRT1_2); // pointing away from the park
    for (let i = 0; i < 7; i++) {
      const a = out + ((i - 3) * 25 * Math.PI) / 180;
      const tip = at(1300, a);
      const B = { x: crown.x + tip.x, z: crown.z + tip.z };
      slab(crown, B, 150, 0, 40, ICE, { phys: 'ice' });
      cylinder(B.x, B.z, 14, 40, 460, 6, 'bark', { tint: [1, 0.7, 0.8] });
      decor.push({ type: 'palm', x: B.x, z: B.z, h: 460, r: 200 });
    }
    cylinder(crown.x, crown.z, 16, 40, 560, 6, 'bark', { tint: [1, 0.7, 0.8] });
    decor.push({ type: 'palm', x: crown.x, z: crown.z, h: 560, r: 230 });
    // the crescent: a curved wall around the fronds to wallrun along
    for (let i = 0; i < 12; i++) {
      const a0 = out - (80 * Math.PI) / 180 + (i * 160 * Math.PI) / 180 / 12;
      const a1 = a0 + (160 * Math.PI) / 180 / 12;
      arcSeg(crown, 1500, 1580, a0, a1, 0, 300, 'megamarble', { tint: i % 2 ? PINK : CYAN });
    }
    orb(crown.x + 180, 110, crown.z - 120); // beside the big palm
  }

  // ================================================================ giant floating columns
  const cols = [
    [{ x: 2500, y: 2200, z: -6200 }, { x: 1, y: 0.2, z: 0.3 }, 260, 3500, PINK],
    [{ x: -2600, y: 2600, z: -5600 }, { x: 1, y: 0.1, z: -0.2 }, 280, 3000, CYAN],
    [{ x: 9000, y: 2400, z: -2500 }, { x: 0.2, y: 0.15, z: 1 }, 260, 3000, PINK],
    [{ x: 2600, y: 2400, z: 7000 }, { x: 1, y: -0.3, z: 0.2 }, 280, 3200, CYAN],
    [{ x: -2800, y: 3000, z: 7000 }, { x: 0.3, y: 0.2, z: -1 }, 300, 3000, PINK],
    [{ x: -9900, y: 2400, z: 1000 }, { x: 0.1, y: 0.2, z: 1 }, 260, 3000, CYAN],
  ];
  for (const [c, axis, r, len, tint] of cols) tiltedColumn(c, axis, r, len, 12, 'megamarble', { ...M, tint });
  orb(2500, 2200 + 300, -6200);
  orb(-2800, 3000 + 340, 7000);
  target(4000, 1800, -2000);
  target(-4000, 2000, -9000);
  target(9000, 1500, 9000);

  // the big one: from the west gate onto the supertall's sky deck
  megaPad(-5800, 1250, { x: BJ.x, y: 5000, z: BJ.z + 650 }, 6600, 8);

  return { beams };
}
