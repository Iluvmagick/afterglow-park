// Trailer shot list: bot-driven runs through the park, plus two camera flyovers.
// Pure (no DOM) so the shots can be dry-run headlessly. Each shot:
//   { title, sub?, color, duration, setup(sim), policy(i, player, mem, sim) -> partial cmd }   (bot shot)
//   { title, sub?, color, duration, camera(u) -> { pos, yaw, pitch } }                         (flyover)
// Bot policies return yaw/pitch too; those drive the camera, so they turn smoothly.

const TAU = Math.PI * 2;
const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
// ease an angle toward a target (k per tick), for camera-friendly turning
const ease = (m, key, target, k) => {
  if (m[key] === undefined) m[key] = target;
  m[key] += wrap(target - m[key]) * k;
  return m[key];
};
const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const pitchTo = (from, to) => Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

// Hop along a list of {x, z, top, half} stepping stones: run at the next one, jump at the edge.
function hopChain(steps, { pitch = 0.12, first = 0 } = {}) {
  return (i, p, m) => {
    m.k ??= first;
    const A = steps[m.k];
    const B = steps[m.k + 1];
    if (!B) return { forward: 0, yaw: m.yaw, pitch };
    const onB = p.onGround && Math.abs(p.pos.y - B.top) < 3 && Math.abs(p.pos.x - B.x) < (B.beam ? 400 : B.half + 20) && Math.abs(p.pos.z - B.z) < (B.beam ? 400 : B.half + 20);
    if (onB) {
      m.k++;
      m.jumped = false;
      return { forward: 1, yaw: m.yaw, pitch };
    }
    const d = { x: B.x - A.x, z: B.z - A.z };
    const l = Math.hypot(d.x, d.z);
    const along = ((p.pos.x - A.x) * d.x + (p.pos.z - A.z) * d.z) / l;
    const jump = !m.jumped && p.onGround && Math.abs(p.pos.y - A.top) < 3 && along > A.half - 24;
    if (jump) m.jumped = true;
    return { forward: 1, jump, yaw: ease(m, 'yaw', yawTo(p.pos, B), 0.2), pitch };
  };
}

export function trailerShots(level) {
  const ob = level.obelisk;
  const helix = level.rings.filter((r) => r.style === 'obelisk');
  const ledge = (i) => {
    const a = Math.PI + i * ((2 * Math.PI) / 9);
    return { x: Math.sin(a) * 225, z: Math.cos(a) * 225, top: 16 + 64 * (i + 1), half: 70 };
  };
  const shots = [];

  // ------------------------------------------------------------ intro flyover
  shots.push({
    title: 'AFTERGLOW PARK',
    sub: 'A CHILL MOVEMENT PLAYGROUND',
    color: '#ff9ad0',
    duration: 6,
    camera: (u) => {
      const t = smooth(u);
      return { pos: { x: lerp(-900, 900, t), y: lerp(2100, 1150, t), z: lerp(3300, 1700, t) }, yaw: lerp(-0.35, 0.3, t), pitch: lerp(-0.32, -0.12, t) };
    },
  });

  // ------------------------------------------------------------ bunnyhop + air strafe (out on the neon grid)
  shots.push({
    title: 'BUNNYHOP',
    sub: 'STRAFE TO GAIN SPEED',
    color: '#ffe27a',
    duration: 7,
    setup: (sim) => sim.player.reset({ x: 13000, y: 0.25, z: 4200 }, 0),
    policy: (i, p, m) => {
      const v = p.vel;
      const sp = Math.hypot(v.x, v.z);
      if (i < 50) return { forward: 1, yaw: 0, pitch: 0.02 };
      const side = Math.floor((i - 50) / 140) % 2 ? -1 : 1; // S-curves
      const vAng = Math.atan2(-v.z, v.x);
      const phi = Math.acos(Math.min(1, 15 / Math.max(sp, 1)));
      // pressing D: wishdir slightly ahead-right of velocity; pressing A: ahead-left. Camera looks along velocity.
      const yaw = side > 0 ? vAng - phi : vAng + phi - Math.PI;
      return { right: side, jump: true, yaw: ease(m, 'y', yaw, 0.35), pitch: 0.02 };
    },
  });

  // ------------------------------------------------------------ wallrun gauntlet
  shots.push({
    title: 'WALLRUN',
    color: '#7af0e6',
    duration: 4.8,
    setup: (sim) => sim.player.reset({ x: 0, y: 320.25, z: -1130 }, 0),
    policy: (i, p, m) => {
      const P = 0.04;
      if (!m.left) {
        // run-up: angle toward the first (left) wall, jump at the platform edge
        if (p.pos.z < -1372) {
          m.left = true;
          return { forward: 1, jump: true, yaw: ease(m, 'y', 0.5, 0.25), pitch: P };
        }
        return { forward: 1, yaw: ease(m, 'y', p.pos.z < -1180 ? 0.5 : 0, 0.25), pitch: P };
      }
      if (p.wall.active) {
        m.side = p.pos.x < 0 ? -1 : 1;
        m.wt = (m.wt || 0) + 1;
        if (m.wt > 45) {
          m.wt = 0;
          return { forward: 1, jump: true, yaw: ease(m, 'y', 0.5 * m.side, 0.3), pitch: P }; // kick toward the other wall
        }
        return { forward: 1, yaw: ease(m, 'y', 0, 0.15), pitch: P };
      }
      m.wt = 0;
      // in the air between walls: keep heading for the other wall
      return { forward: 1, yaw: ease(m, 'y', m.side ? 0.45 * m.side : 0.5, 0.25), pitch: P };
    },
  });

  // ------------------------------------------------------------ surf
  shots.push({
    title: 'SURF',
    sub: 'HOLD INTO THE RAMP',
    color: '#ff9ad0',
    duration: 6,
    setup: (sim) => sim.player.reset({ x: 2150, y: 1180.25, z: -3500 }, Math.PI),
    policy: (i, p, m) => {
      const ramps = [
        [-3400, -1850, 1100, 800],
        [-1650, -100, 740, 440],
        [100, 1650, 400, 160],
      ];
      const c = { yaw: Math.PI, pitch: -0.12 };
      if (i < 30) return { ...c, forward: 1 };
      const r = ramps.find(([z0, z1]) => p.pos.z >= z0 - 100 && p.pos.z <= z1 + 50);
      if (r) {
        const t = Math.min(1, Math.max(0, (p.pos.z - r[0]) / (r[1] - r[0])));
        if (p.pos.y < r[2] + (r[3] - r[2]) * t - 170 || p.vel.y < -150) c.right = -1;
      }
      return c;
    },
  });

  // ------------------------------------------------------------ slide mountain -> ring -> kicker
  shots.push({
    title: 'SLIDE',
    color: '#7af0e6',
    duration: 4.2,
    setup: (sim) => sim.player.reset({ x: 0, y: 648.25, z: 3800 }, 0),
    policy: (i, p, m) => ({ forward: 1, crouch: i > 40 && p.pos.z > 1350, yaw: ease(m, 'y', Math.sin(i * 0.008) * 0.12, 0.2), pitch: -0.06 }),
  });

  // ------------------------------------------------------------ spire climb (jump + mantle)
  shots.push({
    title: 'MANTLE',
    sub: 'CLIMB THE SPIRE',
    color: '#ffe27a',
    duration: 5.4,
    setup: (sim) => {
      const L = ledge(2);
      sim.player.reset({ x: L.x, y: L.top + 0.25, z: L.z }, 0);
    },
    policy: hopChain(
      Array.from({ length: 12 }, (_, k) => ledge(k + 2)),
      { pitch: 0.18 },
    ),
  });

  // ------------------------------------------------------------ rocket jump + grapple onto a sky island
  shots.push({
    title: 'ROCKET JUMP + GRAPPLE',
    color: '#ff9a6a',
    duration: 5.2,
    // from the top of the spire: rocket-jump off it, then hook the sky island from above and reel in
    setup: (sim) => sim.player.reset({ x: 60, y: 1530.25, z: -60 }, -0.45),
    policy: (i, p, m) => {
      const island = { x: 700, y: 1350, z: -1500 };
      const eye = p.eye();
      if (i < 22) return { yaw: ease(m, 'y', -0.45, 0.3), pitch: ease(m, 'p', -1.45, 0.35), fire: i === 9, jump: i === 10, forward: i > 10 ? 1 : 0 };
      const aim = { yaw: ease(m, 'y', yawTo(eye, island), 0.15), pitch: ease(m, 'p', pitchTo(eye, island), 0.15) };
      if (p.onGround && i > 60) return { yaw: aim.yaw, pitch: ease(m, 'p', 0, 0.05) };
      return { grapple: i > 55 && !p.onGround, forward: 1, ...aim };
    },
  });

  // ------------------------------------------------------------ trampolines (hold jump to pump)
  shots.push({
    title: 'TRAMPOLINES',
    sub: 'HOLD JUMP TO PUMP',
    color: '#ff9ad0',
    duration: 5,
    setup: (sim) => sim.player.reset({ x: -1150, y: 0.25, z: -1650 }, 0),
    policy: (i, p, m) => {
      const pad = { x: -1150, z: -1850 };
      const off = Math.hypot(p.pos.x - pad.x, p.pos.z - pad.z);
      const look = { yaw: ease(m, 'y', 0.2 + Math.sin(i * 0.008) * 0.5, 0.05), pitch: ease(m, 'p', p.vel.y > 0 ? -0.3 : -0.55, 0.03) };
      if (i < 55) return { forward: 1, ...look };
      // air-strafe back toward the middle of the pad so every bounce lands on it
      const toward = Math.atan2(-(pad.x - p.pos.x), -(pad.z - p.pos.z));
      const rel = wrap(toward - look.yaw);
      return { jump: true, forward: off > 25 ? Math.round(Math.cos(rel)) : 0, right: off > 25 ? -Math.round(Math.sin(rel)) : 0, ...look };
    },
  });

  // ------------------------------------------------------------ the obelisk express
  shots.push({
    title: 'THE OBELISK EXPRESS',
    color: '#c89aff',
    duration: 10,
    setup: (sim) => {
      const r0 = helix[0];
      const d = { x: helix[1].pos.x - r0.pos.x, z: helix[1].pos.z - r0.pos.z };
      const l = Math.hypot(d.x, d.z);
      sim.player.reset({ x: r0.pos.x - (d.x / l) * 560, y: 8.25, z: r0.pos.z - (d.z / l) * 560 }, Math.atan2(d.x / l, d.z / l) + Math.PI);
    },
    policy: (i, p, m, sim) => {
      if (i === 0) m.y0 = p.yaw;
      if (i < 60) return { forward: 1, yaw: m.y0, pitch: 0 };
      const target = sim.stats.awake ? { x: ob.x, y: 3400, z: ob.z } : { x: ob.x, y: p.pos.y + 900, z: ob.z };
      return { yaw: ease(m, 'y', yawTo(p.pos, target) + 0.35, 0.05), pitch: ease(m, 'p', 0.32, 0.03) };
    },
  });

  // ------------------------------------------------------------ the sky elevator
  shots.push({
    title: 'THE SKY ELEVATOR',
    color: '#ff71ce',
    duration: 6.8,
    setup: (sim) => sim.player.reset({ x: 0, y: 8.25, z: -6100 }, 0),
    policy: (i, p, m) => ({ forward: i < 45 ? 1 : 0, yaw: ease(m, 'y', i < 45 ? 0 : 0.9, 0.02), pitch: ease(m, 'p', i < 45 ? 0.1 : -0.25, 0.02) }),
  });

  // ------------------------------------------------------------ the vaporway
  shots.push({
    title: 'THE VAPORWAY',
    sub: '2400 U/S',
    color: '#5af2ff',
    duration: 5.5,
    setup: (sim) => {
      const a = (2.5 * TAU) / 16;
      sim.player.reset({ x: Math.cos(a) * 11500, y: 320.25, z: Math.sin(a) * 11500 }, 0);
    },
    policy: (i, p, m) => {
      const sp = Math.hypot(p.vel.x, p.vel.z);
      const y = sp > 200 ? Math.atan2(-p.vel.x, -p.vel.z) : 0;
      return { yaw: ease(m, 'y', y, 0.08), pitch: 0.02, jump: i % 160 > 150 };
    },
  });

  // ------------------------------------------------------------ the sail drop
  shots.push({
    title: 'THE SAIL',
    sub: '3600 UNITS OF ICE',
    color: '#ff9ad0',
    duration: 8,
    setup: (sim) => sim.player.reset({ x: 6000, y: 3600.25, z: -3500 }, Math.PI),
    policy: (i, p, m) => ({ forward: 1, crouch: p.pos.z > 2600, yaw: ease(m, 'y', Math.PI, 0.2), pitch: ease(m, 'p', p.pos.z < -2900 ? -0.4 : -0.08, 0.04) }),
  });

  // ------------------------------------------------------------ the mega-parthenon: peristyle climb
  shots.push({
    title: 'THE MEGA-PARTHENON',
    sub: 'THE PERISTYLE CLIMB',
    color: '#ffe27a',
    duration: 9,
    setup: (sim) => {
      const s = level.parthenon.steps.peristyle[3];
      sim.player.reset({ x: s.x, y: s.top + 0.25, z: s.z + 60 }, 0);
    },
    policy: hopChain(level.parthenon.steps.peristyle, { pitch: 0.2, first: 3 }),
  });

  // ------------------------------------------------------------ the naos run
  shots.push({
    title: 'THE NAOS RUN',
    color: '#ffe27a',
    duration: 5.2,
    setup: (sim) => {
      const s = level.parthenon.steps.naos[0];
      sim.player.reset({ x: s.x, y: s.top + 0.25, z: s.z + 60 }, Math.PI);
    },
    policy: hopChain(level.parthenon.steps.naos.slice(0, 7), { pitch: 0.15 }),
  });

  // ------------------------------------------------------------ outro flyover
  shots.push({
    title: 'AFTERGLOW PARK',
    sub: 'NO ENEMIES. NO TIMER. JUST VIBES.',
    color: '#ff9ad0',
    duration: 7,
    camera: (u) => {
      const t = smooth(u);
      return { pos: { x: lerp(-11200, -9200, t), y: lerp(900, 4200, t), z: lerp(-5200, -2600, t) }, yaw: lerp(2.6, 1.6, t), pitch: lerp(0.05, -0.32, t) };
    },
  });
  return shots;
}
