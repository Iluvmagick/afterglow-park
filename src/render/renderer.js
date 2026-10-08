import * as THREE from 'three';
import { PS1Post, ps1Material, makeTexture, shared } from './ps1.js';
import { TEXTURES, MATERIALS } from './textures.js';
import { buildBrushGeometry, buildTreeGeometry, buildPalmGeometry } from './worldgeo.js';
import { Sky, FOG_COLOR } from './sky.js';
import { Particles } from './fx.js';
import { ViewModel } from './viewmodel.js';
import * as M from '../math.js';
import { WEAPON } from '../sim.js';

THREE.ColorManagement.enabled = false;

const ORB_COLORS = [
  [1, 0.9, 0.3],
  [1, 0.7, 0.2],
  [1, 1, 0.75],
];
const BOOM_COLORS = [
  [1, 0.85, 0.4],
  [1, 0.55, 0.15],
  [0.95, 0.3, 0.1],
  [0.4, 0.35, 0.35],
];

function flatColorGeo(geo, colorFn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const c = [];
  for (let i = 0; i < n; i += 3) {
    const col = colorFn(i / 3);
    for (let k = 0; k < 3; k++) c.push(...col);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}

export class GameRenderer {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.sim = sim;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    this.post = new PS1Post();
    this.settings = { lowHeight: 240, jitter: 1, dither: true, affine: true, fov: 95, speedFov: true, view: 24000 };

    shared.uFogColor.value.setRGB(...FOG_COLOR);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(95, 4 / 3, 4, 26000);
    this.camera.rotation.order = 'YXZ';
    this.textures = {};
    for (const [k, fn] of Object.entries(TEXTURES)) this.textures[k] = makeTexture(fn());
    this.sky = new Sky();
    this.view = new ViewModel(this.textures);
    this.particles = new Particles();
    this.scene.add(this.particles.points);

    this.materials = {};
    for (const [name, def] of Object.entries(MATERIALS)) {
      this.materials[name] = ps1Material({
        map: this.textures[def.tex],
        lit: !def.unlit,
        uvScroll: def.scroll || [0, 0],
        overrides: def.affine === false ? { uAffine: { value: 0 } } : {},
      });
    }
    this.buildWorld();
    this.buildEntities();
    this.buildObelisk();
    this.awakeShown = false;
    this.flash = 0;

    // camera feel state
    this.fovNow = this.settings.fov;
    this.roll = 0;
    this.dip = 0;
    this.dipVel = 0;
    this.bob = 0;
    this.fovKick = 0;
    this.lastYaw = 0;
    this.lastPitch = 0;
    this.shake = 0;
    this.time = 0;
    this.tmp = new THREE.Vector3();
    this.resize();
  }

  buildWorld() {
    for (const { name, geometry } of buildBrushGeometry(this.sim.level.brushes)) {
      const m = new THREE.Mesh(geometry, this.materials[name]);
      m.matrixAutoUpdate = false;
      this.scene.add(m);
    }
    const trees = new THREE.Mesh(buildTreeGeometry(this.sim.level.decor), this.materials.pine);
    trees.matrixAutoUpdate = false;
    this.scene.add(trees);
    const palmMat = ps1Material({ map: this.textures.palm, side: THREE.DoubleSide });
    const palms = new THREE.Mesh(buildPalmGeometry(this.sim.level.decor), palmMat);
    palms.matrixAutoUpdate = false;
    this.scene.add(palms);

  }

  buildEntities() {
    const sim = this.sim;
    // orbs
    const orbGeo = flatColorGeo(new THREE.OctahedronGeometry(15), (i) => (i % 2 ? [1, 0.82, 0.25] : [1, 0.95, 0.55]));
    const orbMat = ps1Material({ lit: false });
    this.orbMeshes = sim.orbs.map((o) => {
      const m = new THREE.Mesh(orbGeo, orbMat);
      m.position.set(o.pos.x, o.pos.y, o.pos.z);
      this.scene.add(m);
      return m;
    });
    // targets
    const tGeo = flatColorGeo(new THREE.IcosahedronGeometry(26, 0), (i) => (i % 2 ? [0.95, 0.2, 0.25] : [1, 0.95, 0.9]));
    const tMat = ps1Material({ lit: true });
    const ringGeo = new THREE.TorusGeometry(36, 2.5, 3, 12);
    const ringMat = ps1Material({ lit: false, tint: [1, 0.35, 0.35], vertexColors: false });
    this.targetMeshes = sim.targets.map((t) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(tGeo, tMat));
      const r = new THREE.Mesh(ringGeo, ringMat);
      r.rotation.x = Math.PI / 2;
      g.add(r);
      g.position.set(t.pos.x, t.pos.y, t.pos.z);
      this.scene.add(g);
      return g;
    });
    // boost rings
    const boostGeo = new THREE.TorusGeometry(96, 7, 4, 16);
    this.ringMat = ps1Material({ lit: false, tint: [0.4, 1, 0.95], vertexColors: false });
    const innerMat = ps1Material({ lit: false, tint: [0.7, 1, 1], vertexColors: false, opacity: 0.25, side: THREE.DoubleSide, blend: true });
    const styleMats = {
      obelisk: ps1Material({ lit: false, tint: [0.85, 0.55, 1], vertexColors: false }),
      elevator: ps1Material({ lit: false, tint: [1, 0.45, 0.85], vertexColors: false }),
      mega: ps1Material({ lit: false, tint: [1, 0.85, 0.35], vertexColors: false }),
    };
    this.ringMeshes = sim.rings.map((r) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(boostGeo, styleMats[r.style] || this.ringMat));
      g.scale.setScalar(r.radius / 96);
      g.add(new THREE.Mesh(new THREE.CircleGeometry(90, 16), innerMat));
      g.position.set(r.pos.x, r.pos.y, r.pos.z);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(r.axis.x, r.axis.y, r.axis.z));
      this.scene.add(g);
      return g;
    });
    // rockets
    this.rocketGeo = flatColorGeo(new THREE.OctahedronGeometry(5), (i) => (i % 2 ? [1, 0.9, 0.5] : [1, 0.5, 0.2]));
    this.rocketMat = ps1Material({ lit: false });
    this.rocketMeshes = new Map();
    // explosions
    this.boomGeo = flatColorGeo(new THREE.IcosahedronGeometry(1, 1), (i) => (i % 3 ? [1, 0.6, 0.2] : [1, 0.85, 0.4]));
    this.booms = [];
    // grapple
    this.hookMesh = new THREE.Mesh(flatColorGeo(new THREE.OctahedronGeometry(5), () => [0.9, 0.9, 1]), ps1Material({ lit: false }));
    this.hookMesh.visible = false;
    this.scene.add(this.hookMesh);
    const ropeGeo = new THREE.BufferGeometry();
    ropeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3 * 8), 3));
    this.rope = new THREE.Line(ropeGeo, ps1Material({ lit: false, tint: [0.95, 0.85, 0.7], vertexColors: false }));
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    this.scene.add(this.rope);
    // blob shadow
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(17, 8),
      ps1Material({ lit: false, tint: [0.1, 0.05, 0.12], vertexColors: false, opacity: 0.5, blend: true }),
    );
    this.shadow.material.polygonOffset = true;
    this.shadow.material.polygonOffsetFactor = -2;
    this.shadow.material.polygonOffsetUnits = -2;
    this.scene.add(this.shadow);
  }

  // Runes flowing up the obelisk's faces, a sky beam from the capstone, and drifting motes.
  buildObelisk() {
    const ob = this.sim.level.obelisk;
    if (!ob) return;
    const pos = [];
    const uv = [];
    const ROW = 128;
    const width = (y) => ob.hb + (ob.ht - ob.hb) * ((y - ob.base) / (ob.top - ob.base));
    for (let face = 0; face < 4; face++) {
      const a = (face * Math.PI) / 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      // local face frame: out = (sin a, cos a), across = (cos a, -sin a)
      const P = (s01, y) => {
        const w = width(y);
        const across = (s01 * 2 - 1) * w * 0.8;
        const out = w + 4; // far enough off the face to not depth-fight from across the park
        return [ob.x + sn * out + c * across, y, ob.z + c * out - sn * across];
      };
      for (let y = ob.base + 30; y < ob.top - 30; y += ROW) {
        const y1 = Math.min(y + ROW, ob.top - 30);
        const quad = [P(0, y), P(1, y), P(1, y1), P(0, y), P(1, y1), P(0, y1)];
        const uvs = [
          [1, (y - ob.base) / 256],
          [0, (y - ob.base) / 256],
          [0, (y1 - ob.base) / 256],
          [1, (y - ob.base) / 256],
          [0, (y1 - ob.base) / 256],
          [1, (y1 - ob.base) / 256],
        ];
        quad.forEach((q) => pos.push(...q));
        uvs.forEach((u) => uv.push(...u));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.runeMat = ps1Material({ map: this.textures.runes, lit: false, vertexColors: false, side: THREE.DoubleSide, tint: [0.45, 1, 0.95], uvScroll: [0, -0.12] });
    this.runeMat.polygonOffset = true;
    this.runeMat.polygonOffsetFactor = -2;
    this.runeMat.polygonOffsetUnits = -8;
    this.scene.add(new THREE.Mesh(g, this.runeMat));

    // sky beams: two crossed translucent planes rising from the capstone (and the pyramid)
    this.beamMat = ps1Material({ lit: false, fog: false, vertexColors: false, side: THREE.DoubleSide, opacity: 0.3, tint: [0.5, 1, 1], blend: true });
    this.beamCoreMat = ps1Material({ lit: false, fog: false, vertexColors: false, side: THREE.DoubleSide, opacity: 0.7, tint: [0.85, 1, 1], blend: true });
    const pyrMat = ps1Material({ lit: false, fog: false, vertexColors: false, side: THREE.DoubleSide, opacity: 0.35, tint: [1, 0.5, 0.9], blend: true });
    for (const b of this.sim.level.beams || []) {
      const mats = b.kind === 'obelisk' ? [[90, this.beamMat], [26, this.beamCoreMat]] : [[140, pyrMat]];
      for (const [w, mat] of mats) {
        for (const rot of [0, Math.PI / 2]) {
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, 12000, 1, 24), mat);
          plane.position.set(b.x, b.y + 6000, b.z);
          plane.rotation.y = rot;
          this.scene.add(plane);
        }
      }
    }
  }

  resize() {
    // fixedSize (used by the trailer recorder) pins the output resolution regardless of the window
    const dpr = this.fixedSize ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const w = this.fixedSize ? this.fixedSize.w : window.innerWidth;
    const h = this.fixedSize ? this.fixedSize.h : window.innerHeight;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const lowH = this.settings.lowHeight;
    const lowW = Math.max(1, Math.round((lowH * w) / h));
    this.lowW = lowW;
    this.lowH = lowH;
    this.post.setSize(lowW, lowH);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.view.setAspect(w / h);
  }

  applySettings(s) {
    Object.assign(this.settings, s);
    // view distance: how far the haze reaches (6000 is the classic PS1 murk)
    shared.uFogFar.value = this.settings.view;
    shared.uFogNear.value = this.settings.view * (this.settings.view <= 8000 ? 0.14 : 0.06); // keep a light haze
    this.camera.far = this.settings.view * 1.1 + 1500;
    shared.uSnap.value = this.settings.jitter ? (this.settings.lowHeight > 300 ? 2 : 1) : 0;
    shared.uAffine.value = this.settings.affine ? 1 : 0;
    this.post.material.uniforms.uDither.value = this.settings.dither ? 1 : 0;
    this.resize();
  }

  // --------------------------------------------------------------------- events
  onEvent(e) {
    const P = this.particles;
    switch (e.type) {
      case 'land':
        if (e.speed > 300) {
          this.dipVel -= Math.min(220, e.speed * 0.18);
          this.view.land(e.speed);
          const p = this.sim.player.pos;
          P.burst({ x: p.x, y: p.y + 2, z: p.z }, Math.min(24, Math.floor(e.speed / 40)), { speed: 160, life: 0.5, size: 5, colors: [[0.75, 0.68, 0.6], [0.6, 0.55, 0.5]], grav: 300, up: 60 });
        }
        break;
      case 'fire':
        this.view.fire();
        this.shake = Math.max(this.shake, 0.3);
        break;
      case 'explosion': {
        P.burst(e.pos, 50, { speed: 520, life: 0.7, size: 9, colors: BOOM_COLORS, grav: 150, drag: 3 });
        P.burst(e.pos, 16, { speed: 120, life: 1.4, size: 16, colors: [[0.35, 0.3, 0.32], [0.5, 0.45, 0.45]], grav: -60, drag: 1 });
        const m = new THREE.Mesh(this.boomGeo, ps1Material({ lit: false }));
        m.position.set(e.pos.x, e.pos.y, e.pos.z);
        this.scene.add(m);
        this.booms.push({ m, t: 0 });
        const d = M.dist(e.pos, this.sim.eye);
        this.shake = Math.max(this.shake, Math.max(0, 1 - d / 900) * 1.2);
        break;
      }
      case 'orb':
        P.burst(e.pos, 40, { speed: 380, life: 0.9, size: 7, colors: ORB_COLORS, grav: -40, drag: 2.5 });
        break;
      case 'target':
        P.burst(e.pos, 45, { speed: 450, life: 0.9, size: 8, colors: [[1, 0.25, 0.25], [1, 1, 1], [1, 0.6, 0.6]], grav: 500, drag: 1 });
        break;
      case 'pad':
        P.burst(e.pos, 30, { speed: 200, life: 0.8, size: 7, colors: [[1, 0.8, 0.3], [1, 0.6, 0.2]], grav: -200, up: 250, drag: 1 });
        this.fovKick = Math.max(this.fovKick, 6);
        break;
      case 'ring':
        P.burst(e.pos, 40, { speed: 300, life: 0.7, size: 7, colors: [[0.5, 1, 1], [1, 1, 1]], grav: 0, drag: 2 });
        this.fovKick = Math.max(this.fovKick, 10);
        break;
      case 'dash':
        this.fovKick = Math.max(this.fovKick, 8);
        break;
      case 'doubleJump': {
        const p = this.sim.player.pos;
        P.burst({ x: p.x, y: p.y, z: p.z }, 14, { speed: 140, life: 0.5, size: 6, colors: [[1, 1, 1], [0.7, 0.9, 1]], grav: 100, drag: 3 });
        break;
      }
      case 'wallJump':
        this.fovKick = Math.max(this.fovKick, 4);
        break;
      case 'slide':
        this.fovKick = Math.max(this.fovKick, 4);
        break;
      case 'hookAttach': {
        const h = this.sim.player.hook;
        if (h.anchor) P.burst(h.anchor, 12, { speed: 150, life: 0.4, size: 5, colors: [[1, 1, 0.8]], grav: 300 });
        break;
      }
      case 'respawn':
        this.dip = 0;
        this.dipVel = 0;
        break;
      case 'bounce': {
        const p = this.sim.player.pos;
        P.burst({ x: p.x, y: p.y + (e.wall ? 36 : 2), z: p.z }, 16, { speed: 220, life: 0.5, size: 6, colors: [[1, 0.45, 0.75], [1, 0.85, 0.95]], grav: 300, drag: 2 });
        this.dipVel -= e.wall ? 0 : 60;
        break;
      }
      case 'stick': {
        const p = this.sim.player.pos;
        P.burst({ x: p.x, y: p.y + 40, z: p.z }, 14, { speed: 160, life: 0.6, size: 6, colors: [[0.45, 0.9, 0.45], [0.75, 1, 0.65]], grav: 500, drag: 2 });
        break;
      }
      case 'surface':
        if (e.kind === 'boost') {
          const p = this.sim.player.pos;
          P.burst({ x: p.x, y: p.y + 4, z: p.z }, 14, { speed: 200, life: 0.4, size: 5, colors: [[0.5, 1, 1], [1, 1, 1]], grav: 0, drag: 3 });
          this.fovKick = Math.max(this.fovKick, 6);
        }
        break;
      case 'ascend':
        P.burst(e.pos, 160, { speed: 900, life: 1.8, size: 12, colors: [[1, 0.85, 0.35], [1, 1, 0.8], [0.5, 1, 1]], grav: 40, drag: 1.2 });
        P.burst(e.pos, 60, { speed: 300, life: 2.5, size: 18, colors: [[1, 0.9, 0.5]], grav: -60, drag: 0.8 });
        this.fovKick = Math.max(this.fovKick, 16);
        this.shake = Math.max(this.shake, 1);
        this.flash = 1;
        break;
    }
  }

  // --------------------------------------------------------------------- frame
  render(alpha, dt, look) {
    const sim = this.sim;
    const p = sim.player;
    this.time += dt;
    shared.uTime.value = this.time;

    const eye = M.lerp(sim.prevEye, sim.eye, alpha);
    const hs = M.hlen(p.vel);

    // landing dip spring + head bob
    this.dipVel += (-this.dip * 160 - this.dipVel * 16) * dt;
    this.dip += this.dipVel * dt;
    if (p.onGround && !p.sliding && hs > 30) this.bob += dt * (5.5 + 5 * Math.min(1, hs / 320));
    const bobAmt = p.onGround && !p.sliding ? Math.min(1, hs / 320) : 0;
    const bobY = Math.sin(this.bob * 2) * 1.6 * bobAmt;

    // roll: wallrun lean + gentle strafe roll
    const right = M.rightH(look.yaw);
    let rollTarget = -M.dot(p.vel, right) / 320 * 0.018;
    let wallSide = 0;
    if (p.wall.active && p.wall.normal) {
      wallSide = -M.dot(p.wall.normal, right);
      rollTarget += wallSide * 0.17;
    }
    if (p.sliding) rollTarget += 0.03;
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 7);

    // speed FOV
    let fovTarget = this.settings.fov;
    if (this.settings.speedFov) fovTarget += M.clamp((M.length(p.vel) - 350) / 1300, 0, 1) * 16;
    this.fovKick = Math.max(0, this.fovKick - dt * 30);
    this.fovNow += (fovTarget - this.fovNow) * Math.min(1, dt * 4);
    // horizontal fov setting -> vertical fov for three
    const hfov = ((this.fovNow + this.fovKick) * Math.PI) / 180;
    const vfov = (2 * Math.atan(Math.tan(hfov / 2) / this.camera.aspect) * 180) / Math.PI;
    this.camera.fov = vfov;
    this.camera.updateProjectionMatrix();

    this.shake = Math.max(0, this.shake - dt * 3);
    const sh = this.shake * this.shake;
    this.camera.position.set(
      eye.x + (Math.random() - 0.5) * sh * 4,
      eye.y + bobY + this.dip * 0.08 + (Math.random() - 0.5) * sh * 4,
      eye.z + (Math.random() - 0.5) * sh * 4,
    );
    this.camera.rotation.set(look.pitch, look.yaw, this.roll);
    this.camera.updateMatrixWorld();

    // viewmodel
    let dYaw = look.yaw - this.lastYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const dPitch = look.pitch - this.lastPitch;
    this.lastYaw = look.yaw;
    this.lastPitch = look.pitch;
    this.view.update(dt, { groundSpeed: hs, onGround: p.onGround, sliding: p.sliding, wallSide, dYaw, dPitch });
    this.view.setSpeed(hs);

    this.updateEntities(alpha, dt);
    this.particles.update(dt);
    this.sky.update(this.camera, this.time);

    this.flash = Math.max(0, this.flash - dt * 0.9);
    this.post.material.uniforms.uFlash.value = this.flash * this.flash;

    // passes: sky -> world -> viewmodel into the low-res target, then upscale + dither
    const r = this.renderer;
    r.setRenderTarget(this.post.rt);
    r.clear(true, true, true);
    r.render(this.sky.scene, this.sky.camera);
    r.clearDepth();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.view.scene, this.view.camera);
    this.post.present(r);
  }

  updateEntities(alpha, dt) {
    const sim = this.sim;
    const t = this.time;
    sim.orbs.forEach((o, i) => {
      const m = this.orbMeshes[i];
      m.visible = !o.taken;
      if (!m.visible) return;
      m.rotation.y = t * 2 + i;
      m.position.y = o.pos.y + Math.sin(t * 2.2 + i) * 6;
      if (Math.random() < dt * 3) {
        this.particles.spawn(o.pos.x + (Math.random() - 0.5) * 30, o.pos.y + (Math.random() - 0.5) * 30, o.pos.z + (Math.random() - 0.5) * 30, 0, 30, 0, 0.8, 4, ORB_COLORS[0], 0, 0);
      }
    });
    sim.targets.forEach((tg, i) => {
      const g = this.targetMeshes[i];
      g.visible = tg.alive;
      g.position.y = tg.pos.y + Math.sin(t * 1.3 + i * 2) * 8;
      g.rotation.y = t * 0.8 + i;
      g.children[1].rotation.z = t * 1.5;
    });
    this.ringMeshes.forEach((g, i) => {
      g.children[0].rotation.z = t * 1.2 + i;
    });
    const pulse = 0.85 + Math.sin(t * 6) * 0.15;
    this.materials.pad.uniforms.uTint.value.setRGB(pulse * 1.1, pulse, pulse * 0.9);
    // pad sparkles
    for (const pad of sim.pads) {
      if (Math.random() < dt * 8) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.random() * pad.radius;
        this.particles.spawn(pad.pos.x + Math.cos(a) * rr, pad.pos.y + 2, pad.pos.z + Math.sin(a) * rr, 0, 140 + Math.random() * 100, 0, 0.7, 5, [1, 0.75, 0.3], 0, 0);
      }
    }

    // rockets
    const alive = new Set();
    for (const rk of sim.rockets) {
      alive.add(rk.id);
      let m = this.rocketMeshes.get(rk.id);
      if (!m) {
        m = new THREE.Mesh(this.rocketGeo, this.rocketMat);
        this.scene.add(m);
        this.rocketMeshes.set(rk.id, m);
      }
      const pos = M.lerp(rk.prev, rk.pos, alpha);
      m.position.set(pos.x, pos.y, pos.z);
      m.rotation.set(t * 9, t * 7, 0);
      for (let k = 0; k < 2; k++) {
        this.particles.spawn(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40 + 20, (Math.random() - 0.5) * 40, 0.35, 6, k ? [1, 0.6, 0.2] : [0.7, 0.65, 0.65], 0, 1);
      }
    }
    for (const [id, m] of this.rocketMeshes) {
      if (!alive.has(id)) {
        this.scene.remove(m);
        this.rocketMeshes.delete(id);
      }
    }
    // explosion shells
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.t += dt;
      const k = b.t / 0.32;
      if (k >= 1) {
        this.scene.remove(b.m);
        b.m.material.dispose();
        this.booms.splice(i, 1);
        continue;
      }
      const s = 20 + (WEAPON.radius * 0.8 - 20) * Math.sqrt(k);
      b.m.scale.setScalar(s);
      b.m.material.uniforms.uOpacity.value = 1 - k;
    }

    // grapple
    const p = sim.player;
    const hk = p.hook;
    if (hk.state !== 'none' && hk.pos) {
      this.hookMesh.visible = true;
      this.hookMesh.position.set(hk.pos.x, hk.pos.y, hk.pos.z);
      this.rope.visible = true;
      const start = this.view.worldPoint(this.view.hookLocal, this.camera, this.tmp);
      const arr = this.rope.geometry.attributes.position.array;
      // a slightly sagging rope made of 8 points while flying, straight when taut
      const segs = 8;
      const sag = hk.state === 'attached' ? 0 : 20;
      const pts = [];
      for (let k = 0; k < segs; k++) {
        const u = k / (segs - 1);
        pts.push(start.x + (hk.pos.x - start.x) * u, start.y + (hk.pos.y - start.y) * u - Math.sin(u * Math.PI) * sag, start.z + (hk.pos.z - start.z) * u);
      }
      arr.set(pts);
      this.rope.geometry.setDrawRange(0, segs);
      this.rope.geometry.attributes.position.needsUpdate = true;
    } else {
      this.hookMesh.visible = false;
      this.rope.visible = false;
    }

    // obelisk: pulsing runes (gold once awakened), beam, rising motes; golden trail reward
    const ob = sim.level.obelisk;
    if (ob && this.runeMat) {
      const awake = sim.stats.awake;
      const pulse = 0.75 + 0.25 * Math.sin(t * 2.2);
      const base = awake ? [1, 0.78, 0.3] : [0.45, 1, 0.95];
      this.runeMat.uniforms.uTint.value.setRGB(base[0] * pulse, base[1] * pulse, base[2] * pulse);
      if (awake !== this.awakeShown) {
        this.awakeShown = awake;
        this.beamMat.uniforms.uTint.value.setRGB(...(awake ? [1, 0.82, 0.4] : [0.5, 1, 1]));
        this.beamCoreMat.uniforms.uTint.value.setRGB(...(awake ? [1, 0.95, 0.75] : [0.85, 1, 1]));
        this.beamMat.uniforms.uOpacity.value = awake ? 0.45 : 0.3;
      }
      const cam = this.camera.position;
      if (Math.hypot(cam.x - ob.x, cam.z - ob.z) < 6000) {
        for (let k = 0; k < 2; k++) {
          if (Math.random() > dt * 18) continue;
          const a = Math.random() * Math.PI * 2;
          const r = 200 + Math.random() * 900;
          const col = Math.random() < 0.5 ? [0.6, 1, 1] : awake ? [1, 0.85, 0.45] : [0.9, 0.7, 1];
          this.particles.spawn(ob.x + Math.cos(a) * r, Math.random() * 2600, ob.z + Math.sin(a) * r, 0, 40 + Math.random() * 50, 0, 4, 6, col, 0, 0);
        }
      }
    }
    const pv = sim.player.vel;
    if (sim.stats.awake && Math.hypot(pv.x, pv.y, pv.z) > 600) {
      const pp = sim.player.pos;
      for (let k = 0; k < 2; k++) {
        this.particles.spawn(pp.x + (Math.random() - 0.5) * 24, pp.y + 10 + Math.random() * 40, pp.z + (Math.random() - 0.5) * 24, 0, 20, 0, 0.6, 6, Math.random() < 0.5 ? [1, 0.85, 0.35] : [1, 1, 0.75], 0, 0);
      }
    }

    // blob shadow under the player
    const pos = M.lerp(sim.prevEye, sim.eye, alpha);
    const feet = { x: pos.x, y: p.pos.y + 1, z: pos.z };
    const tr = sim.world.trace(feet, { x: feet.x, y: feet.y - 3000, z: feet.z });
    if (tr.fraction < 1 && tr.normal && tr.normal.y > 0.3) {
      this.shadow.visible = true;
      const h = feet.y - tr.endpos.y;
      this.shadow.position.set(tr.endpos.x, tr.endpos.y + 0.5, tr.endpos.z);
      this.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(tr.normal.x, tr.normal.y, tr.normal.z));
      this.shadow.scale.setScalar(M.clamp(1 - h / 1500, 0.4, 1));
    } else this.shadow.visible = false;
  }
}
