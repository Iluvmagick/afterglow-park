// PS1-style rendering: vertex snapping to the low-res pixel grid, affine (non perspective-
// correct) texture mapping, per-vertex Gouraud lighting, distance fog, and a final pass that
// upscales the tiny framebuffer with nearest filtering + 15-bit color ordered dithering.
//
// Affine mapping falls apart on triangles that get very close to (or cross behind) the camera,
// smearing into long streaks. So texture lookups blend from perspective-correct near the camera
// to fully affine further out: no smears when sliding along a floor, PS1 swim in the distance.
// uAffineNear must exceed the largest triangle size (world faces are cut into 128-unit cells).
//
// Water isn't a mesh: a translucent sheet a few units over or under a surface flickers against it
// (z-fighting) once the vertex snapping moves both by a few units. Instead, whatever you see through
// the water's surface tints itself by the water where your line of sight crosses the surface
// (WATER below), so there's nothing left for anything near the surface to flicker against.
import * as THREE from 'three';

export const WATER_POOLS = 4; // rectangles of water at a time (see setWater)

export const shared = {
  uRes: { value: new THREE.Vector2(320, 240) },
  uSnap: { value: 1 },
  // the wobble fades out with distance: far geometry snapping between pixels reads as flicker
  uSnapNear: { value: 500 },
  uSnapFar: { value: 2200 },
  uSunDir: { value: new THREE.Vector3(-0.55, 0.42, 0.72).normalize() },
  uSunColor: { value: new THREE.Color(1.0, 0.78, 0.55) },
  uAmbTop: { value: new THREE.Color(0.62, 0.6, 0.86) },
  uAmbBottom: { value: new THREE.Color(0.52, 0.42, 0.44) },
  uFogColor: { value: new THREE.Color(0.96, 0.66, 0.52) },
  uFogNear: { value: 900 },
  uFogFar: { value: 6800 },
  uTime: { value: 0 },
  uAffine: { value: 1 },
  uAffineNear: { value: 190 },
  uAffineFar: { value: 560 },
  // the water (see setWater); only on while the world is drawn, the sky and the gun have cameras of their own
  uWaterOn: { value: 0 },
  uWater: { value: Array.from({ length: WATER_POOLS }, () => new THREE.Vector4(1, 1, -1, -1)) },
  uWaterY: { value: new Array(WATER_POOLS).fill(0) },
  uWaterMap: { value: null },
  uWaterTint: { value: new THREE.Color(1, 1, 1) },
  uWaterOpacity: { value: 0 },
  uWaterScroll: { value: new THREE.Vector2(0.03, 0.017) },
};

// The water: pools [{ rect: [x0, z0, x1, z1], y }] (y: the surface), drawn with texture map (one repeat
// per 256 units) at the given tint and opacity.
export function setWater(pools, { map = null, tint = [1, 1, 1], opacity = 0 } = {}) {
  if (pools.length > WATER_POOLS) throw new Error(`at most ${WATER_POOLS} pools of water at a time, not ${pools.length}`);
  shared.uWater.value.forEach((v, i) => (pools[i] ? v.set(...pools[i].rect) : v.set(1, 1, -1, -1)));
  shared.uWaterY.value.forEach((_, i, ys) => (ys[i] = pools[i] ? pools[i].y : 0));
  shared.uWaterMap.value = map;
  shared.uWaterTint.value.setRGB(...tint);
  shared.uWaterOpacity.value = opacity;
}

// The water's surface over the pixel of world position p, seen from the camera: mixed over color c.
const WATER = /* glsl */ `
  uniform float uWaterOn;
  uniform vec4 uWater[${WATER_POOLS}];
  uniform float uWaterY[${WATER_POOLS}];
  uniform sampler2D uWaterMap;
  uniform vec3 uWaterTint;
  uniform float uWaterOpacity;
  uniform vec2 uWaterScroll;
  uniform float uTime;
  vec3 seenThroughWater(vec3 c, vec3 p) {
    float wet = 0.0;
    vec3 hit = p;
    for (int i = 0; i < ${WATER_POOLS}; i++) {
      float a = cameraPosition.y - uWaterY[i];
      float b = p.y - uWaterY[i];
      // where the line of sight crosses the surface's plane (or would, beyond p: then the texture
      // lookups stay continuous from pixel to pixel, so they get the same mipmaps the sheet got)
      hit = cameraPosition + (p - cameraPosition) * (a / (abs(a - b) > 1e-4 ? a - b : 1e-4));
      vec4 r = uWater[i];
      if (a * b < 0.0 && hit.x > r.x && hit.x < r.z && hit.z > r.y && hit.z < r.w) {
        wet = 1.0;
        break;
      }
    }
    vec3 w = texture2D(uWaterMap, hit.xz / 256.0 + uWaterScroll * uTime).rgb * uWaterTint;
    float fog = clamp((distance(hit, cameraPosition) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    // (lit colors go over 1: clamp first, as the framebuffer did under the old sheet)
    return mix(clamp(c, 0.0, 1.0), mix(w, uFogColor, fog), wet * uWaterOpacity);
  }
`;

const SNAP = /* glsl */ `
  if (uSnap > 0.0 && uSnapOn > 0.5 && clip.w > 0.0) {
    vec2 grid = uRes * 0.5 / uSnap;
    vec2 snapped = floor(clip.xy / clip.w * grid + 0.5) / grid * clip.w;
    clip.xy = mix(clip.xy, snapped, 1.0 - smoothstep(uSnapNear, uSnapFar, clip.w));
  }
`;

const VERT = /* glsl */ `
  uniform vec2 uRes;
  uniform float uSnap;
  uniform float uSnapOn;
  uniform float uSnapNear;
  uniform float uSnapFar;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbTop;
  uniform vec3 uAmbBottom;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uLit;
  uniform vec2 uUvScroll;
  uniform float uTime;
  varying vec3 vUvw;
  varying vec2 vUv;
  varying vec3 vCol;
  varying vec3 vView;
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz; // (where the surface really is, not where the snapping moved it)
    vec4 mv = viewMatrix * wp;
    vec4 clip = projectionMatrix * mv;
    ${SNAP}
    gl_Position = clip;
    vec2 suv = uv + uUvScroll * uTime;
    vUv = suv;
    // interpolating (uv*w, w) and dividing per pixel cancels the hardware's perspective correction
    vUvw = vec3(suv * clip.w, clip.w);
    vec3 light = vec3(1.0);
    if (uLit > 0.5) {
      vec3 n = normalize(mat3(modelMatrix) * normal);
      float ndl = max(dot(n, uSunDir), 0.0);
      light = mix(uAmbBottom, uAmbTop, n.y * 0.5 + 0.5) + uSunColor * ndl;
    }
    #ifdef USE_COLOR
      vCol = light * color;
    #else
      vCol = light;
    #endif
    vView = mv.xyz;
  }
`;

const DITHER = /* glsl */ `
  const float BAYER[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  float bayer(vec2 p) {
    ivec2 i = ivec2(mod(p, 4.0));
    return (BAYER[i.y * 4 + i.x] + 0.5) / 16.0;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float uHasMap;
  uniform vec3 uFogColor;
  uniform float uFog;
  uniform vec3 uTint;
  uniform float uOpacity;
  uniform float uBlend;
  uniform float uAffine;
  uniform float uAffineNear;
  uniform float uAffineFar;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vUvw;
  varying vec2 vUv;
  varying vec3 vCol;
  varying vec3 vView;
  varying vec3 vWorld;
  ${DITHER}
  ${WATER}
  void main() {
    if (uBlend < 0.5 && uOpacity < 0.999 && bayer(gl_FragCoord.xy) > uOpacity) discard;
    vec4 tex = vec4(1.0);
    if (uHasMap > 0.5) {
      // vUvw.z is the (perspective-correct) view depth of this pixel
      float k = uAffine * smoothstep(uAffineNear, uAffineFar, vUvw.z);
      tex = texture2D(map, mix(vUv, vUvw.xy / vUvw.z, k));
      if (tex.a < 0.5) discard;
    }
    vec3 c = tex.rgb * vCol * uTint;
    // fog per pixel, not per vertex: big faces (the Poolrooms' floors) would fog wrong otherwise
    float fog = clamp((length(vView) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    c = mix(c, uFogColor, fog * uFog);
    if (uWaterOn > 0.5) c = seenThroughWater(c, vWorld);
    gl_FragColor = vec4(c, uBlend > 0.5 ? uOpacity : 1.0);
  }
`;

// Chunky nearest-neighbour up close, but mipmapped in the distance: without mipmaps, far-away
// textures sparkle and shimmer as you move (the main source of flicker at long view distances).
export function makeTexture(canvas, { mipmaps = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = mipmaps;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function ps1Material(opts = {}) {
  const {
    map = null,
    lit = true,
    fog = true,
    tint = [1, 1, 1],
    opacity = 1,
    side = THREE.FrontSide,
    depthWrite = true,
    depthTest = true,
    snap = true,
    vertexColors = true,
    uvScroll = [0, 0],
    blend = false, // real alpha blending instead of screen-door dither (calmer when moving)
    overrides = {},
  } = opts;
  const uniforms = {
    ...shared,
    map: { value: map },
    uHasMap: { value: map ? 1 : 0 },
    uTint: { value: new THREE.Color(...tint) },
    uOpacity: { value: opacity },
    uBlend: { value: blend ? 1 : 0 },
    uLit: { value: lit ? 1 : 0 },
    uFog: { value: fog ? 1 : 0 },
    uSnapOn: { value: snap ? 1 : 0 },
    uUvScroll: { value: new THREE.Vector2(...uvScroll) },
    ...overrides,
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors,
    side,
    depthWrite: blend ? false : depthWrite,
    depthTest,
    transparent: blend,
  });
}

// Square, pixel-sized particles.
export function particleMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uSnapOn: { value: 1 } },
    vertexColors: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform vec2 uRes;
      uniform float uSnap;
      uniform float uSnapOn;
      uniform float uSnapNear;
      uniform float uSnapFar;
      uniform float uFogNear;
      uniform float uFogFar;
      attribute float size;
      varying vec3 vCol;
      varying float vFog;
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec4 clip = projectionMatrix * mv;
        ${SNAP}
        gl_Position = clip;
        gl_PointSize = max(1.0, floor(size * projectionMatrix[1][1] * uRes.y * 0.5 / max(clip.w, 1.0) + 0.5));
        vCol = color;
        vFog = clamp((length(mv.xyz) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec3 vCol;
      varying float vFog;
      varying vec3 vWorld;
      ${WATER}
      void main() {
        vec3 c = mix(vCol, uFogColor, vFog * 0.7);
        if (uWaterOn > 0.5) c = seenThroughWater(c, vWorld);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

export class PS1Post {
  constructor() {
    this.rt = new THREE.WebGLRenderTarget(320, 240, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rt.texture },
        uLowRes: { value: new THREE.Vector2(320, 240) },
        uDither: { value: 1 },
        uLevels: { value: 31 },
        uFlash: { value: 0 },
        uFlashColor: { value: new THREE.Color(1.0, 0.93, 0.75) },
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec2 uLowRes;
        uniform float uDither;
        uniform float uLevels;
        uniform float uFlash;
        uniform vec3 uFlashColor;
        varying vec2 vUv;
        ${DITHER}
        void main() {
          vec2 px = floor(vUv * uLowRes);
          vec3 c = texture2D(tScene, (px + 0.5) / uLowRes).rgb;
          c = mix(c, uFlashColor, uFlash);
          float t = uDither > 0.5 ? bayer(px) : 0.5;
          c = floor(clamp(c, 0.0, 1.0) * uLevels + t) / uLevels;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    this.scene = new THREE.Scene();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const tri = new THREE.Mesh(geo, this.material);
    tri.frustumCulled = false;
    this.scene.add(tri);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    this.rt.setSize(w, h);
    this.material.uniforms.uLowRes.value.set(w, h);
    shared.uRes.value.set(w, h);
  }

  present(renderer) {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
