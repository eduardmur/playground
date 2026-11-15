// Weather: a handful of numbers that drift toward whatever was asked for, the
// things that lag behind them (wet roads, puddles, settled snow), lightning,
// and the rain and snow you see falling past the windows.
import * as THREE from 'three';
import { env, LAYER } from './shared.js';
import { fxUniforms } from '../fx/lights.js';
import { damp, clamp01 } from '../core/utils.js';

export const WEATHERS = {
  clear: { label: 'Clear', cover: 0.16, overcast: 0, rain: 0, snow: 0, fog: 0, wind: 0.15, storm: 0, temp: 72 },
  cloudy: { label: 'Cloudy', cover: 0.74, overcast: 0.5, rain: 0, snow: 0, fog: 0.06, wind: 0.3, storm: 0, temp: 64 },
  rain: { label: 'Rain', cover: 1, overcast: 0.92, rain: 0.5, snow: 0, fog: 0.22, wind: 0.45, storm: 0, temp: 57 },
  storm: { label: 'Storm', cover: 1, overcast: 1, rain: 1, snow: 0, fog: 0.3, wind: 1, storm: 1, temp: 54 },
  fog: { label: 'Fog', cover: 0.9, overcast: 0.8, rain: 0, snow: 0, fog: 1, wind: 0.05, storm: 0, temp: 50 },
  snow: { label: 'Snow', cover: 1, overcast: 0.88, rain: 0, snow: 0.85, fog: 0.36, wind: 0.3, storm: 0, temp: 29 },
};
export const WEATHER_ORDER = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];
const AUTO = ['clear', 'cloudy', 'rain', 'storm', 'rain', 'cloudy', 'clear', 'cloudy', 'fog', 'clear', 'cloudy', 'snow', 'cloudy'];

const PRECIP_VERT = /* glsl */ `
  attribute vec3 aSeed;
  uniform vec3 uCam, uBox, uOffset, uRel, uCar, uCarFwd;
  uniform float uAmount, uLen, uWidth, uTime, uHead;
  varying vec2 vUv;
  varying float vA;
  void main() {
    vUv = position.xy;
    vec3 p = aSeed * uBox + uOffset;
    #ifdef FLAKE
      p.x += sin(uTime * 0.9 + aSeed.y * 40.0) * 0.4;
      p.z += cos(uTime * 0.7 + aSeed.x * 40.0) * 0.4;
    #endif
    p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
    float on = step(fract(aSeed.x * 7.31 + aSeed.z * 3.17), uAmount);
    // nothing falls inside the car
    vec2 dc = p.xz - uCar.xz;
    if (dot(dc, dc) < 5.8 && p.y < 2.4) on = 0.0;
    vec3 toCam = uCam - p;
    float dist = length(toCam);
    toCam /= max(dist, 1e-3);
    vec3 dir = uRel * uLen;
    #ifdef FLAKE
      vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
      vec3 up = cross(toCam, side);
      vec3 wp = p + side * position.x * uWidth + up * (position.y * 2.0 - 1.0) * uWidth + dir * (position.y - 0.5);
    #else
      vec3 side = normalize(cross(dir, toCam)) * uWidth * (1.0 + dist * 0.06);
      vec3 wp = p + dir * position.y + side * position.x;
    #endif
    // brighter in the cab's own headlights
    vec3 fromCar = p - uCar;
    float ahead = dot(normalize(fromCar + vec3(0.0, 0.2, 0.0)), uCarFwd);
    float beam = smoothstep(0.86, 0.98, ahead) * (1.0 - smoothstep(4.0, 34.0, length(fromCar))) * uHead;
    vA = on * (1.0 + beam * 5.0) * smoothstep(0.5, 2.5, dist) * (1.0 - smoothstep(uBox.x * 0.36, uBox.x * 0.5, dist));
    gl_Position = on > 0.5 ? projectionMatrix * viewMatrix * vec4(wp, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;
const PRECIP_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vA;
  void main() {
    #ifdef FLAKE
      vec2 d = vec2(vUv.x, vUv.y * 2.0 - 1.0);
      float a = smoothstep(1.0, 0.25, length(d));
    #else
      float a = (1.0 - abs(vUv.x)) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
    #endif
    gl_FragColor = vec4(uColor * a * vA, 1.0);
  }
`;

class Precip {
  constructor(count, box, flake) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 3));
    g.instanceCount = count;
    this.uniforms = {
      uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...box) }, uOffset: { value: new THREE.Vector3() },
      uRel: { value: new THREE.Vector3(0, -1, 0) }, uCar: env.uCar, uCarFwd: env.uCarFwd, uHead: env.uHead,
      uAmount: { value: 0 }, uLen: { value: flake ? 0.006 : 0.03 }, uWidth: { value: flake ? 0.02 : 0.006 },
      uTime: env.uTime, uColor: { value: new THREE.Color(1, 1, 1) },
    };
    this.mesh = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: PRECIP_VERT, fragmentShader: PRECIP_FRAG,
        defines: flake ? { FLAKE: '' } : {},
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.layers.set(LAYER.NOREFLECT);
    this.vel = new THREE.Vector3();
  }

  update(dt, amount, vel, camPos, camVel, color) {
    const u = this.uniforms;
    u.uAmount.value = amount;
    this.mesh.visible = amount > 0.004;
    if (!this.mesh.visible) return;
    this.vel.copy(vel);
    u.uOffset.value.addScaledVector(vel, dt);
    // keep the running offset small so it stays precise
    const b = u.uBox.value, o = u.uOffset.value;
    o.set(((o.x % b.x) + b.x) % b.x, ((o.y % b.y) + b.y) % b.y, ((o.z % b.z) + b.z) % b.z);
    u.uCam.value.copy(camPos);
    u.uRel.value.copy(vel).sub(camVel);
    u.uColor.value.copy(color);
  }
}

export class Weather {
  constructor(scene) {
    this.kind = 'clear';
    this.auto = false;
    this.autoIdx = 0;
    this.autoT = 90;
    const t = WEATHERS.clear;
    this.cur = { cover: t.cover, overcast: 0, rain: 0, snow: 0, fog: 0, wind: t.wind, storm: 0, temp: t.temp };
    this.wet = 0;
    this.puddle = 0;
    this.snowCover = 0;
    this.flash = 0;
    this.fogDensity = 0.0009;
    this.strikeT = 8;
    this.pulses = [];
    this.onThunder = null;
    this.windDir = new THREE.Vector3(0.8, 0, 0.6).normalize();

    this.rain = new Precip(9000, [36, 22, 36], false);
    this.snow = new Precip(7000, [30, 18, 30], true);
    scene.add(this.rain.mesh, this.snow.mesh);
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  set(kind, instant = false) {
    if (!WEATHERS[kind]) return;
    this.kind = kind;
    if (instant) {
      const t = WEATHERS[kind];
      Object.assign(this.cur, { cover: t.cover, overcast: t.overcast, rain: t.rain, snow: t.snow, fog: t.fog, wind: t.wind, storm: t.storm, temp: t.temp });
      this.wet = t.rain > 0.02 ? 1 : Math.max(t.fog * 0.35, t.snow * 0.2);
      this.puddle = clamp01(t.rain * 1.3);
      this.snowCover = t.snow > 0.05 ? 1 : 0;
    }
  }

  get label() {
    return WEATHERS[this.kind].label;
  }

  /** What the sky module wants to know. */
  get sky() {
    const c = this.cur;
    return { cover: c.cover, overcast: c.overcast, fog: c.fog, storm: c.storm, wind: c.wind, flash: this.flash, fogDensity: this.fogDensity };
  }

  tempF(hour) {
    return Math.round(this.cur.temp + 6 * Math.sin(((hour - 9) / 24) * Math.PI * 2));
  }

  update(dt, time, camPos, camVel, ambient) {
    if (this.auto) {
      this.autoT -= dt;
      if (this.autoT <= 0) {
        this.autoIdx = (this.autoIdx + 1) % AUTO.length;
        this.kind = AUTO[this.autoIdx];
        this.autoT = 100 + Math.random() * 120;
        this.onAuto?.(this.kind);
      }
    }
    const t = WEATHERS[this.kind], c = this.cur;
    c.cover = damp(c.cover, t.cover, 0.4, dt);
    c.overcast = damp(c.overcast, t.overcast, 0.35, dt);
    c.rain = damp(c.rain, t.rain, 0.5, dt);
    c.snow = damp(c.snow, t.snow, 0.4, dt);
    c.fog = damp(c.fog, t.fog, 0.3, dt);
    c.wind = damp(c.wind, t.wind, 0.5, dt);
    c.storm = damp(c.storm, t.storm, 0.5, dt);
    c.temp = damp(c.temp, t.temp, 0.1, dt);
    if (c.rain < 0.004) c.rain = 0;
    if (c.snow < 0.004) c.snow = 0;

    const wetT = c.rain > 0.02 ? 1 : Math.max(c.fog * 0.35, c.snow * 0.25);
    this.wet = damp(this.wet, wetT, wetT > this.wet ? 0.28 : 0.03, dt);
    const pudT = clamp01(c.rain * 1.3);
    this.puddle = damp(this.puddle, pudT, pudT > this.puddle ? 0.12 : 0.02, dt);
    const snT = c.snow > 0.05 ? 1 : 0;
    this.snowCover = damp(this.snowCover, snT, snT > this.snowCover ? 0.05 : 0.045, dt);
    if (this.wet < 0.003) this.wet = 0;
    if (this.snowCover < 0.003) this.snowCover = 0;
    this.fogDensity = 0.0009 + c.fog * c.fog * 0.016 + c.rain * 0.0022 + c.snow * 0.003;

    // lightning: a few quick pulses, then the thunder some seconds behind
    let flash = 0;
    if (c.storm > 0.5) {
      this.strikeT -= dt;
      if (this.strikeT <= 0) {
        this.strikeT = 7 + Math.random() * 14;
        const n = 2 + Math.floor(Math.random() * 3);
        const dist = 0.3 + Math.random() * 3.2; // seconds until the thunder
        const amp = 1.1 - dist * 0.2;
        let at = time;
        for (let i = 0; i < n; i++) {
          this.pulses.push({ t: at, a: amp * (i === 0 ? 1 : 0.4 + Math.random() * 0.5) });
          at += 0.07 + Math.random() * 0.16;
        }
        this.onThunder?.(dist, amp);
      }
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      const age = time - p.t;
      if (age > 0.6) this.pulses.splice(i, 1);
      else if (age >= 0) flash = Math.max(flash, p.a * Math.exp(-age / 0.075));
    }
    this.flash = flash;

    env.uWet.value = this.wet;
    env.uPuddle.value = this.puddle;
    env.uSnow.value = this.snowCover;
    env.uRain.value = c.rain;
    env.uWind.value = c.wind;
    env.uFlash.value = flash;
    fxUniforms.uFogDensity.value = this.fogDensity;
    fxUniforms.uHaze.value = clamp01(c.fog * 0.9 + c.rain * 0.5 + c.snow * 0.5);

    // falling things
    const w = this.windDir;
    const lum = 0.12 + (ambient.r + ambient.g + ambient.b) * 0.18 + flash * 0.8;
    this._v.set(w.x * c.wind * 4.5, -9.5, w.z * c.wind * 4.5);
    this.rain.update(dt, clamp01(c.rain * 1.15), this._v, camPos, camVel, this._c.setRGB(lum * 0.62, lum * 0.66, lum * 0.72));
    this._v.set(w.x * c.wind * 2.2, -1.25, w.z * c.wind * 2.2);
    this.snow.update(dt, clamp01(c.snow * 1.15), this._v, camPos, camVel, this._c.setRGB(lum * 1.5 + 0.03, lum * 1.5 + 0.03, lum * 1.55 + 0.035));
  }
}
