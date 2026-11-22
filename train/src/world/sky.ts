// What is behind the land: the sky's own light from the atmosphere tables, the sun's and the
// moon's discs, stars and the Milky Way. Drawn as one triangle over the whole view, first.
import * as THREE from 'three';
import { ATMOS, type Atmosphere } from './atmosphere';
import { FSQ_VERT } from '../render/fsq';
import { CLOUDS } from './clouds';

const LAT = (46.6 * Math.PI) / 180;
const DECL = (4 * Math.PI) / 180; // a few weeks off the equinox: sunrise a little before six
const MOON_LAG = (118 * Math.PI) / 180; // the moon follows the sun by this much: a gibbous moon that sets after midnight
const MOON_DECL = (-9 * Math.PI) / 180;

function horizon(hourAngle: number, decl: number, out: THREE.Vector3) {
  const north = Math.cos(LAT) * Math.sin(decl) - Math.sin(LAT) * Math.cos(decl) * Math.cos(hourAngle);
  const east = -Math.cos(decl) * Math.sin(hourAngle);
  const up = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(hourAngle);
  // the train heads north: +x north, +z east
  return out.set(north, up, east).normalize();
}

/** Where the sun and the moon are at an hour of the day (0..24), in world axes. */
export function ephemeris(hour: number, sun: THREE.Vector3, moon: THREE.Vector3) {
  const h = ((hour - 12) / 12) * Math.PI;
  horizon(h, DECL, sun);
  horizon(h - MOON_LAG, MOON_DECL, moon);
}

/** How far the stars have turned, radians. */
export const siderealAngle = (hour: number) => ((hour - 12) / 12) * Math.PI * 1.0027;

const FRAG = /* glsl */ `
${ATMOS}
uniform mat4 uInvProj;
uniform mat4 uCamMat;
uniform float uStarTurn;
uniform float uPixel;      // radians per pixel
uniform float uSkyTime;
uniform sampler2D tNoise;
uniform vec3 uCam;
uniform vec3 uSH[9];
varying vec2 vUv;
${CLOUDS}

const float DISC = 0.00465;

uint h32(uint x) { x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }
uint h3(ivec3 c) { return h32(uint(c.x) * 0x9E3779B1u + h32(uint(c.y) * 0x85EBCA77u + h32(uint(c.z)))); }

vec3 stars(vec3 d, float airmass) {
  const float R = 230.0;
  vec3 p = d * R;
  ivec3 c = ivec3(floor(p));
  uint h = h3(c);
  if ((h & 7u) != 0u) return vec3(0.0);
  vec3 j = vec3(float((h >> 2) & 1023u), float((h >> 12) & 1023u), float((h >> 22) & 1023u)) / 1023.0;
  vec3 s = normalize(vec3(c) + 0.2 + 0.6 * j);
  float a = length(d - s);
  uint h2 = h32(h + 77u);
  float m = float(h2 & 0xFFFFu) / 65535.0;
  float flux = pow(m, 22.0) * 1.2 + 0.0012;
  float sigma = max(uPixel * 0.85, 0.00045);
  float blob = exp(-a * a / (2.0 * sigma * sigma)) * (0.00045 * 0.00045) / (sigma * sigma);
  float t = float((h2 >> 16) & 255u) / 255.0;
  vec3 tint = mix(vec3(1.0, 0.72, 0.5), vec3(0.72, 0.82, 1.0), smoothstep(0.1, 0.8, t));
  float tw = 1.0 + 0.35 * min(airmass - 1.0, 3.0) * sin(uSkyTime * (5.0 + 9.0 * t) + t * 40.0);
  return tint * flux * blob * tw;
}

void main() {
  vec4 f = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize((uCamMat * vec4(f.xyz / f.w, 0.0)).xyz);

  vec3 col = skyRadiance(dir);

  // above the horizon of the round earth: what comes from beyond the air
  vec3 tr = lightAt(uCamAlt, dir, vec3(1.0));
  if (tr.r + tr.g + tr.b > 1e-5) {
    // sun
    float as = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));
    float edge = 1.0 - smoothstep(DISC - uPixel, DISC + uPixel, as);
    if (edge > 0.0) {
      float mu = sqrt(max(1.0 - (as / DISC) * (as / DISC), 0.0));
      vec3 limb = pow(vec3(mu), vec3(0.35, 0.45, 0.6)) * 0.75 + 0.25;
      col += min(uSunE * tr / (PI * DISC * DISC) * limb, vec3(60000.0)) * edge;
    }

    // moon: a little larger than life, lit from where the sun is
    const float MR = 0.0098;
    vec3 mr = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
    vec3 mu3 = cross(uMoonDir, mr);
    vec2 q = vec2(dot(dir, mr), dot(dir, mu3)) / MR;
    float rr = dot(q, q);
    float onMoon = dot(dir, uMoonDir) > 0.0 ? 1.0 - smoothstep(1.0 - uPixel / MR, 1.0 + uPixel / MR, sqrt(rr)) : 0.0;
    if (onMoon > 0.0) {
      vec3 nm = normalize(q.x * mr + q.y * mu3 - sqrt(max(1.0 - rr, 0.0)) * uMoonDir);
      float lit = smoothstep(-0.02, 0.12, dot(nm, uSunDir));
      float maria = texture(tNoise, q * 0.21 + 0.37).b * 0.6 + texture(tNoise, q * 0.9).b * 0.4;
      vec3 surf = vec3(0.13, 0.125, 0.115) * (0.55 + 0.9 * smoothstep(0.3, 0.7, maria));
      col = mix(col, col * 0.2, onMoon);
      col += uSunE * surf / PI * (lit * 1.6 + 0.004) * tr * onMoon;
    }

    // stars turn about the pole, which stands LAT above the northern horizon
    float cl = ${Math.cos(LAT).toFixed(6)}, sl = ${Math.sin(LAT).toFixed(6)};
    vec3 pole = vec3(cl, sl, 0.0);
    float ct = cos(uStarTurn), st = sin(uStarTurn);
    vec3 sd = dir * ct + cross(pole, dir) * st + pole * dot(pole, dir) * (1.0 - ct);
    float airmass = 1.0 / max(dir.y + 0.04, 0.06);
    vec3 night = stars(sd, airmass) * 0.5;
    // the Milky Way: a band tilted across the star sphere
    vec3 gn = normalize(vec3(0.45, 0.35, 0.82));
    float lat = dot(sd, gn);
    vec3 gu = normalize(cross(gn, vec3(0.0, 1.0, 0.0)));
    vec2 guv = vec2(atan(dot(sd, gu), dot(sd, cross(gn, gu))) / 6.2831853, lat);
    float cloud = texture(tNoise, guv * vec2(3.0, 2.2)).b;
    float dust = texture(tNoise, guv * vec2(5.0, 6.0) + 0.3).a;
    float band = exp(-lat * lat * 22.0) * (0.35 + 1.3 * cloud * cloud) * mix(1.0, 0.25, smoothstep(0.45, 0.75, dust) * exp(-lat * lat * 120.0));
    night += vec3(0.75, 0.82, 1.0) * band * 2.4e-4 * (1.0 - onMoon);
    night += vec3(0.5, 0.65, 1.0) * 2.5e-5;   // airglow: the night sky is never black
    col += night * tr;
  }

  // ---- clouds, on a shell round the earth so they close up towards the horizon
  if (dir.y > -0.02) {
    float r = RG + uCamAlt, rc = RG + CLOUD_ALT * 0.001;
    float t = (-r * dir.y + sqrt(max(r * r * (dir.y * dir.y - 1.0) + rc * rc, 0.0))) * 1000.0;
    vec3 pos = uCam + dir * t;
    float d = cloudAt(pos.xz);
    if (d > 0.002) {
      // ragged edges, and a fluffier middle
      float fine = texture(tNoise, (pos.xz + uCloud.xy) / 2100.0 + uCloud.w * 0.0009).a;
      d = clamp(d * (0.7 + 0.6 * fine) - (1.0 - d) * fine * 0.25, 0.0, 1.0);
      float km = CLOUD_ALT * 0.001;
      // towards the light there is either more cloud (shade) or less (a bright rim)
      float sunUp = step(-0.03, uSunDir.y);
      vec3 L = mix(uMoonDir, uSunDir, sunUp);
      float toward = cloudAt(pos.xz + normalize(L.xz + 1e-4) * 700.0);
      float shade = exp(-2.2 * max(toward * 0.8 + d * 0.5 - 0.15, 0.0));
      float ca = dot(dir, L);
      float fwd = 0.35 + 1.6 * pow(max(ca, 0.0), 6.0) * (1.0 - 0.6 * d);
      vec3 direct = (sunLightAt(km) * sunUp + moonLightAt(km) * (1.0 - sunUp)) * shade * fwd * 0.2;
      vec3 up3 = 0.886227 * uSH[0] + 1.023328 * uSH[1];
      vec3 dn3 = 0.886227 * uSH[0] - 1.023328 * uSH[1];
      vec3 amb = (up3 * 0.55 + dn3 * 0.45) / PI * (0.9 - 0.35 * d);
      vec3 cc = direct + amb;
      vec3 ctr, cins;
      aerial(dir, t, ctr, cins);
      cc = cc * ctr + cins;
      float alpha = (1.0 - exp(-d * 3.2)) * smoothstep(-0.02, 0.03, dir.y);
      col = mix(col, cc, alpha);
    }
    // cirrus: long thin streaks far above
    float rz = RG + 9.5;
    float tz = (-r * dir.y + sqrt(max(r * r * (dir.y * dir.y - 1.0) + rz * rz, 0.0))) * 1000.0;
    vec2 cp = (uCam.xz + dir.xz * tz + uCloud.xy) / 61000.0 + uCloud.w * vec2(0.0002, 0.00005);
    float ci = texture(tNoise, cp * vec2(1.0, 3.6)).b * 0.6 + texture(tNoise, cp * vec2(2.3, 9.0) + 0.4).a * 0.4;
    ci = smoothstep(0.62, 0.9, ci) * smoothstep(0.0, 0.12, dir.y) * 0.4 * smoothstep(0.1, 0.5, uCloud.z);
    if (ci > 0.001) {
      vec3 cl = (sunLightAt(9.5) + moonLightAt(9.5)) * (0.06 + 0.5 * pow(max(dot(dir, uSunDir), 0.0), 8.0)) + (0.886227 * uSH[0]) / PI * 0.8;
      vec3 ctr, cins;
      aerial(dir, tz, ctr, cins);
      col = mix(col, cl * ctr + cins, ci);
    }
  }
  gl_FragColor = vec4(col * uExposure, 1.0);
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(atmos: Atmosphere, noise: THREE.Texture, extra: Record<string, THREE.IUniform>) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: FSQ_VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...atmos.uniforms(),
        ...extra,
        uInvProj: { value: new THREE.Matrix4() },
        uCamMat: { value: new THREE.Matrix4() },
        uStarTurn: { value: 0 },
        uPixel: { value: 0.001 },
        uSkyTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    tri.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.mesh = new THREE.Mesh(tri, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  update(camera: THREE.PerspectiveCamera, pixelsHigh: number, hour: number, time: number) {
    const u = this.material.uniforms;
    (u.uInvProj.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (u.uCamMat.value as THREE.Matrix4).copy(camera.matrixWorld);
    u.uPixel.value = (camera.fov * Math.PI) / 180 / pixelsHigh;
    u.uStarTurn.value = siderealAngle(hour);
    u.uSkyTime.value = time;
  }
}
