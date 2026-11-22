// The ground as geometry: nested square rings of a regular grid, each twice as coarse as the one
// inside it, all centred on the camera and lifted by the baked height tiles. Rings morph into the
// next coarser grid at their rim, so there are no cracks and nothing pops.
import * as THREE from 'three';
import { CLIPMAP, LINE, BED_CENTRE, BED_HALF, type TerrainBake } from './bake';
import { ATMOS, type Atmosphere } from './atmosphere';
import { HASH, ROUTE } from './glsl/lib';
import { CLOUDS } from './clouds';

export const MESH_LEVELS = 10;
const BLOCK = 64; // cells along a block
const E0 = 105; // half-width of the finest ring, metres

/** Lighting shared by everything that stands on the land. Needs ATMOS and CLIPMAP first. */
export const LANDLIGHT = /* glsl */ `
uniform vec3 uSH[9];
uniform float uSunPrimary;   // 1: the baked shadow is the sun's; 0: the moon's
vec3 skyIrradiance(vec3 n) {
  return 0.886227 * uSH[0]
    + 1.023328 * (uSH[1] * n.y + uSH[2] * n.z + uSH[3] * n.x)
    + 0.858086 * (uSH[4] * n.x * n.y + uSH[5] * n.y * n.z + uSH[7] * n.x * n.z)
    + 0.247708 * uSH[6] * (3.0 * n.z * n.z - 1.0)
    + 0.429043 * uSH[8] * (n.x * n.x - n.y * n.y);
}
// direct light on a surface with normal n at altitude altM, given the baked shadow there
vec3 directLight(vec3 n, float altM, float shadow, float wrap) {
  float km = altM * 0.001;
  vec3 s = sunLightAt(km) * max((dot(n, uSunDir) + wrap) / (1.0 + wrap), 0.0) * mix(1.0, shadow, uSunPrimary);
  vec3 m = moonLightAt(km) * max((dot(n, uMoonDir) + wrap) / (1.0 + wrap), 0.0) * mix(shadow, 1.0, uSunPrimary);
  return s + m;
}
`;

const VERT = /* glsl */ `
${HASH}
${ROUTE}
${ATMOS}
${CLIPMAP}
uniform sampler2D tNoise;
${CLOUDS}
uniform vec3 uCam;
uniform float uSunPrimary;
attribute vec4 iBlock;        // corner x, z (local); cell size; ring
uniform vec4 uRing[${MESH_LEVELS}];     // centre x, z; half-width; -
uniform vec2 uRingTex[${MESH_LEVELS}];  // tile level this ring reads, and the one the next ring reads
uniform vec4 uHole[${MESH_LEVELS}];     // the part of each ring covered by the finer one inside it
varying vec3 vPos;
varying vec4 vHole;
varying float vWater;
varying vec3 vTr;
varying vec3 vIns;
varying vec3 vSunL;
varying vec3 vMoonL;
varying float vCloud;
void main() {
  int ring = int(iBlock.w);
  vec4 R = uRing[ring];
  vec2 p = iBlock.xy + position.xz * iBlock.z;
  vec2 d = abs(p - R.xy) / R.z;
  float m = smoothstep(0.7, 0.93, max(d.x, d.y));
  vec2 g = (p - R.xy) / iBlock.z;
  p -= mod(floor(g + 0.5), 2.0) * iBlock.z * m;
  vec2 tl = uRingTex[ring];
  float h = heightTile(int(tl.x), p);
  if (m > 0.0) h = mix(h, heightTile(int(tl.y), p), m);
  // lakes and the river are part of this surface: ground under the water line is lifted to it
  vWater = valleyFloorAt(p.x) - WATER_DROP;
  vPos = vec3(p.x, max(h, vWater), p.y);
  vHole = uHole[ring];
  // what changes slowly over the land is worked out here, a vertex at a time: the haze in front of it,
  // the colour of the sun and the moon at its height, the shade of the clouds
  vec3 toP = vPos - uCam;
  float dist = length(toP);
  aerial(toP / dist, dist, vTr, vIns);
  vSunL = sunLightAt(vPos.y * 0.001);
  vMoonL = moonLightAt(vPos.y * 0.001);
  vCloud = cloudShadow(vPos, mix(uMoonDir, uSunDir, uSunPrimary));
  gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
}
`;

const FRAG = /* glsl */ `
${ATMOS}
${CLIPMAP}
${LANDLIGHT}
${LINE}
uniform sampler2D tNoise;
${CLOUDS}
uniform vec3 uCam;          // local
uniform float uTreeFar;     // beyond this trees are no longer drawn and the forest is painted on
uniform float uTime;
varying vec3 vPos;
varying vec4 vHole;
varying float vWater;
varying vec3 vTr;
varying vec3 vIns;
varying vec3 vSunL;
varying vec3 vMoonL;
varying float vCloud;

vec3 sunMoon(vec3 n, float shadow) {
  return vSunL * max(dot(n, uSunDir), 0.0) * mix(1.0, shadow, uSunPrimary) + vMoonL * max(dot(n, uMoonDir), 0.0) * mix(shadow, 1.0, uSunPrimary);
}

vec3 lin(float r, float g, float b) { return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }

void main() {
  vec2 p = vPos.xz;
  if (p.x > vHole.x && p.x < vHole.z && p.y > vHole.y && p.y < vHole.w) discard;

  vec3 toP = vPos - uCam;
  float dist = length(toP);
  vec3 V = toP / dist;

  int T; float lb;
  clipLevel(p, T, lb);
  vec2 uvA = atlasUV(T, tileQ(T, p));
  vec4 G = texture(tG, uvA), M = texture(tM, uvA), Lt = texture(tL, uvA);
  if (lb > 0.0) {
    vec2 uvB = atlasUV(T + 1, tileQ(T + 1, p));
    G = mix(G, texture(tG, uvB), lb); M = mix(M, texture(tM, uvB), lb); Lt = mix(Lt, texture(tL, uvB), lb);
  }
  // where the line goes underground the ground is left standing: all but what would block the tunnel's mouth
  if (M.b > 0.12 && M.b < 0.45 && dist < 3500.0) {
    vec3 bl = besideLine(vPos);
    if (bl.z > 0.5 && abs(bl.x - (${BED_CENTRE.toFixed(1)})) < ${(BED_HALF - 0.1).toFixed(1)} && bl.y < 7.9) discard;
  }
  vec3 n = normalize(vec3(G.x, sqrt(max(1.0 - G.x * G.x - G.y * G.y, 0.0)), G.y));
  float slope = G.w;                 // rise over run
  float alt = vPos.y;

  // noise at four sizes: 4 km, 512 m, 64 m, 8 m to the tile
  float nearK = 1.0 - smoothstep(60.0, 400.0, dist);
  float midK = 1.0 - smoothstep(700.0, 5000.0, dist);
  vec4 n0 = texture(tNoise, p / 4096.0);
  vec4 n1 = texture(tNoise, p / 512.0);
  vec4 n2 = midK > 0.0 ? texture(tNoise, p / 64.0) : vec4(0.5);
  vec4 n3 = nearK > 0.0 ? texture(tNoise, p / 8.0) : vec4(0.5);

  // small relief the tiles are too coarse to hold
  vec2 bump = (n2.xy - 0.5) * 0.55 * midK + (n3.xy - 0.5) * 0.5 * nearK + (n1.xy - 0.5) * 0.35;
  float rough = smoothstep(0.35, 1.0, slope);
  vec3 nd = normalize(n + vec3(bump.x, 0.0, bump.y) * (0.25 + 0.75 * rough));

  // ---- what is on the ground
  float forest = M.r, gully = M.g, works = M.b;
  float depth = (M.a - 0.5) * 32.0;      // metres of water over the ground here
  float wet = smoothstep(-0.5, 0.05, depth);

  vec3 grassLow = mix(lin(74.0, 104.0, 38.0), lin(108.0, 128.0, 52.0), n1.b);
  grassLow = mix(grassLow, lin(132.0, 132.0, 62.0), smoothstep(0.55, 0.8, n2.a) * 0.6);
  vec3 grassHigh = mix(lin(112.0, 108.0, 60.0), lin(136.0, 124.0, 78.0), n1.a);
  vec3 grass = mix(grassLow, grassHigh, smoothstep(1700.0, 2350.0, alt + (n1.b - 0.5) * 300.0));

  // rock: banded along the strata, lighter and darker beds
  float steep = slope + (n2.b - 0.5) * 0.35 + (n1.a - 0.5) * 0.25;
  float rockW = smoothstep(0.75, 1.15, steep);
  rockW = max(rockW, smoothstep(2250.0, 2700.0, alt + (n1.a - 0.5) * 400.0) * smoothstep(0.3, 0.7, steep));
  vec3 rock = lin(120.0, 115.0, 108.0);
  if (rockW > 0.004 || works > 0.2) {
    float bed = texture(tNoise, vec2(alt * 0.004 + n1.b * 0.35, dot(p, vec2(0.0007, 0.0004)))).b;
    rock = mix(lin(96.0, 92.0, 88.0), lin(150.0, 143.0, 132.0), smoothstep(0.3, 0.7, bed));
    rock *= 0.82 + 0.36 * n2.b;
    rock = mix(rock, lin(120.0, 104.0, 84.0), smoothstep(0.6, 0.85, n0.a) * 0.4);
  }
  vec3 scree = lin(150.0, 146.0, 138.0) * (0.85 + 0.3 * n3.b);
  float screeW = smoothstep(0.5, 0.8, steep) * (1.0 - rockW) * smoothstep(1900.0, 2400.0, alt + (n0.b - 0.5) * 500.0);

  vec3 albedo = grass;
  albedo = mix(albedo, scree, screeW);
  albedo = mix(albedo, rock, rockW);

  // forest: its floor near by, its canopy once the trees themselves are no longer drawn
  float canopy = forest * mix(smoothstep(200.0, 1100.0, dist) * 0.8, 1.0, smoothstep(uTreeFar * 0.75, uTreeFar, dist));
  vec3 floorC = lin(50.0, 56.0, 34.0) * (0.8 + 0.4 * n3.b);
  albedo = mix(albedo, floorC, smoothstep(0.35, 0.85, forest) * (1.0 - rockW) * 0.8);
  if (canopy > 0.004) {
    vec4 sp = texture(tNoise, p / 23.0);
    vec3 canopyC = mix(lin(22.0, 36.0, 22.0), lin(36.0, 52.0, 28.0), n1.b) * (0.55 + 0.9 * sp.b);
    albedo = mix(albedo, canopyC, canopy * (1.0 - rockW * 0.7));
    nd = normalize(mix(nd, n + vec3(sp.x - 0.5, 0.0, sp.y - 0.5) * 1.6, canopy * 0.8));
  }

  // the railway's earthworks, river gravel
  vec3 gravel = lin(126.0, 118.0, 108.0) * (0.75 + 0.5 * n3.b);
  albedo = mix(albedo, mix(rock, gravel, 0.6), smoothstep(0.3, 0.6, works));
  albedo = mix(albedo, gravel * mix(0.95, 0.55, smoothstep(0.4, 1.0, wet)), wet);

  // snow: above a ragged line, less on steep faces, more in hollows and on the shaded side
  float snowLine = 2620.0 + (n0.b - 0.5) * 500.0 + (n1.b - 0.5) * 260.0 - n.x * 160.0;
  float snow = smoothstep(snowLine - 60.0, snowLine + 140.0, alt + G.z * 40.0 + (n2.b - 0.5) * 120.0);
  snow *= 1.0 - smoothstep(1.1, 1.9, slope + (n2.a - 0.5) * 0.5);
  // old snow lying in the gullies lower down
  snow = max(snow, (1.0 - smoothstep(0.2, 0.42, gully)) * smoothstep(2250.0, 2550.0, alt) * 0.9 * (1.0 - smoothstep(0.8, 1.3, slope)));
  albedo = mix(albedo, vec3(0.86, 0.89, 0.93), snow);
  nd = normalize(mix(nd, n, snow * 0.7));

  // ---- light
  float shadow = Lt.r * vCloud, sky = Lt.g;
  vec3 direct = sunMoon(nd, shadow);
  vec3 amb = skyIrradiance(nd) * sky;
  // light thrown back up by the land around
  amb += (vSunL * max(uSunDir.y, 0.0) + vMoonL * max(uMoonDir.y, 0.0)) * 0.13 * vec3(0.5, 0.52, 0.42) * (1.0 - 0.5 * nd.y) * (0.35 + 0.65 * sky);
  vec3 col = albedo / PI * (direct + amb);

  // snow glints towards a low sun
  if (snow > 0.01) {
    vec3 H = normalize(uSunDir - V);
    col += snow * vSunL * shadow * pow(max(dot(nd, H), 0.0), 90.0) * 0.12;
  }

  if (depth > 0.0) {
    // ---- water: the bed seen through it, the sky and the far shore mirrored in it
    vec3 sunL = (vSunL + vMoonL) * shadow;
    vec3 thru = exp(-depth * vec3(0.55, 0.16, 0.12));
    vec3 body = vec3(0.018, 0.085, 0.09) * (sunL * max(uSunDir.y, 0.0) * 0.6 + skyIrradiance(vec3(0.0, 1.0, 0.0)) * sky) / PI;
    vec3 under = mix(body, col * 0.8, thru);
    // ripples: two sheets of noise sliding over each other, calmer far out on a lake
    float calm = smoothstep(0.5, 6.0, depth);
    vec2 w1 = texture(tNoise, p / 9.0 + uTime * vec2(0.021, 0.013)).xy - 0.5;
    vec2 w2 = texture(tNoise, p / 31.0 - uTime * vec2(0.008, 0.012)).xy - 0.5;
    vec2 w3 = texture(tNoise, p / 2.3 + uTime * vec2(0.05, -0.03)).xy - 0.5;
    vec2 rip = (w1 * 0.05 + w2 * 0.07) * mix(1.6, 1.0, calm) + w3 * 0.05 * (1.0 - smoothstep(30.0, 200.0, dist));
    vec3 wn = normalize(vec3(rip.x, 1.0, rip.y));
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-V, wn), 0.0), 5.0);
    vec3 R = reflect(V, wn);
    R.y = abs(R.y) + 0.002;
    R = normalize(R);
    vec3 refl = skyRadiance(R);
    // what stands on the far shore, mirrored: walk the reflected ray over the height tiles
    {
      float t = 6.0, hit = -1.0;
      vec3 q;
      for (int i = 0; i < 26; i++) {
        q = vec3(p.x, vWater, p.y) + R * t;
        if (q.y > 4600.0) break;
        float hq = heightAt(q.xz);
        if (hq > q.y) { hit = t; break; }
        t *= 1.32;
      }
      if (hit > 0.0) {
        // one step back and in again, finer, so the mirrored skyline is not stepped
        float t0 = hit / 1.32, t1 = hit;
        for (int i = 0; i < 5; i++) {
          float tm = 0.5 * (t0 + t1);
          vec3 qm = vec3(p.x, vWater, p.y) + R * tm;
          if (heightAt(qm.xz) > qm.y) t1 = tm; else t0 = tm;
        }
        q = vec3(p.x, vWater, p.y) + R * t1;
        vec4 Gq = clipSample(tG, q.xz), Mq = clipSample(tM, q.xz), Lq = clipSample(tL, q.xz);
        vec3 nq = normalize(vec3(Gq.x, sqrt(max(1.0 - Gq.x * Gq.x - Gq.y * Gq.y, 0.0)), Gq.y));
        vec3 aq = mix(vec3(0.07, 0.11, 0.035), vec3(0.2, 0.19, 0.18), smoothstep(0.75, 1.15, Gq.w));
        aq = mix(aq, vec3(0.022, 0.04, 0.018), Mq.r * (1.0 - smoothstep(0.75, 1.15, Gq.w)));
        aq = mix(aq, vec3(0.85), smoothstep(2600.0, 2800.0, q.y) * (1.0 - smoothstep(1.1, 1.9, Gq.w)));
        vec3 lq = aq / PI * (sunMoon(nq, Lq.r * vCloud) + skyIrradiance(nq) * Lq.g);
        vec3 tq, iq;
        aerial(R, t1 + dist, tq, iq);
        refl = lq * tq + iq;
      }
    }
    // the sun's glitter path
    vec3 Hs = normalize(uSunDir - V);
    float gl = pow(max(dot(wn, Hs), 0.0), 900.0) * 60.0 + pow(max(dot(wn, Hs), 0.0), 120.0) * 1.2;
    vec3 Hm = normalize(uMoonDir - V);
    float gm = pow(max(dot(wn, Hm), 0.0), 900.0) * 60.0 + pow(max(dot(wn, Hm), 0.0), 120.0) * 1.2;
    refl += vSunL * shadow * uSunPrimary * gl + vMoonL * shadow * (1.0 - uSunPrimary) * gm;
    float edge = smoothstep(0.0, 0.25, depth);
    col = mix(col, mix(under, refl, fres), edge);
  }

  col = col * vTr + vIns;
  gl_FragColor = vec4(col * uExposure, 1.0);
}
`;

export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private iBlock: THREE.InstancedBufferAttribute;
  private ring: THREE.Vector4[] = [];
  private ringTex: THREE.Vector2[] = [];
  private hole: THREE.Vector4[] = [];
  private blocksPerSide: number;
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  private box = new THREE.Box3();
  drawn = 0;

  constructor(private bake: TerrainBake, atmos: Atmosphere, extra: Record<string, THREE.IUniform>, blocksPerSide = 8) {
    this.blocksPerSide = blocksPerSide;
    const n = BLOCK + 1;
    const pos = new Float32Array(n * n * 3);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) pos.set([x, 0, z], (z * n + x) * 3);
    const idx = new Uint32Array(BLOCK * BLOCK * 6);
    let k = 0;
    for (let z = 0; z < BLOCK; z++) {
      for (let x = 0; x < BLOCK; x++) {
        const a = z * n + x, b = a + 1, c = a + n, d = c + 1;
        // alternate the diagonal so slopes do not all crease the same way
        if ((x + z) & 1) idx.set([a, c, b, b, c, d], k);
        else idx.set([a, c, d, a, d, b], k);
        k += 6;
      }
    }
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const max = MESH_LEVELS * blocksPerSide * blocksPerSide;
    this.iBlock = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.iBlock.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iBlock', this.iBlock);

    const r0 = (bake.N / 2 - 72) * bake.t0;
    for (let l = 0; l < MESH_LEVELS; l++) {
      this.ring.push(new THREE.Vector4());
      this.hole.push(new THREE.Vector4(1, 1, -1, -1));
      const lvl = (ll: number) => Math.min(7, Math.max(0, Math.ceil(Math.log2((E0 * 2 ** ll * 1.02) / r0))));
      this.ringTex.push(new THREE.Vector2(lvl(l), lvl(Math.min(l + 1, MESH_LEVELS - 1))));
    }

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: bake.defines(),
      uniforms: {
        ...bake.uniforms(),
        ...bake.lineUniforms,
        ...atmos.uniforms(),
        ...extra,
        uRing: { value: this.ring },
        uRingTex: { value: this.ringTex },
        uHole: { value: this.hole },
      },
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /**
   * Lay the rings out around the camera and keep the blocks it can see.
   * camX/camZ are world coordinates; the camera itself is expected to be in local ones.
   */
  update(camX: number, camZ: number, camera: THREE.Camera) {
    const ox = this.bake.originX, oz = this.bake.originZ;
    const cells = this.blocksPerSide * BLOCK;
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const a = this.iBlock.array as Float32Array;
    let count = 0;
    let px = 0, pz = 0, pe = 0;
    for (let l = 0; l < MESH_LEVELS; l++) {
      const half = E0 * 2 ** l;
      const cell = (2 * half) / cells;
      const snap = cell * 2;
      const cx = Math.round(camX / snap) * snap - ox, cz = Math.round(camZ / snap) * snap - oz;
      this.ring[l].set(cx, cz, half, 0);
      const eps = cell * 0.002;
      if (l > 0) this.hole[l].set(px - pe + eps, pz - pe + eps, px + pe - eps, pz + pe - eps);
      const bs = cell * BLOCK;
      for (let bz = 0; bz < this.blocksPerSide; bz++) {
        for (let bx = 0; bx < this.blocksPerSide; bx++) {
          const x0 = cx - half + bx * bs, z0 = cz - half + bz * bs;
          if (l > 0 && x0 >= px - pe && x0 + bs <= px + pe && z0 >= pz - pe && z0 + bs <= pz + pe) continue;
          this.box.min.set(x0, 0, z0);
          this.box.max.set(x0 + bs, 4800, z0 + bs);
          if (!this.frustum.intersectsBox(this.box)) continue;
          a[count * 4] = x0;
          a[count * 4 + 1] = z0;
          a[count * 4 + 2] = cell;
          a[count * 4 + 3] = l;
          count++;
        }
      }
      px = cx; pz = cz; pe = half;
    }
    this.geo.instanceCount = count;
    this.iBlock.clearUpdateRanges();
    this.iBlock.addUpdateRange(0, count * 4);
    this.iBlock.needsUpdate = true;
    this.drawn = count;
  }
}
