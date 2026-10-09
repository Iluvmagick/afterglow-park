// Procedural low-res textures (64x64, small palettes) so the game needs no asset files.
import { mulberry32 } from '../math.js';

const S = 64;

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

class Tex {
  constructor(seed, size = S) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(size, size);
    this.rand = mulberry32(seed);
  }
  set(x, y, c, a = 255) {
    const s = this.size;
    x = ((x % s) + s) % s;
    y = ((y % s) + s) % s;
    const i = (y * s + x) * 4;
    this.img.data[i] = c[0];
    this.img.data[i + 1] = c[1];
    this.img.data[i + 2] = c[2];
    this.img.data[i + 3] = a;
  }
  get(x, y) {
    const s = this.size;
    x = ((x % s) + s) % s;
    y = ((y % s) + s) % s;
    const i = (y * s + x) * 4;
    return [this.img.data[i], this.img.data[i + 1], this.img.data[i + 2]];
  }
  fill(fn) {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) this.set(x, y, fn(x, y));
  }
  pick(pal) {
    return pal[Math.floor(this.rand() * pal.length)];
  }
  // tileable value noise in [0,1)
  noise(cells) {
    const g = [];
    for (let i = 0; i < cells * cells; i++) g.push(this.rand());
    const at = (x, y) => g[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)];
    return (x, y) => {
      const fx = (x / this.size) * cells;
      const fy = (y / this.size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  }
  done() {
    this.ctx.putImageData(this.img, 0, 0);
    return this.canvas;
  }
}

const shade = (c, f) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));

function grass() {
  const t = new Tex(11);
  const pal = ['#3f7a2e', '#4a8a34', '#56973b', '#356b28'].map(hex);
  const n = t.noise(8);
  const n2 = t.noise(4);
  t.fill((x, y) => {
    const v = n(x, y) * 0.6 + n2(x, y) * 0.4 + (t.rand() - 0.5) * 0.35;
    return pal[Math.max(0, Math.min(3, Math.floor(v * 4)))];
  });
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(t.rand() * S);
    const y = Math.floor(t.rand() * S);
    t.set(x, y, hex('#74b24c'));
    t.set(x, y + 1, hex('#5e9c40'));
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(t.rand() * S);
    const y = Math.floor(t.rand() * S);
    t.set(x, y, hex(t.rand() < 0.5 ? '#f2e46a' : '#f0f0f0'));
  }
  return t.done();
}

function dirt() {
  const t = new Tex(12);
  const pal = ['#6b4a2e', '#5a3d26', '#7a5634', '#4d331f'].map(hex);
  const n = t.noise(8);
  t.fill((x, y) => pal[Math.max(0, Math.min(3, Math.floor((n(x, y) + (t.rand() - 0.5) * 0.5) * 4)))]);
  for (let i = 0; i < 30; i++) t.set(Math.floor(t.rand() * S), Math.floor(t.rand() * S), hex('#9a8a78'));
  return t.done();
}

function tiles() {
  const t = new Tex(13);
  const pal = ['#d8c9a8', '#cdbd9a', '#e2d4b4', '#c9b48e'].map(hex);
  const grout = hex('#7a6c5c');
  const tileCol = [];
  for (let i = 0; i < 16; i++) tileCol.push(t.pick(pal));
  t.fill((x, y) => {
    if (x % 16 === 0 || y % 16 === 0) return grout;
    const c = tileCol[Math.floor(y / 16) * 4 + Math.floor(x / 16)];
    let f = 1 + (t.rand() - 0.5) * 0.08;
    if (x % 16 === 1 || y % 16 === 1) f *= 1.08;
    if (x % 16 === 15 || y % 16 === 15) f *= 0.9;
    return shade(c, f);
  });
  return t.done();
}

function stone() {
  const t = new Tex(14);
  const pal = ['#8a8790', '#7c7984', '#96939c', '#85828c'].map(hex);
  const mortar = hex('#5e5b66');
  const n = t.noise(16);
  const blockCol = new Map();
  t.fill((x, y) => {
    const row = Math.floor(y / 16);
    const off = row % 2 ? 16 : 0;
    const bx = Math.floor((x + off) / 32);
    if (y % 16 === 0 || (x + off) % 32 === 0) return mortar;
    const k = row * 8 + bx;
    if (!blockCol.has(k)) blockCol.set(k, t.pick(pal));
    let f = 0.9 + n(x, y) * 0.2;
    if (y % 16 === 1) f *= 1.1;
    if (y % 16 === 15) f *= 0.85;
    return shade(blockCol.get(k), f);
  });
  return t.done();
}

function brick() {
  const t = new Tex(15);
  const pal = ['#9a4a3a', '#8a3f31', '#a8564a', '#93473a'].map(hex);
  const mortar = hex('#c2b29f');
  const cols = new Map();
  t.fill((x, y) => {
    const row = Math.floor(y / 8);
    const off = row % 2 ? 8 : 0;
    if (y % 8 === 0 || (x + off) % 16 === 0) return mortar;
    const k = row * 8 + Math.floor((x + off) / 16);
    if (!cols.has(k)) cols.set(k, t.pick(pal));
    return shade(cols.get(k), 0.92 + t.rand() * 0.14 - (y % 8 === 7 ? 0.12 : 0));
  });
  return t.done();
}

function metal() {
  const t = new Tex(16);
  const base = hex('#5d6b7d');
  const n = t.noise(4);
  t.fill((x, y) => {
    let f = 0.85 + n(x, y) * 0.25 + (t.rand() - 0.5) * 0.06;
    if (x % 32 === 0 || y === 0) f = 0.55;
    if (x % 32 === 1 || y === 1) f *= 1.25;
    return shade(base, f);
  });
  for (const [x, y] of [
    [4, 4],
    [28, 4],
    [4, 60],
    [28, 60],
    [36, 4],
    [60, 4],
    [36, 60],
    [60, 60],
  ]) {
    t.set(x, y, hex('#b8c4d4'));
    t.set(x + 1, y + 1, hex('#2e3640'));
  }
  return t.done();
}

function wood() {
  const t = new Tex(17);
  const pal = ['#a0703f', '#8c6034', '#b07c46', '#97693a'].map(hex);
  const plank = [];
  for (let i = 0; i < 8; i++) plank.push({ c: t.pick(pal), seam: Math.floor(t.rand() * 64) });
  t.fill((x, y) => {
    const p = plank[Math.floor(y / 8)];
    if (y % 8 === 0) return hex('#4e341c');
    if (x === p.seam) return hex('#5e3f22');
    const grain = Math.sin((x + p.seam) * 0.45 + (y % 8) * 1.7) > 0.75 ? 0.82 : 1;
    return shade(p.c, grain * (0.94 + t.rand() * 0.1));
  });
  return t.done();
}

function surf() {
  const t = new Tex(18);
  const a = hex('#ff7ab0');
  const b = hex('#8a63ff');
  t.fill((x, y) => {
    const k = y / 63;
    let c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
    if (x % 16 === 0 || y % 16 === 0) c = shade(c, 1.35);
    else if ((x + y) % 32 < 2) c = shade(c, 1.12);
    return c;
  });
  return t.done();
}

function hazard() {
  const t = new Tex(19);
  t.fill((x, y) => (((x + y) >> 3) % 2 ? hex('#2a2620') : hex('#f2c230')));
  return t.done();
}

function pad() {
  const t = new Tex(20);
  t.fill((x, y) => {
    const cx = x % 32;
    const cy = y % 32;
    const chevron = Math.abs(cx - 16) + (cy % 16) < 14 && Math.abs(cx - 16) + (cy % 16) > 8;
    return chevron ? hex('#fff6c8') : (x ^ y) & 1 ? hex('#ff9a2a') : hex('#ff8a1a');
  });
  return t.done();
}

function cliff() {
  const t = new Tex(21);
  const pal = ['#7d6f68', '#6e625c', '#8c7e74', '#5f5450'].map(hex);
  const n = t.noise(8);
  t.fill((x, y) => {
    const band = Math.floor((y + n(x, y) * 10) / 8) % 4;
    return shade(pal[band], 0.9 + n(x * 2, y) * 0.2 + (t.rand() - 0.5) * 0.08);
  });
  return t.done();
}

function rock() {
  const t = new Tex(22);
  const pal = ['#5b4c48', '#4b3f3c', '#6a5a52', '#3f3532'].map(hex);
  const n = t.noise(8);
  t.fill((x, y) => pal[Math.max(0, Math.min(3, Math.floor((n(x, y) + (t.rand() - 0.5) * 0.4) * 4)))]);
  return t.done();
}

function crate() {
  const t = new Tex(23);
  const pal = ['#b8874a', '#a87a40', '#c29454'].map(hex);
  const dark = hex('#5a3c1e');
  t.fill((x, y) => {
    const edge = x < 5 || y < 5 || x > 58 || y > 58;
    const diag = Math.abs(x - y) < 4 || Math.abs(x + y - 63) < 4;
    if (edge) return shade(hex('#8c6234'), x === 0 || y === 0 || x === 63 || y === 63 ? 0.6 : 1);
    if (diag) return shade(hex('#966a38'), 1);
    if (y % 10 === 0) return dark;
    return shade(pal[Math.floor(y / 10) % 3], 0.95 + t.rand() * 0.1);
  });
  return t.done();
}

function checker() {
  const t = new Tex(24);
  const a = hex('#7c68a8');
  const b = hex('#6c5a96');
  t.fill((x, y) => {
    if (x % 32 === 0 || y % 32 === 0) return hex('#c4b4ec');
    if (x % 8 === 0 || y % 8 === 0) return hex('#8e7cbc');
    return ((x >> 4) + (y >> 4)) % 2 ? a : b;
  });
  return t.done();
}

function slide() {
  const t = new Tex(25);
  const n = t.noise(4);
  t.fill((x, y) => {
    let c = shade(hex('#4fb0c6'), 0.9 + n(x, y) * 0.2);
    if (x % 32 === 0 || x % 32 === 31) c = hex('#e8f6ff');
    if (x % 32 === 16 && y % 16 < 8) c = hex('#f6fbff');
    return c;
  });
  return t.done();
}

function bark() {
  const t = new Tex(26);
  t.fill((x, y) => shade(hex('#5e4130'), (x % 4 === 0 ? 0.75 : 1) * (0.9 + t.rand() * 0.2)));
  return t.done();
}

function pine() {
  const t = new Tex(27);
  const pal = ['#24522f', '#2d6138', '#1d4528', '#357042'].map(hex);
  t.fill((x, y) => {
    const band = (y + (x % 8 < 4 ? 0 : 3)) % 8;
    return shade(t.pick(pal), band < 2 ? 0.75 : 1);
  });
  return t.done();
}

// Gunmetal for the launcher: rows run around the tube, so horizontal bands become rings.
function launcher() {
  const t = new Tex(29);
  const base = hex('#636a8a');
  const n = t.noise(8);
  t.fill((x, y) => {
    let f = 0.86 + n(x, y) * 0.22 + (t.rand() - 0.5) * 0.05;
    const ry = y % 16;
    if (ry === 0) f = 0.5;
    else if (ry === 1) f *= 1.25;
    if (x % 32 === 0) f *= 0.7;
    if (x % 32 === 1) f *= 1.15;
    return shade(base, f);
  });
  // rivets along the rings
  for (let y = 4; y < 64; y += 16) {
    for (let x = 6; x < 64; x += 16) {
      t.set(x, y, hex('#a8b0c8'));
      t.set(x + 1, y + 1, hex('#262838'));
    }
  }
  // warm scuffs
  for (let i = 0; i < 40; i++) t.set(Math.floor(t.rand() * 64), Math.floor(t.rand() * 64), hex('#7a6a68'));
  return t.done();
}

function ice() {
  const t = new Tex(30);
  const n = t.noise(4);
  t.fill((x, y) => {
    let c = shade(hex('#bfe4f2'), 0.92 + n(x, y) * 0.14);
    const streak = (x + y * 2) % 64;
    if (streak < 3) c = shade(c, 1.12); // glossy diagonal glints
    if (streak > 30 && streak < 32) c = shade(c, 1.06);
    return c;
  });
  // cracks: short random walks
  for (let k = 0; k < 7; k++) {
    let x = Math.floor(t.rand() * 64);
    let y = Math.floor(t.rand() * 64);
    for (let i = 0; i < 14; i++) {
      t.set(x, y, hex('#86bcd6'));
      x += Math.floor(t.rand() * 3) - 1;
      y += t.rand() < 0.6 ? 1 : 0;
    }
  }
  return t.done();
}

function bounce() {
  const t = new Tex(31);
  t.fill((x, y) => {
    const cx = (x % 16) - 7.5;
    const cy = (y % 16) - 7.5;
    const r = Math.hypot(cx, cy);
    if (r < 3.2) return hex('#fff0f8');
    if (r < 4.4) return hex('#ffb3d6');
    return ((x >> 4) + (y >> 4)) % 2 ? hex('#ff5fa8') : hex('#f04c98');
  });
  return t.done();
}

// Speed-strip chevrons pointing along `d` (image space: up = (0,-1)); tiles every 32 px.
function boost(d) {
  return () => {
    const t = new Tex(32);
    const perp = { x: -d.y, y: d.x };
    t.fill((x, y) => {
      const px = x - 31.5;
      const py = y - 31.5;
      const a = px * d.x + py * d.y;
      const b = px * perp.x + py * perp.y;
      const band = (((-a - Math.abs(b)) % 32) + 32) % 32;
      if (band < 6) return band < 2 ? hex('#e8ffff') : hex('#7af0ff');
      return shade(hex('#18245a'), 0.9 + ((x ^ y) & 1) * 0.1);
    });
    return t.done();
  };
}

function goo() {
  const t = new Tex(33);
  const n = t.noise(8);
  const n2 = t.noise(4);
  t.fill((x, y) => {
    const v = n(x, y) * 0.6 + n2(x, y) * 0.4;
    let c = v > 0.62 ? hex('#8af07a') : v > 0.45 ? hex('#56c85a') : hex('#3a9a48');
    if (v > 0.7 && (x + y) % 5 === 0) c = hex('#d8ffc8'); // wet glints
    return c;
  });
  // drips running down (texture up is +v, so drips extend toward the bottom of the image)
  for (let k = 0; k < 9; k++) {
    const x = Math.floor(t.rand() * 64);
    const y0 = Math.floor(t.rand() * 64);
    const len = 6 + Math.floor(t.rand() * 14);
    for (let i = 0; i < len; i++) t.set(x, y0 + i, hex('#2e7a3c'));
    t.set(x, y0 + len, hex('#a8f890'));
  }
  return t.done();
}

function obsidian() {
  const t = new Tex(34);
  const n = t.noise(8);
  t.fill((x, y) => {
    let c = shade(hex('#241a34'), 0.85 + n(x, y) * 0.35);
    if ((x * 7 + y * 3) % 61 === 0) c = hex('#5a4a7a'); // faint flecks
    if (y % 32 === 0) c = shade(c, 0.7);
    return c;
  });
  return t.done();
}

function gold() {
  const t = new Tex(35);
  const n = t.noise(4);
  t.fill((x, y) => {
    let c = shade(hex('#e3b04a'), 0.88 + n(x, y) * 0.2);
    if (x % 16 === 0 || y % 16 === 0) c = shade(c, 0.78);
    if ((x + 2 * y) % 48 < 3) c = shade(c, 1.2);
    return c;
  });
  return t.done();
}

// Glowing glyph columns with a transparent background (alpha-tested in the shader).
function runes() {
  const t = new Tex(36);
  const d = t.img.data;
  for (let i = 0; i < d.length; i++) d[i] = 0;
  const on = (x, y) => t.set(x, y, [255, 255, 255], 255);
  for (let y = 0; y < 64; y++) {
    on(3, y);
    on(60, y);
  }
  for (let gy = 0; gy < 64; gy += 16) {
    for (let x = 6; x < 58; x++) if (x % 3) on(x, gy + 15);
    // two glyphs per row: random symmetric 5x7 pixel symbols
    for (const gx of [16, 40]) {
      for (let yy = 0; yy < 9; yy++) {
        for (let xx = 0; xx < 4; xx++) {
          if (t.rand() < 0.45) {
            on(gx + xx, gy + 3 + yy);
            on(gx + 8 - xx, gy + 3 + yy);
          }
        }
      }
    }
  }
  return t.done();
}

function marble() {
  const t = new Tex(37);
  const n = t.noise(8);
  t.fill((x, y) => {
    let c = shade(hex('#f3e4ee'), 0.94 + n(x, y) * 0.1);
    if (y % 32 === 0) c = shade(c, 0.86); // block courses
    return c;
  });
  for (let k = 0; k < 6; k++) {
    let x = t.rand() * 64;
    let y = t.rand() * 64;
    const dx = t.rand() - 0.5;
    for (let i = 0; i < 40; i++) {
      t.set(Math.floor(x), Math.floor(y), hex(k % 2 ? '#c8b4d8' : '#d6c2dc'));
      x += dx + (t.rand() - 0.5) * 0.8;
      y += 0.7 + t.rand() * 0.5;
    }
  }
  return t.done();
}

function vaporgrid() {
  const t = new Tex(38);
  const n = t.noise(4);
  t.fill((x, y) => {
    const lx = x % 32;
    const ly = y % 32;
    if (lx === 0 || ly === 0) return hex('#ff4fd8');
    if (lx === 1 || ly === 1 || lx === 31 || ly === 31) return hex('#7a2a8a');
    return shade(hex('#1c0b34'), 0.85 + n(x, y) * 0.3);
  });
  return t.done();
}

function water() {
  const t = new Tex(39);
  t.fill((x, y) => {
    const wave = Math.sin(x * 0.3 + Math.sin(y * 0.2) * 2) + Math.sin(y * 0.45);
    if (wave > 1.5) return hex('#d8fbff');
    if (wave > 0.9) return hex('#8eeaf8');
    return wave < -1.2 ? hex('#2fb8d8') : hex('#4fd2ec');
  });
  return t.done();
}

function palm() {
  const t = new Tex(40);
  t.fill((x, y) => {
    if (Math.abs(x - 32) < 2) return hex('#2a6a5a'); // the frond's spine
    const leaflet = (y + Math.abs(x - 32)) % 8 < 2;
    return leaflet ? hex('#1f8a7a') : (x + y) % 3 ? hex('#3ac2a0') : hex('#4ed8b0');
  });
  return t.done();
}

// Vaporwave curtain wall: mullions, spandrels and a sunset reflection gradient.
function glassTex(seed, top, bottom, frame) {
  return () => {
    const t = new Tex(seed);
    const a = hex(top);
    const b = hex(bottom);
    t.fill((x, y) => {
      if (x % 16 === 0 || x % 16 === 15) return hex(frame);
      if (y % 16 === 0) return shade(hex(frame), 1.2);
      const k = y / 63;
      let c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
      if ((x + (63 - y)) % 40 < 4) c = shade(c, 1.25); // diagonal glint
      return shade(c, 0.95 + ((x >> 4) % 2) * 0.06);
    });
    return t.done();
  };
}

function neon() {
  const t = new Tex(41);
  t.fill((x, y) => {
    const band = (y >> 3) % 4;
    if (band === 0) return hex('#ff4fd8');
    if (band === 2) return hex('#5af2ff');
    return (x + y) % 2 ? hex('#2a0f48') : hex('#321458');
  });
  return t.done();
}

function white() {
  const t = new Tex(28, 8);
  t.fill(() => [255, 255, 255]);
  return t.done();
}

// ---------------------------------------------------------------- the Poolrooms
// One palette for everything down there: white and aqua ceramic, teal trim, turquoise water.
const POOL_GROUT = '#a9c9c8';

// Square ceramic tiles, 16 px each (4 x 4 per texture), with a glossy top-left edge.
function ceramic(seed, pal, grout = POOL_GROUT) {
  return () => {
    const t = new Tex(seed);
    const cols = [];
    for (let i = 0; i < 16; i++) cols.push(t.pick(pal.map(hex)));
    t.fill((x, y) => {
      const lx = x % 16;
      const ly = y % 16;
      if (lx === 0 || ly === 0) return hex(grout);
      let f = 1 + (t.rand() - 0.5) * 0.03;
      if (lx === 1 || ly === 1) f *= 1.06;
      if (lx === 15 || ly === 15) f *= 0.93;
      if ((lx === 3 && ly > 2 && ly < 7) || (ly === 3 && lx > 2 && lx < 7)) f *= 1.05; // glaze glint
      return shade(cols[(y >> 4) * 4 + (x >> 4)], f);
    });
    return t.done();
  };
}

// The ceiling: small white tiles with a glowing light panel in every repeat.
function poolceil() {
  const t = new Tex(51);
  t.fill((x, y) => {
    const px = x - 32;
    const py = y - 32;
    if (Math.abs(px) < 11 && Math.abs(py) < 11) {
      if (Math.abs(px) === 10 || Math.abs(py) === 10) return hex('#c8e6e4'); // panel frame
      return (px + py) & 1 ? hex('#fbfffe') : hex('#f2fffd');
    }
    if (x % 8 === 0 || y % 8 === 0) return hex('#b6cfce');
    return shade(hex('#dfe9e7'), 0.97 + t.rand() * 0.05);
  });
  return t.done();
}

// Clear turquoise with caustic ripples (drawn translucent over the tiles).
function poolwater() {
  const t = new Tex(52);
  const n = t.noise(4);
  t.fill((x, y) => {
    const a = Math.sin(x * 0.2 + Math.sin(y * 0.15) * 2.2 + n(x, y) * 4);
    const b = Math.sin(y * 0.23 + Math.sin(x * 0.18) * 2);
    const v = a + b;
    if (v > 1.55) return hex('#f2ffff');
    if (v > 1.1) return hex('#a8f4f2');
    return v < -1 ? hex('#2aa6b8') : hex('#52c8d2');
  });
  return t.done();
}

// Springboard: white with a blue non-slip grip pattern.
function poolboard() {
  const t = new Tex(53);
  t.fill((x, y) => {
    if (y % 32 < 3) return hex('#2a8f9c');
    return (x + y) % 6 < 2 ? hex('#cfe6ee') : hex('#f4fbff');
  });
  return t.done();
}

// Pool ladder: chrome rungs on teal tile (crawlable, like goo).
function poolladder() {
  const t = new Tex(54);
  t.fill((x, y) => {
    if (x < 6 || x > 57) return x % 6 === 2 ? hex('#ffffff') : hex('#b9c6cc'); // the rails
    if (y % 16 < 4) return y % 16 === 1 ? hex('#ffffff') : hex('#a9b8be'); // rungs
    return (x >> 4) % 2 === (y >> 4) % 2 ? hex('#3fb3b0') : hex('#36a3a1');
  });
  return t.done();
}

// Water-slide fiberglass: glossy pale aqua, no grid (a slide is moulded, not tiled), soft sheen.
function poolslide() {
  const t = new Tex(60);
  const n = t.noise(4);
  const n2 = t.noise(8);
  t.fill((x, y) => {
    const v = n(x, y) * 0.65 + n2(x, y) * 0.35;
    let c = shade(hex('#b9eef0'), 0.94 + v * 0.12);
    if (v > 0.68) c = shade(c, 1.07); // wet sheen
    return c;
  });
  for (let i = 0; i < 24; i++) t.set(Math.floor(t.rand() * 64), Math.floor(t.rand() * 64), hex('#f2ffff')); // glints
  return t.done();
}

// Launch pad in pool style: a round jet grate, rings of white and aqua.
function pooljet() {
  const t = new Tex(59);
  t.fill((x, y) => {
    const r = Math.hypot((x % 32) - 15.5, (y % 32) - 15.5);
    if (r < 3) return hex('#ffffff');
    return Math.floor(r / 3) % 2 ? hex('#7fe6e6') : hex('#e8fffd');
  });
  return t.done();
}

// Water current: soft white chevrons on aqua (speed strips in pool style).
function current() {
  const t = new Tex(55);
  t.fill((x, y) => {
    const px = x - 31.5;
    const py = y - 31.5;
    const band = (((py - Math.abs(px) * 0.8) % 32) + 32) % 32;
    if (band < 5) return band < 2 ? hex('#ffffff') : hex('#c4fbf6');
    return shade(hex('#2fb4c0'), 0.92 + ((x ^ y) & 1) * 0.08);
  });
  return t.done();
}

export const TEXTURES = {
  grass, dirt, tiles, stone, brick, metal, wood, surf, hazard, pad, cliff, rock, crate, checker, slide, bark, pine, white, launcher,
  ice, bounce, goo, obsidian, gold, runes, marble, vaporgrid, water, palm, neon,
  glass: glassTex(42, '#7fe0ff', '#ff8ed8', '#2a2a5a'),
  glassgoo: glassTex(43, '#9affb0', '#3ac28a', '#1c4a3a'),
  boostN: boost({ x: 0, y: -1 }),
  boostS: boost({ x: 0, y: 1 }),
  boostE: boost({ x: 1, y: 0 }),
  boostW: boost({ x: -1, y: 0 }),
  pooltile: ceramic(50, ['#eef5f3', '#e8f1ef', '#f4f8f6', '#e2eeec']),
  poolaqua: ceramic(56, ['#9fe0de', '#93d8d7', '#a9e6e2', '#8ad1d2']),
  pooltrim: ceramic(57, ['#2a8f9c', '#25828f', '#3199a4', '#217987'], '#1a5d66'),
  poolice: ceramic(58, ['#c4eef2', '#bce8ef', '#cff3f5', '#b4e2ea'], '#8cc4cc'),
  poolceil, poolwater, poolboard, poolladder, current, pooljet, poolslide,
};

// World units per texture repeat, lighting, uv mode.
export const MATERIALS = {
  grass: { tex: 'grass', scale: 192 },
  dirt: { tex: 'dirt', scale: 128 },
  tiles: { tex: 'tiles', scale: 128 },
  stone: { tex: 'stone', scale: 128 },
  brick: { tex: 'brick', scale: 128 },
  metal: { tex: 'metal', scale: 128 },
  wood: { tex: 'wood', scale: 96 },
  surf: { tex: 'surf', scale: 128 },
  hazard: { tex: 'hazard', scale: 64 },
  pad: { tex: 'pad', scale: 64, unlit: true },
  cliff: { tex: 'cliff', scale: 256 },
  rock: { tex: 'rock', scale: 160 },
  crate: { tex: 'crate', scale: 128, fit: true },
  checker: { tex: 'checker', scale: 128 },
  slide: { tex: 'slide', scale: 128 },
  bark: { tex: 'bark', scale: 64 },
  pine: { tex: 'pine', scale: 128 },
  ice: { tex: 'ice', scale: 192 },
  bounce: { tex: 'bounce', scale: 96 },
  goo: { tex: 'goo', scale: 128, scroll: [0, 0.04] }, // slowly oozing down
  obsidian: { tex: 'obsidian', scale: 160 },
  gold: { tex: 'gold', scale: 96 },
  marble: { tex: 'marble', scale: 128 },
  vaporgrid: { tex: 'vaporgrid', scale: 256, unlit: true }, // glowing neon grid
  water: { tex: 'water', scale: 160, unlit: true, scroll: [0.05, 0.02] },
  palm: { tex: 'palm', scale: 128 },
  // megacity: huge faces, so perspective-correct (affine: false) and big texture scales
  megagrid: { tex: 'vaporgrid', scale: 512, unlit: true, affine: false },
  megamarble: { tex: 'marble', scale: 512, affine: false },
  megagold: { tex: 'gold', scale: 384, affine: false },
  megaobsidian: { tex: 'obsidian', scale: 640, affine: false },
  megasurf: { tex: 'surf', scale: 640, affine: false },
  megaice: { tex: 'water', scale: 640, unlit: true, scroll: [0.02, 0.01], affine: false },
  megaboost: { tex: 'boostN', scale: 320, unlit: true, scroll: [0, -1.2], affine: false },
  megarock: { tex: 'rock', scale: 1600, affine: false },
  megacliff: { tex: 'cliff', scale: 1600, affine: false },
  glass: { tex: 'glass', scale: 512, affine: false },
  glassgoo: { tex: 'glassgoo', scale: 512, affine: false }, // sticky: crawl up it
  neon: { tex: 'neon', scale: 128, unlit: true, affine: false },
  // speed strips glow and their chevrons stream in the push direction
  boostN: { tex: 'boostN', scale: 96, unlit: true, scroll: [0, -1.6] },
  boostS: { tex: 'boostS', scale: 96, unlit: true, scroll: [0, 1.6] },
  boostE: { tex: 'boostE', scale: 96, unlit: true, scroll: [-1.6, 0] },
  boostW: { tex: 'boostW', scale: 96, unlit: true, scroll: [1.6, 0] },
  // the Poolrooms: tiles everywhere. The M variants are for huge faces cut into coarse cells.
  pooltile: { tex: 'pooltile', scale: 128 },
  pooltileM: { tex: 'pooltile', scale: 128, affine: false },
  poolaqua: { tex: 'poolaqua', scale: 128 },
  poolaquaM: { tex: 'poolaqua', scale: 128, affine: false },
  pooltrim: { tex: 'pooltrim', scale: 64 },
  pooltrimM: { tex: 'pooltrim', scale: 64, affine: false },
  poolice: { tex: 'poolice', scale: 128 }, // glossy: you skate on it
  poolceil: { tex: 'poolceil', scale: 512, unlit: true, affine: false }, // light panels glow
  poolboard: { tex: 'poolboard', scale: 64 },
  poolladder: { tex: 'poolladder', scale: 64 },
  current: { tex: 'current', scale: 96, unlit: true, scroll: [0, -1.2] },
  pooljet: { tex: 'pooljet', scale: 64, unlit: true },
  poolslide: { tex: 'poolslide', scale: 256 },
};
