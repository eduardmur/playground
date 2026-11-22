// Forest. Every tree's place comes from a hash of the 4 m cell it stands in, worked out in the
// vertex shader, so there is nothing to generate or store: three rings of tiles follow the camera,
// detailed spruces near by, plainer ones further out. A distant tree is always one of the near
// ones (the lowest hash among its neighbours), so trees thin out with distance without moving.
import * as THREE from 'three';
import { CLIPMAP, type TerrainBake } from './bake';
import { ATMOS, type Atmosphere } from './atmosphere';
import { LANDLIGHT } from './terrain';
import { HASH } from './glsl/lib';
import { mulberry } from './noisetex';
import { Pass } from '../render/fsq';
import { CLOUDS } from './clouds';

const TILE_CELLS = 16;
/** cell size (m), how far the ring reaches (m) */
export const RINGS = [
  { cell: 4, far: 300 },
  { cell: 8, far: 1100 },
  { cell: 16, far: 3600 },
];

// Where each tree of a tile stands is worked out once, when the tile comes into use, and kept in a
// small texture: a texel to a cell. Drawing a tree then costs two lookups a vertex, not forty hashes.
const PLACE_FRAG = /* glsl */ `
layout(location = 0) out vec4 oA;   // x in the tile, ground height, z in the tile, whole metres of height + density (0: no tree)
layout(location = 1) out vec4 oB;   // turn, girth, tint, kept in the next ring out (0.5) and the one after (0.25)
${HASH}
${CLIPMAP}
uniform float uCell;
uniform int uRing;
uniform vec2 uTileLocal;
uniform ivec2 uSlotTexel;

ivec2 best(ivec2 c2) {
  uint a = hash2(c2, 900u), b = hash2(c2 + ivec2(1, 0), 900u), c = hash2(c2 + ivec2(0, 1), 900u), d = hash2(c2 + ivec2(1, 1), 900u);
  uint m = min(min(a, b), min(c, d));
  return m == a ? ivec2(0, 0) : m == b ? ivec2(1, 0) : m == c ? ivec2(0, 1) : ivec2(1, 1);
}

void main() {
  int per = int(64.0 / uCell);
  ivec2 c = ivec2(floor(uTileLocal / uCell + 0.5)) + (ivec2(gl_FragCoord.xy) - uSlotTexel) + uOrigin64 * per;
  for (int j = 0; j < uRing; j++) c = c * 2 + best(c * 2);
  uint h = hash2(c, 900u);
  float u = u01(h);
  uint h2 = hash32(h ^ 0x68E31DA4u), h3 = hash32(h2 + 0x1B56C4E9u);
  vec2 pw = (vec2(c - uOrigin64 * 16) + 0.12 + 0.76 * vec2(u01(h2), u01(h3))) * 4.0;
  vec4 M = clipSample(tM, pw);
  oA = vec4(0.0); oB = vec4(0.0);
  if (u >= M.r * 0.62) return;
  ivec2 par = c >> 1;
  bool kept1 = par * 2 + best(par * 2) == c;
  ivec2 par2 = par >> 1;
  bool kept2 = kept1 && (par2 * 2 + best(par2 * 2) == par);
  float ground = heightAt(pw);
  float kind = u01(hash32(h3 + 5u));
  float size = mix(13.0, 31.0, kind * kind) * (1.0 - 0.35 * smoothstep(1700.0, 2100.0, ground));
  oA = vec4(pw.x - uTileLocal.x, ground, pw.y - uTileLocal.y, floor(size) + clamp(M.r, 0.0, 0.98));
  oB = vec4(u, u01(hash32(h3 + 9u)), u01(hash32(h3 + 13u)), (kept1 ? 0.5 : 0.0) + (kept2 ? 0.25 : 0.0));
}`;

const VERT = /* glsl */ `
${ATMOS}
${CLIPMAP}
uniform sampler2D tNoise;
${CLOUDS}
uniform float uSunPrimary;
attribute vec2 iCell;
attribute vec3 aShade;     // x: 0 inside the crown .. 1 at the tips; y: 0 needles, 1 trunk; z: tier phase
uniform highp sampler2D tTreeA;
uniform sampler2D tTreeB;
uniform float uDim;
uniform vec3 uRange;       // from, to, - (metres from the camera)
uniform vec3 uCam;
varying vec3 vPos;
varying vec3 vN;
varying vec4 vShade;       // tip, trunk, height in the tree, forest density
varying vec3 vLight;       // baked shadow, sky, tint
varying float vFade;
varying vec2 vUv;
varying vec3 vTr;
varying vec3 vIns;
varying vec3 vSunL;
varying vec3 vMoonL;

void main() {
  float slot = modelMatrix[3].y;
  ivec2 st = ivec2(int(mod(slot, uDim)), int(floor(slot / uDim))) * ${TILE_CELLS} + ivec2(iCell);
  vec4 A = texelFetch(tTreeA, st, 0);
  vec2 pw = modelMatrix[3].xz + A.xz;
  float dist = length(pw - uCam.xz);
  if (A.w < 1.0 || dist < uRange.x || dist >= uRange.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 B = texelFetch(tTreeB, st, 0);
  bool kept1 = B.a > 0.45, kept2 = fract(B.a * 2.0) > 0.45;
  float r0 = ${RINGS[0].far.toFixed(1)}, r1 = ${RINGS[1].far.toFixed(1)}, r2 = ${RINGS[2].far.toFixed(1)};
  float sc = 1.0;
  if (!kept1) sc *= 1.0 - smoothstep(0.6 * r0, 0.95 * r0, dist);
  else sc *= 1.0 + 0.25 * smoothstep(0.6 * r0, 0.95 * r0, dist);
  if (!kept2) sc *= 1.0 - smoothstep(0.6 * r1, 0.95 * r1, dist);
  else sc *= 1.0 + 0.25 * smoothstep(0.6 * r1, 0.95 * r1, dist);
  sc *= 1.0 - smoothstep(0.82 * r2, r2, dist);
  if (sc < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  vec4 Lt = clipSample(tL, pw);
  float size = floor(A.w) * sc;
  float wide = mix(0.85, 1.25, B.g);
  float rot = B.r * 6.2831853;
  float cr = cos(rot), sr = sin(rot);
  vec3 lp = position * vec3(wide, 1.0, wide) * size;
  lp.xz = mat2(cr, sr, -sr, cr) * lp.xz;
  vec3 ln = normal;
  ln.xz = mat2(cr, sr, -sr, cr) * ln.xz;

  vPos = vec3(pw.x, A.y, pw.y) + lp;
  vN = ln;
  vShade = vec4(aShade.x, aShade.y, position.y, fract(A.w));
  // one answer for the whole tree: the haze in front of it, the light on it, the clouds over it
  vec3 base = vec3(pw.x, A.y + size * 0.5, pw.y);
  vec3 toP = base - uCam;
  float dd = length(toP);
  aerial(toP / dd, dd, vTr, vIns);
  vSunL = sunLightAt(base.y * 0.001);
  vMoonL = moonLightAt(base.y * 0.001);
  vLight = vec3(Lt.r * cloudShadow(base, mix(uMoonDir, uSunDir, uSunPrimary)), Lt.g, B.b);
  vFade = sc;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
}
`;

const FRAG = /* glsl */ `
${ATMOS}
${CLIPMAP}
${LANDLIGHT}
uniform vec3 uCam;
uniform sampler2D tBough;
varying vec3 vTr;
varying vec3 vIns;
varying vec3 vSunL;
varying vec3 vMoonL;
varying vec3 vPos;
varying vec3 vN;
varying vec4 vShade;
varying vec3 vLight;
varying float vFade;
varying vec2 vUv;

void main() {
  vec3 toP = vPos - uCam;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;

  float tip = vShade.x, trunk = vShade.y, up = vShade.z, dens = vShade.w;
  float alpha = 1.0;
#ifdef BOUGHS
  // the skirts carry a picture of hanging boughs: needles, gaps, ragged ends
  if (trunk < 0.5) {
    vec4 bt = texture(tBough, vUv);
    alpha = clamp((bt.a - 0.4) / max(fwidth(bt.a), 0.002) + 0.5, 0.0, 1.0);
    if (alpha < 0.03) discard;
    tip = bt.r * (0.35 + 0.65 * tip);
  }
#endif
  // spruce green: dark inside the crown, a little lighter and yellower at the tips; each tree its own shade
  vec3 deep = vec3(0.008, 0.018, 0.01), outer = mix(vec3(0.024, 0.046, 0.022), vec3(0.042, 0.062, 0.024), vLight.z);
  vec3 albedo = mix(deep, outer, tip * tip);
  albedo = mix(albedo, vec3(0.055, 0.04, 0.03), trunk);

  // inside a wood the lower branches see little of the sun or the sky
  float open = mix(1.0, smoothstep(0.05, 0.8, up), dens * 0.85);
  float self = 0.35 + 0.65 * tip;
  float lit = vLight.x;
  vec3 direct = (vSunL * max((dot(n, uSunDir) + 0.4) / 1.4, 0.0) * mix(1.0, lit, uSunPrimary) + vMoonL * max((dot(n, uMoonDir) + 0.4) / 1.4, 0.0) * mix(lit, 1.0, uSunPrimary)) * open * self;
  vec3 amb = skyIrradiance(normalize(n + vec3(0.0, 0.8, 0.0))) * vLight.y * open * (0.4 + 0.6 * tip);
  vec3 col = albedo / PI * (direct + amb);
  // light coming through the needles when the sun is behind the tree
  float back = pow(max(dot(V, uSunDir), 0.0), 3.0);
  col += outer * 0.9 / PI * vSunL * lit * back * tip * open * 0.5;

  gl_FragColor = vec4((col * vTr + vIns) * uExposure, alpha);
}
`;

/** One spruce, a unit tall: tiers of drooping, star-edged skirts round a thin trunk. */
function spruce(tiers: number, lobes: number, trunk: boolean, seed: number): THREE.BufferGeometry {
  const rand = mulberry(seed);
  const pos: number[] = [], nor: number[] = [], shade: number[] = [], idx: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, tip: number, tr: number) => {
    const l = Math.hypot(nx, ny, nz) || 1;
    pos.push(x, y, z);
    nor.push(nx / l, ny / l, nz / l);
    shade.push(tip, tr, 0);
    return pos.length / 3 - 1;
  };
  if (trunk) {
    const sides = 5;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const r0 = 0.016, r1 = 0.004, y0 = -0.05, y1 = 0.86;
      const a = push(Math.cos(a0) * r0, y0, Math.sin(a0) * r0, Math.cos(a0), 0, Math.sin(a0), 0.5, 1);
      const b = push(Math.cos(a1) * r0, y0, Math.sin(a1) * r0, Math.cos(a1), 0, Math.sin(a1), 0.5, 1);
      const c = push(Math.cos(a0) * r1, y1, Math.sin(a0) * r1, Math.cos(a0), 0, Math.sin(a0), 0.5, 1);
      const d = push(Math.cos(a1) * r1, y1, Math.sin(a1) * r1, Math.cos(a1), 0, Math.sin(a1), 0.5, 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  const low = 0.13;
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1); // 0 bottom .. 1 top
    const yTop = low + (1 - low) * (0.1 + 0.9 * k) ** 0.92;
    const r = (0.155 * (1 - k) ** 0.8 + 0.01) * (0.9 + 0.2 * rand());
    const droop = r * (1.5 - 0.5 * k);
    const rise = r * 0.55 + 0.02;
    const a0 = rand() * Math.PI * 2;
    const apex = push(0, Math.min(1, yTop + rise * 0.45), 0, 0, 1, 0, 0.12, 0);
    const rim: number[] = [];
    const n = lobes * 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const out = i % 2 === 0 ? 1 : 0.58 + 0.12 * rand();
      const rr = r * out * (0.88 + 0.24 * rand());
      const y = yTop - droop * out - (out < 1 ? -droop * 0.25 : 0);
      rim.push(push(Math.cos(a) * rr, y, Math.sin(a) * rr, Math.cos(a) * 0.75, 0.66, Math.sin(a) * 0.75, out < 1 ? 0.55 : 1, 0));
    }
    for (let i = 0; i < n; i++) idx.push(apex, rim[(i + 1) % n], rim[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  return g;
}

/** A spruce for close by: smooth conical skirts that carry the bough picture. */
function boughSpruce(tiers: number, segs: number, seed: number): THREE.BufferGeometry {
  const rand = mulberry(seed);
  const pos: number[] = [], nor: number[] = [], shade: number[] = [], uvs: number[] = [], idx: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, tip: number, tr: number, u: number, v: number) => {
    const l = Math.hypot(nx, ny, nz) || 1;
    pos.push(x, y, z);
    nor.push(nx / l, ny / l, nz / l);
    shade.push(tip, tr, 0);
    uvs.push(u, v);
    return pos.length / 3 - 1;
  };
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2, a1 = ((i + 1) / 5) * Math.PI * 2;
    const r0 = 0.015, r1 = 0.003, y0 = -0.05, y1 = 0.9;
    const a = push(Math.cos(a0) * r0, y0, Math.sin(a0) * r0, Math.cos(a0), 0, Math.sin(a0), 0.5, 1, 0.5, 0.5);
    const b = push(Math.cos(a1) * r0, y0, Math.sin(a1) * r0, Math.cos(a1), 0, Math.sin(a1), 0.5, 1, 0.5, 0.5);
    const c = push(Math.cos(a0) * r1, y1, Math.sin(a0) * r1, Math.cos(a0), 0, Math.sin(a0), 0.5, 1, 0.5, 0.5);
    const d = push(Math.cos(a1) * r1, y1, Math.sin(a1) * r1, Math.cos(a1), 0, Math.sin(a1), 0.5, 1, 0.5, 0.5);
    idx.push(a, c, b, b, c, d);
  }
  const low = 0.07;
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1);
    const yTop = low + (1 - low) * (0.1 + 0.9 * k) ** 0.97;
    const r = (0.15 * (1 - k) ** 0.82 + 0.008) * (0.88 + 0.24 * rand());
    const len = r * 1.5 + 0.03; // how far the skirt hangs: well over the one below
    const a0 = rand() * Math.PI * 2;
    const reps = Math.max(1, Math.round((r / 0.15) * 3)) / 3; // fewer boughs round the small top tiers
    const u0 = rand();
    const rings = [
      { rr: 0.008, y: Math.min(1, yTop + 0.02), v: 1, tip: 0.05 },
      { rr: r * 0.6, y: yTop - len * 0.3, v: 0.5, tip: 0.55 },
      { rr: r, y: yTop - len * 0.85, v: 0, tip: 1 },
    ];
    const base = pos.length / 3;
    for (const ring of rings) {
      for (let i = 0; i <= segs; i++) {
        const a = a0 + (i / segs) * Math.PI * 2;
        push(Math.cos(a) * ring.rr, ring.y, Math.sin(a) * ring.rr, Math.cos(a) * 0.8, 0.6, Math.sin(a) * 0.8, ring.tip, 0, u0 + (i / segs) * reps, ring.v);
      }
    }
    const row = segs + 1;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < segs; i++) {
        const a = base + j * row + i, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** Hanging spruce boughs, drawn needle by needle: brightness in the colour, coverage in the alpha. Tiles sideways. */
function boughTexture(): THREE.CanvasTexture {
  const W = 1024, H = 512, K = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry(77);
  ctx.lineCap = 'round';
  const FANS = 9;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < FANS; k++) {
      const cx = ((k + 0.5 + (rand() - 0.5) * 0.5) / FANS) * W;
      const len = H * (pass === 0 ? 0.5 + 0.2 * rand() : 0.72 + 0.28 * rand());
      const spread = 0.42 + 0.2 * rand();
      const twigs = 13;
      for (let t = 0; t < twigs; t++) {
        const a = (t / (twigs - 1) - 0.5) * 2 * spread + (rand() - 0.5) * 0.08;
        const tl = len * (1 - 0.55 * Math.abs(a / spread) ** 1.5) * (0.75 + 0.25 * rand());
        const sx = cx + a * 14 * K, sy = -4 * K;
        for (const off of [-W, 0, W]) {
          for (let d = 0; d < tl; d += 2.1 * K) {
            const px = sx + Math.sin(a) * d + off, py = sy + Math.cos(a) * d;
            if (px < -24 || px > W + 24) continue;
            const along = d / tl;
            const nl = (7.5 - 3.5 * along) * (0.8 + 0.4 * rand()) * K;
            for (const side of [-1, 1]) {
              const na = a + side * (0.55 + 0.35 * rand());
              const lum = Math.round(60 + 150 * (py / H) ** 0.8 + 45 * rand());
              ctx.strokeStyle = `rgb(${lum},${lum},${lum})`;
              ctx.lineWidth = (1.3 + rand() * 0.9) * K * 0.8;
              ctx.beginPath();
              ctx.moveTo(px, py);
              ctx.lineTo(px + Math.sin(na) * nl, py + Math.cos(na) * nl);
              ctx.stroke();
            }
          }
        }
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

interface Ring {
  cell: number;
  from: number;
  far: number;
  dim: number; // tiles along a side of the pool
  meshes: THREE.Mesh[];
  tileSize: number;
  /** where each tree of each tile stands */
  data: THREE.WebGLRenderTarget;
  place: Pass;
  /** which tile of the world each slot holds now: ti, tj, and the origin it was worked out against */
  held: Float64Array;
}

export class Trees {
  readonly group = new THREE.Group();
  private rings: Ring[] = [];
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  private box = new THREE.Box3();
  visibleTiles = 0;

  constructor(private bake: TerrainBake, atmos: Atmosphere, extra: Record<string, THREE.IUniform>, detail = 1) {
    const shapes = [boughSpruce(14, 10, 11), spruce(7, 6, false, 12), spruce(4, 5, false, 13)];
    const bough = { value: boughTexture() };
    const cells = new Float32Array(TILE_CELLS * TILE_CELLS * 2);
    for (let z = 0; z < TILE_CELLS; z++) for (let x = 0; x < TILE_CELLS; x++) cells.set([x, z], (z * TILE_CELLS + x) * 2);
    RINGS.forEach((R, i) => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = shapes[i].index;
      for (const name of ['position', 'normal', 'aShade', 'uv']) geo.setAttribute(name, shapes[i].getAttribute(name));
      geo.setAttribute('iCell', new THREE.InstancedBufferAttribute(cells, 2));
      geo.instanceCount = TILE_CELLS * TILE_CELLS;
      const far = i === 2 ? R.far * detail : R.far;
      const tileSize = R.cell * TILE_CELLS;
      const dim = Math.ceil((far * 2) / tileSize) + 2;
      const data = new THREE.WebGLRenderTarget(dim * TILE_CELLS, dim * TILE_CELLS, {
        count: 2, type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
      });
      data.textures[1].type = THREE.UnsignedByteType;
      const place = new Pass(PLACE_FRAG, {
        ...bake.uniforms(), uCell: { value: R.cell }, uRing: { value: i }, uTileLocal: { value: new THREE.Vector2() }, uSlotTexel: { value: new THREE.Vector2() },
      }, { glslVersion: THREE.GLSL3, defines: bake.defines() });
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        defines: i === 0 ? { ...bake.defines(), BOUGHS: '1' } : bake.defines(),
        side: THREE.DoubleSide,
        alphaToCoverage: i === 0,
        uniforms: {
          ...bake.uniforms(),
          ...atmos.uniforms(),
          ...extra,
          tBough: bough,
          tTreeA: { value: data.textures[0] },
          tTreeB: { value: data.textures[1] },
          uDim: { value: dim },
          uRange: { value: new THREE.Vector3(i === 0 ? 0 : RINGS[i - 1].far, far, 0) },
        },
      });
      const meshes: THREE.Mesh[] = [];
      for (let k = 0; k < dim * dim; k++) {
        const m = new THREE.Mesh(geo, material);
        m.frustumCulled = false;
        m.matrixAutoUpdate = false;
        m.visible = false;
        meshes.push(m);
        this.group.add(m);
      }
      this.rings.push({ cell: R.cell, from: i === 0 ? 0 : RINGS[i - 1].far, far, dim, meshes, tileSize, data, place, held: new Float64Array(dim * dim * 2).fill(NaN) });
    });
  }

  /** Forget where every tree was put: after a jump, when the land under the tiles has all been drawn afresh. */
  reset() {
    for (const R of this.rings) R.held.fill(NaN);
  }

  update(camX: number, camZ: number, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
    const ox = this.bake.originX, oz = this.bake.originZ;
    // tiles placed against tiles of the land that have since been drawn finer are placed again, a few a frame
    let budget = 60;
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    let shown = 0;
    for (const R of this.rings) {
      const ts = R.tileSize;
      const ci = Math.floor(camX / ts), cj = Math.floor(camZ / ts);
      const half = Math.floor(R.dim / 2);
      for (let dj = -half; dj < R.dim - half; dj++) {
        for (let di = -half; di < R.dim - half; di++) {
          const ti = ci + di, tj = cj + dj;
          const slot = (((tj % R.dim) + R.dim) % R.dim) * R.dim + (((ti % R.dim) + R.dim) % R.dim);
          const mesh = R.meshes[slot];
          const x0 = ti * ts - ox, z0 = tj * ts - oz;
          // nearest and farthest the tile can be from the camera
          const lx = camX - ox, lz = camZ - oz;
          const nx = Math.max(x0 - lx, 0, lx - x0 - ts), nz = Math.max(z0 - lz, 0, lz - z0 - ts);
          const fx = Math.max(Math.abs(x0 - lx), Math.abs(x0 + ts - lx)), fz = Math.max(Math.abs(z0 - lz), Math.abs(z0 + ts - lz));
          let vis = Math.hypot(nx, nz) < R.far && Math.hypot(fx, fz) >= R.from;
          if (vis) {
            this.box.min.set(x0 - 8, 0, z0 - 8);
            this.box.max.set(x0 + ts + 8, 4000, z0 + ts + 8);
            vis = this.frustum.intersectsBox(this.box);
          }
          if (vis && (R.held[slot * 2] !== ti || R.held[slot * 2 + 1] !== tj)) {
            if (budget-- > 0) {
              const sx = (slot % R.dim) * TILE_CELLS, sy = Math.floor(slot / R.dim) * TILE_CELLS;
              (R.place.u.uTileLocal.value as THREE.Vector2).set(x0, z0);
              (R.place.u.uSlotTexel.value as THREE.Vector2).set(sx, sy);
              const rect: [number, number, number, number] = [sx, sy, TILE_CELLS, TILE_CELLS];
              R.place.render(renderer, R.data, rect, rect);
              R.held[slot * 2] = ti;
              R.held[slot * 2 + 1] = tj;
            } else vis = false;
          }
          mesh.visible = vis;
          if (vis) {
            // the height slot of the matrix carries the tile's place in the pool
            mesh.matrix.makeTranslation(x0, slot, z0);
            mesh.matrixWorld.copy(mesh.matrix);
            shown++;
          }
        }
      }
    }
    this.visibleTiles = shown;
  }
}
