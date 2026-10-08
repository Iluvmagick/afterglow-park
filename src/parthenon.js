// THE MEGA-PARTHENON: a giant (but properly proportioned) Parthenon in the megacity's outer
// ring, west of the Vaporway behind the acropolis. Long axis north-south, east colonnade facing
// the park. Peristyle of 8 x 17 columns, neon frieze, pediments, open roof beams, cella with a
// two-tier naos colonnade and a gold-and-ivory Athena Parthenos, plus two (untimed) parkour routes:
//   THE PERISTYLE CLIMB (outside): east ramp -> floating staircase up the east pteron ->
//     along the entablature -> up the north pediment to its apex.
//   THE NAOS RUN (inside): north door -> floating blocks -> colonnade beams -> stepping slabs ->
//     Athena's helmet crest.

const M = { cell: 1024 };

export function buildMegaParthenon(api) {
  const { add, box, cylinder, pad, orb, tiltedColumn, ellipsoid, PINK, CYAN } = api;
  const IVORY = [1, 0.95, 0.86];
  const MARBLE = 'megamarble';
  const GOLD = 'megagold';
  const XC = -14200;
  const P = { x0: -16000, x1: -12400, z0: -4050, z1: 4050, floor: 180 };
  const steps = { peristyle: [], naos: [] };

  const ramp = (A, B, hw, h0, h1, mat) => {
    const d = { x: B.x - A.x, z: B.z - A.z };
    const l = Math.hypot(d.x, d.z);
    const p = { x: -d.z / l, z: d.x / l };
    const pts = [];
    for (const [Q, h] of [
      [A, h0],
      [B, h1],
    ])
      for (const s of [-1, 1]) {
        const x = Q.x + p.x * hw * s;
        const z = Q.z + p.z * hw * s;
        pts.push({ x, y: 0, z }, { x, y: h, z });
      }
    return add(pts, mat, M);
  };
  // a floating stone block for the parkour routes (top at `top`), recorded as a route step
  const block = (route, x, z, top, half = 100) => {
    box(x - half, top - 40, z - half, x + half, top, z + half, { top: MARBLE, side: MARBLE }, { ...M, tint: steps[route].length % 2 ? PINK : CYAN });
    steps[route].push({ x, z, top, half });
  };

  // ---------------------------------------------------------------- crepidoma (three huge steps) + ramps
  box(P.x0 - 120, 0, P.z0 - 120, P.x1 + 120, 60, P.z1 + 120, MARBLE, { ...M, tint: [0.9, 0.86, 0.95] });
  box(P.x0 - 60, 60, P.z0 - 60, P.x1 + 60, 120, P.z1 + 60, MARBLE, { ...M, tint: [0.95, 0.9, 0.97] });
  box(P.x0, 120, P.z0, P.x1, P.floor, P.z1, { top: MARBLE, side: MARBLE }, { ...M, tint: PINK });
  ramp({ x: -11900, z: 0 }, { x: P.x1, z: 0 }, 500, 0, P.floor, MARBLE); // east, from the Vaporway side
  ramp({ x: XC, z: P.z0 - 550 }, { x: XC, z: P.z0 }, 500, 0, P.floor, MARBLE); // north front
  ramp({ x: XC, z: P.z1 + 550 }, { x: XC, z: P.z1 }, 500, 0, P.floor, MARBLE); // south front

  // ---------------------------------------------------------------- peristyle: 8 x 17 columns
  const column = (x, z, i) => {
    cylinder(x, z, 130, P.floor, 1380, 12, MARBLE, { ...M, tint: i % 2 ? PINK : CYAN });
    box(x - 190, 1380, z - 190, x + 190, 1440, z + 190, GOLD, M);
  };
  let ci = 0;
  for (let i = 0; i < 8; i++) {
    const x = -15850 + (i * 3300) / 7;
    column(x, -3900, ci++);
    column(x, 3900, ci++);
  }
  for (let i = 1; i < 16; i++) {
    const z = -3900 + i * 487.5;
    column(-12550, z, ci++);
    column(-15850, z, ci++);
  }

  // ---------------------------------------------------------------- entablature ring: architrave, NEON frieze, cornice
  for (const [y0, y1, mat] of [
    [1440, 1560, MARBLE],
    [1560, 1680, 'neon'],
    [1680, 1740, MARBLE],
  ]) {
    box(P.x0, y0, P.z0, P.x1, y1, P.z0 + 300, mat, M);
    box(P.x0, y0, P.z1 - 300, P.x1, y1, P.z1, mat, M);
    box(P.x1 - 300, y0, P.z0 + 300, P.x1, y1, P.z1 - 300, mat, M);
    box(P.x0, y0, P.z0 + 300, P.x0 + 300, y1, P.z1 - 300, mat, M);
  }
  // pediments (walkable 14-degree slopes up to 2200)
  for (const [za, zb] of [
    [P.z0, P.z0 + 300],
    [P.z1 - 300, P.z1],
  ]) {
    add(
      [
        { x: P.x0, y: 1740, z: za },
        { x: P.x1, y: 1740, z: za },
        { x: XC, y: 2200, z: za },
        { x: P.x0, y: 1740, z: zb },
        { x: P.x1, y: 1740, z: zb },
        { x: XC, y: 2200, z: zb },
      ],
      MARBLE,
      { ...M, tint: CYAN },
    );
  }
  // open roof: beams across the cella, flush with the entablature top
  for (const z of [-2700, -1800, -900, 0, 900, 1800, 2700]) box(P.x0 + 300, 1620, z - 60, P.x1 - 300, 1740, z + 60, MARBLE, { ...M, tint: PINK });

  // ---------------------------------------------------------------- the cella: walls with doors, porches
  const C = { x0: -15300, x1: -13100, z0: -3000, z1: 3000, top: 1300 };
  const W = 120;
  box(C.x1 - W, P.floor, C.z0, C.x1, C.top, C.z1, MARBLE, { ...M, tint: CYAN }); // east wall
  box(C.x0, P.floor, C.z0, C.x0 + W, C.top, C.z1, MARBLE, { ...M, tint: CYAN }); // west wall
  const wallWithDoor = (z0, z1, dx0, dx1, doorTop) => {
    box(C.x0 + W, P.floor, z0, dx0, C.top, z1, MARBLE, { ...M, tint: PINK });
    box(dx1, P.floor, z0, C.x1 - W, C.top, z1, MARBLE, { ...M, tint: PINK });
    box(dx0, doorTop, z0, dx1, C.top, z1, GOLD, M);
  };
  wallWithDoor(C.z0, C.z0 + W, -14500, -13900, 900); // north (main) door
  wallWithDoor(C.z1 - W, C.z1, -14500, -13900, 900); // south door
  wallWithDoor(1300, 1420, -14400, -14000, 800); // naos | back room
  for (const z of [-3350, 3350]) {
    for (let i = 0; i < 6; i++) {
      const x = -15050 + i * 340;
      cylinder(x, z, 90, P.floor, 1300, 10, MARBLE, { ...M, tint: IVORY });
      box(x - 120, 1300, z - 120, x + 120, 1340, z + 120, GOLD, M);
    }
  }
  // back room (the "parthenon" proper): four columns and a treasure orb
  for (const x of [-14650, -13750]) for (const z of [1900, 2400]) cylinder(x, z, 80, P.floor, C.top, 10, MARBLE, { ...M, tint: IVORY });
  orb(XC, 260, 2150);

  // ---------------------------------------------------------------- naos: two-tier colonnade with walkable beams
  for (let z = -2400; z <= 800; z += 400) {
    cylinder(-14900, z, 60, P.floor, 800, 8, MARBLE, { ...M, tint: IVORY });
    cylinder(-13500, z, 60, P.floor, 800, 8, MARBLE, { ...M, tint: IVORY });
  }
  for (const x of [-14550, XC, -13850]) cylinder(x, 1000, 60, P.floor, 800, 8, MARBLE, { ...M, tint: IVORY });
  box(-14980, 800, -2480, -14820, 840, 1080, GOLD, M); // west beam
  box(-13580, 800, -2480, -13420, 840, 1080, GOLD, M); // east beam
  box(-14820, 800, 920, -13580, 840, 1080, GOLD, M); // south beam
  for (const z of [-2000, -1200, -400, 400]) {
    cylinder(-14900, z, 32, 840, C.top, 8, MARBLE, { ...M, tint: IVORY });
    cylinder(-13500, z, 32, 840, C.top, 8, MARBLE, { ...M, tint: IVORY });
  }
  for (const x of [-14550, -13850]) cylinder(x, 1000, 32, 840, C.top, 8, MARBLE, { ...M, tint: IVORY });
  // the reflecting pool in front of Athena (as in the real one), skateable
  box(XC - 450, P.floor, -1900, XC + 450, P.floor + 6, -900, { top: 'megaice', side: MARBLE }, { ...M, phys: 'ice' });

  // ---------------------------------------------------------------- Athena Parthenos (gold + ivory)
  const AZ = -300;
  box(XC - 260, P.floor, AZ - 200, XC + 260, 360, AZ + 200, MARBLE, { ...M, tint: PINK });
  const frustum = (y0, r0, y1, r1, mat, tint) => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      pts.push({ x: XC + Math.cos(a) * r0, y: y0, z: AZ + Math.sin(a) * r0 }, { x: XC + Math.cos(a) * r1, y: y1, z: AZ + Math.sin(a) * r1 });
    }
    add(pts, mat, { ...M, ...(tint ? { tint } : {}) });
  };
  frustum(360, 220, 900, 150, GOLD); // robe
  frustum(900, 150, 1080, 120, MARBLE, IVORY); // torso
  ellipsoid({ x: XC, y: 1150, z: AZ }, 70, 90, 75, MARBLE, { ...M, tint: IVORY });
  ellipsoid({ x: XC, y: 1200, z: AZ - 10 }, 80, 60, 85, GOLD, M);
  add(
    [
      { x: XC - 12, y: 1240, z: AZ - 120 },
      { x: XC + 12, y: 1240, z: AZ - 120 },
      { x: XC - 12, y: 1240, z: AZ + 120 },
      { x: XC + 12, y: 1240, z: AZ + 120 },
      { x: XC, y: 1340, z: AZ },
    ],
    GOLD,
    M,
  ); // helmet crest
  {
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const dx of [-15, 15]) pts.push({ x: XC + 280 + dx, y: 520 + Math.sin(a) * 220, z: AZ + Math.cos(a) * 220 });
    }
    add(pts, GOLD, M); // shield
  }
  tiltedColumn({ x: XC - 245, y: 790, z: AZ - 50 }, { x: 30, y: 1220, z: -100 }, 18, 1225, 6, GOLD, M); // spear
  box(XC + 100, 920, AZ - 350, XC + 180, 980, AZ + 40, MARBLE, { ...M, tint: IVORY }); // outstretched arm
  {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pts.push({ x: XC + 140 + Math.cos(a) * 40, y: 980, z: AZ - 320 + Math.sin(a) * 40 }, { x: XC + 140 + Math.cos(a) * 22, y: 1100, z: AZ - 320 + Math.sin(a) * 22 });
    }
    add(pts, GOLD, M); // a little Nike in her hand
    ellipsoid({ x: XC + 140, y: 1125, z: AZ - 320 }, 25, 28, 25, GOLD, M, 4, 8);
  }
  orb(XC + 140, 1200, AZ - 320);

  // ---------------------------------------------------------------- route: THE NAOS RUN (inside)
  for (const [i, [x, z]] of [
    [-14550, -2550],
    [-14700, -2250],
    [-14550, -1950],
    [-14700, -1650],
    [-14550, -1350],
    [-14700, -1050],
  ].entries())
    block('naos', x, z, 280 + i * 100);
  steps.naos.push({ x: -14900, z: -1050, top: 840, half: 80, beam: true });
  steps.naos.push({ x: XC, z: 1000, top: 840, half: 80, beam: true, restart: true }); // new chain from the south beam
  for (const [i, z] of [760, 560, 360, 160, -40].entries()) block('naos', XC, z, 920 + i * 82.5, 80);
  steps.naos.push({ x: XC, z: AZ, top: 1340, half: 12, crest: true });

  // ---------------------------------------------------------------- route: THE PERISTYLE CLIMB (outside)
  for (let i = 0; i < 15; i++) block('peristyle', i % 2 ? -12960 : -12820, 300 - 260 * i, 260 + 100 * i);
  steps.peristyle.push({ x: -12550, z: 300 - 260 * 14, top: 1740, half: 150, beam: true });

  orb(XC, 2280, P.z0 + 150); // north pediment apex (the climb's finish)
  orb(XC, 2280, P.z1 - 150); // south pediment apex
  orb(XC, 1810, 0); // middle roof beam

  // a pad from behind the acropolis straight onto the east entablature
  pad(-9600, 0, -300, { x: -12550, y: 1740, z: 0 }, 2600, 110);

  return { steps, center: { x: XC, z: 0 } };
}
