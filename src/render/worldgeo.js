// Turns brushes into PS1-ish meshes: world-aligned UVs, faces chopped on a grid so the affine
// texture warp stays in the charming-but-readable range, and baked vertex color variation.
//
// The mesh is made watertight like Quake's map compiler did: vertices are welded, and any vertex
// that lies on another polygon's edge (a "T-junction") is inserted into that edge. Otherwise the
// PS1 vertex snapping opens hairline cracks along those seams that sparkle, worst in the distance.
import * as THREE from 'three';
import { MATERIALS } from './textures.js';
import { pineTiers, PINE_SIDES } from '../level.js';

const CELL = 128;
const WELD = 256; // vertex positions are welded to a 1/256 unit grid
const TJ_GRID = 128;
const TILE = 2560; // world mesh chunk size for frustum culling
const MIN_CHUNK_TRIS = 400;
const lexLess = (a, b) => (a.x !== b.x ? a.x < b.x : a.y !== b.y ? a.y < b.y : a.z < b.z);
const UP = { x: 0, y: 1, z: 0 };
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

function faceMaterial(mat, n) {
  if (typeof mat === 'string') return mat;
  if (n.y > 0.7) return mat.top ?? mat.side;
  if (n.y < -0.7) return mat.bottom ?? mat.side;
  return mat.side;
}

function basis(n) {
  if (Math.abs(n.y) > 0.999) return [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: n.y > 0 ? -1 : 1 }];
  const tu = { x: n.z, y: 0, z: -n.x }; // cross(UP, n)
  const l = Math.hypot(tu.x, tu.z);
  tu.x /= l;
  tu.z /= l;
  const tv = { x: n.y * tu.z - n.z * tu.y, y: n.z * tu.x - n.x * tu.z, z: n.x * tu.y - n.y * tu.x };
  return [tu, tv];
}

function clipPoly(poly, axis, c) {
  const below = [];
  const above = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = dot(a, axis) - c;
    const db = dot(b, axis) - c;
    if (da <= 0) below.push(a);
    if (da >= 0) above.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      // interpolate from a canonical endpoint so neighbours sharing this edge get the same bits
      const [p0, p1, d0, d1] = lexLess(a, b) ? [a, b, da, db] : [b, a, db, da];
      const t = d0 / (d0 - d1);
      const p = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, z: p0.z + (p1.z - p0.z) * t };
      below.push(p);
      above.push(p);
    }
  }
  return [below, above];
}

function splitAxis(polys, axis, cell) {
  const out = [];
  for (let poly of polys) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of poly) {
      const d = dot(p, axis);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    for (let k = Math.floor(lo / cell) + 1; k * cell < hi - 0.5; k++) {
      if (k * cell <= lo + 0.5) continue;
      const [below, above] = clipPoly(poly, axis, k * cell);
      if (below.length >= 3) out.push(below);
      poly = above;
      if (poly.length < 3) break;
    }
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

function hash3(x, y, z) {
  let h = Math.imul(Math.round(x) | 0, 73856093) ^ Math.imul(Math.round(y) | 0, 19349663) ^ Math.imul(Math.round(z) | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
  }
  vert(p, n, u, v, c) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

export function buildBrushGeometry(brushes) {
  const polys = collectPolygons(brushes);
  weldVertices(polys);
  fixTJunctions(polys);
  // Bucket by material AND by spatial tile, so each mesh has a tight bounding sphere and
  // three.js can frustum-cull whatever is behind you or off to the side.
  const builders = new Map();
  for (const poly of polys) {
    const c0 = poly.verts[0].p;
    const key = `${poly.name}|${Math.floor(c0.x / TILE)}|${Math.floor(c0.z / TILE)}`;
    if (!builders.has(key)) builders.set(key, { name: poly.name, gb: new GeoBuilder() });
    const gb = builders.get(key).gb;
    const vs = poly.verts;
    if (!poly.split) {
      for (let i = 1; i + 1 < vs.length; i++) for (const vv of [vs[0], vs[i], vs[i + 1]]) gb.vert(vv.p, poly.n, vv.u, vv.v, vv.c);
      continue;
    }
    // edges got extra vertices: fan from the centroid so every boundary edge is a real triangle edge
    const k = 1 / vs.length;
    const c = { p: { x: 0, y: 0, z: 0 }, u: 0, v: 0, c: [0, 0, 0] };
    for (const vv of vs) {
      c.p.x += vv.p.x * k;
      c.p.y += vv.p.y * k;
      c.p.z += vv.p.z * k;
      c.u += vv.u * k;
      c.v += vv.v * k;
      for (let j = 0; j < 3; j++) c.c[j] += vv.c[j] * k;
    }
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      for (const vv of [c, a, b]) gb.vert(vv.p, poly.n, vv.u, vv.v, vv.c);
    }
  }
  // tiny chunks aren't worth a draw call each: fold them into one leftover mesh per material
  const out = [];
  const leftovers = new Map();
  for (const { name, gb } of builders.values()) {
    if (gb.pos.length / 9 >= MIN_CHUNK_TRIS) {
      out.push({ name, geometry: gb.build() });
      continue;
    }
    if (!leftovers.has(name)) leftovers.set(name, new GeoBuilder());
    const lo = leftovers.get(name);
    lo.pos.push(...gb.pos);
    lo.nrm.push(...gb.nrm);
    lo.uv.push(...gb.uv);
    lo.col.push(...gb.col);
  }
  for (const [name, gb] of leftovers) out.push({ name, geometry: gb.build() });
  return out; // [{ name, geometry }], several chunks per material
}

function collectPolygons(brushes) {
  const polys = [];
  for (const b of brushes) {
    if (b.invisible) continue;
    const tint = b.tint || [1, 1, 1];
    const grounded = b.mins.y <= 1;
    for (const f of b.faces) {
      // skip faces nobody can ever see: underground ones, and the backs of the outer mountain rings
      let maxY = -Infinity;
      for (const p of f.poly) maxY = Math.max(maxY, p.y);
      if (maxY <= 0.01 && f.n.y < 0.5) continue;
      if (b.hideOutward && Math.abs(f.n.y) < 0.9) {
        const c = f.poly[0];
        const r = Math.hypot(c.x, c.z) || 1;
        if ((f.n.x * c.x + f.n.z * c.z) / r > 0.3) continue;
      }
      const name = faceMaterial(b.mat, f.n);
      const def = MATERIALS[name];
      if (!def) throw new Error(`unknown material ${name}`);
      // speed strips: on flat tops the texture's "up" follows the push direction, so the chevrons point the right way
      const [tu, tv] =
        b.boostDir && Math.abs(f.n.y) > 0.999 ? [{ x: -b.boostDir.z, y: 0, z: b.boostDir.x }, b.boostDir] : basis(f.n);
      let u0 = 0;
      let v0 = 0;
      let su = def.scale;
      let sv = def.scale;
      if (def.fit) {
        let ulo = Infinity;
        let uhi = -Infinity;
        let vlo = Infinity;
        let vhi = -Infinity;
        for (const p of f.poly) {
          ulo = Math.min(ulo, dot(p, tu));
          uhi = Math.max(uhi, dot(p, tu));
          vlo = Math.min(vlo, dot(p, tv));
          vhi = Math.max(vhi, dot(p, tv));
        }
        u0 = ulo;
        v0 = vlo;
        su = Math.max(1, uhi - ulo);
        sv = Math.max(1, vhi - vlo);
      }
      const cell = b.cell || CELL; // far-away scenery can use coarser cells
      const pieces = splitAxis(splitAxis([f.poly], tu, cell), tv, cell);
      const sideFace = Math.abs(f.n.y) < 0.7;
      for (const poly of pieces) {
        const verts = poly.map((p) => {
          let shadeF = 0.92 + hash3(p.x, p.y, p.z) * 0.16;
          if (grounded && sideFace) shadeF *= 0.7 + 0.3 * Math.min(1, (p.y - b.mins.y) / 110);
          if (f.n.y < -0.7) shadeF *= 0.75;
          return {
            p,
            u: (dot(p, tu) - u0) / su,
            v: (dot(p, tv) - v0) / sv,
            c: [tint[0] * shadeF, tint[1] * shadeF, tint[2] * shadeF],
          };
        });
        polys.push({ name, n: f.n, verts, split: false });
      }
    }
  }
  return polys;
}

// Snap every vertex to a fine grid and share one object per position.
function weldVertices(polys) {
  const canon = new Map();
  for (const poly of polys) {
    for (const v of poly.verts) {
      const qx = Math.round(v.p.x * WELD);
      const qy = Math.round(v.p.y * WELD);
      const qz = Math.round(v.p.z * WELD);
      const key = `${qx},${qy},${qz}`;
      let c = canon.get(key);
      if (!c) canon.set(key, (c = { x: qx / WELD, y: qy / WELD, z: qz / WELD }));
      v.p = c;
    }
    poly.verts = poly.verts.filter((v, i, a) => v.p !== a[(i + 1) % a.length].p);
  }
  for (let i = polys.length - 1; i >= 0; i--) if (polys[i].verts.length < 3) polys.splice(i, 1);
}

// Insert every vertex that lies strictly inside a polygon edge into that edge.
function fixTJunctions(polys) {
  const grid = new Map();
  const cellKey = (x, y, z) => `${x},${y},${z}`;
  const seen = new Set();
  for (const poly of polys) {
    for (const v of poly.verts) {
      if (seen.has(v.p)) continue;
      seen.add(v.p);
      const k = cellKey(Math.floor(v.p.x / TJ_GRID), Math.floor(v.p.y / TJ_GRID), Math.floor(v.p.z / TJ_GRID));
      let cell = grid.get(k);
      if (!cell) grid.set(k, (cell = []));
      cell.push(v.p);
    }
  }
  for (const poly of polys) {
    const vs = poly.verts;
    const out = [];
    for (let i = 0; i < vs.length; i++) {
      const A = vs[i];
      const B = vs[(i + 1) % vs.length];
      out.push(A);
      const a = A.p;
      const b = B.p;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const ez = b.z - a.z;
      const len2 = ex * ex + ey * ey + ez * ez;
      const hits = [];
      const x0 = Math.floor((Math.min(a.x, b.x) - 0.01) / TJ_GRID);
      const x1 = Math.floor((Math.max(a.x, b.x) + 0.01) / TJ_GRID);
      const y0 = Math.floor((Math.min(a.y, b.y) - 0.01) / TJ_GRID);
      const y1 = Math.floor((Math.max(a.y, b.y) + 0.01) / TJ_GRID);
      const z0 = Math.floor((Math.min(a.z, b.z) - 0.01) / TJ_GRID);
      const z1 = Math.floor((Math.max(a.z, b.z) + 0.01) / TJ_GRID);
      for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++)
          for (let cz = z0; cz <= z1; cz++) {
            const cell = grid.get(cellKey(cx, cy, cz));
            if (!cell) continue;
            for (const p of cell) {
              if (p === a || p === b) continue;
              const t = ((p.x - a.x) * ex + (p.y - a.y) * ey + (p.z - a.z) * ez) / len2;
              if (t <= 1e-6 || t >= 1 - 1e-6) continue;
              const dx = a.x + ex * t - p.x;
              const dy = a.y + ey * t - p.y;
              const dz = a.z + ez * t - p.z;
              if (dx * dx + dy * dy + dz * dz < 1e-4) hits.push({ t, p });
            }
          }
      if (!hits.length) continue;
      hits.sort((h1, h2) => h1.t - h2.t);
      for (const { t, p } of hits) {
        out.push({ p, u: A.u + (B.u - A.u) * t, v: A.v + (B.v - A.v) * t, c: A.c.map((x, j) => x + (B.c[j] - x) * t) });
      }
      poly.split = true;
    }
    poly.verts = out;
  }
}

// For tests: count polygon-edge T-junctions remaining in built geometry.
export function countTJunctions(brushes) {
  const polys = collectPolygons(brushes);
  weldVertices(polys);
  fixTJunctions(polys);
  const before = polys.reduce((n, p) => n + p.verts.length, 0);
  fixTJunctions(polys); // a second pass must find nothing new
  return polys.reduce((n, p) => n + p.verts.length, 0) - before;
}

// Low-poly pine trees (render only; trunks are brushes).
export function buildTreeGeometry(decor) {
  const gb = new GeoBuilder();
  for (const d of decor) {
    if (d.type !== 'pine') continue;
    for (const [t, { base, top, r, rot }] of pineTiers(d).entries()) {
      const sides = PINE_SIDES;
      const apex = { x: d.x, y: top, z: d.z };
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2 + rot;
        const a1 = ((i + 1) / sides) * Math.PI * 2 + rot;
        const p0 = { x: d.x + Math.cos(a0) * r, y: base, z: d.z + Math.sin(a0) * r };
        const p1 = { x: d.x + Math.cos(a1) * r, y: base, z: d.z + Math.sin(a1) * r };
        const am = (a0 + a1) / 2;
        const slope = r / (top - base);
        const nl = Math.hypot(1, slope);
        const n = { x: Math.cos(am) / nl, y: slope / nl, z: Math.sin(am) / nl };
        const shade = 0.85 + hash3(d.x, t, i) * 0.3;
        const c = [shade, shade, shade];
        const cTop = [shade * 1.15, shade * 1.15, shade * 1.1];
        // two rows so no triangle is bigger than the affine fade distance (see ps1.js)
        const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
        const m0 = mid(p0, apex);
        const m1 = mid(p1, apex);
        const u0 = i / sides;
        const u1 = (i + 1) / sides;
        const ua = (i + 0.5) / sides;
        const cMid = c.map((v, k) => (v + cTop[k]) / 2);
        gb.vert(p0, n, u0, 0, c);
        gb.vert(m0, n, (u0 + ua) / 2, 0.7, cMid);
        gb.vert(p1, n, u1, 0, c);
        gb.vert(m0, n, (u0 + ua) / 2, 0.7, cMid);
        gb.vert(m1, n, (u1 + ua) / 2, 0.7, cMid);
        gb.vert(p1, n, u1, 0, c);
        gb.vert(m0, n, (u0 + ua) / 2, 0.7, cMid);
        gb.vert(apex, n, ua, 1.4, cTop);
        gb.vert(m1, n, (u1 + ua) / 2, 0.7, cMid);
        // underside
        const dn = { x: 0, y: -1, z: 0 };
        const cDark = [0.45, 0.45, 0.45];
        gb.vert(p1, dn, 1, 0, cDark);
        gb.vert({ x: d.x, y: base + 4, z: d.z }, dn, 0.5, 0.5, cDark);
        gb.vert(p0, dn, 0, 0, cDark);
      }
    }
  }
  return gb.build();
}

// Palm fronds (render only; trunks are brushes): drooping two-segment leaves around the top.
export function buildPalmGeometry(decor) {
  const gb = new GeoBuilder();
  const up = { x: 0, y: 1, z: 0 };
  for (const d of decor) {
    if (d.type !== 'palm') continue;
    const top = { x: d.x, y: d.h, z: d.z };
    const leaves = 8;
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2 + hash3(d.x, d.z, i) * 0.5;
      const dir = { x: Math.cos(a), z: Math.sin(a) };
      const side = { x: -dir.z, z: dir.x };
      const L = d.r * (0.85 + hash3(d.z, i, d.x) * 0.3);
      const mid = { x: top.x + dir.x * L * 0.5, y: top.y + 28, z: top.z + dir.z * L * 0.5 };
      const tip = { x: top.x + dir.x * L, y: top.y - 70, z: top.z + dir.z * L };
      const w = 30;
      const ml = { x: mid.x + side.x * w, y: mid.y, z: mid.z + side.z * w };
      const mr = { x: mid.x - side.x * w, y: mid.y, z: mid.z - side.z * w };
      const c0 = [0.75, 0.75, 0.75];
      const c1 = [1.05, 1.05, 1.05];
      gb.vert(top, up, 0.5, 0, c0);
      gb.vert(ml, up, 0, 0.5, c1);
      gb.vert(mr, up, 1, 0.5, c1);
      gb.vert(ml, up, 0, 0.5, c1);
      gb.vert(tip, up, 0.5, 1, c0);
      gb.vert(mr, up, 1, 0.5, c1);
    }
    // a few coconuts
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1;
      const p = { x: top.x + Math.cos(a) * 14, y: top.y - 12, z: top.z + Math.sin(a) * 14 };
      const brown = [0.45, 0.3, 0.25];
      gb.vert({ x: p.x, y: p.y + 10, z: p.z }, up, 0, 0, brown);
      gb.vert({ x: p.x + 9, y: p.y - 8, z: p.z }, up, 0, 0, brown);
      gb.vert({ x: p.x - 5, y: p.y - 8, z: p.z + 8 }, up, 0, 0, brown);
    }
  }
  return gb.build();
}

// The vaporwave sun: a disc of horizontal bands, the lower half sliced by widening gaps.
export function buildVaporSun({ x, y, z, r }) {
  const gb = new GeoBuilder();
  const n = { x: 1, y: 0, z: 0 };
  const top = [1.0, 0.98, 0.59];
  const mid = [1.0, 0.6, 0.55];
  const bot = [1.0, 0.44, 0.81];
  const color = (t) => (t < 0.5 ? top.map((v, i) => v + (mid[i] - v) * t * 2) : mid.map((v, i) => v + (bot[i] - v) * (t - 0.5) * 2));
  const BANDS = 26;
  for (let i = 0; i < BANDS; i++) {
    let y0 = r - (i / BANDS) * 2 * r;
    let y1 = r - ((i + 1) / BANDS) * 2 * r;
    if (y0 < 0) {
      // below the middle: cut a gap that grows toward the bottom
      const gap = (2 * r) / BANDS * Math.min(0.85, 0.15 + (-y0 / r) * 0.8);
      y1 += gap;
      if (y1 >= y0) continue;
    }
    const w0 = Math.sqrt(Math.max(0, r * r - y0 * y0));
    const w1 = Math.sqrt(Math.max(0, r * r - y1 * y1));
    const c0 = color(i / BANDS);
    const c1 = color((i + 1) / BANDS);
    const A = { x, y: y + y0, z: z - w0 };
    const B = { x, y: y + y0, z: z + w0 };
    const C = { x, y: y + y1, z: z + w1 };
    const D = { x, y: y + y1, z: z - w1 };
    for (const [p, c] of [
      [A, c0],
      [B, c0],
      [C, c1],
      [A, c0],
      [C, c1],
      [D, c1],
    ])
      gb.vert(p, n, 0, 0, c);
  }
  return gb.build();
}
