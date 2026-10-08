// PS1-style rendering: vertex snapping to the low-res pixel grid, affine (non perspective-
// correct) texture mapping, per-vertex Gouraud lighting, distance fog, and a final pass that
// upscales the tiny framebuffer with nearest filtering + 15-bit color ordered dithering.
//
// Affine mapping falls apart on triangles that get very close to (or cross behind) the camera,
// smearing into long streaks. So texture lookups blend from perspective-correct near the camera
// to fully affine further out: no smears when sliding along a floor, PS1 swim in the distance.
// uAffineNear must exceed the largest triangle size (world faces are cut into 128-unit cells).
import * as THREE from 'three';

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
};

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
  varying float vFog;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
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
    vFog = clamp((length(mv.xyz) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
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
  varying vec3 vUvw;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vFog;
  ${DITHER}
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
    c = mix(c, uFogColor, vFog * uFog);
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
      void main() {
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
      varying vec3 vCol;
      varying float vFog;
      void main() {
        gl_FragColor = vec4(mix(vCol, uFogColor, vFog * 0.7), 1.0);
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
        varying vec2 vUv;
        ${DITHER}
        void main() {
          vec2 px = floor(vUv * uLowRes);
          vec3 c = texture2D(tScene, (px + 0.5) / uLowRes).rgb;
          c = mix(c, vec3(1.0, 0.93, 0.75), uFlash);
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
