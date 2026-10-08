// CPU particle pool rendered as chunky square points.
import * as THREE from 'three';
import { particleMaterial } from './ps1.js';

export class Particles {
  constructor(max = 4000) {
    this.max = max;
    this.n = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3);
    this.s = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.setAttribute('size', this.sizeAttr);
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, particleMaterial());
    this.points.frustumCulled = false;
  }

  spawn(x, y, z, vx, vy, vz, life, size, col, grav = 0, drag = 0) {
    let i = this.n;
    if (i >= this.max) i = Math.floor(Math.random() * this.max);
    else this.n++;
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    this.c[i * 3] = col[0];
    this.c[i * 3 + 1] = col[1];
    this.c[i * 3 + 2] = col[2];
    this.s[i] = this.s0[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  burst(pos, count, { speed = 300, life = 0.6, size = 6, colors = [[1, 1, 1]], grav = 400, drag = 1.5, up = 0, spread = 1 } = {}) {
    for (let k = 0; k < count; k++) {
      let x = Math.random() * 2 - 1;
      let y = Math.random() * 2 - 1;
      let z = Math.random() * 2 - 1;
      const l = Math.hypot(x, y, z) || 1;
      const sp = speed * (0.4 + Math.random() * 0.6);
      x = (x / l) * sp * spread;
      y = (y / l) * sp * spread + up;
      z = (z / l) * sp * spread;
      const col = colors[Math.floor(Math.random() * colors.length)];
      this.spawn(pos.x, pos.y, pos.z, x, y, z, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.7), col, grav, drag);
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.n;
        if (i !== last) this.copy(last, i);
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i * 3 + 1] -= this.grav[i] * dt;
      this.v[i * 3] *= d;
      this.v[i * 3 + 1] *= d;
      this.v[i * 3 + 2] *= d;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.s[i] = this.s0[i] * Math.sqrt(this.life[i] / this.maxLife[i]);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  copy(from, to) {
    for (const arr of [this.p, this.v, this.c]) {
      arr[to * 3] = arr[from * 3];
      arr[to * 3 + 1] = arr[from * 3 + 1];
      arr[to * 3 + 2] = arr[from * 3 + 2];
    }
    for (const arr of [this.s, this.s0, this.life, this.maxLife, this.grav, this.drag]) arr[to] = arr[from];
  }
}
