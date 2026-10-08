// First-person "pulse launcher": a chunky Quake-style rocket launcher held dead center, drawn in
// its own scene so it never clips into walls. Bob, sway, recoil, muzzle flash and slide/wallrun
// tilts are all faked here.
import * as THREE from 'three';
import { ps1Material, makeTexture } from './ps1.js';
import { drawText, textWidth, speedColor } from '../hud.js';

const SCREEN_W = 64;
const SCREEN_H = 24;
const SCREEN_TILT = 0.61; // radians the speed screen leans back toward the player

// Non-indexed, flat-shaded copy with a solid vertex color (and uvs if missing).
function prep(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(color, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

// Cylinder lying along -z. rFront/rBack radii, centered at z.
function tube(rFront, rBack, len, sides, z, y = 0, x = 0, color = [1, 1, 1]) {
  const g = new THREE.CylinderGeometry(rFront, rBack, len, sides, 1, false, Math.PI / sides);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return prep(g, color);
}

function block(w, h, d, x, y, z, color = [1, 1, 1]) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return prep(g, color);
}

// Box leaned back by SCREEN_TILT, centered at (0, y, z).
function tilted(w, h, d, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(-SCREEN_TILT);
  g.translate(0, y, z);
  return prep(g, color);
}

function disc(r, sides, z, y, color) {
  const g = new THREE.CircleGeometry(r, sides, Math.PI / sides);
  g.translate(0, y, z);
  return prep(g, color);
}

function merge(geos) {
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['uv', 2],
    ['color', 3],
  ]) {
    const arrs = geos.map((g) => g.attributes[name].array);
    const data = new Float32Array(arrs.reduce((a, b) => a + b.length, 0));
    let o = 0;
    for (const a of arrs) {
      data.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  return out;
}

export class ViewModel {
  constructor(textures) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.5, 200);
    this.root = new THREE.Group();
    this.gun = new THREE.Group();
    this.root.add(this.gun);
    this.scene.add(this.root);

    // light from the upper left, in view space
    const viewLight = { uSunDir: { value: new THREE.Vector3(-0.45, 0.75, 0.5).normalize() } };
    const metalMat = ps1Material({ map: textures.launcher, fog: false, overrides: viewLight });
    const hazardMat = ps1Material({ map: textures.hazard, fog: false, overrides: viewLight });
    const plainMat = ps1Material({ fog: false, overrides: viewLight });
    const glowMat = ps1Material({ lit: false, fog: false });

    const dark = [0.62, 0.62, 0.7];
    // the launcher tube is the star of the show: barrel axis is y = 0, muzzle toward -z
    const metal = merge([
      tube(3.5, 3.5, 25, 8, -16.5),
      tube(3.5, 4.3, 5, 8, -2.5, 0, 0, dark), // flared rear
      tube(4.3, 4.3, 3.2, 8, -30, 0, 0, dark), // muzzle collar
      block(6, 4.4, 15, 0, -4.2, -9, [0.8, 0.78, 0.86]), // receiver under the tube
      block(1.3, 2.2, 3, 0, 4.1, -25.5, dark), // front sight
      block(2, 1.6, 2, 0, 3.6, -12, dark), // speed screen neck
      tilted(4.6, 2.2, 0.9, 4.7, -12, dark), // speed screen housing
      block(2.6, 2.6, 9, 0, -4.4, -22.5, [1.0, 0.82, 0.6]), // grapple launcher (brass)
    ]);
    const hazard = merge([tube(3.65, 3.65, 2.2, 8, -24)]);
    const plain = merge([
      disc(2.9, 8, -31.65, 0, [0.06, 0.04, 0.08]), // bore
      block(3.2, 1.2, 5, 0, -6.8, -11, [0.25, 0.2, 0.22]), // trigger guard-ish
    ]);
    const glow = merge([
      block(0.8, 1.4, 11, 3.6, 0.2, -15, [0.4, 1.0, 0.95]), // energy cells
      block(0.8, 1.4, 11, -3.6, 0.2, -15, [0.4, 1.0, 0.95]),
      block(2.8, 2.8, 1.2, 0, -4.4, -27.4, [1.0, 0.62, 0.2]), // hook claw tip
      disc(1.3, 8, -31.75, 0, [1.0, 0.55, 0.18]), // pulse core inside the bore
    ]);
    this.gun.add(
      new THREE.Mesh(metal, metalMat),
      new THREE.Mesh(hazard, hazardMat),
      new THREE.Mesh(plain, plainMat),
      new THREE.Mesh(glow, glowMat),
    );

    // speedometer screen: a tiny canvas drawn with the HUD font, glowing on top of the launcher
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = SCREEN_W;
    screenCanvas.height = SCREEN_H;
    this.screenCtx = screenCanvas.getContext('2d');
    this.screenTex = makeTexture(screenCanvas, { mipmaps: false });
    const screenGeo = new THREE.PlaneGeometry(3.9, 1.46);
    screenGeo.rotateX(-SCREEN_TILT);
    const n = new THREE.Vector3(0, Math.sin(SCREEN_TILT), Math.cos(SCREEN_TILT));
    screenGeo.translate(0, 4.7 + n.y * 0.47, -12 + n.z * 0.47);
    // drawn last and without depth testing: it sits a hair in front of its housing, and depth
    // fighting + vertex snapping made it flicker. Nothing on the gun can cover it anyway.
    const screen = new THREE.Mesh(
      screenGeo,
      ps1Material({ map: this.screenTex, lit: false, fog: false, vertexColors: false, depthTest: false, depthWrite: false }),
    );
    screen.renderOrder = 10;
    this.gun.add(screen);
    this.shownSpeed = -1;
    this.setSpeed(0);

    // muzzle flash: two stacked octagons that pop for a few frames
    const flashGeo = merge([disc(6.5, 8, 0, 0, [1.0, 0.6, 0.15]), disc(3.4, 8, 0.2, 0, [1.0, 0.95, 0.7])]);
    this.flash = new THREE.Mesh(flashGeo, ps1Material({ lit: false, fog: false, depthWrite: false }));
    this.flash.position.set(0, 0, -33);
    this.flash.visible = false;
    this.gun.add(this.flash);

    // dead center and low, tilted up a touch so the muzzle points at the crosshair
    this.gun.position.set(0, -8.6, -6);
    this.gun.rotation.x = 0.06;
    this.muzzleLocal = new THREE.Vector3(0, 0, -33);
    this.hookLocal = new THREE.Vector3(0, -4.4, -28);

    this.bobPhase = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.recoil = 0;
    this.flashT = 0;
    this.dip = 0;
    this.dipVel = 0;
    this.tilt = 0;
    this.lower = 0;
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  setSpeed(hs) {
    const v = Math.round(hs);
    if (v === this.shownSpeed) return;
    this.shownSpeed = v;
    const ctx = this.screenCtx;
    ctx.fillStyle = '#0a1418';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    ctx.fillStyle = '#10222a';
    for (let y = 0; y < SCREEN_H; y += 2) ctx.fillRect(0, y, SCREEN_W, 1);
    const col = speedColor(v);
    const str = String(v);
    const sc = str.length > 4 ? 1 : 2;
    drawText(ctx, str, Math.floor((SCREEN_W - textWidth(str, sc)) / 2), sc === 2 ? 2 : 6, col, sc, '#000000');
    ctx.fillStyle = '#1c3036';
    ctx.fillRect(4, 19, SCREEN_W - 8, 3);
    ctx.fillStyle = col;
    ctx.fillRect(4, 19, Math.round((SCREEN_W - 8) * Math.min(1, v / 1500)), 3);
    this.screenTex.needsUpdate = true;
  }

  fire() {
    this.recoil = 1;
    this.flashT = 0.07;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  land(speed) {
    this.dipVel -= Math.min(60, speed * 0.05);
  }

  update(dt, s) {
    // s: { groundSpeed, onGround, sliding, wallSide, dYaw, dPitch }
    const k = Math.min(1, s.groundSpeed / 320);
    if (s.onGround && !s.sliding) this.bobPhase += dt * (6 + 6 * k);
    const bobAmt = s.onGround && !s.sliding ? k : 0;
    this.swayX += (-s.dYaw * 30 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (s.dPitch * 30 - this.swayY) * Math.min(1, dt * 10);
    this.swayX = Math.max(-3, Math.min(3, this.swayX));
    this.swayY = Math.max(-3, Math.min(3, this.swayY));
    this.recoil = Math.max(0, this.recoil - dt * 3.5);
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    // spring for landing dip
    this.dipVel += (-this.dip * 120 - this.dipVel * 14) * dt;
    this.dip += this.dipVel * dt;
    const tiltTarget = s.wallSide * 0.2 + (s.sliding ? 0.12 : 0);
    this.tilt += (tiltTarget - this.tilt) * Math.min(1, dt * 8);
    this.lower += ((s.sliding ? 1 : 0) - this.lower) * Math.min(1, dt * 8);

    // Quake-ish: the gun bobs up/down and pumps forward/back as you run
    const r = this.recoil * this.recoil;
    this.root.position.set(
      Math.sin(this.bobPhase) * 0.6 * bobAmt + this.swayX,
      -Math.abs(Math.cos(this.bobPhase)) * 0.8 * bobAmt + this.swayY + this.dip * 0.06 - this.lower * 1.6,
      Math.cos(this.bobPhase * 2) * 0.6 * bobAmt + r * 5 + this.lower * 2,
    );
    this.root.rotation.set(r * 0.16, 0, this.tilt);
  }

  // Approximate world positions of muzzle / hook launcher (main camera space ~ viewmodel space).
  worldPoint(local, mainCamera, out) {
    out.copy(local);
    this.gun.localToWorld(out);
    return mainCamera.localToWorld(out);
  }
}
