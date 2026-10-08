// Trailer recorder (?trailer on the recording server, see tools/record-trailer.mjs).
// Renders the shot list frame by frame at a fixed game time step (so tab throttling can't make it
// stutter), composites the 3D view + HUD, streams JPEG frames to the recorder, and renders the
// soundtrack offline with the game's own synth so music and SFX line up with the picture.
import { DT } from './sim.js';
import { EMPTY_CMD } from './player.js';
import { GameAudio } from './audio.js';
import { trailerShots } from './trailer-shots.js';

const FPS = 30;
const W = 1280;
const H = 720;

function wav(buffer) {
  const ch = buffer.numberOfChannels;
  const n = buffer.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, v * 32767, true);
      o += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}

export async function runTrailer({ sim, renderer, hud, input, status }) {
  const shots = trailerShots(sim.level);
  const total = shots.reduce((t, s) => t + s.duration, 0);
  renderer.fixedSize = { w: W, h: H };
  renderer.resize();
  hud.resize(renderer.lowW, renderer.lowH);

  const actx = new OfflineAudioContext(2, Math.ceil(44100 * (total + 1.5)), 44100);
  const audio = new GameAudio();
  audio.init(actx);
  audio.setVolumes(0.75, 0.6);

  const cap = document.createElement('canvas');
  cap.width = W;
  cap.height = H;
  const cctx = cap.getContext('2d');
  cctx.imageSmoothingEnabled = false;
  await fetch('/__rec/start?fps=' + FPS, { method: 'POST' });

  let T = 0;
  let frameNo = 0;
  const totalFrames = shots.reduce((n, s) => n + Math.round(s.duration * FPS), 0);
  for (const shot of shots) {
    const p = sim.player;
    sim.rockets.length = 0;
    if (shot.setup) shot.setup(sim);
    sim.eye = p.eye();
    sim.prevEye = sim.eye;
    sim.drainEvents();
    renderer.flash = 0.55; // cut
    renderer.fovKick = 0;
    renderer.shake = 0;
    renderer.view.scene.visible = !shot.camera;
    hud.minimal = !!shot.camera;
    hud.toasts.length = 0;
    hud.toast(shot.title, shot.color, Math.min(3, shot.duration - 0.5));
    if (shot.sub) hud.toast(shot.sub, '#ffffff', Math.min(3, shot.duration - 0.5));
    const mem = {};
    let tick = 0;
    let acc = 0;
    let look = { yaw: p.yaw, pitch: 0 };
    const n = Math.round(shot.duration * FPS);
    for (let f = 0; f < n; f++) {
      if (shot.camera) {
        const cam = shot.camera(f / n);
        p.reset({ x: cam.pos.x, y: cam.pos.y - 64, z: cam.pos.z }, cam.yaw);
        p.gravityScale = 0;
        sim.eye = p.eye();
        sim.prevEye = sim.eye;
        look = { yaw: cam.yaw, pitch: cam.pitch };
      } else {
        acc += 1 / FPS;
        let k = 0;
        while (acc >= DT) {
          const c = shot.policy(tick, p, mem, sim) || {};
          if (c.yaw !== undefined) look.yaw = c.yaw;
          if (c.pitch !== undefined) look.pitch = c.pitch;
          sim.tick({ ...EMPTY_CMD, ...c, yaw: look.yaw, pitch: look.pitch });
          audio.clock = T + k * DT;
          for (const e of sim.drainEvents()) {
            renderer.onEvent(e);
            audio.onEvent(e, sim.eye);
          }
          acc -= DT;
          tick++;
          k++;
        }
      }
      audio.clock = T;
      audio.update(1 / FPS, sim);
      audio.tickMusic();
      input.yaw = look.yaw;
      input.pitch = look.pitch;
      renderer.render(shot.camera ? 1 : acc / DT, 1 / FPS, look);
      hud.draw(1 / FPS, sim, '');
      cctx.drawImage(renderer.canvas, 0, 0, W, H);
      cctx.drawImage(hud.canvas, 0, 0, W, H);
      // synchronous encode: toBlob's callback gets starved in a background tab, toDataURL doesn't
      const b64 = cap.toDataURL('image/jpeg', 0.93).slice('data:image/jpeg;base64,'.length);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      await fetch('/__rec/frame', { method: 'POST', body: bytes });
      T += 1 / FPS;
      frameNo++;
      if (status) status(`recording ${frameNo}/${totalFrames}  (${shot.title})`);
    }
  }
  if (status) status('rendering audio...');
  const buf = await actx.startRendering();
  await fetch('/__rec/audio', { method: 'POST', body: wav(buf) });
  if (status) status('encoding...');
  const out = await (await fetch('/__rec/end', { method: 'POST' })).text();
  if (status) status(`done: ${out}`);
  return out;
}
