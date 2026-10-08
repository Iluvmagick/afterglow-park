// HUD drawn on a canvas the size of the low-res framebuffer, then scaled up pixelated.

const GLYPHS = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  0: '.###. #...# #..## #.#.# ##..# #...# .###.',
  1: '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  2: '.###. #...# ....# ...#. ..#.. .#... #####',
  3: '####. ....# ....# .###. ....# ....# ####.',
  4: '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  5: '##### #.... ####. ....# ....# #...# .###.',
  6: '.###. #.... #.... ####. #...# #...# .###.',
  7: '##### ....# ...#. ..#.. .#... .#... .#...',
  8: '.###. #...# #...# .###. #...# #...# .###.',
  9: '.###. #...# #...# .#### ....# ....# .###.',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  ',': '..... ..... ..... ..... .##.. ..#.. .#...',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
  '/': '....# ....# ...#. ..#.. .#... #.... #....',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  '-': '..... ..... ..... .###. ..... ..... .....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  "'": '..#.. ..#.. .#... ..... ..... ..... .....',
  '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...',
  '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
  '=': '..... ..... ##### ..... ##### ..... .....',
  '%': '##..# ##..# ...#. ..#.. .#... #..## #..##',
  '_': '..... ..... ..... ..... ..... ..... #####',
  '*': '..... #.#.# .###. ##### .###. #.#.# .....',
  ' ': '..... ..... ..... ..... ..... ..... .....',
};
const FONT = {};
for (const [k, v] of Object.entries(GLYPHS)) FONT[k] = v.split(' ').map((r) => [...r].map((c) => c === '#'));

export function textWidth(s, scale = 1) {
  return String(s).length * 6 * scale - scale;
}

// Each (color, scale) gets a pre-rendered strip of all glyphs, so drawing a character is a
// single drawImage instead of dozens of 1-pixel fillRects.
const CHARS = Object.keys(FONT);
const CHAR_INDEX = new Map(CHARS.map((c, i) => [c, i]));
const atlases = new Map();
function glyphAtlas(color, scale) {
  const key = `${color}|${scale}`;
  let a = atlases.get(key);
  if (a) return a;
  a = document.createElement('canvas');
  a.width = CHARS.length * 6 * scale;
  a.height = 7 * scale;
  const g = a.getContext('2d');
  g.fillStyle = color;
  CHARS.forEach((ch, i) => {
    const rows = FONT[ch];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (rows[r][c]) g.fillRect((i * 6 + c) * scale, r * scale, scale, scale);
  });
  atlases.set(key, a);
  return a;
}

// Draw text with the 5x7 bitmap font onto any 2D canvas context.
export function drawText(ctx, s, x, y, color = '#fff', scale = 1, shadow = '#201028') {
  s = String(s).toUpperCase();
  const w = 5 * scale;
  const h = 7 * scale;
  const y0 = Math.round(y);
  for (const pass of shadow ? [0, 1] : [1]) {
    const atlas = glyphAtlas(pass ? color : shadow, scale);
    const o = pass ? 0 : scale;
    let cx = Math.round(x);
    for (const ch of s) {
      const i = CHAR_INDEX.get(ch) ?? CHAR_INDEX.get('?');
      ctx.drawImage(atlas, i * 6 * scale, 0, w, h, cx + o, y0 + o, w, h);
      cx += 6 * scale;
    }
  }
}

export const speedColor = (hs) => (hs > 1200 ? '#ff7ab0' : hs > 700 ? '#ffb46a' : hs > 400 ? '#ffe27a' : '#ffffff');

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.toasts = [];
    this.debug = false;
    this.fps = 60;
    this.respawn = 0; // 0..1 progress of holding R
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.w = w;
    this.h = h;
  }

  textWidth(s, scale = 1) {
    return textWidth(s, scale);
  }

  text(s, x, y, color, scale, shadow) {
    drawText(this.ctx, s, x, y, color, scale, shadow);
  }

  toast(s, color = '#ffe27a', time = 1.6) {
    this.toasts.push({ s, color, t: time, max: time });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  drawToasts(dt, w, h) {
    const cx = Math.floor(w / 2);
    let ty = Math.floor(h * 0.25);
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.toasts.splice(i, 1);
        continue;
      }
    }
    for (const t of this.toasts) {
      const fade = Math.min(1, t.t / 0.3);
      if (fade < 1 && Math.floor(t.t * 30) % 2) {
        ty += 18;
        continue; // PS1-style blinky fade
      }
      const sc = t.s.length * 12 > w - 8 ? 1 : 2; // fall back to small text if it won't fit
      this.text(t.s, cx - this.textWidth(t.s, sc) / 2, ty, t.color, sc);
      ty += 18;
    }
  }

  draw(dt, sim, extra) {
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (this.minimal) {
      // only titles (used by trailer flyovers)
      this.drawToasts(dt, w, h);
      return;
    }
    const p = sim.player;
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);

    // crosshair
    ctx.fillStyle = '#201028';
    ctx.fillRect(cx - 4, cy - 1, 3, 3);
    ctx.fillRect(cx + 2, cy - 1, 3, 3);
    ctx.fillRect(cx - 1, cy - 4, 3, 3);
    ctx.fillRect(cx - 1, cy + 2, 3, 3);
    ctx.fillStyle = p.hook.state === 'attached' ? '#7af0e6' : '#fff';
    ctx.fillRect(cx - 3, cy, 2, 1);
    ctx.fillRect(cx + 2, cy, 2, 1);
    ctx.fillRect(cx, cy - 3, 1, 2);
    ctx.fillRect(cx, cy + 2, 1, 2);

    // (speed lives on the launcher's screen, see render/viewmodel.js)


    // hold-to-respawn countdown
    if (this.respawn > 0) {
      const secs = Math.max(1, Math.ceil(3 * (1 - this.respawn)));
      const label = `RESPAWN IN ${secs}`;
      const bw = 90;
      const by = cy - 22; // above the crosshair, clear of the launcher's screen
      this.text(label, cx - this.textWidth(label) / 2, by - 11, '#ffffff');
      ctx.fillStyle = '#201028';
      ctx.fillRect(cx - bw / 2 - 2, by - 2, bw + 4, 8);
      ctx.fillStyle = '#4a3a5a';
      ctx.fillRect(cx - bw / 2, by, bw, 4);
      ctx.fillStyle = '#ffb27a';
      ctx.fillRect(cx - bw / 2, by, Math.round(bw * this.respawn), 4);
    }

    // pickups
    const orbTotal = sim.orbs.length;
    this.text(`ORBS ${sim.stats.orbs}/${orbTotal}`, 6, 6, '#ffe27a');
    this.text(`TARGETS ${sim.stats.targets}`, 6, 16, '#ff9a9a');
    const best = `BEST ${Math.round(sim.stats.topSpeed)}`;
    this.text(best, w - this.textWidth(best) - 6, 6, '#c8b8e8');

    // abilities (bottom-left)
    const by = h - 30;
    const dashReady = p.t.dashCd <= 0;
    this.text('DASH', 6, by, dashReady ? '#ffffff' : '#7a6a8a');
    ctx.fillStyle = '#201028';
    ctx.fillRect(34, by + 2, 26, 4);
    ctx.fillStyle = dashReady ? '#7af0e6' : '#5a7a8a';
    ctx.fillRect(35, by + 3, Math.round(24 * (1 - p.t.dashCd / p.move.dashCooldown)), 2);
    this.text('AIR', 6, by + 10, p.airJumps > 0 ? '#ffffff' : '#7a6a8a');
    for (let i = 0; i < p.move.airJumps; i++) {
      ctx.fillStyle = '#201028';
      ctx.fillRect(34 + i * 7, by + 11, 5, 5);
      ctx.fillStyle = i < p.airJumps ? '#ffe27a' : '#4a3a5a';
      ctx.fillRect(35 + i * 7, by + 12, 3, 3);
    }
    const hookTxt = p.hook.state === 'attached' ? 'HOOK *' : 'HOOK';
    this.text(hookTxt, 6, by + 20, p.hook.state === 'none' && p.t.hook <= 0 ? '#ffffff' : '#7af0e6');

    this.drawToasts(dt, w, h);

    if (this.debug) {
      const lines = [
        ...(Array.isArray(extra) ? extra : [`FPS ${Math.round(this.fps)}`, extra || '']),
        `POS ${p.pos.x.toFixed(0)} ${p.pos.y.toFixed(0)} ${p.pos.z.toFixed(0)}`,
        `VEL ${p.vel.x.toFixed(0)} ${p.vel.y.toFixed(0)} ${p.vel.z.toFixed(0)}`,
        `${p.onGround ? 'GROUND' : 'AIR'} ${p.crouched ? 'CROUCH' : ''} ${p.sliding ? 'SLIDE' : ''} ${p.wall.active ? 'WALL' : ''} ${p.hook.state.toUpperCase()}`,
      ];
      lines.forEach((l, i) => this.text(l, 6, 30 + i * 10, '#9af09a'));
    }
  }
}
