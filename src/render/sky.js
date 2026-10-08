// Sunset skybox drawn in its own tiny scene around a camera at the origin.
import * as THREE from 'three';
import { ps1Material, particleMaterial, shared } from './ps1.js';
import { buildVaporSun } from './worldgeo.js';
import { mulberry32 } from '../math.js';

const STOPS = [
  [-1.0, 0x6e4a5e],
  [-0.06, 0xd98f7e],
  [0.0, 0xf6a986],
  [0.06, 0xf39a8a],
  [0.18, 0xd07aa0],
  [0.4, 0x8a66ac],
  [0.7, 0x4a4888],
  [1.0, 0x262c62],
];

function c3(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

export function skyColor(y) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [y0, h0] = STOPS[i];
    const [y1, h1] = STOPS[i + 1];
    if (y <= y1) {
      const t = Math.max(0, (y - y0) / (y1 - y0));
      const a = c3(h0);
      const b = c3(h1);
      return a.map((v, k) => v + (b[k] - v) * t);
    }
  }
  return c3(STOPS[STOPS.length - 1][1]);
}

export const FOG_COLOR = c3(0xf6a986);

export class Sky {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(90, 1, 1, 2000);
    this.camera.rotation.order = 'YXZ';
    const rand = mulberry32(99);

    // dome
    const dome = new THREE.SphereGeometry(500, 24, 16);
    const pos = dome.attributes.position;
    const col = [];
    for (let i = 0; i < pos.count; i++) col.push(...skyColor(pos.getY(i) / 500));
    dome.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.scene.add(new THREE.Mesh(dome, ps1Material({ lit: false, fog: false, side: THREE.BackSide, depthWrite: false })));

    // sun
    const sd = shared.uSunDir.value;
    const sunGroup = new THREE.Group();
    sunGroup.position.copy(sd).multiplyScalar(440);
    sunGroup.lookAt(0, 0, 0);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(70, 12),
      ps1Material({ lit: false, fog: false, tint: [1, 0.8, 0.6], opacity: 0.35, vertexColors: false, blend: true }),
    );
    const disc = new THREE.Mesh(new THREE.CircleGeometry(30, 12), ps1Material({ lit: false, fog: false, tint: [1, 0.96, 0.8], vertexColors: false, depthWrite: false }));
    disc.position.z = 1;
    sunGroup.add(glow, disc);
    this.scene.add(sunGroup);

    // the vaporwave sun, low in the west behind the megacity
    {
      const dir = new THREE.Vector3(-1, 0.13, 0.12).normalize();
      const sun = new THREE.Mesh(buildVaporSun({ x: 0, y: 0, z: 0, r: 105 }), ps1Material({ lit: false, fog: false, side: THREE.DoubleSide, depthWrite: false }));
      sun.position.copy(dir).multiplyScalar(450);
      sun.lookAt(0, 0, 0);
      sun.rotateY(-Math.PI / 2); // the disc is built facing +x
      sun.renderOrder = 1;
      this.scene.add(sun);
    }
    // stars near the zenith
    const sp = [];
    const sc = [];
    const ss = [];
    for (let i = 0; i < 120; i++) {
      const y = 0.45 + rand() * 0.55;
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      sp.push(Math.cos(a) * r * 480, y * 480, Math.sin(a) * r * 480);
      const b = 0.55 + rand() * 0.45 * y;
      sc.push(b, b, b * 1.05);
      ss.push(1);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    sg.setAttribute('size', new THREE.Float32BufferAttribute(ss, 1));
    const starMat = particleMaterial();
    starMat.uniforms = { ...starMat.uniforms, uFogNear: { value: 1e5 }, uFogFar: { value: 2e5 } };
    this.scene.add(new THREE.Points(sg, starMat));

    // mountain rings (far = hazier)
    // draw order (nothing in the sky writes depth): dome, suns + stars, mountains, clouds
    for (const m of [this.mountains(rand, 470, 0.06, 0.16, 0xa0708e, 0.55, 64), this.mountains(rand, 440, 0.03, 0.1, 0x6a4a6e, 0.3, 48)]) {
      m.renderOrder = 2;
      this.scene.add(m);
    }

    // clouds
    // all clouds merged into one mesh (one draw call)
    const cloudMat = ps1Material({ lit: false, fog: false, depthWrite: false });
    const cloudPos = [];
    const cloudCol = [];
    const tmp = new THREE.Object3D();
    for (let i = 0; i < 16; i++) {
      const g = new THREE.OctahedronGeometry(1, 1);
      const p = g.attributes.position;
      const cc = [];
      for (let k = 0; k < p.count; k++) {
        const top = p.getY(k) > 0;
        cc.push(...(top ? [1.0, 0.86, 0.82] : [0.86, 0.6, 0.7]));
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
      const a = rand() * Math.PI * 2;
      const el = 0.06 + rand() * 0.25;
      const r = 400;
      tmp.position.set(Math.cos(a) * r, el * r, Math.sin(a) * r);
      tmp.scale.set(30 + rand() * 50, 6 + rand() * 6, 18 + rand() * 20);
      tmp.lookAt(0, tmp.position.y, 0);
      tmp.updateMatrix();
      g.applyMatrix4(tmp.matrix);
      cloudPos.push(...g.attributes.position.array);
      cloudCol.push(...g.attributes.color.array);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cloudPos, 3));
    cg.setAttribute('color', new THREE.Float32BufferAttribute(cloudCol, 3));
    this.clouds = new THREE.Mesh(cg, cloudMat);
    this.clouds.renderOrder = 3;
    this.scene.add(this.clouds);
  }

  mountains(rand, radius, minH, maxH, hex, haze, segs) {
    const base = c3(hex);
    const fogc = FOG_COLOR;
    const pos = [];
    const col = [];
    const heights = [];
    for (let i = 0; i < segs; i++) heights.push(minH + rand() * (maxH - minH) * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.37))));
    const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
    const lowC = mix(base, fogc, haze + 0.2);
    const topC = mix(mix(base, [1, 0.9, 0.85], 0.25), fogc, haze);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const h0 = heights[i] * radius;
      const h1 = heights[(i + 1) % segs] * radius;
      const p = (a, y) => [Math.cos(a) * radius, y, Math.sin(a) * radius];
      // quad as two triangles facing the center
      const A = p(a0, -20);
      const B = p(a1, -20);
      const C = p(a1, h1);
      const D = p(a0, h0);
      pos.push(...A, ...C, ...B, ...A, ...D, ...C);
      col.push(...lowC, ...topC, ...lowC, ...lowC, ...topC, ...topC);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Mesh(g, ps1Material({ lit: false, fog: false, side: THREE.DoubleSide, depthWrite: false }));
  }

  update(mainCamera, time) {
    this.camera.quaternion.copy(mainCamera.quaternion);
    this.camera.fov = mainCamera.fov;
    this.camera.aspect = mainCamera.aspect;
    this.camera.updateProjectionMatrix();
    this.clouds.rotation.y = time * 0.004;
  }
}
