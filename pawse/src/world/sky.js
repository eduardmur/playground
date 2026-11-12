import * as THREE from 'three';
import { shared } from './shared.js';
import { clamp, lerp, smoothstep } from '../core/utils.js';

const C = (hex) => new THREE.Color(hex);

/** Look of the world keyed by the sine of the sun's elevation. */
const KEYS = [
  {
    e: -0.3, // deep night
    zenith: C('#040917'), horizon: C('#131f48'), sun: C('#a9c1ff'), sunI: 0.62,
    hemiSky: C('#42599c'), hemiGround: C('#121a33'), hemiI: 0.62,
    fog: C('#0f1836'), fogD: 0.0078, cloudL: C('#2c3d6c'), cloudD: C('#0a0f22'),
    stars: 1, exposure: 1.22, bloom: 0.62,
  },
  {
    e: -0.1, // blue hour
    zenith: C('#1a2459'), horizon: C('#b46d92'), sun: C('#c9a0c0'), sunI: 0.0,
    hemiSky: C('#7570ad'), hemiGround: C('#2c2a44'), hemiI: 0.66,
    fog: C('#62568a'), fogD: 0.0072, cloudL: C('#e08fa4'), cloudD: C('#3a3562'),
    stars: 0.35, exposure: 1.14, bloom: 0.5,
  },
  {
    e: 0.0, // sun on the horizon
    zenith: C('#33509e'), horizon: C('#ff9b62'), sun: C('#ff8140'), sunI: 1.5,
    hemiSky: C('#cba4ba'), hemiGround: C('#6a5c48'), hemiI: 0.74,
    fog: C('#eaa283'), fogD: 0.0068, cloudL: C('#ffc59c'), cloudD: C('#7b5b84'),
    stars: 0, exposure: 1.08, bloom: 0.46,
  },
  {
    e: 0.16, // golden hour
    zenith: C('#3f76cc'), horizon: C('#ffcd8c'), sun: C('#ffb866'), sunI: 2.9,
    hemiSky: C('#d5dcf5'), hemiGround: C('#8b8a55'), hemiI: 0.84,
    fog: C('#f3cf9f'), fogD: 0.0046, cloudL: C('#ffe9c8'), cloudD: C('#b08fa4'),
    stars: 0, exposure: 1.02, bloom: 0.4,
  },
  {
    e: 0.42,
    zenith: C('#3a80d6'), horizon: C('#cfe6f4'), sun: C('#fff0d8'), sunI: 3.0,
    hemiSky: C('#d2e6ff'), hemiGround: C('#8c9c62'), hemiI: 0.98,
    fog: C('#d3e6f2'), fogD: 0.0042, cloudL: C('#ffffff'), cloudD: C('#b9c6d6'),
    stars: 0, exposure: 1.0, bloom: 0.3,
  },
  {
    e: 0.7, // high noon
    zenith: C('#2f7fdc'), horizon: C('#bfe0f5'), sun: C('#fff6e6'), sunI: 3.1,
    hemiSky: C('#cfe6ff'), hemiGround: C('#8fa066'), hemiI: 1.02,
    fog: C('#cfe6f5'), fogD: 0.0038, cloudL: C('#ffffff'), cloudD: C('#b9c6d6'),
    stars: 0, exposure: 1.0, bloom: 0.28,
  },
];

const COLOR_KEYS = ['zenith', 'horizon', 'sun', 'hemiSky', 'hemiGround', 'fog', 'cloudL', 'cloudD'];
const SCALAR_KEYS = ['sunI', 'hemiI', 'fogD', 'stars', 'exposure', 'bloom'];

export const PHASES = [
  { name: 'Dawn', from: 5.25, jump: 5.75 },
  { name: 'Morning', from: 6.7, jump: 7.6 },
  { name: 'Midday', from: 10.5, jump: 12.5 },
  { name: 'Afternoon', from: 15.0, jump: 16.0 },
  { name: 'Golden hour', from: 18.1, jump: 18.75 },
  { name: 'Sunset', from: 19.5, jump: 19.72 },
  { name: 'Dusk', from: 20.08, jump: 20.28 },
  { name: 'Night', from: 20.85, jump: 22.4 },
];

const SHADOW_EXTENT = 30;
const SUNSET_AZIMUTH = 0.57; // the sun sets over the pond as seen from the hill

export class Sky {
  constructor(scene, { shadowMapSize = 2048 } = {}) {
    this.hour = 18.7;
    this.paused = false;
    this.warp = null; // { to, speed }
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.night = 0;
    this.elevation = 0.3;

    this.cur = {};
    for (const k of COLOR_KEYS) this.cur[k] = new THREE.Color();
    for (const k of SCALAR_KEYS) this.cur[k] = 0;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(shadowMapSize, shadowMapSize);
    sh.camera.left = -SHADOW_EXTENT;
    sh.camera.right = SHADOW_EXTENT;
    sh.camera.top = SHADOW_EXTENT;
    sh.camera.bottom = -SHADOW_EXTENT;
    sh.camera.near = 1;
    sh.camera.far = 220;
    sh.bias = -0.0004;
    sh.normalBias = 0.045;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x556644, 1);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xffffff, 0.005);
    this.fog = scene.fog;

    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir },
      uSunColor: { value: new THREE.Color() },
      uMoonDir: { value: this.moonDir },
      uCloudLight: { value: new THREE.Color() },
      uCloudDark: { value: new THREE.Color() },
      uLight2D: { value: new THREE.Vector2(1, 0) },
      uTime: shared.uTime,
      uStars: { value: 0 },
      uSunVis: { value: 1 },
      uMoonVis: { value: 0 },
      uCloudCover: { value: 0.56 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uFogColor;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uMoonDir;
        uniform vec3 uCloudLight;
        uniform vec3 uCloudDark;
        uniform vec2 uLight2D;
        uniform float uTime;
        uniform float uStars;
        uniform float uSunVis;
        uniform float uMoonVis;
        uniform float uCloudCover;
        varying vec3 vDir;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float hash31(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.zyx + 31.32);
          return fract((p.x + p.y) * p.z);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                     mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float a = 0.5, s = 0.0;
          for (int i = 0; i < 5; i++) {
            s += a * vnoise(p);
            p = p * 2.03 + vec2(17.1, 9.2);
            a *= 0.5;
          }
          return s;
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-h * 3.4));

          float sd = max(dot(d, uSunDir), 0.0);
          float low = 0.35 + 0.65 * pow(1.0 - h, 3.0);
          col += uSunColor * (pow(sd, 6.0) * 0.16 + pow(sd, 48.0) * 0.34) * uSunVis * low;

          // clouds: a drifting sheet, lit from the side the light comes from
          float dens = 0.0;
          if (d.y > -0.02) {
            vec2 uv = d.xz / (d.y + 0.2) * 0.6 + vec2(uTime * 0.0042, uTime * 0.0016);
            float n = fbm(uv * 1.5) + fbm(uv * 4.3 + 7.7) * 0.2 - 0.1;
            float nL = fbm((uv + uLight2D * 0.09) * 1.5) + fbm((uv + uLight2D * 0.09) * 4.3 + 7.7) * 0.2 - 0.1;
            dens = smoothstep(uCloudCover, uCloudCover + 0.3, n);
            float lit = clamp((n - nL) * 3.2 + 0.55, 0.0, 1.0);
            vec3 cc = mix(uCloudDark, uCloudLight, lit);
            cc += uSunColor * pow(sd, 10.0) * 0.3 * uSunVis;
            dens *= smoothstep(-0.02, 0.16, d.y);

            // stars and moon sit behind the clouds
            if (uStars > 0.001) {
              vec3 sp = d * 150.0;
              vec3 ip = floor(sp);
              vec3 fp = fract(sp) - 0.5;
              float sh = hash31(ip);
              float star = smoothstep(0.3, 0.0, length(fp)) * step(0.982, sh);
              star *= 0.35 + 0.65 * fract(sh * 71.3);
              star *= 0.7 + 0.3 * sin(uTime * (1.0 + sh * 5.0) + sh * 100.0);
              col += vec3(0.85, 0.92, 1.0) * star * uStars * 1.8 * smoothstep(0.0, 0.3, d.y);
            }
            float md = dot(d, uMoonDir);
            col += vec3(0.95, 0.97, 1.0) * smoothstep(0.99945, 0.9997, md) * 2.2 * uMoonVis;
            col += vec3(0.45, 0.58, 0.95) * pow(max(md, 0.0), 80.0) * 0.3 * uMoonVis;

            col = mix(col, cc, dens * 0.94);
          }

          float disc = smoothstep(0.9993, 0.9997, dot(d, uSunDir));
          col += uSunColor * disc * 12.0 * uSunVis * (1.0 - dens * 0.9);

          col = mix(uFogColor, col, smoothstep(-0.04, 0.1, d.y));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.dome.scale.setScalar(900);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.name = 'sky';
    scene.add(this.dome);

    this._apply();
  }

  /** Game hours per real second: nights pass quickly, golden hours linger. */
  rate() {
    const h = this.hour;
    if (h >= 21.0 || h < 5.0) return 1 / 15; // night
    if (h < 7.5) return 1 / 75; // dawn and early morning
    if (h < 17.6) return 1 / 32; // the long day
    if (h < 20.0) return 1 / 95; // golden hour into sunset
    return 1 / 70; // dusk
  }

  phase() {
    let p = PHASES[PHASES.length - 1];
    for (const q of PHASES) if (this.hour >= q.from) p = q;
    if (this.hour < PHASES[0].from) p = PHASES[PHASES.length - 1];
    return p;
  }

  /** Time-lapse forward to the start of the next phase. */
  nextPhase() {
    const cur = this.warp ? this.warp.phase : this.phase();
    const next = PHASES[(PHASES.indexOf(cur) + 1) % PHASES.length];
    let delta = (next.jump - this.hour + 24) % 24;
    if (delta < 0.05) delta += 24;
    this.warp = { remaining: delta, speed: Math.max(delta / 2.4, 0.6), phase: next };
    return next;
  }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
    this.warp = null;
    this._apply();
  }

  update(dt, focus, camera) {
    if (this.warp) {
      const step = Math.min(this.warp.remaining, this.warp.speed * dt);
      this.hour = (this.hour + step) % 24;
      this.warp.remaining -= step;
      if (this.warp.remaining <= 1e-4) this.warp = null;
    } else if (!this.paused) {
      this.hour = (this.hour + this.rate() * dt) % 24;
    }
    this._apply();

    // keep the shadow frustum centred on the player, snapped to shadow texels
    const sun = this.sun;
    const dir = this.lightDir;
    _right.crossVectors(Math.abs(dir.y) > 0.98 ? _X : _Y, dir).normalize();
    _up.crossVectors(dir, _right).normalize();
    const texel = (SHADOW_EXTENT * 2) / sun.shadow.mapSize.x;
    const fx = focus.dot(_right), fy = focus.dot(_up);
    _f.copy(focus)
      .addScaledVector(_right, Math.round(fx / texel) * texel - fx)
      .addScaledVector(_up, Math.round(fy / texel) * texel - fy);
    sun.target.position.copy(_f);
    sun.position.copy(_f).addScaledVector(dir, 110);

    if (camera) this.dome.position.copy(camera.position);
  }

  _apply() {
    const h = this.hour;
    // sun: up from 6:00 to 20:00, setting toward +x
    let th;
    if (h >= 6 && h < 20) th = lerp(-Math.PI / 2, Math.PI / 2, (h - 6) / 14);
    else th = lerp(Math.PI / 2, (3 * Math.PI) / 2, (((h - 20) % 24) + 24) % 24 / 10);
    const sx = Math.sin(th), sy = Math.cos(th) * 0.84, sz = -Math.cos(th) * 0.54;
    const ca = Math.cos(SUNSET_AZIMUTH), sa = Math.sin(SUNSET_AZIMUTH);
    this.sunDir.set(sx * ca + sz * sa, sy, -sx * sa + sz * ca).normalize();
    const e = (this.elevation = this.sunDir.y);

    // moon: arcs over during the night
    const hn = (((h - 20) % 24) + 24) % 24;
    const ph = clamp(hn / 10, 0, 1) * Math.PI;
    this.moonDir.set(-Math.cos(ph) * 0.75, Math.sin(ph) * 0.8 + 0.14, 0.5).normalize();

    // blend the two nearest keys
    let a = KEYS[0], b = KEYS[KEYS.length - 1], t = 0;
    if (e <= KEYS[0].e) {
      b = a;
    } else if (e >= b.e) {
      a = b;
    } else {
      for (let i = 0; i < KEYS.length - 1; i++) {
        if (e >= KEYS[i].e && e <= KEYS[i + 1].e) {
          a = KEYS[i];
          b = KEYS[i + 1];
          t = (e - a.e) / (b.e - a.e);
          break;
        }
      }
    }
    const cur = this.cur;
    for (const k of COLOR_KEYS) cur[k].copy(a[k]).lerp(b[k], t);
    for (const k of SCALAR_KEYS) cur[k] = lerp(a[k], b[k], t);

    // mornings are mistier, pinker and cooler than evenings
    const am = h > 3.5 && h < 13 ? smoothstep(0.5, 0.05, e) * smoothstep(-0.25, -0.05, e) : 0;
    if (am > 0) {
      cur.horizon.lerp(_c.set('#ffc9bd'), am * 0.55);
      cur.sun.lerp(_c.set('#ffd4bc'), am * 0.5);
      cur.fog.lerp(_c.set('#e9cfd0'), am * 0.55);
      cur.fogD *= 1 + am * 1.5;
    }
    this.mist = am;

    this.night = smoothstep(-0.02, -0.24, e);
    const moonLight = e < -0.1;
    this.lightDir.copy(moonLight ? this.moonDir : this.sunDir);
    if (this.lightDir.y < 0.06) {
      // never light the world from below the horizon
      this.lightDir.y = 0.06;
      this.lightDir.normalize();
    }

    this.sun.color.copy(cur.sun);
    this.sun.intensity = cur.sunI;
    this.hemi.color.copy(cur.hemiSky);
    this.hemi.groundColor.copy(cur.hemiGround);
    this.hemi.intensity = cur.hemiI;
    this.fog.color.copy(cur.fog);
    this.fog.density = cur.fogD;

    const u = this.uniforms;
    u.uZenith.value.copy(cur.zenith);
    u.uHorizon.value.copy(cur.horizon);
    u.uFogColor.value.copy(cur.fog);
    u.uSunColor.value.copy(moonLight ? _c.set('#ffb070') : cur.sun);
    u.uCloudLight.value.copy(cur.cloudL);
    u.uCloudDark.value.copy(cur.cloudD);
    u.uStars.value = cur.stars;
    u.uSunVis.value = smoothstep(-0.12, 0.02, e);
    u.uMoonVis.value = this.night;
    _v2.set(this.lightDir.x, this.lightDir.z);
    if (_v2.lengthSq() > 1e-6) u.uLight2D.value.copy(_v2.normalize());

    shared.uSunDir.value.copy(this.lightDir);
    shared.uSunColor.value.copy(cur.sun).multiplyScalar(cur.sunI / 3);
    shared.uBacklight.value = 0.15 + 0.95 * clamp(cur.sunI / 2.7, 0, 1) * (moonLight ? 0.3 : 1);
    shared.uSkyZenith.value.copy(cur.zenith);
    shared.uSkyHorizon.value.copy(cur.horizon);
    shared.uAmbient.value.copy(cur.hemiSky).multiplyScalar(cur.hemiI);
  }
}

const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _f = new THREE.Vector3();
const _c = new THREE.Color();
const _v2 = new THREE.Vector2();
