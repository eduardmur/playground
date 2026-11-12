import * as THREE from 'three';
import { TAU, mulberry32, randRange } from '../core/utils.js';
import { shared } from '../world/shared.js';
import { WORLD, pondNorm } from '../world/terrain.js';

/** Sprite sheet cells. */
export const CELL = { SOFT: 0, HEART: 1, SPARK: 2, PETAL: 3, NOTE: 4, ZZZ: 5, DROP: 6, RING: 7 };

function makeAtlas() {
  const C = 128;
  const cv = document.createElement('canvas');
  cv.width = C * 4;
  cv.height = C * 2;
  const g = cv.getContext('2d');
  const at = (i) => [(i % 4) * C + C / 2, Math.floor(i / 4) * C + C / 2];
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';

  // 0 soft blob
  let [x, y] = at(0);
  let grad = g.createRadialGradient(x, y, 0, x, y, C * 0.48);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(x - C / 2, y - C / 2, C, C);
  g.fillStyle = '#fff';

  // 1 heart
  [x, y] = at(1);
  g.beginPath();
  const s = C * 0.021;
  g.moveTo(x, y + 15 * s);
  g.bezierCurveTo(x - 24 * s, y - 2 * s, x - 14 * s, y - 20 * s, x, y - 8 * s);
  g.bezierCurveTo(x + 14 * s, y - 20 * s, x + 24 * s, y - 2 * s, x, y + 15 * s);
  g.fill();

  // 2 four-point sparkle
  [x, y] = at(2);
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU, r = i % 2 ? C * 0.07 : C * 0.42;
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  grad = g.createRadialGradient(x, y, 0, x, y, C * 0.3);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(x - C / 2, y - C / 2, C, C);
  g.fillStyle = '#fff';

  // 3 petal
  [x, y] = at(3);
  g.beginPath();
  g.moveTo(x - C * 0.3, y);
  g.quadraticCurveTo(x, y - C * 0.3, x + C * 0.32, y - C * 0.02);
  g.quadraticCurveTo(x + C * 0.05, y + C * 0.24, x - C * 0.3, y);
  g.fill();

  // 4 music note
  [x, y] = at(4);
  g.beginPath();
  g.ellipse(x - C * 0.1, y + C * 0.2, C * 0.13, C * 0.1, -0.4, 0, TAU);
  g.fill();
  g.fillRect(x, y - C * 0.28, C * 0.045, C * 0.48);
  g.beginPath();
  g.moveTo(x, y - C * 0.28);
  g.quadraticCurveTo(x + C * 0.26, y - C * 0.2, x + C * 0.2, y + C * 0.02);
  g.quadraticCurveTo(x + C * 0.18, y - C * 0.1, x, y - C * 0.14);
  g.fill();

  // 5 Z
  [x, y] = at(5);
  g.font = `italic 700 ${C * 0.74}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('z', x, y - C * 0.04);

  // 6 droplet (crisp dot)
  [x, y] = at(6);
  g.beginPath();
  g.arc(x, y, C * 0.3, 0, TAU);
  g.fill();

  // 7 ring
  [x, y] = at(7);
  g.lineWidth = C * 0.07;
  g.beginPath();
  g.arc(x, y, C * 0.36, 0, TAU);
  g.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

let _atlas = null;
const atlas = () => (_atlas ||= makeAtlas());
const pointScale = { value: 600 };
export function setPointScale(v) {
  pointScale.value = v;
}

const VERT = /* glsl */ `
  attribute vec4 aColor;
  attribute vec3 aData; // size, cell, rotation
  uniform float uScale;
  varying vec4 vColor;
  varying vec2 vCell;
  varying float vRot;
  void main() {
    vColor = aColor;
    vCell = vec2(mod(aData.y, 4.0), floor(aData.y / 4.0));
    vRot = aData.z;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aData.x * uScale / max(-mv.z, 0.05), 420.0);
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec4 vColor;
  varying vec2 vCell;
  varying float vRot;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    if (abs(p.x) > 0.5 || abs(p.y) > 0.5) discard;
    vec2 uv = (vCell + p + 0.5) / vec2(4.0, 2.0);
    vec4 t = texture2D(uAtlas, uv);
    float a = t.a * vColor.a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb * t.rgb, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** A CPU-simulated pool of sprite particles. */
export class Particles {
  constructor(max = 2000, additive = false) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.color = new Float32Array(max * 4);
    this.data = new Float32Array(max * 3);
    this.p = Array.from({ length: max }, () => ({
      alive: false, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 0, s1: 0, a: 1, grav: 0, drag: 0, rotv: 0,
      wind: 0, fadeIn: 0.1, fadeOut: 0.4, floor: -1e9, sway: 0, seed: 0,
    }));
    this.next = 0;
    this.alive = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aData', new THREE.BufferAttribute(this.data, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: atlas() }, uScale: pointScale },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 21 : 20;
  }

  /**
   * opts: x,y,z, vx,vy,vz, life, size, sizeEnd, color (THREE.Color|hex), alpha, cell,
   * gravity, drag, rot, rotv, wind (0..1 follows wind), fadeIn, fadeOut (fractions of life),
   * floor (y where it stops), sway
   */
  spawn(o) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const q = this.p[i];
    q.alive = true;
    q.vx = o.vx || 0;
    q.vy = o.vy || 0;
    q.vz = o.vz || 0;
    q.life = 0;
    q.max = o.life || 1;
    q.s0 = o.size ?? 0.1;
    q.s1 = o.sizeEnd ?? q.s0;
    q.a = o.alpha ?? 1;
    q.grav = o.gravity || 0;
    q.drag = o.drag || 0;
    q.rotv = o.rotv || 0;
    q.wind = o.wind || 0;
    q.fadeIn = o.fadeIn ?? 0.08;
    q.fadeOut = o.fadeOut ?? 0.4;
    q.floor = o.floor ?? -1e9;
    q.sway = o.sway || 0;
    q.seed = Math.random() * 100;
    this.pos[i * 3] = o.x;
    this.pos[i * 3 + 1] = o.y;
    this.pos[i * 3 + 2] = o.z;
    _c.set(o.color ?? 0xffffff);
    this.color[i * 4] = _c.r;
    this.color[i * 4 + 1] = _c.g;
    this.color[i * 4 + 2] = _c.b;
    this.color[i * 4 + 3] = 0;
    this.data[i * 3] = q.s0;
    this.data[i * 3 + 1] = o.cell || 0;
    this.data[i * 3 + 2] = o.rot || 0;
  }

  update(dt) {
    const wind = shared.uWindDir.value;
    const t = shared.uTime.value;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      const q = this.p[i];
      if (!q.alive) continue;
      q.life += dt;
      const k = q.life / q.max;
      if (k >= 1) {
        q.alive = false;
        this.color[i * 4 + 3] = 0;
        this.data[i * 3] = 0;
        continue;
      }
      alive++;
      const d = Math.exp(-q.drag * dt);
      q.vx *= d;
      q.vy *= d;
      q.vz *= d;
      q.vy -= q.grav * dt;
      let x = this.pos[i * 3] + (q.vx + wind.x * q.wind) * dt;
      let y = this.pos[i * 3 + 1] + q.vy * dt;
      let z = this.pos[i * 3 + 2] + (q.vz + wind.y * q.wind) * dt;
      if (q.sway) {
        x += Math.sin(t * 2.3 + q.seed) * q.sway * dt;
        z += Math.cos(t * 1.9 + q.seed * 1.3) * q.sway * dt;
      }
      if (y < q.floor) {
        y = q.floor;
        q.vx = q.vy = q.vz = 0;
        q.rotv = 0;
        q.wind = 0;
        q.sway = 0;
      }
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const fi = q.fadeIn > 0 ? Math.min(1, k / q.fadeIn) : 1;
      const fo = q.fadeOut > 0 ? Math.min(1, (1 - k) / q.fadeOut) : 1;
      this.color[i * 4 + 3] = q.a * fi * fo;
      this.data[i * 3] = q.s0 + (q.s1 - q.s0) * k;
      this.data[i * 3 + 2] += q.rotv * dt;
    }
    this.alive = alive;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aData.needsUpdate = true;
  }
}

const _c = new THREE.Color();

/** Fireflies: lazily drifting glows that only come out after dark. All motion is in the shader. */
export class Fireflies {
  constructor(terrain, spots, count = 170) {
    const rnd = mulberry32(31);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      let x, z;
      for (let tries = 0; tries < 30; tries++) {
        if (spots.length && rnd() < 0.7) {
          const s = spots[Math.floor(rnd() * spots.length)];
          const a = rnd() * TAU, d = 0.5 + rnd() * 5;
          x = s.x + Math.cos(a) * d;
          z = s.z + Math.sin(a) * d;
        } else {
          const a = rnd() * TAU, d = Math.sqrt(rnd()) * (WORLD.parkRadius - 2);
          x = Math.cos(a) * d;
          z = Math.sin(a) * d;
        }
        if (pondNorm(x, z) > 0.9 && Math.hypot(x, z) < WORLD.parkRadius) break;
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = Math.max(terrain.heightAt(x, z), WORLD.waterLevel) + randRange(rnd, 0.35, 1.9);
      pos[i * 3 + 2] = z;
      seed[i * 4] = rnd();
      seed[i * 4 + 1] = rnd();
      seed[i * 4 + 2] = rnd();
      seed[i * 4 + 3] = rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.uniforms = { uTime: shared.uTime, uScale: pointScale, uAmount: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform float uScale;
        uniform float uAmount;
        varying float vGlow;
        void main() {
          float t = uTime;
          vec3 p = position;
          p.x += sin(t * (0.21 + aSeed.x * 0.25) + aSeed.y * 40.0) * 1.6 + sin(t * 0.9 + aSeed.z * 20.0) * 0.25;
          p.z += cos(t * (0.19 + aSeed.y * 0.22) + aSeed.x * 40.0) * 1.6 + cos(t * 1.1 + aSeed.w * 20.0) * 0.25;
          p.y += sin(t * (0.5 + aSeed.z * 0.5) + aSeed.w * 30.0) * 0.35;
          float blink = smoothstep(0.1, 0.75, sin(t * (0.7 + aSeed.w * 1.3) + aSeed.x * 60.0) * 0.5 + 0.5);
          vGlow = blink * uAmount;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min((0.1 + aSeed.z * 0.07) * uScale / max(-mv.z, 0.1), 80.0) * step(0.004, vGlow);
        }`,
      fragmentShader: /* glsl */ `
        varying float vGlow;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          a = a * a * 0.9 + smoothstep(0.12, 0.0, d);
          gl_FragColor = vec4(vec3(1.0, 0.92, 0.42) * 2.4 * a * vGlow, a * vGlow);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 22;
    this.points.visible = false;
  }

  setAmount(a) {
    this.uniforms.uAmount.value = a;
    this.points.visible = a > 0.003;
  }
}

/** Sunlit dust and pollen hanging in the air around the camera. */
export class Motes {
  constructor(count = 260, box = 26) {
    const rnd = mulberry32(77);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rnd() * box;
      pos[i * 3 + 1] = rnd() * 5.5;
      pos[i * 3 + 2] = rnd() * box;
      seed[i * 2] = rnd();
      seed[i * 2 + 1] = rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    this.uniforms = {
      uTime: shared.uTime,
      uScale: pointScale,
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: box },
      uWindDir: shared.uWindDir,
      uColor: { value: new THREE.Color('#fff2cc') },
      uAmount: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec2 aSeed;
        uniform float uTime;
        uniform float uScale;
        uniform vec3 uCenter;
        uniform float uBox;
        uniform vec2 uWindDir;
        uniform float uAmount;
        varying float vA;
        void main() {
          vec3 p = position;
          p.xz += uWindDir * uTime * (0.25 + aSeed.x * 0.3);
          p.x += sin(uTime * 0.4 + aSeed.y * 30.0) * 0.5;
          p.y += sin(uTime * 0.3 + aSeed.x * 30.0) * 0.4;
          p.xz = mod(p.xz - uCenter.xz + uBox * 0.5, uBox) - uBox * 0.5 + uCenter.xz;
          p.y += uCenter.y - 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          vA = uAmount * smoothstep(0.6, 3.0, dist) * (1.0 - smoothstep(uBox * 0.32, uBox * 0.5, dist))
             * (0.35 + 0.65 * (sin(uTime * (0.6 + aSeed.y) + aSeed.x * 50.0) * 0.5 + 0.5));
          gl_PointSize = min((0.018 + aSeed.y * 0.03) * uScale / max(dist, 0.1), 24.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          float a = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5)) * vA;
          gl_FragColor = vec4(uColor * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 19;
  }
}
