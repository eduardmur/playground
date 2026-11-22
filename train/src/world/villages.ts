// Villages on the valley floor: a few dozen plain houses and a church, here and there along the line.
// Mostly they are something for the eye to find across the valley, and lights at night.
import * as THREE from 'three';
import { CLIPMAP, type TerrainBake } from './bake';
import { ATMOS, type Atmosphere } from './atmosphere';
import { LANDLIGHT } from './terrain';
import { routeAt, hash32, type Route } from './route';

const SITE_EVERY = 3600; // one place a village may stand per this many metres of line
const BEHIND = 9000, AHEAD = 16000;

const VERT = /* glsl */ `
${ATMOS}
${CLIPMAP}
attribute vec4 iPlace;   // x, z (from the group's origin), turn, seed
attribute vec3 iSize;    // width, height to the eaves, depth
uniform vec3 uCam;
uniform float uSunPrimary;
varying vec3 vPos;
varying vec3 vN;
varying vec3 vLocal;
varying vec4 vInfo;      // seed, roof?, baked shadow, sky
varying vec3 vTr;
varying vec3 vIns;
varying vec3 vSunL;
varying vec3 vMoonL;
void main() {
  vec2 base = (modelMatrix * vec4(iPlace.x, 0.0, iPlace.y, 1.0)).xz;
  float ground = heightAt(base) - 0.4;
  float c = cos(iPlace.z), s = sin(iPlace.z);
  // the unit house: walls from 0 to 1, the roof's ridge at 1.6 of the eaves' height
  vec3 lp = position * vec3(iSize.x, iSize.y, iSize.z);
  vec3 ln = normalize(normal / vec3(iSize.x, iSize.y, iSize.z));
  vLocal = lp;
  lp.xz = mat2(c, s, -s, c) * lp.xz;
  ln.xz = mat2(c, s, -s, c) * ln.xz;
  vPos = vec3(base.x, ground, base.y) + lp;
  vN = ln;
  vec4 Lt = clipSample(tL, base);
  vInfo = vec4(iPlace.w, uv.x, Lt.r, Lt.g);
  vec3 toP = vPos - uCam;
  float dd = length(toP);
  aerial(toP / dd, dd, vTr, vIns);
  vSunL = sunLightAt(vPos.y * 0.001);
  vMoonL = moonLightAt(vPos.y * 0.001);
  gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
}`;

const FRAG = /* glsl */ `
${ATMOS}
${CLIPMAP}
${LANDLIGHT}
uniform float uNight;    // 0 by day .. 1 when the lamps are lit
varying vec3 vPos;
varying vec3 vN;
varying vec3 vLocal;
varying vec4 vInfo;
varying vec3 vTr;
varying vec3 vIns;
varying vec3 vSunL;
varying vec3 vMoonL;
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  vec3 n = normalize(vN);
  float seed = vInfo.x, roof = vInfo.y;
  vec3 wall = mix(vec3(0.62, 0.6, 0.55), vec3(0.74, 0.7, 0.62), h1(seed));
  // the upper floor in dark timber, as they build here
  wall = mix(wall, vec3(0.16, 0.1, 0.06), step(0.5, h1(seed + 3.0)) * step(2.6, vLocal.y));
  vec3 roofC = mix(vec3(0.16, 0.12, 0.1), vec3(0.28, 0.16, 0.12), h1(seed + 7.0));
  vec3 albedo = mix(wall, roofC, roof);
  float shadow = vInfo.z, sky = vInfo.w;
  vec3 direct = vSunL * max(dot(n, uSunDir), 0.0) * mix(1.0, shadow, uSunPrimary) + vMoonL * max(dot(n, uMoonDir), 0.0) * mix(shadow, 1.0, uSunPrimary);
  vec3 col = albedo / PI * (direct + skyIrradiance(n) * sky);
  // windows: a grid on the walls, some of them lit after dark
  if (roof < 0.5 && abs(n.y) < 0.5) {
    vec2 g = vec2(dot(vLocal.xz, vec2(abs(n.z), abs(n.x))) / 2.4, vLocal.y / 2.7);
    vec2 cell = floor(g), f = fract(g);
    float pane = step(0.3, f.x) * step(f.x, 0.7) * step(0.35, f.y) * step(f.y, 0.78);
    float on = step(0.45, h1(seed * 13.0 + cell.x * 7.0 + cell.y * 3.0 + n.x * 5.0 + n.z * 9.0));
    col = mix(col, col * 0.25, pane);
    col += pane * on * uNight * vec3(1.0, 0.72, 0.38) * 0.035;
  }
  gl_FragColor = vec4((col * vTr + vIns) * uExposure, 1.0);
}`;

// a point of light for each house, so a village still shows when its houses are smaller than a pixel
const GLOW_VERT = /* glsl */ `
${ATMOS}
${CLIPMAP}
attribute vec4 iPlace;
attribute vec3 iSize;
uniform vec3 uCam;
uniform float uPixel;    // radians to a pixel
uniform float uNight;
varying vec2 vQ;
varying vec3 vCol;
void main() {
  vec2 base = (modelMatrix * vec4(iPlace.x, 0.0, iPlace.y, 1.0)).xz;
  vec3 wp = vec3(base.x, heightAt(base) + iSize.y * 0.6, base.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dist = length(mv.xyz);
  float on = step(0.3, fract(sin(iPlace.w * 91.7) * 43758.5453));
  // never smaller than a pixel and a half; dimmer with distance to make up for it
  float want = 0.9, least = dist * uPixel * 1.5;
  float size = max(want, least);
  vec3 tr, ins;
  aerial((wp - uCam) / max(length(wp - uCam), 1.0), length(wp - uCam), tr, ins);
  vCol = vec3(1.0, 0.7, 0.36) * 0.05 * uNight * on * (want * want) / (size * size) * tr * uExposure * smoothstep(150.0, 500.0, dist);
  vQ = position.xy;
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = /* glsl */ `
varying vec2 vQ;
varying vec3 vCol;
void main() {
  float r = dot(vQ, vQ);
  if (r > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-r * 3.0), 1.0);
}`;

function houseGeometry(): THREE.BufferGeometry {
  // a unit house about the origin: x and z from -0.5 to 0.5, walls up to y = 1, ridge along x at y = 1.6
  const p: number[] = [], n: number[] = [], uv: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], roof: number) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const q of [a, b, c, a, c, d]) {
      p.push(...q);
      n.push(...nn);
      uv.push(roof, 0);
    }
  };
  const x = 0.5, z = 0.5, e = 0.08;
  quad([-x, 0, z], [x, 0, z], [x, 1, z], [-x, 1, z], 0);
  quad([x, 0, -z], [-x, 0, -z], [-x, 1, -z], [x, 1, -z], 0);
  quad([x, 0, z], [x, 0, -z], [x, 1, -z], [x, 1, z], 0);
  quad([-x, 0, -z], [-x, 0, z], [-x, 1, z], [-x, 1, -z], 0);
  // gables
  for (const s of [-1, 1]) {
    const a = [s * x, 1, s * z], b = [s * x, 1, -s * z], c = [s * x, 1.6, 0];
    const nn = [s, 0, 0];
    for (const q of [a, b, c]) {
      p.push(...q);
      n.push(...nn);
      uv.push(0, 0);
    }
  }
  // roof, overhanging a little
  quad([-x - e, 0.94, z + e], [x + e, 0.94, z + e], [x + e, 1.62, 0], [-x - e, 1.62, 0], 1);
  quad([x + e, 0.94, -z - e], [-x - e, 0.94, -z - e], [-x - e, 1.62, 0], [x + e, 1.62, 0], 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

const rnd = (seed: number) => {
  let s = seed >>> 0;
  return () => (s = hash32(s + 0x9e3779b9)) / 4294967296;
};

export class Villages {
  readonly group = new THREE.Group();
  private houses: THREE.Mesh;
  private glow: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private glowGeo: THREE.InstancedBufferGeometry;
  private place: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private baseX = 0;
  private baseZ = 0;
  private builtAt = -1e12;
  private r = {} as Route;
  readonly night = { value: 0 };
  readonly pixel = { value: 0.001 };
  count = 0;

  constructor(private bake: TerrainBake, atmos: Atmosphere, extra: Record<string, THREE.IUniform>) {
    const MAX = 2400;
    this.place = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    const house = houseGeometry();
    this.geo = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'normal', 'uv']) this.geo.setAttribute(k, house.getAttribute(k));
    this.geo.setAttribute('iPlace', this.place);
    this.geo.setAttribute('iSize', this.size);
    const uniforms = { ...bake.uniforms(), ...atmos.uniforms(), ...extra, uNight: this.night, uPixel: this.pixel };
    this.houses = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, defines: bake.defines() }));
    this.glowGeo = new THREE.InstancedBufferGeometry();
    this.glowGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    this.glowGeo.setAttribute('iPlace', this.place);
    this.glowGeo.setAttribute('iSize', this.size);
    this.glow = new THREE.Mesh(
      this.glowGeo,
      new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms, defines: bake.defines(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.glow.renderOrder = 5;
    for (const m of [this.houses, this.glow]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  private rebuild(camX: number) {
    this.builtAt = camX;
    this.baseX = Math.round(camX / 1024) * 1024;
    this.baseZ = Math.round(routeAt(camX, this.r).zp / 1024) * 1024;
    const P = this.place.array as Float32Array, S = this.size.array as Float32Array;
    let n = 0;
    const max = P.length / 4;
    for (let site = Math.floor((camX - BEHIND) / SITE_EVERY); site <= Math.floor((camX + AHEAD) / SITE_EVERY); site++) {
      const rand = rnd(site * 7919 + 13);
      if (rand() < 0.2) continue; // not every place has a village
      const xs = (site + 0.2 + 0.6 * rand()) * SITE_EVERY;
      const r0 = routeAt(xs, this.r);
      if (r0.lake > 0.02 || Math.abs(r0.sigma) < 0.99 || r0.w < 150) continue;
      const uc = (rand() - 0.5) * 1.1 * r0.w;
      const houses = 14 + Math.floor(rand() * 34);
      for (let i = 0; i < houses && n < max; i++) {
        const g = () => (rand() + rand() + rand() - 1.5) * 1.2;
        const x = xs + g() * 170, r = routeAt(x, this.r);
        const u = uc + g() * 75;
        if (Math.abs(u) > r.w - 20 || Math.abs(u - r.riverU) < r.riverHW + 16) continue;
        const z = r.zp + r.c + u;
        if (Math.abs(z - r.zp) < 30) continue;
        const church = i === 0;
        P.set([x - this.baseX, z - this.baseZ, Math.atan2(r.dzp, 1) * -1 + (rand() < 0.5 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.5, site * 100 + i], n * 4);
        if (church) S.set([7, 9, 16], n * 3);
        else S.set([7 + rand() * 5, 4.4 + rand() * 3.2, 7 + rand() * 4], n * 3);
        n++;
        if (church && n < max) {
          // its tower: a tall narrow house at one end
          P.set([x - this.baseX + 9, z - this.baseZ, P[(n - 1) * 4 + 2], site * 100 + 99], n * 4);
          S.set([4.5, 19, 4.5], n * 3);
          n++;
        }
      }
    }
    this.count = n;
    this.geo.instanceCount = n;
    this.glowGeo.instanceCount = n;
    this.place.needsUpdate = true;
    this.size.needsUpdate = true;
  }

  update(camX: number, night: number, pixel: number) {
    if (Math.abs(camX - this.builtAt) > 1500) this.rebuild(camX);
    this.night.value = night;
    this.pixel.value = pixel;
    this.group.position.set(this.baseX - this.bake.originX, 0, this.baseZ - this.bake.originZ);
    this.group.updateMatrixWorld(true);
  }
}
