// Swept axis-aligned box vs convex brush traces (a port of Quake 3's CM_ClipBoxToBrush),
// with a 2D uniform grid for broadphase.

export const SURFACE_CLIP_EPSILON = 0.125;
const ZERO = { x: 0, y: 0, z: 0 };
const CELL = 512;

export class World {
  constructor(brushes) {
    this.brushes = brushes;
    this.grid = new Map();
    this.stamp = 0;
    brushes.forEach((b, i) => {
      b.index = i;
      b.mark = 0;
      if (b.noclip) return;
      const x0 = Math.floor(b.mins.x / CELL);
      const x1 = Math.floor(b.maxs.x / CELL);
      const z0 = Math.floor(b.mins.z / CELL);
      const z1 = Math.floor(b.maxs.z / CELL);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const k = x * 65536 + z;
          let cell = this.grid.get(k);
          if (!cell) this.grid.set(k, (cell = []));
          cell.push(b);
        }
      }
    });
  }

  // Trace a box (mins/maxs relative to the origin) from start to end.
  // Returns { fraction, endpos, normal, startsolid, allsolid, brush }.
  trace(start, end, mins = ZERO, maxs = ZERO) {
    const tr = { fraction: 1, endpos: null, normal: null, startsolid: false, allsolid: false, brush: null };
    const bx0 = Math.min(start.x, end.x) + mins.x - 1;
    const by0 = Math.min(start.y, end.y) + mins.y - 1;
    const bz0 = Math.min(start.z, end.z) + mins.z - 1;
    const bx1 = Math.max(start.x, end.x) + maxs.x + 1;
    const by1 = Math.max(start.y, end.y) + maxs.y + 1;
    const bz1 = Math.max(start.z, end.z) + maxs.z + 1;
    const stamp = ++this.stamp;
    const cx0 = Math.floor(bx0 / CELL);
    const cx1 = Math.floor(bx1 / CELL);
    const cz0 = Math.floor(bz0 / CELL);
    const cz1 = Math.floor(bz1 / CELL);
    outer: for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const cell = this.grid.get(cx * 65536 + cz);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const b = cell[i];
          if (b.mark === stamp) continue;
          b.mark = stamp;
          if (b.maxs.x < bx0 || b.mins.x > bx1 || b.maxs.y < by0 || b.mins.y > by1 || b.maxs.z < bz0 || b.mins.z > bz1) continue;
          clipBoxToBrush(start, end, mins, maxs, b, tr);
          if (tr.allsolid) break outer;
        }
      }
    }
    if (tr.fraction === 1) tr.endpos = { x: end.x, y: end.y, z: end.z };
    else {
      const f = tr.fraction;
      tr.endpos = {
        x: start.x + (end.x - start.x) * f,
        y: start.y + (end.y - start.y) * f,
        z: start.z + (end.z - start.z) * f,
      };
    }
    return tr;
  }

  // True if a box at pos does not overlap any solid.
  boxFree(pos, mins, maxs) {
    return !this.trace(pos, pos, mins, maxs).startsolid;
  }
}

function clipBoxToBrush(start, end, mins, maxs, b, tr) {
  let enterFrac = -1;
  let leaveFrac = 1;
  let clip = null;
  let getout = false;
  let startout = false;
  const planes = b.planes;
  for (let i = 0; i < planes.length; i++) {
    const pl = planes[i];
    const n = pl.n;
    // push the plane out by the box support in the -n direction
    const ofs =
      (n.x < 0 ? maxs.x : mins.x) * n.x + (n.y < 0 ? maxs.y : mins.y) * n.y + (n.z < 0 ? maxs.z : mins.z) * n.z;
    const dist = pl.d - ofs;
    const d1 = start.x * n.x + start.y * n.y + start.z * n.z - dist;
    const d2 = end.x * n.x + end.y * n.y + end.z * n.z - dist;
    if (d2 > 0) getout = true;
    if (d1 > 0) startout = true;
    // completely in front of face, no intersection with the entire brush
    if (d1 > 0 && (d2 >= SURFACE_CLIP_EPSILON || d2 >= d1)) return;
    // completely behind this plane
    if (d1 <= 0 && d2 <= 0) continue;
    if (d1 > d2) {
      // entering
      let f = (d1 - SURFACE_CLIP_EPSILON) / (d1 - d2);
      if (f < 0) f = 0;
      if (f > enterFrac) {
        enterFrac = f;
        clip = pl;
      }
    } else {
      // leaving
      let f = (d1 + SURFACE_CLIP_EPSILON) / (d1 - d2);
      if (f > 1) f = 1;
      if (f < leaveFrac) leaveFrac = f;
    }
  }
  if (!startout) {
    tr.startsolid = true;
    if (!getout) {
      tr.allsolid = true;
      tr.fraction = 0;
      tr.brush = b;
    }
    return;
  }
  if (enterFrac < leaveFrac && enterFrac > -1) {
    const f = enterFrac < 0 ? 0 : enterFrac;
    // on an exact tie (e.g. a trampoline flush with the floor) the special surface wins
    if (f < tr.fraction || (f === tr.fraction && b.phys && !(tr.brush && tr.brush.phys))) {
      tr.fraction = f;
      tr.normal = clip.n;
      tr.brush = b;
    }
  }
}
