// The air: a physically based sky after Hillaire ("A Scalable and Production Ready Sky and
// Atmosphere Rendering Technique", 2020). Three small tables are computed on the GPU:
//   transmittance   how much light survives from a point to the top of the atmosphere
//   multi-scatter   light that has bounced more than once
//   sky view        the sky as seen from the camera's altitude, once for the sun and once for the moon
// Everything else (terrain haze, water, the light on the land) reads those.
//
// Units: kilometres inside the tables. Light is in "sun units": the sun delivers SUN_E per unit
// area above the atmosphere and the tables hold the answer for a sun of 1.
import * as THREE from 'three';
import { Pass } from '../render/fsq';

export const SUN_E = 20;
/** Moonlight is really 400 000 times weaker than sunlight; that leaves a night nobody can see. */
export const MOON_E = SUN_E * 3.2e-4;

const MEDIUM = /* glsl */ `
const float PI = 3.14159265359;
const float RG = 6360.0;
const float RT = 6460.0;
uniform float uHaze;
const vec3 RAY_S = vec3(5.802e-3, 13.558e-3, 33.1e-3);
const float MIE_S = 3.996e-3;
const float MIE_A = 4.40e-3;
const vec3 OZO_A = vec3(0.650e-3, 1.881e-3, 0.085e-3);

void medium(float h, out vec3 rayS, out float mieS, out vec3 ext) {
  float dr = exp(-h / 8.0), dm = exp(-h / 1.2) * uHaze;
  float dz = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  rayS = RAY_S * dr;
  mieS = MIE_S * dm;
  ext = rayS + vec3(mieS + MIE_A * dm) + OZO_A * dz;
}
float rayTop(float r, float mu) { return -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + RT * RT, 0.0)); }
// distance to the ground along the ray, or -1
float rayGround(float r, float mu) {
  float disc = r * r * (mu * mu - 1.0) + RG * RG;
  if (mu >= 0.0 || disc < 0.0) return -1.0;
  return -r * mu - sqrt(disc);
}
vec2 transUV(float r, float mu) {
  float H = sqrt(RT * RT - RG * RG);
  float rho = sqrt(max(r * r - RG * RG, 0.0));
  float d = rayTop(r, mu), dmin = RT - r, dmax = rho + H;
  return vec2((d - dmin) / (dmax - dmin), rho / H);
}
float phaseR(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
float phaseM(float c) {
  const float g = 0.8;
  return 3.0 / (8.0 * PI) * (1.0 - g * g) * (1.0 + c * c) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * c, 1.5));
}
`;

const TRANS_FRAG = /* glsl */ `
varying vec2 vUv;
${MEDIUM}
void main() {
  float H = sqrt(RT * RT - RG * RG);
  float rho = H * vUv.y;
  float r = sqrt(rho * rho + RG * RG);
  float dmin = RT - r, dmax = rho + H;
  float d = dmin + vUv.x * (dmax - dmin);
  float mu = d == 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  vec3 tau = vec3(0.0);
  const int STEPS = 48;
  float dt = d / float(STEPS);
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + 0.5) * dt;
    float h = sqrt(r * r + t * t + 2.0 * r * mu * t) - RG;
    vec3 rs, ex; float ms;
    medium(h, rs, ms, ex);
    tau += ex * dt;
  }
  gl_FragColor = vec4(exp(-tau), 1.0);
}`;

const LOOKUPS = /* glsl */ `
uniform sampler2D tTrans;
uniform sampler2D tMulti;
vec3 transTo(float r, float mu) { return texture(tTrans, transUV(r, mu)).rgb; }
// to a light with a disc: fades as the disc sinks behind the round earth
vec3 transToLight(float r, float mu) {
  float sinH = RG / r, cosH = -sqrt(max(1.0 - sinH * sinH, 0.0));
  return transTo(r, max(mu, cosH)) * smoothstep(-sinH * 0.0047, sinH * 0.0047, mu - cosH);
}
vec3 multiAt(float r, float mu) {
  return texture(tMulti, vec2(mu * 0.5 + 0.5, (r - RG) / (RT - RG))).rgb;
}
vec3 scatterAlong(vec3 pos, vec3 dir, vec3 sun, float tMax, int steps) {
  float c = dot(dir, sun);
  float pm = phaseM(c), pr = phaseR(c);
  vec3 lum = vec3(0.0), tr = vec3(1.0);
  float t = 0.0;
  for (int i = 0; i < steps; i++) {
    float nt = (float(i) + 0.3) / float(steps) * tMax;
    float dt = nt - t; t = nt;
    vec3 p = pos + dir * t;
    float r = length(p);
    vec3 rs, ex; float ms;
    medium(r - RG, rs, ms, ex);
    vec3 st = exp(-dt * ex);
    float mu = dot(p, sun) / r;
    vec3 sunT = transToLight(r, mu);
    vec3 psi = multiAt(r, mu);
    vec3 ins = rs * (pr * sunT + psi) + ms * (pm * sunT + psi);
    lum += (ins - ins * st) / ex * tr;
    tr *= st;
  }
  return lum;
}
`;

const MULTI_FRAG = /* glsl */ `
varying vec2 vUv;
${MEDIUM}
uniform sampler2D tTrans;
vec3 transTo(float r, float mu) { return texture(tTrans, transUV(r, mu)).rgb; }
void main() {
  float mus = vUv.x * 2.0 - 1.0;
  float r = RG + 0.01 + vUv.y * (RT - RG - 0.02);
  vec3 pos = vec3(0.0, r, 0.0);
  vec3 sun = vec3(sqrt(max(1.0 - mus * mus, 0.0)), mus, 0.0);
  vec3 lum = vec3(0.0), fms = vec3(0.0);
  const int SQ = 8;
  for (int i = 0; i < SQ; i++) for (int j = 0; j < SQ; j++) {
    float th = PI * (float(i) + 0.5) / float(SQ);
    float ph = acos(1.0 - 2.0 * (float(j) + 0.5) / float(SQ));
    vec3 dir = vec3(sin(ph) * cos(th * 2.0), cos(ph), sin(ph) * sin(th * 2.0));
    float mu = dir.y;
    float tg = rayGround(r, mu), tt = rayTop(r, mu);
    float tMax = tg > 0.0 ? tg : tt;
    vec3 l = vec3(0.0), lf = vec3(0.0), tr = vec3(1.0);
    float t = 0.0;
    const int ST = 20;
    for (int k = 0; k < ST; k++) {
      float nt = (float(k) + 0.3) / float(ST) * tMax;
      float dt = nt - t; t = nt;
      vec3 p = pos + dir * t;
      float rr = length(p);
      vec3 rs, ex; float ms;
      medium(rr - RG, rs, ms, ex);
      vec3 st = exp(-dt * ex);
      vec3 sc = rs + vec3(ms);
      lf += (sc - sc * st) / ex * tr;
      float m2 = dot(p, sun) / rr;
      float sinH = RG / rr, cosH = -sqrt(max(1.0 - sinH * sinH, 0.0));
      vec3 sunT = m2 > cosH ? transTo(rr, m2) : vec3(0.0);
      vec3 ins = sc * sunT / (4.0 * PI);
      l += (ins - ins * st) / ex * tr;
      tr *= st;
    }
    if (tg > 0.0) {
      // light off the ground
      vec3 hit = pos + dir * tg;
      float m3 = dot(normalize(hit), sun);
      if (m3 > 0.0) l += tr * transTo(RG, m3) * m3 * 0.3 / PI;
    }
    lf /= float(SQ * SQ); l /= float(SQ * SQ);
    lum += l; fms += lf;
  }
  gl_FragColor = vec4(lum / (1.0 - fms), 1.0);
}`;

const SKYVIEW_FRAG = /* glsl */ `
varying vec2 vUv;
${MEDIUM}${LOOKUPS}
uniform float uAlt;      // camera altitude, km
uniform float uSunAlt;   // light's altitude angle, radians
void main() {
  float az = (vUv.x - 0.5) * 2.0 * PI;
  float v = vUv.y, adj;
  if (v < 0.5) { float c = 1.0 - 2.0 * v; adj = -c * c; } else { float c = v * 2.0 - 1.0; adj = c * c; }
  float r = RG + uAlt;
  float dip = acos(RG / r);              // how far the horizon lies under the horizontal
  float alt = adj * 0.5 * PI - dip;      // the table is centred on the horizon, where the sky changes fastest
  float ca = cos(alt);
  vec3 dir = vec3(ca * sin(az), sin(alt), -ca * cos(az));
  vec3 sun = vec3(0.0, sin(uSunAlt), -cos(uSunAlt));
  float tg = rayGround(r, dir.y), tt = rayTop(r, dir.y);
  vec3 lum = scatterAlong(vec3(0.0, r, 0.0), dir, sun, tg > 0.0 ? tg : tt, 40);
  gl_FragColor = vec4(lum, 1.0);
}`;

/** For materials: the sky in any direction, light reaching a point, and haze between the eye and a point. */
export const ATMOS = /* glsl */ `
${MEDIUM}
uniform sampler2D tTrans;
uniform sampler2D tSkySun;
uniform sampler2D tSkyMoon;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunE;      // sun above the atmosphere, in scene units
uniform vec3 uMoonE;
uniform float uCamAlt;   // km
uniform float uExposure;

vec3 skyLUT(sampler2D lut, vec3 dir, vec3 light) {
  float r = RG + uCamAlt;
  float alt = asin(clamp(dir.y, -1.0, 1.0)) + acos(RG / r);
  float az = 0.0;
  if (abs(alt) < 0.5 * PI - 1e-4) {
    vec3 right = normalize(cross(light, vec3(0.0, 1.0, 0.0)) + vec3(1e-6, 0.0, 0.0));
    vec3 fwd = cross(vec3(0.0, 1.0, 0.0), right);
    vec3 pd = normalize(vec3(dir.x, 0.0, dir.z) + vec3(0.0, 0.0, 1e-6));
    az = atan(dot(pd, right), dot(pd, fwd)) + PI;
  }
  float v = 0.5 + 0.5 * sign(alt) * sqrt(abs(alt) * 2.0 / PI);
  return texture(lut, vec2(az / (2.0 * PI), v)).rgb;
}
// the sky's own light in a direction, before stars and discs
vec3 skyRadiance(vec3 dir) {
  return skyLUT(tSkySun, dir, uSunDir) * uSunE + skyLUT(tSkyMoon, dir, uMoonDir) * uMoonE;
}
vec3 transTo(float r, float mu) { return texture(tTrans, transUV(r, mu)).rgb; }
vec3 lightAt(float altKm, vec3 lightDir, vec3 E) {
  float r = RG + max(altKm, 0.0);
  float sinH = RG / r, cosH = -sqrt(max(1.0 - sinH * sinH, 0.0));
  return E * transTo(r, max(lightDir.y, cosH)) * smoothstep(-sinH * 0.0047, sinH * 0.0047, lightDir.y - cosH);
}
// the direct light on something at this altitude: the sun, or the moon once the sun has gone
vec3 sunLightAt(float altKm) { return lightAt(altKm, uSunDir, uSunE); }
vec3 moonLightAt(float altKm) { return lightAt(altKm, uMoonDir, uMoonE); }

// density integrals (rayleigh, mie) along a ray from altitude h0 (km), rising at sy, for d km
vec2 airPath(float h0, float sy, float d) {
  const vec2 Hs = vec2(8.0, 1.2);
  vec2 k = sy / Hs;
  vec2 kd = k * d;
  vec2 I = mix(d * (1.0 - 0.5 * kd), (1.0 - exp(-kd)) / (k + step(abs(k), vec2(1e-7)) * 1e-7), step(1e-3, abs(kd)));
  return exp(-max(h0, 0.0) / Hs) * I;
}
vec3 airExt(vec2 path) { return RAY_S * path.x + (MIE_S + MIE_A) * uHaze * path.y; }
// between the eye (at uCamAlt) and a point d metres off in direction dir: what gets through, and the light added
void aerial(vec3 dir, float dist, out vec3 trans, out vec3 inscatter) {
  float d = dist * 0.001;
  float sy = dir.y;
  vec3 tau = airExt(airPath(uCamAlt, sy, d));
  float dEnd = sy > 0.0 ? min((60.0 - uCamAlt) / max(sy, 1e-3), 700.0) : min(uCamAlt / max(-sy, 1e-3), 700.0);
  vec3 tauEnd = airExt(airPath(uCamAlt, sy, max(dEnd, d)));
  trans = exp(-tau);
  // the light added along a short path is not the glow of the far horizon: take the sky a little above it
  vec3 sd = normalize(vec3(dir.x, abs(dir.y) * 0.5 + 0.1, dir.z));
  inscatter = skyRadiance(sd) * (1.0 - trans) / (1.0 - exp(-tauEnd) + 1e-4);
}
`;

export class Atmosphere {
  readonly trans: THREE.WebGLRenderTarget;
  readonly multi: THREE.WebGLRenderTarget;
  readonly skySun: THREE.WebGLRenderTarget;
  readonly skyMoon: THREE.WebGLRenderTarget;
  private passTrans: Pass;
  private passMulti: Pass;
  private passSky: Pass;

  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, -1, 0);
  readonly haze = { value: 1.0 };
  private shared: Record<string, THREE.IUniform>;
  /** sky radiance per unit sun, read back: spherical harmonics of the sky for ambient light */
  private skyPixels = new Float32Array(SKY_W * SKY_H * 4);
  /** the sky's radiance as nine spherical-harmonic coefficients (rgb each), scene units, world axes */
  readonly ambient = { sh: new Float32Array(27) };
  private built = false;
  private lastHaze = -1;

  constructor(private renderer: THREE.WebGLRenderer) {
    const opt = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    this.trans = new THREE.WebGLRenderTarget(256, 64, opt);
    this.multi = new THREE.WebGLRenderTarget(32, 32, opt);
    this.skySun = new THREE.WebGLRenderTarget(SKY_W, SKY_H, { ...opt, type: THREE.FloatType });
    this.skyMoon = new THREE.WebGLRenderTarget(SKY_W, SKY_H, { ...opt, type: THREE.FloatType });
    this.skySun.texture.wrapS = this.skyMoon.texture.wrapS = THREE.RepeatWrapping;
    this.passTrans = new Pass(TRANS_FRAG, { uHaze: this.haze });
    this.passMulti = new Pass(MULTI_FRAG, { uHaze: this.haze, tTrans: { value: this.trans.texture } });
    this.passSky = new Pass(SKYVIEW_FRAG, {
      uHaze: this.haze, tTrans: { value: this.trans.texture }, tMulti: { value: this.multi.texture }, uAlt: { value: 1 }, uSunAlt: { value: 0 },
    });
    this.shared = {
      uHaze: this.haze,
      tTrans: { value: this.trans.texture },
      tSkySun: { value: this.skySun.texture },
      tSkyMoon: { value: this.skyMoon.texture },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uSunE: { value: new THREE.Vector3(SUN_E, SUN_E * 0.98, SUN_E * 0.94) },
      uMoonE: { value: new THREE.Vector3(MOON_E * 0.86, MOON_E * 0.93, MOON_E * 1.0) },
      uCamAlt: { value: 1 },
      uExposure: { value: 1 },
    };
  }

  /** The uniforms ATMOS declares; share between materials. */
  uniforms() {
    return this.shared;
  }

  /** Recompute what depends on where the lights are and how high the camera is. */
  update(camAltMetres: number) {
    const r = this.renderer;
    if (!this.built || this.lastHaze !== this.haze.value) {
      this.passTrans.render(r, this.trans);
      this.passMulti.render(r, this.multi);
      this.built = true;
      this.lastHaze = this.haze.value;
    }
    const alt = Math.max(0.05, camAltMetres / 1000);
    this.shared.uCamAlt.value = alt;
    this.passSky.u.uAlt.value = alt;
    this.passSky.u.uSunAlt.value = Math.asin(THREE.MathUtils.clamp(this.sunDir.y, -1, 1));
    this.passSky.render(r, this.skySun);
    this.passSky.u.uSunAlt.value = Math.asin(THREE.MathUtils.clamp(this.moonDir.y, -1, 1));
    this.passSky.render(r, this.skyMoon);
  }

  /**
   * Ambient light from the sky, worked out on the CPU from the sky tables (a few times a second is
   * plenty): second-order spherical harmonics of the radiance, in scene units, world axes.
   */
  async updateAmbient() {
    const r = this.renderer;
    const E = this.shared.uSunE.value as THREE.Vector3, M = this.shared.uMoonE.value as THREE.Vector3;
    const sh = new Float64Array(27);
    for (const [rt, dir, e] of [[this.skySun, this.sunDir, E], [this.skyMoon, this.moonDir, M]] as const) {
      await r.readRenderTargetPixelsAsync(rt, 0, 0, SKY_W, SKY_H, this.skyPixels);
      accumulateSH(this.skyPixels, dir, e, this.shared.uCamAlt.value as number, sh);
    }
    for (let i = 0; i < 27; i++) this.ambient.sh[i] = sh[i];
  }
}

export const SKY_W = 192;
export const SKY_H = 108;

/** Project one sky table onto SH (9 coefficients x rgb), turning its sun-relative azimuth back to world axes. */
function accumulateSH(px: Float32Array, light: THREE.Vector3, e: THREE.Vector3, altKm: number, sh: Float64Array) {
  const RGk = 6360, r = RGk + altKm;
  const dip = Math.acos(RGk / r);
  // the table's forward (azimuth 0) is the light's heading
  const lh = Math.hypot(light.x, light.z) || 1;
  const fx = light.x / lh, fz = light.z / lh;
  const AZ = 24, EL = 12;
  let wsum = 0;
  const acc = new Float64Array(27);
  for (let j = 0; j < EL; j++) {
    // cosine-uniform in elevation over the whole sphere
    const y = -1 + (2 * (j + 0.5)) / EL;
    const elev = Math.asin(y);
    const altA = elev + dip; // angle above the true horizon
    const v = 0.5 + 0.5 * Math.sign(altA) * Math.sqrt(Math.min(1, (Math.abs(altA) * 2) / Math.PI));
    const row = Math.min(SKY_H - 1, Math.max(0, Math.floor(v * SKY_H)));
    const ch = Math.cos(elev);
    for (let i = 0; i < AZ; i++) {
      const az = ((i + 0.5) / AZ) * 2 * Math.PI; // relative to the light, as in the table: az - PI is the angle from forward
      const col = Math.min(SKY_W - 1, Math.floor((az / (2 * Math.PI)) * SKY_W));
      const o = (row * SKY_W + col) * 4;
      const a = az - Math.PI;
      // in the table, a = 0 looks towards the light; in the world that is (fx, fz), and a grows towards cross(light, up) = (-fz, fx)
      const sa = Math.sin(a), ca = Math.cos(a);
      const dx = ch * (ca * fx + sa * -fz), dz = ch * (ca * fz + sa * fx);
      const L = [px[o] * e.x, px[o + 1] * e.y, px[o + 2] * e.z];
      const b = [0.282095, 0.488603 * y, 0.488603 * dz, 0.488603 * dx, 1.092548 * dx * y, 1.092548 * y * dz, 0.315392 * (3 * dz * dz - 1), 1.092548 * dx * dz, 0.546274 * (dx * dx - y * y)];
      for (let k = 0; k < 9; k++) for (let c = 0; c < 3; c++) acc[k * 3 + c] += L[c] * b[k];
      wsum++;
    }
  }
  const norm = (4 * Math.PI) / wsum;
  for (let i = 0; i < 27; i++) sh[i] += acc[i] * norm;
}
