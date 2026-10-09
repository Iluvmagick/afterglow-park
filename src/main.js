import { buildLevel } from './level.js';
import { Sim, DT } from './sim.js';
import { EMPTY_CMD } from './player.js';
import { GameRenderer } from './render/renderer.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { Input } from './input.js';
import { Perf } from './perf.js';

const params = new URLSearchParams(location.search);
const level = buildLevel();
const sim = new Sim(level);
const canvas = document.getElementById('game');
const hudCanvas = document.getElementById('hud');
const bootStart = performance.now();
const renderer = new GameRenderer(canvas, sim);
const bootMs = performance.now() - bootStart;
const perf = new Perf(renderer.renderer.getContext());
renderer.renderer.info.autoReset = false; // count triangles/calls across all passes of a frame
const hud = new Hud(hudCanvas);
const audio = new GameAudio();
const input = new Input(canvas);
const menu = document.getElementById('menu');
const playBtn = document.getElementById('play');

// ------------------------------------------------------------------ settings
const SETTINGS_VERSION = 2;
const DEFAULTS = { sens: 2, fov: 100, res: 360, view: 40000, jitter: true, dither: true, affine: true, autohop: true, speedFov: true, fullscreen: true, music: 0.5, sfx: 0.7 };
let settings = { ...DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem('afterglow-settings') || '{}');
  if ((saved.version || 1) < SETTINGS_VERSION) {
    // v2: calmer defaults (higher resolution, longer view) replace the old saved ones once
    delete saved.res;
    delete saved.view;
  }
  settings = { ...DEFAULTS, ...saved, version: SETTINGS_VERSION };
} catch {}
if (params.has('res')) settings.res = Number(params.get('res'));

function applySettings() {
  input.sens = settings.sens;
  sim.player.move.autoHop = settings.autohop;
  renderer.applySettings({ lowHeight: settings.res, jitter: settings.jitter, dither: settings.dither, affine: settings.affine, fov: settings.fov, speedFov: settings.speedFov, view: settings.view });
  hud.resize(renderer.lowW, renderer.lowH);
  audio.setVolumes(settings.sfx, settings.music);
  try {
    localStorage.setItem('afterglow-settings', JSON.stringify(settings));
  } catch {}
}

for (const el of document.querySelectorAll('[data-setting]')) {
  const key = el.dataset.setting;
  const out = document.querySelector(`[data-out="${key}"]`);
  const show = () => {
    if (out) out.textContent = el.type === 'checkbox' ? '' : el.value;
  };
  if (el.type === 'checkbox') el.checked = !!settings[key];
  else el.value = settings[key];
  show();
  el.addEventListener('input', () => {
    settings[key] = el.type === 'checkbox' ? el.checked : Number(el.value);
    show();
    applySettings();
  });
}
document.getElementById('reset-orbs').addEventListener('click', () => {
  for (const o of sim.orbs) o.taken = false;
  sim.stats.orbs = 0;
  sim.stats.topSpeed = 0;
  hud.toast('PROGRESS RESET', '#c8b8e8');
});
applySettings();
addEventListener('resize', () => {
  renderer.resize();
  hud.resize(renderer.lowW, renderer.lowH);
});

// ------------------------------------------------------------------ play / pause
let playing = false;
let capturing = false;
let script = null; // debug: scripted commands instead of live input
const lockNote = document.getElementById('lock-note');
function start(withLock = true) {
  audio.init();
  input.enabled = true;
  playing = true;
  menu.classList.add('hidden');
  lockNote.hidden = true;
  if (withLock) capture();
}
// Grab the mouse (and the screen, if enabled); both need the click that calls this. The lock goes
// first: in some browsers requesting fullscreen uses up the click. Chrome refuses the mouse for
// 1.25 s after the player pressed Esc, so a quick "resume" keeps asking until that has passed: the
// click still counts as permission for a few seconds.
const LOCK_RETRY_MS = 3000;
async function capture() {
  if (capturing) return;
  capturing = true;
  const t0 = performance.now();
  let ok = await input.lock();
  while (!ok && playing && performance.now() - t0 < LOCK_RETRY_MS && navigator.userActivation?.isActive !== false) {
    await new Promise((r) => setTimeout(r, 200));
    if (playing) ok = await input.lock();
  }
  capturing = false;
  if (!ok) {
    if (playing) {
      pause();
      lockNote.hidden = false;
    }
    return;
  }
  if (settings.fullscreen && document.fullscreenEnabled && !document.fullscreenElement) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
}
function pause() {
  playing = false;
  input.enabled = false;
  menu.classList.remove('hidden');
  playBtn.textContent = 'CLICK TO RESUME';
}
playBtn.addEventListener('click', () => start(!params.has('nolock')));
// no music (or any sound) from a background tab
const syncAudioFocus = () => audio.setActive(document.visibilityState === 'visible' && document.hasFocus());
addEventListener('blur', syncAudioFocus);
addEventListener('focus', syncAudioFocus);
document.addEventListener('visibilitychange', syncAudioFocus);
setInterval(syncAudioFocus, 1000); // and check now and then, in case an event never came
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && playing && !params.has('nolock')) pause();
});
// browsers without promise-based pointer lock only report a refusal with this event
document.addEventListener('pointerlockerror', () => {
  if (playing && !capturing && !input.locking && !params.has('nolock')) pause();
});
canvas.addEventListener('click', () => {
  if (playing && !input.locked && !params.has('nolock')) capture();
});
input.onKey = (code) => {
  if (code === 'KeyM') hud.toast(audio.toggleMusic() ? 'MUSIC ON' : 'MUSIC OFF', '#c8b8e8', 1);
  else if (code === 'Backquote' || code === 'F3') hud.debug = !hud.debug;
};

// ------------------------------------------------------------------ hold R to respawn
// Respawning needs a deliberate 3-second hold so a stray R press never throws away a run.
const RESPAWN_HOLD = 3;
let respawnHeld = -1; // seconds R has been held, -1 when not holding
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && !e.repeat && playing) respawnHeld = 0;
});
addEventListener('keyup', (e) => {
  if (e.code === 'KeyR') respawnHeld = -1;
});
addEventListener('blur', () => (respawnHeld = -1));
function updateRespawnHold(dt) {
  if (respawnHeld < 0) return;
  if (!playing) {
    respawnHeld = -1;
    return;
  }
  respawnHeld += dt;
  if (respawnHeld >= RESPAWN_HOLD) {
    sim.respawn();
    respawnHeld = -1; // let go and hold again to respawn again
  }
}

// ------------------------------------------------------------------ events -> fx / audio / hud
const firsts = new Set();
function onEvent(e) {
  renderer.onEvent(e);
  audio.onEvent(e, sim.eye);
  switch (e.type) {
    case 'respawn':
      input.yaw = e.yaw;
      input.pitch = 0;
      break;
    case 'orb':
      if (e.count === e.total) hud.toast('ALL ORBS FOUND!', '#ff9ad0', 4);
      else hud.toast(`ORB ${e.count}/${e.total}`, '#ffe27a');
      break;
    case 'target':
      hud.toast('TARGET POP!', '#ff9a9a', 1);
      break;
    case 'noclip':
      if (!firsts.has('noclip')) {
        firsts.add('noclip');
        hud.toast('YOU NOCLIPPED OUT OF REALITY', '#c8fff8', 4);
      }
      hud.toast('T H E   P O O L R O O M S', '#7af0e6', 3.5);
      break;
    case 'wake':
      hud.toast('...AND WOKE UP IN THE PARK', '#ffe27a', 3);
      break;
    case 'swim':
      if (!firsts.has('swim')) {
        firsts.add('swim');
        hud.toast('SWIM! SPACE: UP  CROUCH: DOWN', '#7af0e6', 2.5);
      }
      break;
    case 'ascend':
      if (e.count === 1) {
        hud.toast('THE OBELISK AWAKENS', '#ffe27a', 5);
        hud.toast('GOLDEN TRAIL UNLOCKED', '#7af0e6', 5);
      } else hud.toast(`ASCENSION x${e.count}`, '#ffe27a', 2.5);
      break;
    case 'bounce':
    case 'stick':
    case 'surface': {
      const key = e.type === 'surface' ? e.kind : e.type;
      const names = { bounce: 'BOING!', stick: 'STICKY! LOOK WHERE TO CRAWL', ice: 'ICE!', boost: 'SPEED STRIP!' };
      if (names[key] && !firsts.has(key)) {
        firsts.add(key);
        hud.toast(names[key], '#7af0e6', 1.4);
      }
      break;
    }
    case 'wallrun':
    case 'slide':
    case 'doubleJump':
    case 'hookAttach':
    case 'mantle':
      if (!firsts.has(e.type)) {
        firsts.add(e.type);
        const names = { wallrun: 'WALLRUN!', slide: 'SLIDE!', doubleJump: 'DOUBLE JUMP!', hookAttach: 'GRAPPLE!', mantle: 'MANTLE!' };
        hud.toast(names[e.type], '#7af0e6', 1.2);
      }
      break;
  }
}

// ------------------------------------------------------------------ main loop
// ?timerloop drives frames with timers (hidden/background tabs pause requestAnimationFrame)
const nextFrame = params.has('timerloop') ? (cb) => setTimeout(() => cb(performance.now()), 8) : requestAnimationFrame;
let last = performance.now();
let acc = 0;
let wasInVapor = false;
let fpsAcc = 0;
let fpsN = 0;
function frame(now) {
  nextFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  perf.add('frame', dt * 1000);
  if (dt > 0.1) dt = 0.1;
  if (benchRunning) return;
  const tSim = performance.now();
  if (playing) {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 30) {
      let c = script ? nextScripted() : null;
      if (!c) {
        c = input.cmd();
        input.consumeLatches();
      }
      sim.tick(c);
      acc -= DT;
      steps++;
    }
    if (steps === 30) acc = 0;
  }
  updateRespawnHold(dt);
  hud.respawn = respawnHeld >= 0 ? respawnHeld / RESPAWN_HOLD : 0;
  // zone welcome
  const vapor = sim.level.vapor;
  const inVapor = vapor && sim.player.pos.y > -300 && Math.max(Math.abs(sim.player.pos.x), Math.abs(sim.player.pos.z)) > vapor.parkHalf;
  if (inVapor && !wasInVapor) hud.toast('A E S T H E T I C', '#ff71ce', 2.5);
  wasInVapor = inVapor;
  for (const e of sim.drainEvents()) onEvent(e);
  const tRender = performance.now();
  perf.add('sim', tRender - tSim);
  renderer.renderer.info.reset();
  perf.gpuBegin();
  // paused: draw the frame with no time passing, so the gun, the camera and the effects hold still
  renderer.render(playing ? acc / DT : 1, playing ? dt : 0, { yaw: input.yaw, pitch: input.pitch });
  perf.gpuEnd();
  perf.poll();
  const tHud = performance.now();
  perf.add('render', tHud - tRender);
  audio.update(dt, sim, !playing);
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 0.5) {
    hud.fps = fpsN / fpsAcc;
    fpsAcc = 0;
    fpsN = 0;
  }
  hud.draw(dt, sim, hud.debug ? perf.lines(renderer.renderer.info.render) : '');
  perf.add('hud', performance.now() - tHud);
}
nextFrame(frame);

// ------------------------------------------------------------------ benchmark (?bench)
// A fixed fly-through of every zone. Each frame waits for the GPU to finish (1px readback), so the
// numbers are the true cost of a frame: headroom, not capped by the display's refresh rate.
let benchRunning = false;
const BENCH_PATH = [
  [0, 80, 560, 0, 0.05],
  [0, 900, 1400, 0, -0.35],
  [-300, 500, -1100, 0.2, -0.05],
  [0, 450, -2600, 0.4, -0.1],
  [2200, 1250, -3600, Math.PI, -0.2],
  [2150, 700, -1500, Math.PI, -0.15],
  [2000, 600, 900, -2.6, 0.2],
  [1500, 1800, 3000, -1.6, -0.1],
  [2300, 3050, 3300, 0.6, -0.35],
  [1200, 400, -1700, 0, -0.3],
  [-900, 700, -1500, 0.2, -0.2],
  [-1600, 900, -2600, 1.2, -0.1],
  [-2600, 1100, 400, 2.5, -0.25],
  [-3600, 300, 2600, -2.2, 0],
  [-3600, 300, 0, -Math.PI / 2, 0],
  [-5200, 200, 0, -Math.PI / 2, 0.05],
  [-6400, 500, 1200, -2.2, -0.1],
  [-7400, 1300, 0, -1.2, -0.3],
  [-6000, 2600, -4500, -0.6, -0.1],
  [0, 5100, -7700, Math.PI, -0.35],
  [6000, 3700, -3300, Math.PI, -0.3],
  [5000, 1500, 4000, 2.6, 0],
  [0, 2700, 6000, Math.PI, -0.1],
  [-5000, 600, 5000, 2.4, -0.1],
  [-10600, 360, 0, 0, 0],
  [-11000, 900, 0, Math.PI / 2, 0.15],
  [-14200, 700, -2600, Math.PI, 0.1],
  [-12900, 1900, 600, 0.3, -0.25],
  [0, 2500, 0, 0.8, -0.6],
  [0, 7000, -17600, 0, -0.2], // over the far mountains: the north pier
  [0, 600, -20600, 0, -0.1],
  // the Poolrooms
  [0, -1100, 1200, 0, -0.15],
  [-1600, -1000, -1600, 0.8, -0.1],
  [2600, -1300, -1400, 2.4, 0.05],
  [2600, -1500, 2000, Math.PI, 0],
  [0, -1300, 6500, Math.PI, 0],
  [-2600, -1200, 0, 0, 0.1],
];
async function runBench(frames = 900) {
  benchRunning = true;
  menu.classList.add('hidden');
  const gl = renderer.renderer.getContext();
  const px = new Uint8Array(4);
  const cost = [];
  const tris = [];
  const calls = [];
  const phase = { sim: [], render: [], hud: [], gpuWait: [] };
  const lerpAng = (a, b, t) => {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };
  for (let i = 0; i < frames; i++) {
    const t = (i / frames) * (BENCH_PATH.length - 1);
    const k = Math.floor(t);
    const u = t - k;
    const a = BENCH_PATH[k];
    const b = BENCH_PATH[Math.min(k + 1, BENCH_PATH.length - 1)];
    const t0 = performance.now();
    sim.player.reset({ x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, z: a[2] + (b[2] - a[2]) * u }, 0);
    sim.player.gravityScale = 0;
    sim.tick({ ...EMPTY_CMD, yaw: lerpAng(a[3], b[3], u) });
    sim.prevEye = sim.eye;
    for (const e of sim.drainEvents()) onEvent(e);
    const t1 = performance.now();
    renderer.renderer.info.reset();
    renderer.render(1, 1 / 60, { yaw: lerpAng(a[3], b[3], u), pitch: a[4] + (b[4] - a[4]) * u });
    const t2 = performance.now();
    hud.draw(1 / 60, sim, '');
    const t3 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // wait for the GPU
    const t4 = performance.now();
    cost.push(t4 - t0);
    phase.sim.push(t1 - t0);
    phase.render.push(t2 - t1);
    phase.hud.push(t3 - t2);
    phase.gpuWait.push(t4 - t3);
    tris.push(renderer.renderer.info.render.triangles);
    calls.push(renderer.renderer.info.render.calls);
    if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const sorted = [...cost].sort((x, y) => x - y);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const avg = cost.reduce((x, y) => x + y, 0) / cost.length;
  const result = {
    frames,
    lowRes: `${renderer.lowW}x${renderer.lowH}`,
    canvas: `${renderer.canvas.width}x${renderer.canvas.height}`,
    viewDistance: renderer.settings.view,
    avgMs: +avg.toFixed(2),
    p50Ms: +q(0.5).toFixed(2),
    p95Ms: +q(0.95).toFixed(2),
    p99Ms: +q(0.99).toFixed(2),
    maxMs: +sorted[sorted.length - 1].toFixed(2),
    headroomFps: Math.round(1000 / q(0.95)),
    avgTris: Math.round(tris.reduce((x, y) => x + y, 0) / tris.length),
    maxCalls: Math.max(...calls),
    bootMs: Math.round(bootMs),
    phasesAvgMs: Object.fromEntries(Object.entries(phase).map(([k, v]) => [k, +(v.reduce((x, y) => x + y, 0) / v.length).toFixed(3)])),
    gpu: (gl.getExtension('WEBGL_debug_renderer_info') && gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)) || 'unknown',
  };
  console.log('AFTERGLOW BENCH', JSON.stringify(result));
  showBenchResult(result);
  benchRunning = false;
  sim.respawn();
  return result;
}
function showBenchResult(r) {
  let el = document.getElementById('bench');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'bench';
    document.body.appendChild(el);
  }
  el.textContent = [
    'BENCHMARK  (frame cost incl. GPU, lower is better)',
    `avg ${r.avgMs} ms   p50 ${r.p50Ms}   p95 ${r.p95Ms}   p99 ${r.p99Ms}   max ${r.maxMs}`,
    `=> ~${r.headroomFps} fps of headroom at p95`,
    `${r.avgTris} triangles/frame, ${r.maxCalls} draw calls, low-res ${r.lowRes}, canvas ${r.canvas}`,
    `cpu: sim ${r.phasesAvgMs.sim}  render ${r.phasesAvgMs.render}  hud ${r.phasesAvgMs.hud}  | gpu wait ${r.phasesAvgMs.gpuWait} ms`,
    `view distance ${r.viewDistance}, startup ${r.bootMs} ms`,
    `GPU: ${r.gpu}`,
    'click to dismiss',
  ].join('\n');
  el.onclick = () => el.remove();
}

// ------------------------------------------------------------------ debug / test hooks
// game.play([{ ticks, forward, right, jump, crouch, dash, grapple, fire, yaw, pitch, yawRate, pitchRate }])
function nextScripted() {
  const s = script;
  while (s.k < s.steps.length && s.left <= 0) {
    s.k++;
    if (s.k < s.steps.length) s.left = s.steps[s.k].ticks ?? 1;
  }
  if (s.k >= s.steps.length) {
    script = null;
    return null;
  }
  const st = s.steps[s.k];
  if (st.yaw !== undefined && s.left === (st.ticks ?? 1)) input.yaw = st.yaw;
  if (st.pitch !== undefined && s.left === (st.ticks ?? 1)) input.pitch = st.pitch;
  input.yaw += st.yawRate || 0;
  input.pitch += st.pitchRate || 0;
  s.left--;
  s.i++;
  return { ...EMPTY_CMD, ...st, yaw: input.yaw, pitch: input.pitch };
}

window.game = {
  sim,
  perf,
  bench: runBench,
  renderer,
  input,
  audio,
  hud,
  start: () => start(false),
  pause,
  play(steps) {
    script = { steps, k: -1, left: 0, i: 0 };
    return new Promise((resolve) => {
      const check = () => (script ? setTimeout(check, 50) : resolve(this.state()));
      check();
    });
  },
  // Synchronous version for automated testing: runs the whole script now, logs as it goes.
  runSync(steps, sampleEvery = 25) {
    script = { steps, k: -1, left: 0, i: 0 };
    const log = [];
    const events = [];
    let n = 0;
    for (;;) {
      const c = nextScripted();
      if (!c) break;
      sim.tick(c);
      n++;
      for (const e of sim.drainEvents()) {
        events.push(`${n}:${e.type}`);
        onEvent(e);
      }
      if (sampleEvery && n % sampleEvery === 0) {
        const p = sim.player;
        log.push(
          `${n} pos=${p.pos.x.toFixed(0)},${p.pos.y.toFixed(0)},${p.pos.z.toFixed(0)} hs=${Math.hypot(p.vel.x, p.vel.z).toFixed(0)} vy=${p.vel.y.toFixed(0)}` +
            `${p.onGround ? ' G' : ''}${p.sliding ? ' SL' : ''}${p.wall.active ? ' WR' : ''}${p.crouched ? ' C' : ''} hook=${p.hook.state}`,
        );
      }
    }
    renderer.render(1, DT, { yaw: input.yaw, pitch: input.pitch });
    hud.draw(DT, sim, '');
    return { state: this.state(), log, events };
  },
  // Reactive bot for testing: policy(tick, player, memory) -> partial cmd, or null to stop.
  bot(policy, maxTicks = 2000, sample = 10) {
    const p = sim.player;
    const log = [];
    const events = [];
    const mem = {};
    for (let i = 0; i < maxTicks; i++) {
      const c = policy(i, p, mem);
      if (!c) break;
      if (c.yaw !== undefined) input.yaw = c.yaw;
      if (c.pitch !== undefined) input.pitch = c.pitch;
      sim.tick({ ...EMPTY_CMD, ...c, yaw: input.yaw, pitch: input.pitch });
      for (const e of sim.drainEvents()) {
        events.push(`${i}:${e.type}`);
        onEvent(e);
      }
      if (sample && i % sample === 0) {
        log.push(
          `${i} ${p.pos.x.toFixed(0)},${p.pos.y.toFixed(0)},${p.pos.z.toFixed(0)} hs=${Math.hypot(p.vel.x, p.vel.z).toFixed(0)} vy=${p.vel.y.toFixed(0)}` +
            `${p.onGround ? ' G' : ''}${p.sliding ? ' SL' : ''}${p.wall.active ? ' WR' : ''}${p.crouched ? ' C' : ''}${p.hook.state !== 'none' ? ' H:' + p.hook.state : ''}`,
        );
      }
    }
    for (let k = 0; k < 20; k++) renderer.render(1, 1 / 60, { yaw: input.yaw, pitch: input.pitch });
    hud.draw(DT, sim, '');
    return { log, events, state: this.state() };
  },
  // freeze the realtime sim but keep rendering (for screenshots of bot runs)
  freeze() {
    playing = false;
    input.enabled = false;
    menu.classList.add('hidden');
  },
  get scripting() {
    return !!script;
  },
  teleport(x, y, z, yaw = input.yaw, pitch = 0) {
    const h = sim.player.hull;
    while (!sim.world.boxFree({ x, y, z }, h.mins, h.maxs) && y < 4000) y += 8;
    sim.player.reset({ x, y, z }, yaw);
    sim.eye = sim.player.eye();
    sim.prevEye = sim.eye;
    input.yaw = yaw;
    input.pitch = pitch;
  },
  state() {
    const p = sim.player;
    return {
      pos: { ...p.pos },
      vel: { ...p.vel },
      speed: Math.hypot(p.vel.x, p.vel.z),
      onGround: p.onGround,
      crouched: p.crouched,
      sliding: p.sliding,
      wallrun: p.wall.active,
      hook: p.hook.state,
      orbs: sim.stats.orbs,
      fps: hud.fps,
    };
  },
};

if (params.has('autostart')) start(false);
if (params.has('bench')) setTimeout(() => runBench(Number(params.get('bench')) || 900), 300);
// tools/build.mjs sets NO_TRAILER, so the static build leaves the recorder out entirely
if (!globalThis.NO_TRAILER && params.has('trailer')) {
  // recording mode (served by tools/record-trailer.mjs): bots perform, frames go to ffmpeg
  benchRunning = true; // keep the realtime loop out of the way
  menu.classList.add('hidden');
  const el = document.createElement('pre');
  el.id = 'bench';
  document.body.appendChild(el);
  import('./trailer.js').then(({ runTrailer }) => runTrailer({ sim, renderer, hud, input, status: (t) => (el.textContent = t) }));
}
