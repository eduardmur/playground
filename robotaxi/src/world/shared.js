import * as THREE from 'three';
import { Noise2D, mulberry32 } from '../core/utils.js';

/**
 * Render layers. The mirror camera that renders the wet-road reflection only
 * sees MAIN, so rain, decals and the reflective surfaces themselves stay out of it.
 */
export const LAYER = { MAIN: 0, NOREFLECT: 1, WET: 2 };

/** Uniforms shared by every material that reacts to the weather and the hour. */
export const env = {
  uTime: { value: 0 },
  uNoise: { value: null }, // RGBA tiling scalar noise
  uNormalNoise: { value: null }, // tiling normal map
  uWet: { value: 0 }, // 0 dry .. 1 soaked
  uPuddle: { value: 0 }, // how much standing water
  uSnow: { value: 0 }, // snow cover
  uRain: { value: 0 }, // rain falling right now (ripples)
  uNight: { value: 0 }, // 0 day .. 1 night: windows light up
  uLamp: { value: 0 }, // street lamps
  uShop: { value: 0 }, // shop fronts and signs
  uLate: { value: 0 }, // deep night: fewer lit windows
  uFlash: { value: 0 }, // lightning
  uWind: { value: 0.2 },
  uReflect: { value: null },
  uReflectMatrix: { value: new THREE.Matrix4() },
  uReflectOn: { value: 0 },
  uCar: { value: new THREE.Vector3() }, // where the cab is, for rain culling and headlight glow
  uCarFwd: { value: new THREE.Vector3(0, 0, -1) },
  uHead: { value: 0 }, // our headlights
};

export function makeNoiseTexture(size = 256) {
  const a = new Noise2D(11), b = new Noise2D(23), c = new Noise2D(37);
  const rnd = mulberry32(5);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, (a.fbm(u * 6, v * 6, 5, 2, 0.5, 6) * 0.62 + 0.5) * 255));
      data[i + 1] = Math.max(0, Math.min(255, (b.fbm(u * 12, v * 12, 4, 2, 0.55, 12) * 0.62 + 0.5) * 255));
      data[i + 2] = rnd() * 255;
      data[i + 3] = Math.max(0, Math.min(255, (c.fbm(u * 24, v * 24, 3, 2, 0.6, 24) * 0.62 + 0.5) * 255));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** A tiling normal map: grainy aggregate on top of slow undulation. */
export function makeNormalNoiseTexture(size = 256) {
  const a = new Noise2D(71);
  const rnd = mulberry32(9);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      h[y * size + x] = a.fbm(u * 10, v * 10, 5, 2.1, 0.55, 10) * 0.9 + (rnd() - 0.5) * 0.55;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 1.6;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 1.6;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = (-dx / l * 0.5 + 0.5) * 255;
      data[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function initShared() {
  if (!env.uNoise.value) env.uNoise.value = makeNoiseTexture(256);
  if (!env.uNormalNoise.value) env.uNormalNoise.value = makeNormalNoiseTexture(256);
}

let patchId = 0;

/**
 * Splices GLSL into one of three's built-in lit materials, so custom surfaces
 * still get the standard lights, shadows, fog and environment reflections.
 *
 * Hooks (all optional strings of GLSL):
 *   vertexPars   declarations before main()
 *   vertex       after `transformed` exists; may change it. `vWPos` is set after this.
 *   fragPars     declarations before main()
 *   fragColor    after the base colour: edit diffuseColor
 *   fragSurface  edit roughnessFactor / metalnessFactor
 *   fragNormal   edit `normal` (view space)
 *   fragEmissive edit totalEmissiveRadiance
 *   fragFinal    edit outgoingLight just before it is written
 */
export function patchMaterial(material, hooks, uniforms = {}, defines = null, key = null) {
  const id = ++patchId;
  if (defines) material.defines = { ...(material.defines || {}), ...defines };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader;
    vs = vs.replace(
      'void main() {',
      `varying vec3 vWPos;\nvarying vec3 vWNormal;\n${hooks.vertexPars || ''}\nvoid main() {`,
    );
    vs = vs.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      ${hooks.vertex || ''}
      {
        vec4 wp_ = vec4(transformed, 1.0);
        vec3 wn_ = objectNormal;
        #ifdef USE_INSTANCING
          wp_ = instanceMatrix * wp_;
          wn_ = mat3(instanceMatrix) * wn_;
        #endif
        vWPos = (modelMatrix * wp_).xyz;
        vWNormal = normalize(mat3(modelMatrix) * wn_);
      }`,
    );
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = fs.replace(
      'void main() {',
      `varying vec3 vWPos;\nvarying vec3 vWNormal;\n${hooks.fragPars || ''}\nvoid main() {`,
    );
    if (hooks.fragColor) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n${hooks.fragColor}`);
    if (hooks.fragSurface) fs = fs.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${hooks.fragSurface}`);
    if (hooks.fragNormal) fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${hooks.fragNormal}`);
    if (hooks.fragEmissive) fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${hooks.fragEmissive}`);
    if (hooks.fragFinal) fs = fs.replace('#include <opaque_fragment>', `${hooks.fragFinal}\n#include <opaque_fragment>`);
    shader.fragmentShader = fs;
  };
  // materials patched the same way can name a shared key, and then share one compiled program
  material.customProgramCacheKey = () => key || `patch${id}`;
  return material;
}

/** GLSL shared by several shaders. */
export const GLSL_HASH = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
`;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function canvasTexture(canvas, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso;
  return tex;
}

/** Collects quads/boxes into one BufferGeometry with whatever extra attributes the caller needs. */
export class GeoBuilder {
  constructor(attrs = {}) {
    // attrs: { name: itemSize }
    this.pos = [];
    this.nor = [];
    this.idx = [];
    this.extra = {};
    this.sizes = attrs;
    for (const k of Object.keys(attrs)) this.extra[k] = [];
    this.count = 0;
  }

  /** One vertex. `vals` supplies the extra attributes by name. */
  vert(x, y, z, nx, ny, nz, vals) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    for (const k in this.extra) {
      const v = vals[k];
      const arr = this.extra[k];
      if (typeof v === 'number') arr.push(v);
      else for (let i = 0; i < this.sizes[k]; i++) arr.push(v[i]);
    }
    return this.count++;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  quadIdx(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    for (const k in this.extra) g.setAttribute(k, new THREE.Float32BufferAttribute(this.extra[k], this.sizes[k]));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
