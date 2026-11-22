// The land, drawn into textures.
//
// Eight square tiles, each N texels across and each twice as coarse as the one before, are kept
// centred on the train (a clipmap): level 0 covers about a kilometre at a metre a texel, level 7
// about 130 km. Whenever the train has moved far enough from a tile's centre the tile is drawn
// again, a strip at a time, from the terrain function alone, so nothing is stored and nothing repeats.
//
//   tH  height                                   (float)
//   tM  forest density, gully, earthworks, depth under water (0.5 at the shore, +-16 m)
//   tG  normal x, normal z, curvature, slope
//   tL  sun (or moon) shadow, how much sky is seen
//
// Along the line itself a one-dimensional "profile" says how far the natural ground is above or
// below the rails: that decides where the line is in a cutting, on a bank, in a tunnel or on a viaduct.
// It is the one thing read back to the CPU, so the sound and the tunnel walls agree with the picture.
import * as THREE from 'three';
import { Pass } from '../render/fsq';
import { HASH, ROUTE, NOISE, TERRAIN } from './glsl/lib';

export const LEVELS = 8;
export const PROFILE_W = 8192;
const STRIP_PAD = 64;
/** A tile is drawn again once the camera is this many texels from its centre. */
const RECENTRE = 48;
/** Shaders read a level out to this many texels from the camera. */
const USABLE_INSET = 72;
/** The formation carries two tracks: ours, and one four metres to the left. Its middle and half-width, metres. */
export const BED_CENTRE = -2;
export const BED_HALF = 5.4;
export const TUNNEL_OVER = 13; // metres of ground over the rails before the line goes under it
export const VIADUCT_UNDER = -9;

/** GLSL for anything that reads the tiles. */
export const CLIPMAP = /* glsl */ `
uniform highp sampler2D tH;
uniform sampler2D tM;
uniform sampler2D tG;
uniform sampler2D tL;
uniform vec4 uLevels[8];   // local centre x, z; metres per texel
uniform float uTileN;
uniform vec2 uClipCam;     // the point levels are chosen around
uniform float uClipR0;     // how far level 0 can be read from there

vec2 tileQ(int T, vec2 p) { vec4 L = uLevels[T]; return (p - L.xy) / L.z + uTileN * 0.5; }
vec2 atlasUV(int T, vec2 q) {
  q = clamp(q, 0.5, uTileN - 0.5);
  return (q + vec2(float(T & 3), float(T >> 2)) * uTileN) / (uTileN * vec2(4.0, 2.0));
}
float heightTile(int T, vec2 p) {
  vec2 q = tileQ(T, p);
#ifdef FLOAT_LINEAR
  return texture(tH, atlasUV(T, q)).r;
#else
  q = clamp(q, 0.5, uTileN - 0.5) - 0.5;
  vec2 i = floor(q), f = q - i;
  int n = int(uTileN);
  ivec2 o = ivec2(T & 3, T >> 2) * n;
  ivec2 b = ivec2(i);
  ivec2 b1 = min(b + 1, ivec2(n - 1));
  float h00 = texelFetch(tH, o + b, 0).r, h10 = texelFetch(tH, o + ivec2(b1.x, b.y), 0).r;
  float h01 = texelFetch(tH, o + ivec2(b.x, b1.y), 0).r, h11 = texelFetch(tH, o + b1, 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
#endif
}
// which level to read at p, and how far to blend into the next coarser one
void clipLevel(vec2 p, out int T, out float blend) {
  vec2 d = abs(p - uClipCam);
  float m = max(d.x, d.y) / uClipR0;
  T = int(clamp(ceil(log2(max(m, 1e-4))), 0.0, 7.0));
  float r = m * exp2(-float(T));
  blend = T < 7 ? smoothstep(0.84, 1.0, r) : 0.0;
}
float heightAt(vec2 p) {
  int T; float b; clipLevel(p, T, b);
  float h = heightTile(T, p);
  if (b > 0.0) h = mix(h, heightTile(T + 1, p), b);
  return h;
}
vec4 clipSample(sampler2D tex, vec2 p) {
  int T; float b; clipLevel(p, T, b);
  vec4 s = texture(tex, atlasUV(T, tileQ(T, p)));
  if (b > 0.0) s = mix(s, texture(tex, atlasUV(T + 1, tileQ(T + 1, p))), b);
  return s;
}
`;

/** GLSL to look the line up near the camera. Uniforms from `lineUniforms`. */
export const LINE = /* glsl */ `
uniform highp sampler2D tProfile;   // ground over rails, tunnel, viaduct, ground height
uniform highp sampler2D tLine;      // rail z (local), rail y, dz/dx, dy/dx
uniform float uLineX0;
vec4 lineFetch(highp sampler2D t, float xl) {
  float q = xl - uLineX0 - 0.5;
  float i = floor(q), f = q - i;
  int i0 = clamp(int(i), 0, ${PROFILE_W - 1}), i1 = clamp(int(i) + 1, 0, ${PROFILE_W - 1});
  return mix(texelFetch(t, ivec2(i0, 0), 0), texelFetch(t, ivec2(i1, 0), 0), f);
}
// p relative to the line: x = metres to the right of our track, y = metres over the rails, z = tunnel 0..1
vec3 besideLine(vec3 p) {
  vec4 L = lineFetch(tLine, p.x);
  float cs2 = 1.0 / (1.0 + L.z * L.z);
  float v = p.z - L.x;
  float xs = p.x + v * L.z * cs2;
  vec4 Ls = lineFetch(tLine, xs);
  return vec3(v * sqrt(cs2), p.y - Ls.y, lineFetch(tProfile, xs).y);
}
`;

const OUT2 = 'layout(location = 0) out vec4 o0;\nlayout(location = 1) out vec4 o1;\n';

const STRIP_FRAG = /* glsl */ `
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
uniform float uCenterX, uTexelS, uSW;
${HASH}${ROUTE}
void main() {
  float xl = uCenterX + (gl_FragCoord.x - uSW * 0.5) * uTexelS;
  Route r = routeAt(xl);
  o0 = vec4(r.zp, r.dzp, r.flr, r.ty);
  o1 = vec4(r.c, r.w, r.s, r.at);
  o2 = vec4(r.lake, r.riverU, r.riverHW, r.dty);
}`;

const HEIGHT_FRAG = /* glsl */ `
${OUT2}
uniform vec2 uCenter;
uniform float uN, uSW;
uniform int uLevel;
uniform highp sampler2D tS0, tS1, tS2, tProfile;
uniform float uProfileX0;
${HASH}${ROUTE}${NOISE}${TERRAIN}
Route routeFor(float xl) {
  float q = (xl - uCenter.x) / uTexel + uSW * 0.5 - 0.5;
  float i = floor(q), f = q - i;
  int n = int(uSW) - 1;
  ivec2 a = ivec2(clamp(int(i), 0, n), uLevel), b = ivec2(clamp(int(i) + 1, 0, n), uLevel);
  vec4 A = mix(texelFetch(tS0, a, 0), texelFetch(tS0, b, 0), f);
  vec4 B = mix(texelFetch(tS1, a, 0), texelFetch(tS1, b, 0), f);
  vec4 C = mix(texelFetch(tS2, a, 0), texelFetch(tS2, b, 0), f);
  Route r;
  r.zp = A.x; r.dzp = A.y; r.flr = A.z; r.ty = A.w;
  r.c = B.x; r.w = B.y; r.s = B.z; r.at = B.w;
  r.lake = C.x; r.riverU = C.y; r.riverHW = C.z; r.dty = C.w;
  return r;
}
vec4 profileAt(float xl) {
  float q = xl - uProfileX0 - 0.5;
  float i = floor(q), f = q - i;
  int i0 = clamp(int(i), 0, ${PROFILE_W - 1}), i1 = clamp(int(i) + 1, 0, ${PROFILE_W - 1});
  return mix(texelFetch(tProfile, ivec2(i0, 0), 0), texelFetch(tProfile, ivec2(i1, 0), 0), f);
}
void main() {
  vec2 p = uCenter + (gl_FragCoord.xy - uN * 0.5) * uTexel;
  Ground G = groundAt(p);
  Route r = routeFor(p.x);
  float h = G.h;
  float works = 0.0, dLine = 1e4;

  // the railway: a level bed, with the ground cut back or banked up to meet it
  if (uTexel < 4.5 && abs(G.v) < 110.0) {
    float cs2 = 1.0 / (1.0 + r.dzp * r.dzp);
    dLine = abs(G.v * sqrt(cs2) - (${BED_CENTRE.toFixed(1)}));
    float xs = p.x + G.v * r.dzp * cs2;
    vec4 pf = profileAt(xs);
    float bed = r.ty + r.dty * (xs - p.x) - 0.78;
    float e = max(dLine - ${BED_HALF.toFixed(1)}, 0.0);
    float up = bed + e * mix(0.75, 2.4, smoothstep(4.0, 13.0, pf.x)) + pf.y * 4000.0;
    float lo = bed - e * 0.64 - pf.z * 4000.0;
    float hc = clamp(h, lo, up);
    works = max(1.0 - smoothstep(${(BED_HALF - 0.4).toFixed(1)}, ${(BED_HALF + 1.4).toFixed(1)}, dLine), 0.5 * smoothstep(0.3, 2.0, abs(h - hc)));
    works *= 1.0 - max(pf.y, pf.z);
    // over a tunnel: mark the ground, so the part of it that would stand in the tunnel's mouth can be left out
    works = max(works, 0.3 * pf.y * (1.0 - smoothstep(${(BED_HALF + 1.0).toFixed(1)}, ${(BED_HALF + 2.5).toFixed(1)}, dLine)));
    h = hc;
  }

  float water = r.flr - WATER_DROP;
  float line = 2080.0 + 170.0 * gn(p, 5, 150u).x;
  float forest = 1.0 - smoothstep(line - 220.0, line, h);
  forest *= 1.0 - smoothstep(0.72, 1.05, G.slope);
  forest *= smoothstep(-0.35, 0.05, gn(p, 3, 151u).x + 0.35 * gn(p, 1, 152u).x);
  forest *= mix(1.0, smoothstep(0.12, 0.38, gn(p, 2, 153u).x), G.inFloor);
  forest *= smoothstep(8.0, 16.0, dLine);
  // on the valley side of the line the trees stand back, in clumps: the view is the point
  float valleySide = step(0.0, G.v * r.c);
  forest *= mix(1.0, mix(smoothstep(0.1, 0.3, gn(p, 0, 154u).x) * 0.8, 1.0, smoothstep(70.0, 190.0, abs(G.v))), valleySide);
  forest *= step(water + 0.7, h);

  o0 = vec4(h, 0.0, 0.0, 1.0);
  o1 = vec4(forest, G.gully, works, clamp(0.5 + (water - h) / 32.0, 0.0, 1.0));
}`;

const PROFILE_A = /* glsl */ `
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
uniform float uX0;
${HASH}${ROUTE}${NOISE}${TERRAIN}
Route routeFor(float xl) { return routeAt(xl); }
void main() {
  float xl = uX0 + gl_FragCoord.x;
  Route r = routeAt(xl);
  Ground G = groundAt(vec2(xl, r.zp + (${BED_CENTRE.toFixed(1)}) * sqrt(1.0 + r.dzp * r.dzp)));
  o0 = vec4(G.h - r.ty, 0.0, 0.0, G.h);
  o1 = vec4(r.zp, r.ty, r.dzp, r.dty);
}`;

// a tunnel only where the ground stays high for 60 m, a viaduct only where it stays low for 24 m:
// erode, then dilate
const PROFILE_B = /* glsl */ `
out vec4 o0;
uniform highp sampler2D tP;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(tP, c, 0);
  float mn = 1e9, mx = -1e9;
  for (int k = -30; k <= 30; k += 2) {
    float d = texelFetch(tP, ivec2(clamp(c.x + k, 0, ${PROFILE_W - 1}), 0), 0).r;
    mn = min(mn, d);
    if (abs(k) <= 12) mx = max(mx, d);
  }
  o0 = vec4(s.r, mn, mx, s.a);
}`;
const PROFILE_C = /* glsl */ `
out vec4 o0;
uniform highp sampler2D tP;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(tP, c, 0);
  float tun = 0.0, via = 0.0;
  for (int k = -30; k <= 30; k += 2) {
    vec4 d = texelFetch(tP, ivec2(clamp(c.x + k, 0, ${PROFILE_W - 1}), 0), 0);
    tun = max(tun, step(${TUNNEL_OVER.toFixed(1)}, d.g));
    if (abs(k) <= 12) via = max(via, step(d.b, ${VIADUCT_UNDER.toFixed(1)}));
  }
  o0 = vec4(s.r, tun, via, s.a);
}`;

const COPY_FRAG = /* glsl */ `
${OUT2}
uniform highp sampler2D tA;
uniform sampler2D tB;
uniform ivec2 uOff;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy) - uOff;
  o0 = texelFetch(tA, c, 0);
  o1 = texelFetch(tB, c, 0);
}`;

const NORMAL_FRAG = /* glsl */ `
out vec4 o0;
uniform highp sampler2D tA;
uniform ivec2 uOff;
uniform float uN, uTexelN;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy) - uOff;
  int n = int(uN) - 1;
  ivec2 l = ivec2(max(c.x - 1, 0), c.y), r = ivec2(min(c.x + 1, n), c.y);
  ivec2 d = ivec2(c.x, max(c.y - 1, 0)), u = ivec2(c.x, min(c.y + 1, n));
  float hl = texelFetch(tA, l, 0).r, hr = texelFetch(tA, r, 0).r;
  float hd = texelFetch(tA, d, 0).r, hu = texelFetch(tA, u, 0).r, hc = texelFetch(tA, c, 0).r;
  vec2 g = vec2((hr - hl) / (float(r.x - l.x) * uTexelN), (hu - hd) / (float(u.y - d.y) * uTexelN));
  vec3 nn = normalize(vec3(-g.x, 1.0, -g.y));
  o0 = vec4(nn.x, nn.z, (hl + hr + hd + hu - 4.0 * hc) / uTexelN, length(g));
}`;

const LIGHT_FRAG = /* glsl */ `
out vec4 o0;
${CLIPMAP}
uniform ivec2 uOff;
uniform int uLevel;
uniform vec3 uSun;
float hFrom(vec2 p) {
  for (int T = uLevel; T < 7; T++) {
    vec2 q = tileQ(T, p);
    if (min(q.x, q.y) > 1.0 && max(q.x, q.y) < uTileN - 1.0) return heightTile(T, p);
  }
  return heightTile(7, p);
}
void main() {
  vec4 L = uLevels[uLevel];
  vec2 p = L.xy + (gl_FragCoord.xy - vec2(uOff) - uTileN * 0.5) * L.z;
  float h = texelFetch(tH, ivec2(gl_FragCoord.xy), 0).r;

  // the sun: march towards it, in steps that grow, and keep how nearly the ground reached the ray
  float sh = 1.0;
  if (uSun.y > 0.002) {
    float t = L.z * 1.5;
    vec3 o = vec3(p.x, h + L.z * 0.35, p.y);
    for (int i = 0; i < 46; i++) {
      vec3 q = o + uSun * t;
      if (q.y > 4700.0 || t > 90000.0) break;
      sh = min(sh, (q.y - hFrom(q.xz)) * 26.0 / t + 0.35);
      if (sh <= 0.0) break;
      t *= 1.21;
    }
    sh = smoothstep(0.0, 1.0, sh);
  } else sh = 0.0;

  // how much of the sky this spot sees: the horizon in six directions
  float vis = 0.0;
  float grow = pow(9000.0 / (2.0 * L.z), 1.0 / 7.0);
  for (int a = 0; a < 6; a++) {
    float ang = (float(a) + 0.3) * 1.0471976;
    vec2 dir = vec2(cos(ang), sin(ang));
    float tz = 0.0, t = L.z * 2.0;
    for (int i = 0; i < 8; i++) {
      tz = max(tz, (hFrom(p + dir * t) - h) / t);
      t *= grow;
    }
    vis += 1.0 / (1.0 + tz * tz);
  }
  o0 = vec4(sh, vis / 6.0, 0.0, 1.0);
}`;

interface Level {
  cx: number; cz: number; // world centre
  texel: number;
  baked: boolean;
}

export class TerrainBake {
  readonly N: number;
  readonly t0: number;
  readonly floatLinear: boolean;
  readonly geo: THREE.WebGLRenderTarget; // tH, tM
  readonly norm: THREE.WebGLRenderTarget;
  readonly light: THREE.WebGLRenderTarget;
  private scratch: THREE.WebGLRenderTarget;
  private strip: THREE.WebGLRenderTarget;
  private profA: THREE.WebGLRenderTarget;
  private profB: THREE.WebGLRenderTarget;
  private profRaw: THREE.WebGLRenderTarget; // [ground against rails, the line itself]

  readonly levels: Level[] = [];
  /** uLevels for the shaders, in local coordinates: refreshed by `uniformsFor`. */
  readonly levelUniform: THREE.Vector4[] = [];
  readonly origin64 = new THREE.Vector2(0, 0);
  originX = 0;
  originZ = 0;

  // the profile along the line, as read back
  profile = new Float32Array(PROFILE_W * 4);
  profileX0 = -1e12; // world x of its first sample
  private profileCentre = -1e12;

  private passStrip: Pass;
  private passHeight: Pass;
  private passProfA: Pass;
  private passProfB: Pass;
  private passProfC: Pass;
  private passCopy: Pass;
  private passNormal: Pass;
  private passLight: Pass;

  private job: { level: number; cx: number; cz: number; row: number } | null = null;
  private relight: number[] = [];
  private sun = new THREE.Vector3(0, 1, 0);
  private litSun = new THREE.Vector3(0, -2, 0);
  /** rows of a tile drawn per frame while the train is moving */
  rowsPerFrame: number;
  bakes = 0;

  constructor(private renderer: THREE.WebGLRenderer, N = 1024) {
    this.N = N;
    this.t0 = 1024 / N;
    this.rowsPerFrame = N / 8;
    this.floatLinear = renderer.extensions.has('OES_texture_float_linear');
    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
    const linear = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    const hFilter = this.floatLinear ? linear : nearest;

    const mrt = (w: number, h: number) => {
      const rt = new THREE.WebGLRenderTarget(w, h, { ...hFilter, count: 2, type: THREE.FloatType, format: THREE.RedFormat });
      const m = rt.textures[1];
      m.type = THREE.UnsignedByteType;
      m.format = THREE.RGBAFormat;
      m.minFilter = m.magFilter = THREE.LinearFilter;
      return rt;
    };
    this.geo = mrt(N * 4, N * 2);
    this.scratch = mrt(N, N);
    this.scratch.textures[0].minFilter = this.scratch.textures[0].magFilter = THREE.NearestFilter;
    this.norm = new THREE.WebGLRenderTarget(N * 4, N * 2, { ...linear, type: THREE.HalfFloatType, format: THREE.RGBAFormat });
    this.light = new THREE.WebGLRenderTarget(N * 4, N * 2, { ...linear, type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    this.strip = new THREE.WebGLRenderTarget(N + STRIP_PAD, LEVELS, { ...nearest, count: 3, type: THREE.FloatType, format: THREE.RGBAFormat });
    this.profA = new THREE.WebGLRenderTarget(PROFILE_W, 1, { ...nearest, type: THREE.FloatType, format: THREE.RGBAFormat });
    this.profRaw = new THREE.WebGLRenderTarget(PROFILE_W, 1, { ...nearest, count: 2, type: THREE.FloatType, format: THREE.RGBAFormat });
    this.profB = new THREE.WebGLRenderTarget(PROFILE_W, 1, { ...nearest, type: THREE.FloatType, format: THREE.RGBAFormat });

    this.lineUniforms.tProfile.value = this.profA.texture;
    this.lineUniforms.tLine.value = this.profRaw.textures[1];
    for (let T = 0; T < LEVELS; T++) {
      this.levels.push({ cx: 0, cz: 0, texel: this.t0 * 2 ** T, baked: false });
      this.levelUniform.push(new THREE.Vector4(0, 0, this.t0 * 2 ** T, 0));
    }

    const g3 = { glslVersion: THREE.GLSL3 };
    const o64 = { value: this.origin64 };
    this.passStrip = new Pass(STRIP_FRAG, { uOrigin64: o64, uCenterX: { value: 0 }, uTexelS: { value: 1 }, uSW: { value: N + STRIP_PAD } }, g3);
    this.passHeight = new Pass(HEIGHT_FRAG, {
      uOrigin64: o64, uTexel: { value: 1 }, uCenter: { value: new THREE.Vector2() }, uN: { value: N }, uSW: { value: N + STRIP_PAD }, uLevel: { value: 0 },
      tS0: { value: this.strip.textures[0] }, tS1: { value: this.strip.textures[1] }, tS2: { value: this.strip.textures[2] },
      tProfile: { value: this.profA.texture }, uProfileX0: { value: 0 },
    }, g3);
    this.passProfA = new Pass(PROFILE_A, { uOrigin64: o64, uTexel: { value: this.t0 }, uX0: { value: 0 } }, g3);
    this.passProfB = new Pass(PROFILE_B, { tP: { value: this.profRaw.textures[0] } }, g3);
    this.passProfC = new Pass(PROFILE_C, { tP: { value: this.profB.texture } }, g3);
    this.passCopy = new Pass(COPY_FRAG, { tA: { value: this.scratch.textures[0] }, tB: { value: this.scratch.textures[1] }, uOff: { value: new THREE.Vector2() } }, g3);
    this.passNormal = new Pass(NORMAL_FRAG, { tA: { value: this.scratch.textures[0] }, uOff: { value: new THREE.Vector2() }, uN: { value: N }, uTexelN: { value: 1 } }, g3);
    this.passLight = new Pass(LIGHT_FRAG, {
      ...this.uniforms(), uOff: { value: new THREE.Vector2() }, uLevel: { value: 0 }, uSun: { value: this.sun },
    }, { ...g3, defines: this.defines() });
  }

  defines(): Record<string, string> {
    return this.floatLinear ? { FLOAT_LINEAR: '1' } : {};
  }

  /** The uniforms CLIPMAP declares. Share the returned objects between materials. */
  private shared: Record<string, THREE.IUniform> | null = null;
  uniforms(): Record<string, THREE.IUniform> {
    if (!this.shared) {
      this.shared = {
        tH: { value: this.geo.textures[0] },
        tM: { value: this.geo.textures[1] },
        tG: { value: this.norm.texture },
        tL: { value: this.light.texture },
        uLevels: { value: this.levelUniform },
        uTileN: { value: this.N },
        uClipCam: { value: new THREE.Vector2() },
        uClipR0: { value: (this.N / 2 - USABLE_INSET) * this.t0 },
        uOrigin64: { value: this.origin64 },
      };
    }
    return this.shared;
  }

  private tileOffset(T: number): [number, number] {
    return [(T & 3) * this.N, (T >> 2) * this.N];
  }

  private syncLevelUniforms() {
    for (let T = 0; T < LEVELS; T++) {
      const L = this.levels[T];
      this.levelUniform[T].set(L.cx - this.originX, L.cz - this.originZ, L.texel, 0);
    }
  }

  /** Move the origin shaders work from. Tiles stay where they are in the world. */
  setOrigin(x: number, z: number) {
    if (x === this.originX && z === this.originZ) return;
    this.originX = x;
    this.originZ = z;
    this.origin64.set(Math.round(x / 64), Math.round(z / 64));
    this.job = null; // a tile half drawn was drawn for the old origin
    this.syncLevelUniforms();
  }

  private profileOrigin = NaN;
  /** For shaders that need the line near the camera: its profile and its position, a metre a texel. See LINE. */
  readonly lineUniforms = {
    tProfile: { value: null as THREE.Texture | null },
    tLine: { value: null as THREE.Texture | null },
    uLineX0: { value: 0 },
  };

  private spare = new Float32Array(PROFILE_W * 4);
  private readToken = 0;
  private bakeProfile(camX: number, wait = false) {
    const c = Math.round(camX / 1024) * 1024;
    this.profileCentre = c;
    const r = this.renderer;
    this.passProfA.u.uX0.value = c - PROFILE_W / 2 - this.originX;
    this.passProfA.render(r, this.profRaw);
    this.passProfB.render(r, this.profB);
    this.passProfC.render(r, this.profA);
    const gpuX0 = c - PROFILE_W / 2;
    this.passHeight.u.uProfileX0.value = gpuX0 - this.originX;
    this.lineUniforms.uLineX0.value = gpuX0 - this.originX;
    this.profileOrigin = this.originX + this.originZ * 1e-9;
    if (wait) {
      // three's asynchronous read-backs (the light probe, the exposure meter) leave their pixel buffer bound
      // while they wait, and a plain read with one bound is an error that reads nothing
      const gl = r.getContext() as WebGL2RenderingContext;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      r.readRenderTargetPixels(this.profA, 0, 0, PROFILE_W, 1, this.profile);
      this.profileX0 = gpuX0;
    } else {
      // later ones may take their time: what the CPU has still covers the train for a good while
      const into = this.spare, token = ++this.readToken;
      r.readRenderTargetPixelsAsync(this.profA, 0, 0, PROFILE_W, 1, into)
        .then(() => {
          if (token !== this.readToken) return;
          this.spare = this.profile;
          this.profile = into;
          this.profileX0 = gpuX0;
        })
        .catch(() => {});
    }
  }

  /** Ground against rails at world x: metres over (+) or under, and whether the line is in a tunnel or on a viaduct. */
  profileAt(x: number, out = { dh: 0, tunnel: 0, viaduct: 0, ground: 0 }) {
    const q = Math.min(PROFILE_W - 1.001, Math.max(0, x - this.profileX0 - 0.5));
    const i = Math.floor(q), f = q - i, a = i * 4, b = a + 4;
    const p = this.profile;
    out.dh = p[a] + (p[b] - p[a]) * f;
    out.tunnel = p[a + 1] + (p[b + 1] - p[a + 1]) * f;
    out.viaduct = p[a + 2] + (p[b + 2] - p[a + 2]) * f;
    out.ground = p[a + 3] + (p[b + 3] - p[a + 3]) * f;
    return out;
  }

  private startJob(T: number, camX: number, camZ: number) {
    const L = this.levels[T];
    const snap = 32 * L.texel;
    const cx = Math.round(camX / snap) * snap, cz = Math.round(camZ / snap) * snap;
    this.job = { level: T, cx, cz, row: 0 };
    const SW = this.N + STRIP_PAD;
    this.passStrip.u.uCenterX.value = cx - this.originX;
    this.passStrip.u.uTexelS.value = L.texel;
    this.passStrip.render(this.renderer, this.strip, [0, T, SW, 1]);
    const u = this.passHeight.u;
    u.uTexel.value = L.texel;
    u.uLevel.value = T;
    (u.uCenter.value as THREE.Vector2).set(cx - this.originX, cz - this.originZ);
    u.uProfileX0.value = this.profileX0 - this.originX;
  }

  /** Draw up to `rows` rows of the tile in hand; finish it if that was the last of them. Returns rows drawn. */
  private stepJob(rows: number): number {
    const j = this.job!;
    const n = Math.min(rows, this.N - j.row);
    this.passHeight.render(this.renderer, this.scratch, [0, j.row, this.N, n]);
    j.row += n;
    if (j.row >= this.N) this.finishJob();
    return n;
  }

  private finishJob() {
    const j = this.job!;
    const T = j.level, L = this.levels[T], r = this.renderer;
    const [ox, oy] = this.tileOffset(T);
    const rect: [number, number, number, number] = [ox, oy, this.N, this.N];
    (this.passCopy.u.uOff.value as THREE.Vector2).set(ox, oy);
    this.passCopy.render(r, this.geo, rect, rect);
    (this.passNormal.u.uOff.value as THREE.Vector2).set(ox, oy);
    this.passNormal.u.uTexelN.value = L.texel;
    this.passNormal.render(r, this.norm, rect, rect);
    L.cx = j.cx;
    L.cz = j.cz;
    L.baked = true;
    this.syncLevelUniforms();
    this.job = null;
    this.bakes++;
    this.lightLevel(T);
  }

  private lightLevel(T: number) {
    const [ox, oy] = this.tileOffset(T);
    const rect: [number, number, number, number] = [ox, oy, this.N, this.N];
    (this.passLight.u.uOff.value as THREE.Vector2).set(ox, oy);
    this.passLight.u.uLevel.value = T;
    this.passLight.render(this.renderer, this.light, rect, rect);
  }

  /** Light direction (towards the sun, or the moon at night), local axes. Tiles are lit again as it moves. */
  setSun(dir: THREE.Vector3) {
    this.sun.copy(dir);
    if (this.litSun.angleTo(dir) > 0.0015 && this.relight.length === 0) {
      this.litSun.copy(dir);
      for (let T = 0; T < LEVELS; T++) this.relight.push(T);
    }
  }

  /** Everything at once, for the first frame. */
  bakeAll(camX: number, camZ: number) {
    this.bakeProfile(camX, true);
    for (let T = LEVELS - 1; T >= 0; T--) {
      this.startJob(T, camX, camZ);
      this.stepJob(this.N);
    }
    for (let T = 0; T < LEVELS; T++) this.lightLevel(T);
    this.litSun.copy(this.sun);
    this.relight.length = 0;
  }

  /** Call every frame with the camera's world position. */
  update(camX: number, camZ: number) {
    (this.uniforms().uClipCam.value as THREE.Vector2).set(camX - this.originX, camZ - this.originZ);
    if (Math.abs(camX - this.profileCentre) > 768 || this.profileOrigin !== this.originX + this.originZ * 1e-9) this.bakeProfile(camX);

    let budget = this.rowsPerFrame;
    while (budget > 0) {
      if (!this.job) {
        let next = -1;
        for (let T = 0; T < LEVELS; T++) {
          const L = this.levels[T];
          if (!L.baked || Math.abs(camX - L.cx) > RECENTRE * L.texel || Math.abs(camZ - L.cz) > RECENTRE * L.texel) { next = T; break; }
        }
        if (next < 0) break;
        this.startJob(next, camX, camZ);
      }
      budget -= this.stepJob(budget);
    }

    // one tile lit again per frame while the light moves
    if (this.relight.length) this.lightLevel(this.relight.shift()!);
  }

  private probeBusy = false;
  private probeL = new Uint8Array(4);
  private probeM = new Uint8Array(4);
  /** what the last probe found: how much of the light reaches the spot, and how wooded a second spot is */
  readonly probed = { reach: 1, forest: 0 };
  /** Read the baked light at one world position and the forest at another. Answers a frame or two later, in `probed`. */
  probe(x: number, z: number, fx: number, fz: number) {
    if (this.probeBusy) return;
    const L = this.levels[0];
    if (!L.baked) return;
    const at = (wx: number, wz: number): [number, number] => [
      Math.min(this.N - 1, Math.max(0, Math.floor((wx - L.cx) / L.texel + this.N / 2))),
      Math.min(this.N - 1, Math.max(0, Math.floor((wz - L.cz) / L.texel + this.N / 2))),
    ];
    const [ax, ay] = at(x, z), [bx, by] = at(fx, fz);
    this.probeBusy = true;
    Promise.all([
      this.renderer.readRenderTargetPixelsAsync(this.light, ax, ay, 1, 1, this.probeL),
      this.renderer.readRenderTargetPixelsAsync(this.geo, bx, by, 1, 1, this.probeM, undefined, 1),
    ])
      .then(() => {
        this.probed.reach = this.probeL[0] / 255;
        this.probed.forest = this.probeM[0] / 255;
      })
      .catch(() => {})
      .finally(() => (this.probeBusy = false));
  }

  dispose() {
    for (const rt of [this.geo, this.norm, this.light, this.scratch, this.strip, this.profA, this.profB]) rt.dispose();
  }
}
