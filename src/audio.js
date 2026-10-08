// All sound is synthesized with WebAudio: chunky SFX, speed-driven wind, and a mellow
// generative ambient track with a PS1-SPU-ish reverb.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.sfxVolume = 0.7;
    this.musicVolume = 0.5;
    this.musicOn = true;
    this.stepDist = 0;
  }

  // `offlineCtx` (an OfflineAudioContext) renders sound faster than real time, e.g. for the trailer;
  // then `clock` stands in for the current time and music is scheduled by calling tickMusic().
  init(offlineCtx = null) {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.offline) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC && !offlineCtx) return;
    this.offline = !!offlineCtx;
    this.clock = 0;
    const ctx = (this.ctx = offlineCtx || new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 1.3;
    // gentle lowpass for a softer, retro sampler feel
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 11000;
    this.master.connect(lp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVolume;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? this.musicVolume : 0;
    this.musicBus.connect(this.master);

    // white noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // reverb
    this.reverb = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    this.reverb.connect(wet).connect(this.master);
    this.sfxVerb = ctx.createGain();
    this.sfxVerb.gain.value = 0.25;
    this.sfxVerb.connect(this.reverb);

    // loops: wind + slide scrape
    this.wind = this.noiseLoop('lowpass', 400, 0.7);
    this.slideLoop = this.noiseLoop('bandpass', 900, 2.5);
    this.skateLoop = this.noiseLoop('highpass', 3500, 0.8);
    this.hum = this.drone();
    this.music = new Music(this);
    if (!this.offline) this.music.start();
  }

  // Silence everything while the tab is hidden or unfocused; pick up again on return.
  now() {
    return this.offline ? this.clock : this.ctx.currentTime;
  }

  tickMusic() {
    if (this.music) this.music.schedule();
  }

  setActive(active) {
    if (!this.ctx || this.offline) return;
    if (active && this.ctx.state === 'suspended') this.ctx.resume();
    else if (!active && this.ctx.state === 'running') this.ctx.suspend();
  }

  noiseLoop(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
    return { f, g };
  }

  // the obelisk's low hum: a detuned drone with a slow wobble, loudness set by distance
  drone() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    lp.connect(g).connect(this.sfx);
    g.connect(this.sfxVerb);
    const oscs = [];
    for (const [f, type, v] of [
      [55, 'sine', 0.5],
      [55.4, 'sine', 0.4],
      [82.4, 'triangle', 0.18],
      [110, 'sine', 0.12],
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = v;
      o.connect(og).connect(lp);
      o.start();
      oscs.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    return { g, oscs };
  }

  setVolumes(sfx, music) {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    if (!this.ctx) return;
    this.sfx.gain.value = sfx;
    this.musicBus.gain.setTargetAtTime(this.musicOn ? music : 0, this.now(), 0.3);
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(this.musicOn ? this.musicVolume : 0, this.now(), 0.4);
    return this.musicOn;
  }

  tone(type, f0, f1, dur, vol, { delay = 0, attack = 0.005, verb = false } = {}) {
    const ctx = this.ctx;
    const t = this.now() + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    if (verb) g.connect(this.sfxVerb);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, vol, type, f0, f1, { q = 1, delay = 0, verb = false } = {}) {
    const ctx = this.ctx;
    const t = this.now() + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    if (verb) g.connect(this.sfxVerb);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  onEvent(e, eye) {
    if (!this.ctx) return;
    switch (e.type) {
      case 'jump':
      case 'slideJump':
        this.tone('square', 170, 340, 0.09, 0.07);
        this.noise(0.06, 0.08, 'highpass', 2500, 4000);
        break;
      case 'doubleJump':
        this.tone('square', 280, 720, 0.13, 0.07);
        this.tone('triangle', 560, 1440, 0.12, 0.06, { delay: 0.02 });
        this.noise(0.15, 0.1, 'bandpass', 3000, 800, { q: 1.5 });
        break;
      case 'land': {
        const v = Math.min(0.5, e.speed / 1400);
        if (v > 0.06) {
          this.noise(0.14, v, 'lowpass', 700, 150);
          this.tone('sine', 110, 45, 0.14, v * 0.9);
        } else this.step(0.6);
        break;
      }
      case 'slide':
        this.noise(0.3, 0.18, 'bandpass', 1800, 500, { q: 1.2 });
        break;
      case 'wallrun':
        this.tone('triangle', 380, 520, 0.08, 0.05);
        this.step(1.2);
        break;
      case 'wallJump':
        this.tone('square', 240, 620, 0.11, 0.07);
        this.noise(0.12, 0.12, 'bandpass', 2500, 900, { q: 1.4 });
        break;
      case 'dash':
        this.noise(0.28, 0.32, 'bandpass', 3200, 350, { q: 1.6 });
        this.tone('sawtooth', 120, 60, 0.18, 0.04);
        break;
      case 'mantle':
        this.noise(0.1, 0.12, 'lowpass', 900, 300);
        this.tone('triangle', 200, 320, 0.08, 0.05);
        break;
      case 'hookFire':
        this.tone('sawtooth', 700, 2200, 0.09, 0.04);
        this.noise(0.08, 0.06, 'highpass', 3000, 6000);
        break;
      case 'hookAttach':
        this.tone('triangle', 1500, 1150, 0.16, 0.12, { verb: true });
        this.tone('square', 90, 60, 0.06, 0.06);
        break;
      case 'hookRelease':
        this.tone('triangle', 900, 500, 0.06, 0.04);
        break;
      case 'fire':
        this.tone('square', 520, 80, 0.2, 0.1);
        this.noise(0.14, 0.16, 'lowpass', 5000, 400);
        break;
      case 'explosion': {
        const d = eye ? Math.hypot(e.pos.x - eye.x, e.pos.y - eye.y, e.pos.z - eye.z) : 0;
        const v = Math.max(0.08, 0.6 * (1 - Math.min(1, d / 3000)));
        this.noise(0.9, v, 'lowpass', 1800, 80, { verb: true });
        this.tone('sine', 75, 28, 0.55, v);
        break;
      }
      case 'orb': {
        const notes = [76, 79, 83, 88];
        notes.forEach((n, i) => this.tone('triangle', mtof(n), mtof(n), 0.25, 0.15, { delay: i * 0.055, verb: true }));
        this.tone('sine', mtof(100), mtof(100), 0.5, 0.03, { delay: 0.2, verb: true });
        if (e.count === e.total) {
          [72, 76, 79, 84, 88, 91].forEach((n, i) => this.tone('square', mtof(n), mtof(n), 0.3, 0.05, { delay: 0.35 + i * 0.1, verb: true }));
        }
        break;
      }
      case 'target':
        this.tone('square', 1300, 260, 0.16, 0.07);
        this.noise(0.25, 0.14, 'bandpass', 2400, 600, { q: 2 });
        break;
      case 'targetBack':
        break;
      case 'pad':
        this.tone('sine', 140, 760, 0.38, 0.22);
        this.tone('square', 70, 380, 0.3, 0.04);
        break;
      case 'ring':
        this.tone('sawtooth', 260, 1600, 0.45, 0.05, { verb: true });
        this.tone('triangle', 520, 2100, 0.4, 0.06, { verb: true, delay: 0.03 });
        break;
      case 'respawn':
        this.tone('triangle', mtof(72), mtof(60), 0.4, 0.07, { verb: true });
        break;
      case 'bounce': {
        const k = Math.min(1, e.speed / 1500);
        this.tone('sine', 120 + k * 80, 420 + k * 500, 0.22, 0.18);
        this.tone('square', 60, 160, 0.12, 0.03);
        break;
      }
      case 'stick':
        this.noise(0.18, 0.2, 'lowpass', 900, 200, { q: 3 });
        this.tone('sine', 90, 140, 0.15, 0.08);
        break;
      case 'surface':
        if (e.kind === 'boost') {
          this.tone('sawtooth', 200, 1400, 0.25, 0.05);
          this.noise(0.2, 0.12, 'bandpass', 2000, 6000, { q: 2 });
        } else if (e.kind === 'ice') this.noise(0.15, 0.06, 'highpass', 5000, 3000);
        break;
      case 'ascend':
        // a big shimmering chord that blooms in the reverb
        [57, 64, 69, 73, 76, 81, 88].forEach((n, i) => {
          this.tone('triangle', mtof(n), mtof(n), 3.2, 0.06, { delay: i * 0.07, attack: 0.4, verb: true });
          this.tone('sine', mtof(n) * 1.003, mtof(n) * 1.003, 3.2, 0.04, { delay: i * 0.07 + 0.03, attack: 0.5, verb: true });
        });
        this.noise(2.5, 0.1, 'bandpass', 8000, 1500, { q: 0.7, verb: true });
        break;
      case 'step':
        break;
    }
  }

  step(bright = 1) {
    const f = (700 + Math.random() * 500) * bright;
    this.noise(0.05, 0.07, 'bandpass', f, f * 0.6, { q: 1.8 });
  }

  update(dt, sim) {
    if (!this.ctx) return;
    const p = sim.player;
    const hs = Math.hypot(p.vel.x, p.vel.z);
    const sp = Math.hypot(hs, p.vel.y);
    const t = this.now();
    const windVol = Math.min(1, Math.max(0, (sp - 260) / 1300)) * (p.onGround ? 0.18 : 0.32);
    this.wind.g.gain.setTargetAtTime(windVol, t, 0.15);
    this.wind.f.frequency.setTargetAtTime(250 + sp * 1.2, t, 0.2);
    const slideVol = p.sliding && p.onGround ? Math.min(0.16, hs / 3500) : 0;
    this.slideLoop.g.gain.setTargetAtTime(slideVol, t, 0.05);
    const onIce = p.onGround && p.surface === 'ice';
    this.skateLoop.g.gain.setTargetAtTime(onIce ? Math.min(0.09, hs / 4000) : 0, t, 0.08);
    // past the walls the music goes "slowed + reverb"
    if (this.music && sim.level.vapor) this.music.vapor = Math.max(Math.abs(p.pos.x), Math.abs(p.pos.z)) > sim.level.vapor.parkHalf;
    const ob = sim.level.obelisk;
    if (ob) {
      const d = Math.hypot(p.pos.x - ob.x, p.pos.z - ob.z);
      const k = Math.max(0, 1 - d / 2600);
      this.hum.g.gain.setTargetAtTime(k * k * (sim.stats.awake ? 0.22 : 0.16), t, 0.3);
    }
    this.slideLoop.f.frequency.setTargetAtTime(500 + hs * 0.8, t, 0.1);

    // footsteps from distance travelled (skates glide silently on ice)
    if ((p.onGround && !p.sliding && p.surface !== 'ice') || p.wall.active) {
      this.stepDist += hs * dt;
      const stride = p.wall.active ? 95 : 125;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        if (hs > 60) this.step(p.wall.active ? 1.3 : 1);
      }
    } else this.stepDist = 100;
  }
}

class Music {
  constructor(audio) {
    this.a = audio;
    const ctx = audio.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 1.4;
    this.out.connect(audio.musicBus);
    this.out.connect(audio.reverb);
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2200;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delay.connect(this.out);
    // Fmaj9 - Em7 - Dm9 - Cmaj7 (+ an Am9 / Bbmaj7 detour) - soft and floaty
    this.chords = [
      [53, 57, 60, 64, 67],
      [52, 55, 59, 62, 66],
      [50, 53, 57, 60, 64],
      [48, 52, 55, 59, 62],
      [45, 52, 55, 59, 60],
      [46, 50, 53, 57, 60],
      [50, 53, 57, 60, 64],
      [48, 52, 55, 59, 67],
    ];
    this.beat = 0;
    this.nextTime = 0;
    this.chordLen = 16; // eighth-notes per chord
    this.tempo = 0.36; // seconds per eighth
  }

  start() {
    this.nextTime = this.a.now() + 0.3;
    this.timer = setInterval(() => this.schedule(), 100);
  }

  voice(type, freq, t, dur, vol, attack, dest) {
    const ctx = this.a.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setTargetAtTime(0.0001, t + Math.max(attack, dur - attack), attack * 0.6 + 0.05);
    o.connect(f).connect(g).connect(dest || this.out);
    o.start(t);
    o.stop(t + dur + attack * 3 + 0.5);
  }

  schedule() {
    const ctx = this.a.ctx;
    if (!this.a.musicOn) {
      this.nextTime = this.a.now() + 0.2;
      return;
    }
    while (this.nextTime < this.a.now() + 0.4) {
      const t = this.nextTime;
      const ci = Math.floor(this.beat / this.chordLen) % this.chords.length;
      const tr = this.vapor ? -3 : 0; // vaporwave: everything a minor third down and slower
      const chord = this.chords[ci].map((n) => n + tr);
      const tempo = this.vapor ? this.tempo * 1.45 : this.tempo;
      const step = this.beat % this.chordLen;
      const chordDur = this.chordLen * tempo;
      if (step === 0) {
        for (const n of chord.slice(1)) {
          this.voice('triangle', mtof(n), t, chordDur, 0.016, 1.6);
          this.voice('sine', mtof(n) * (this.vapor ? 1.012 : 1.004), t, chordDur, 0.014, 2.0); // wider chorus when vapor
        }
        this.voice('sine', mtof(chord[0] - 12), t, chordDur, 0.05, 0.8);
      }
      // sparse plinks with echo
      if ((step % 2 === 0 && Math.random() < 0.42) || step === 0) {
        const pool = chord.map((n) => n + 12).concat(chord.map((n) => n + 24));
        const n = pool[Math.floor(Math.random() * pool.length)];
        this.voice('triangle', mtof(n), t, 0.25, 0.035, 0.01);
        this.voice('sine', mtof(n), t, 0.25, 0.03, 0.01, this.delay);
      }
      this.nextTime += tempo;
      this.beat++;
    }
  }
}
