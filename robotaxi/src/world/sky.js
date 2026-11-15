// The sky dome, the sun and moon, fog, and the numbers every other system reads
// to know how bright and what colour the world is right now.
import * as THREE from 'three';
import { env } from './shared.js';
import { clamp01, lerp, smoothstep, keyframes } from '../core/utils.js';

const DEG = Math.PI / 180;
const MAX_EL = 62 * DEG; // how high the sun climbs at noon
const NOON = 12.5;

// keyed by sun elevation in degrees; colours are linear
const K_ZEN = [
  [-18, [0.0022, 0.004, 0.011]], [-10, [0.006, 0.012, 0.034]], [-5, [0.028, 0.058, 0.155]], [-1, [0.085, 0.155, 0.35]],
  [3, [0.12, 0.25, 0.55]], [9, [0.13, 0.3, 0.67]], [22, [0.115, 0.29, 0.71]], [60, [0.085, 0.24, 0.67]],
];
const K_HOR = [
  [-18, [0.011, 0.015, 0.028]], [-10, [0.04, 0.045, 0.08]], [-5, [0.3, 0.2, 0.2]], [-1, [0.9, 0.48, 0.27]],
  [3, [0.98, 0.64, 0.39]], [9, [0.82, 0.73, 0.6]], [22, [0.58, 0.72, 0.88]], [60, [0.5, 0.68, 0.9]],
];
const K_SUN = [
  [-4, [1.0, 0.3, 0.1]], [0, [1.0, 0.36, 0.13]], [3, [1.0, 0.5, 0.22]], [9, [1.0, 0.72, 0.46]], [22, [1.0, 0.9, 0.76]], [60, [1.0, 0.96, 0.9]],
];
const K_SUNI = [[-3, 0], [-0.5, 0.5], [3, 2.4], [9, 3.7], [22, 4.5], [60, 5.0]];

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = viewMatrix * vec4(position, 0.0);
    gl_Position = (projectionMatrix * vec4(p.xyz, 1.0)).xyww;
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform sampler2D uNoise;
  uniform vec3 uSunDir, uMoonDir, uZenith, uHorizon, uGround, uSunCol, uGlowCol, uSunsetCol, uCloudLit, uCloudDark, uOverCol, uFogCol;
  uniform float uSunDisk, uGlow, uSunset, uStars, uCover, uOvercast, uFogAmt, uTime, uFlash, uMoon, uCloudSpeed;
  varying vec3 vDir;

  float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * texture2D(uNoise, p).r; p = p * 2.07 + vec2(11.3, 7.1); a *= 0.5; }
    return s / 0.97;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-h * 3.4));
    float mu = max(dot(d, uSunDir), 0.0);
    float az = max(dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz + 1e-5)), 0.0);
    col += uSunsetCol * uSunset * exp(-h * 6.5) * az * az;
    col += uGlowCol * uGlow * (0.16 * pow(mu, 5.0) + 0.5 * pow(mu, 60.0) + 2.0 * pow(mu, 900.0));

    // clouds live on a flat sheet far overhead
    vec2 cp = d.xz / (d.y + 0.14);
    vec2 wind = vec2(uTime * uCloudSpeed, uTime * uCloudSpeed * 0.35);
    float n = fbm(cp * 0.11 + wind);
    float n2 = fbm(cp * 0.11 + wind + uSunDir.xz * 0.035);
    float cov = smoothstep(0.98 - uCover * 0.82, 1.18 - uCover * 0.82, n * 1.25 + 0.1);
    cov *= smoothstep(-0.02, 0.1, d.y);
    float shade = clamp(0.5 + (n - n2) * 3.5, 0.0, 1.0);
    vec3 ccol = mix(uCloudLit, uCloudDark, shade * 0.85 + 0.15 * cov);
    ccol += uGlowCol * uGlow * pow(mu, 8.0) * 0.5 * (1.0 - cov * 0.7);

    // stars and the moon sit behind the clouds
    vec3 sp = d * 160.0;
    float hs = hash31(floor(sp));
    float star = step(0.996, hs) * smoothstep(0.42, 0.05, length(fract(sp) - 0.5));
    star *= 0.6 + 0.4 * sin(uTime * (1.5 + hs * 30.0) + hs * 80.0);
    col += vec3(0.9, 0.95, 1.0) * star * uStars * smoothstep(0.02, 0.3, d.y) * (0.3 + 2.2 * fract(hs * 77.0));
    float mm = dot(d, uMoonDir);
    vec3 mcol = vec3(1.0, 0.97, 0.9) * (0.75 + 0.3 * texture2D(uNoise, d.xy * 9.0).g);
    col += (mcol * smoothstep(0.9999, 0.99994, mm) * 3.5 + vec3(0.45, 0.55, 0.9) * 0.3 * pow(max(mm, 0.0), 300.0)) * uMoon;
    col += uSunCol * uSunDisk * smoothstep(0.99993, 0.99996, dot(d, uSunDir));

    col = mix(col, ccol, cov * 0.94);

    // a full overcast deck
    float on = fbm(cp * 0.06 + wind * 0.6);
    vec3 oc = uOverCol * (0.72 + 0.56 * on);
    oc += uGlowCol * uGlow * 0.1 * pow(mu, 3.0);
    col = mix(col, oc, uOvercast);

    // haze and fog close the horizon
    float hz = 1.0 - smoothstep(0.0, 0.12 + uFogAmt * 0.9, d.y);
    col = mix(col, uFogCol, clamp(hz * (0.35 + uFogAmt) + uFogAmt * 0.75, 0.0, 1.0));
    col = mix(col, mix(uFogCol, uGround, 0.6), smoothstep(0.0, -0.12, d.y));
    col += vec3(0.6, 0.7, 1.0) * uFlash * (0.35 + 0.9 * on);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  constructor(worldScene, renderer, { shadowMapSize = 2048 } = {}) {
    this.scene = worldScene;
    this.renderer = renderer;
    const u = (this.uniforms = {
      uNoise: env.uNoise, uTime: env.uTime,
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunCol: { value: new THREE.Color() }, uGlowCol: { value: new THREE.Color() }, uSunsetCol: { value: new THREE.Color() },
      uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() }, uOverCol: { value: new THREE.Color() },
      uFogCol: { value: new THREE.Color() },
      uSunDisk: { value: 0 }, uGlow: { value: 0 }, uSunset: { value: 0 }, uStars: { value: 0 }, uCover: { value: 0.2 },
      uOvercast: { value: 0 }, uFogAmt: { value: 0 }, uFlash: { value: 0 }, uMoon: { value: 0 }, uCloudSpeed: { value: 0.0016 },
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    });
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.dome = new THREE.Mesh(geo, this.material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    worldScene.add(this.dome);

    // a private copy of the dome, used to bake the sky into reflections and ambient light
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(geo, this.material));
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.envTimer = 0;
    this.envDirty = true;
    this._sig = '';

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(shadowMapSize, shadowMapSize);
    this.shadowRange = 105;
    sh.camera.left = sh.camera.bottom = -this.shadowRange;
    sh.camera.right = sh.camera.top = this.shadowRange;
    sh.camera.near = 20;
    sh.camera.far = 900;
    sh.bias = -0.0006;
    sh.normalBias = 0.25;
    worldScene.add(this.sun, this.sun.target);

    // warm from below at night (street light bouncing up), cool from above by day
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.3);
    worldScene.add(this.hemi);
    // lightning
    this.bolt = new THREE.DirectionalLight(0xbfd0ff, 0);
    this.bolt.position.set(0.3, 1, 0.2);
    worldScene.add(this.bolt);

    this.fog = new THREE.FogExp2(0x8899aa, 0.001);
    worldScene.fog = this.fog;

    // read by everything else
    this.hour = 12;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, 1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.lightColor = new THREE.Color();
    this.lightIntensity = 0;
    this.ambient = new THREE.Color();
    this.elevation = 0;
    this.day = 1;
    this.night = 0;
    this.sunUp = 1; // 0..1 how much direct sun reaches the street
    this.exposure = 1;
  }

  /** weather: { cover, overcast, fog, storm, flash } all 0..1 */
  update(dt, hour, w, focus) {
    this.hour = hour;
    const th = ((hour - NOON) / 24) * Math.PI * 2;
    const sd = this.sunDir.set(-Math.sin(th), Math.cos(th) * Math.sin(MAX_EL), Math.cos(th) * Math.cos(MAX_EL)).normalize();
    const tm = th + Math.PI;
    const ML = 50 * DEG;
    this.moonDir.set(-Math.sin(tm) * 0.92, Math.cos(tm) * Math.sin(ML), Math.cos(tm) * Math.cos(ML) + 0.15).normalize();
    const el = (this.elevation = Math.asin(sd.y) / DEG);
    const day = (this.day = smoothstep(-6, 8, el));
    const u = this.uniforms;

    const zen = keyframes(K_ZEN, el), hor = keyframes(K_HOR, el), sc = keyframes(K_SUN, el);
    const murk = clamp01(w.overcast * 0.85 + w.fog * 0.5);
    const sunI = keyframes(K_SUNI, el) * (1 - 0.95 * w.overcast) * (1 - 0.7 * w.fog);
    const moonI = (1 - smoothstep(-10, -5, el)) * 0.22 * (1 - 0.9 * w.overcast) * (this.moonDir.y > 0.05 ? 1 : 0);

    u.uSunDir.value.copy(sd);
    u.uMoonDir.value.copy(this.moonDir);
    u.uZenith.value.setRGB(zen[0], zen[1], zen[2]);
    u.uHorizon.value.setRGB(hor[0], hor[1], hor[2]);
    u.uSunCol.value.setRGB(sc[0] * 60, sc[1] * 60, sc[2] * 60);
    const glowK = lerp(1.1, 0.5, smoothstep(4, 40, el)) * smoothstep(-9, 0, el);
    u.uGlowCol.value.setRGB(sc[0] * glowK, sc[1] * glowK, sc[2] * glowK);
    u.uGlow.value = 1 - 0.75 * w.overcast;
    const sunset = smoothstep(-8, -1, el) * (1 - smoothstep(4, 16, el));
    u.uSunsetCol.value.setRGB(1.0, 0.42, 0.16);
    u.uSunset.value = sunset * 0.75 * (1 - w.overcast);
    u.uSunDisk.value = smoothstep(-1.2, 0.4, el) * (1 - w.overcast) * (1 - w.fog);
    u.uStars.value = (1 - smoothstep(-13, -5, el)) * (1 - murk);
    u.uMoon.value = (1 - smoothstep(-9, -3, el)) * (1 - murk * 0.95);
    u.uCover.value = w.cover;
    u.uOvercast.value = w.overcast;
    u.uCloudSpeed.value = 0.0012 + 0.004 * (w.wind || 0);
    u.uFlash.value = w.flash || 0;

    // clouds take the colour of whatever lights them; at night that is the city below
    const cl = 0.95 * day;
    const warm = 1 - smoothstep(3, 20, el);
    u.uCloudLit.value.setRGB(
      lerp(cl, cl * (0.55 + 0.6 * sc[0]), warm) + 0.028 * (1 - day),
      lerp(cl, cl * (0.45 + 0.6 * sc[1]), warm) + 0.022 * (1 - day),
      lerp(cl, cl * (0.45 + 0.6 * sc[2]), warm) + 0.02 * (1 - day),
    );
    u.uCloudDark.value.setRGB(
      lerp(0.014, 0.36, day) * lerp(1, 0.75, warm), lerp(0.013, 0.39, day) * lerp(1, 0.7, warm), lerp(0.016, 0.45, day) * lerp(1, 0.8, warm),
    );
    const od = lerp(0.03, 0.5, day) * (1 - 0.55 * w.storm);
    u.uOverCol.value.setRGB(od * lerp(1.25, 0.96, day), od * lerp(1.02, 1.02, day), od * lerp(0.9, 1.12, day));
    // fog takes the horizon's colour, greyer when the sky is closed in
    const fr = lerp(hor[0] * 0.85, u.uOverCol.value.r * 0.95, murk), fg = lerp(hor[1] * 0.88, u.uOverCol.value.g * 0.95, murk), fb = lerp(hor[2] * 0.92, u.uOverCol.value.b * 0.95, murk);
    u.uFogCol.value.setRGB(fr, fg, fb);
    u.uFogAmt.value = w.fog;
    u.uGround.value.setRGB(fr * 0.4, fg * 0.4, fb * 0.4);
    this.fog.color.copy(u.uFogCol.value);
    this.fog.density = w.fogDensity;

    // the one light that casts shadows: the sun, handing over to the moon after dusk
    const useMoon = sunI <= 0.0001;
    const ld = this.lightDir.copy(useMoon ? this.moonDir : sd);
    if (ld.y < 0.03) { ld.y = 0.03; ld.normalize(); }
    if (useMoon) this.lightColor.setRGB(0.55, 0.66, 1.0);
    else this.lightColor.setRGB(sc[0], sc[1], sc[2]);
    this.lightIntensity = useMoon ? moonI : sunI;
    this.sunUp = useMoon ? 0 : clamp01(sunI / 2.4);
    this.sun.color.copy(this.lightColor);
    this.sun.intensity = this.lightIntensity;
    this.sun.castShadow = this.lightIntensity > 0.02;
    this._placeShadow(focus, ld);

    // fill light
    const lamp = env.uLamp.value;
    // by day this stands in for light bouncing off sunlit walls and pavements, which keeps shade from going pure sky-blue
    this.hemi.color.setRGB(lerp(0.1, 0.74, day), lerp(0.12, 0.77, day), lerp(0.2, 0.84, day));
    this.hemi.groundColor.setRGB(lerp(0.5, 0.46, day), lerp(0.36, 0.41, day), lerp(0.2, 0.34, day));
    this.hemi.intensity = lerp(0.2 + 0.5 * lamp, 0.95 + 0.3 * murk, day);
    this.scene.environmentIntensity = lerp(1, 0.6, day * (1 - murk));
    this.bolt.intensity = (w.flash || 0) * 6;
    this.ambient.setRGB(
      lerp(zen[0], hor[0], 0.5) * (1 - murk) + u.uOverCol.value.r * murk,
      lerp(zen[1], hor[1], 0.5) * (1 - murk) + u.uOverCol.value.g * murk,
      lerp(zen[2], hor[2], 0.5) * (1 - murk) + u.uOverCol.value.b * murk,
    );

    this.night = 1 - day;
    this.exposure = lerp(1.22, 0.84, day) + 0.2 * murk * day;

    // rebake the sky into the reflection/ambient map when it has visibly changed
    const sig = `${el.toFixed(1)}|${w.cover.toFixed(2)}|${w.overcast.toFixed(2)}|${w.fog.toFixed(2)}|${(w.storm || 0).toFixed(1)}`;
    if (sig !== this._sig) {
      this._sig = sig;
      this.envDirty = true;
    }
    this.envTimer -= dt;
    if (this.envDirty && this.envTimer <= 0) this._bakeEnv();
  }

  _placeShadow(focus, dir) {
    // snap the shadow frustum to whole texels so shadow edges do not crawl as the cab moves
    const sh = this.sun.shadow;
    const texel = (this.shadowRange * 2) / sh.mapSize.x;
    const up = Math.abs(dir.y) > 0.99 ? _v1.set(1, 0, 0) : _v1.set(0, 1, 0);
    const right = _v2.crossVectors(up, dir).normalize();
    const up2 = _v3.crossVectors(dir, right).normalize();
    const fr = Math.round(focus.dot(right) / texel) * texel;
    const fu = Math.round(focus.dot(up2) / texel) * texel;
    const fd = focus.dot(dir);
    const t = this.sun.target.position;
    t.set(0, 0, 0).addScaledVector(right, fr).addScaledVector(up2, fu).addScaledVector(dir, fd);
    this.sun.position.copy(t).addScaledVector(dir, 420);
    this.sun.target.updateMatrixWorld();
  }

  _bakeEnv() {
    const u = this.uniforms;
    const disk = u.uSunDisk.value, stars = u.uStars.value, flash = u.uFlash.value;
    u.uSunDisk.value = 0; // the sun itself is a real light; baking it too would double its highlight
    u.uStars.value = 0;
    u.uFlash.value = 0;
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 10, { size: 128 });
    u.uSunDisk.value = disk;
    u.uStars.value = stars;
    u.uFlash.value = flash;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.envDirty = false;
    this.envTimer = 0.4;
  }

  /** The baked sky, for the cabin scene to share. */
  get envMap() {
    return this.envRT ? this.envRT.texture : null;
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
