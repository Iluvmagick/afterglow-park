// Tiny immutable-ish vector helpers. Vectors are plain {x, y, z} objects.
// World units are Quake-style (player is 32 wide, 72 tall), Y is up.

export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const clone = (a) => ({ x: a.x, y: a.y, z: a.z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const madd = (a, b, s) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const hlen = (a) => Math.sqrt(a.x * a.x + a.z * a.z);
export const dist = (a, b) => length(sub(a, b));
export const lerp = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function normalize(a) {
  const l = length(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}

// Horizontal (XZ) part of a vector, normalized. Returns null if ~zero.
export function hnorm(a) {
  const l = hlen(a);
  return l > 1e-6 ? { x: a.x / l, y: 0, z: a.z / l } : null;
}

// yaw 0 looks down -Z (three.js camera convention); positive pitch looks up.
export const viewDir = (yaw, pitch) => {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
};
export const forwardH = (yaw) => ({ x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) });
export const rightH = (yaw) => ({ x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) });

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
