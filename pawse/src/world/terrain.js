import * as THREE from 'three';
import { Noise2D, smoothstep, lerp, clamp } from '../core/utils.js';
import { shared, GLSL_GRASS_TINT } from './shared.js';

/** Layout of the park. Units are metres; +x is "east" (where the sun sets), +y is up. */
export const WORLD = {
  size: 256,
  half: 128,
  seg: 384,
  parkRadius: 76,
  waterLevel: -0.42,
  plaza: { x: 0, z: 0, r: 6.6 },
  pond: { x: 34, z: -22, r: 15.5 },
  island: { x: 31, z: -19.5, r: 5.2 },
  hill: { x: -40, z: 26, r: 27, h: 8.2 },
  lawn: { x: -10, z: -24, r: 13 },
  meadow: { x: 22, z: 30, r: 17 },
};

const noise = new Noise2D(20240612);

function baseHeight(x, z) {
  return (
    noise.fbm(x * 0.0105 + 3.1, z * 0.0105 - 1.7, 3, 2, 0.5) * 3.0 +
    noise.fbm(x * 0.047 + 9.2, z * 0.047 + 4.4, 2, 2, 0.5) * 0.3
  );
}

const PLAZA_H = Math.max(baseHeight(WORLD.plaza.x, WORLD.plaza.z), 0.35);

/** Distance to the pond centre normalised so that 1.0 is the shoreline. */
export function pondNorm(x, z) {
  const dx = x - WORLD.pond.x, dz = z - WORLD.pond.z;
  const a = Math.atan2(dz, dx);
  const R =
    WORLD.pond.r *
    (1 + 0.16 * Math.sin(2 * a + 0.6) + 0.09 * Math.sin(3 * a + 2.1) + 0.045 * Math.sin(5 * a + 4.0));
  return Math.hypot(dx, dz) / R;
}

export function pondShorePoint(angle, norm = 1) {
  const a = angle;
  const R =
    WORLD.pond.r *
    (1 + 0.16 * Math.sin(2 * a + 0.6) + 0.09 * Math.sin(3 * a + 2.1) + 0.045 * Math.sin(5 * a + 4.0));
  return { x: WORLD.pond.x + Math.cos(a) * R * norm, z: WORLD.pond.z + Math.sin(a) * R * norm };
}

export function terrainHeight(x, z) {
  const W = WORLD;
  const r = Math.hypot(x, z);
  let h = baseHeight(x, z);

  // keep land comfortably above the water table around the pond
  const pd = pondNorm(x, z);
  if (pd < 2.8) h = lerp(h, Math.max(h, W.waterLevel + 0.6), smoothstep(2.8, 1.8, pd));

  // the plaza is flat
  const dp = Math.hypot(x - W.plaza.x, z - W.plaza.z);
  h = lerp(h, PLAZA_H, smoothstep(W.plaza.r + 11, W.plaza.r + 1.5, dp));

  // the hill
  const dh = Math.hypot(x - W.hill.x, z - W.hill.z) / W.hill.r;
  if (dh < 1) {
    const k = 1 - dh * dh;
    h += W.hill.h * k * k;
  }

  // pond basin with a little island
  if (pd < 1.7) {
    const bank = smoothstep(1.7, 1.0, pd);
    let bed = pd >= 1 ? W.waterLevel + (pd - 1) * 1.2 : W.waterLevel - 1.7 * smoothstep(1.0, 0.25, pd);
    const di = Math.hypot(x - W.island.x, z - W.island.z) / W.island.r;
    if (di < 1) {
      const k = 1 - di * di;
      bed += 2.9 * k * k;
    }
    h = lerp(h, bed, bank);
  }

  // wooded hills rising around the park
  const rim = smoothstep(W.parkRadius - 3, W.parkRadius + 42, r);
  h += rim * rim * 15 + rim * noise.fbm(x * 0.03 + 5, z * 0.03 - 8, 3) * 4.5;
  return h;
}

// ------------------------------------------------------------------ paths

const LOOP = [
  [0, -52], [28, -52], [56, -36], [63, -8], [53, 24], [29, 48], [-2, 56],
  [-30, 54], [-56, 44], [-67, 20], [-60, -8], [-48, -32], [-26, -48],
];
const SPOKES = [
  [[0, -5.5], [2.5, -26], [0, -52]],
  [[5.5, 1.2], [22, 7], [40, 11], [56, 12]],
  [[1, 5.5], [5, 28], [3, 55]],
  [[-5.5, 1], [-14, 7], [-22, 11], [-29, 18], [-35, 23.5]],
  [[14, 4], [17, -6], [19.5, -13.5]], // down to the little beach
];

function curvePoints(pts, closed, spacing = 1.2) {
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    closed,
    'catmullrom',
    0.5
  );
  const n = Math.max(8, Math.round(curve.getLength() / spacing));
  return curve.getSpacedPoints(n).map((p) => ({ x: p.x, z: p.z }));
}

export const PATHS = {
  loop: curvePoints(LOOP, true),
  spokes: SPOKES.map((s) => curvePoints(s, false)),
};

// ------------------------------------------------------------------ mask

const MASK_SIZE = 1024;

function paintMask() {
  const S = MASK_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const k = S / WORLD.size;
  const c = (v) => (v + WORLD.half) * k;
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // soft-edged stroke/fill: several passes of decreasing width adding up to full strength
  const softStroke = (pts, closed, width, color, feather = 1.6, passes = 6) => {
    g.strokeStyle = color;
    g.globalAlpha = 1 / passes;
    for (let i = 0; i < passes; i++) {
      g.lineWidth = (width + feather * (i / (passes - 1)) * 2) * k;
      g.beginPath();
      pts.forEach((p, j) => (j ? g.lineTo(c(p.x), c(p.z)) : g.moveTo(c(p.x), c(p.z))));
      if (closed) g.closePath();
      g.stroke();
    }
    g.globalAlpha = 1;
  };
  const softDisc = (x, z, r, color, feather = 1.5, passes = 6) => {
    g.fillStyle = color;
    g.globalAlpha = 1 / passes;
    for (let i = 0; i < passes; i++) {
      g.beginPath();
      g.arc(c(x), c(z), (r + feather * (i / (passes - 1))) * k, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  };

  // R: trodden earth paths
  softStroke(PATHS.loop, true, 2.5, '#ff0000');
  PATHS.spokes.forEach((s, i) => softStroke(s, false, i === 4 ? 1.7 : 2.3, '#ff0000'));
  // worn patches: under the hilltop tree, the play lawn, the beach approach
  softDisc(WORLD.hill.x + 2.4, WORLD.hill.z - 0.6, 2.0, '#ff0000', 1.8);

  // G: sand around and under the pond
  const shore = [];
  for (let i = 0; i < 160; i++) shore.push(pondShorePoint((i / 160) * Math.PI * 2, 1.0));
  g.fillStyle = '#00ff00';
  g.beginPath();
  shore.forEach((p, j) => (j ? g.lineTo(c(p.x), c(p.z)) : g.moveTo(c(p.x), c(p.z))));
  g.closePath();
  g.fill();
  softStroke(shore, true, 1.6, '#00ff00', 1.6);
  softDisc(18.6, -15.5, 4.2, '#00ff00', 2.2); // the little beach on the west shore
  // ...but the island's crown is grassy: knock the green channel back out there
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = '#ff00ff';
  g.beginPath();
  g.arc(c(WORLD.island.x), c(WORLD.island.z), 2.9 * k, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'lighter';

  // B: plaza paving
  softDisc(WORLD.plaza.x, WORLD.plaza.z, WORLD.plaza.r, '#0000ff', 0.5, 4);

  const data = g.getImageData(0, 0, S, S).data;
  return { canvas, data };
}

// ------------------------------------------------------------------ terrain

export class Terrain {
  constructor() {
    const N = WORLD.seg + 1;
    this.N = N;
    this.cell = WORLD.size / WORLD.seg;
    const heights = (this.heights = new Float32Array(N * N));
    for (let j = 0; j < N; j++) {
      const z = -WORLD.half + j * this.cell;
      for (let i = 0; i < N; i++) {
        heights[j * N + i] = terrainHeight(-WORLD.half + i * this.cell, z);
      }
    }

    // normals by central differences
    const normals = (this.normals = new Float32Array(N * N * 3));
    const inv = 1 / (2 * this.cell);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const il = Math.max(i - 1, 0), ir = Math.min(i + 1, N - 1);
        const jd = Math.max(j - 1, 0), ju = Math.min(j + 1, N - 1);
        const dx = (heights[j * N + ir] - heights[j * N + il]) * inv;
        const dz = (heights[ju * N + i] - heights[jd * N + i]) * inv;
        const l = 1 / Math.hypot(dx, 1, dz);
        const o = (j * N + i) * 3;
        normals[o] = -dx * l;
        normals[o + 1] = l;
        normals[o + 2] = -dz * l;
      }
    }

    // GPU copy: R = height, GBA = normal (half floats filter linearly everywhere in WebGL2)
    const hf = new Uint16Array(N * N * 4);
    const toHalf = THREE.DataUtils.toHalfFloat;
    for (let i = 0; i < N * N; i++) {
      hf[i * 4] = toHalf(heights[i]);
      hf[i * 4 + 1] = toHalf(normals[i * 3]);
      hf[i * 4 + 2] = toHalf(normals[i * 3 + 1]);
      hf[i * 4 + 3] = toHalf(normals[i * 3 + 2]);
    }
    const heightTex = new THREE.DataTexture(hf, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
    heightTex.magFilter = heightTex.minFilter = THREE.LinearFilter;
    heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
    heightTex.needsUpdate = true;
    this.heightTex = heightTex;
    shared.uHeightMap.value = heightTex;
    // world xz -> uv, hitting texel centres exactly at the grid points
    shared.uHm.value.set(WORLD.seg / (WORLD.size * N), (WORLD.half * WORLD.seg / WORLD.size + 0.5) / N);
    shared.uWaterLevel.value = WORLD.waterLevel;

    const mask = paintMask();
    this.maskData = mask.data;
    const maskTex = new THREE.CanvasTexture(mask.canvas);
    maskTex.flipY = false;
    maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
    maskTex.minFilter = THREE.LinearMipmapLinearFilter;
    maskTex.magFilter = THREE.LinearFilter;
    maskTex.anisotropy = 4;
    this.maskTex = maskTex;
    shared.uMaskMap.value = maskTex;

    this.mesh = this._buildMesh();
  }

  _buildMesh() {
    const N = this.N;
    const pos = new Float32Array(N * N * 3);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const o = (j * N + i) * 3;
        pos[o] = -WORLD.half + i * this.cell;
        pos[o + 1] = this.heights[j * N + i];
        pos[o + 2] = -WORLD.half + j * this.cell;
      }
    }
    const idx = new Uint32Array(WORLD.seg * WORLD.seg * 6);
    let k = 0;
    for (let j = 0; j < WORLD.seg; j++) {
      for (let i = 0; i < WORLD.seg; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        // alternate the diagonal so shorelines don't show a directional bias
        if ((i + j) & 1) {
          idx[k++] = a; idx[k++] = c; idx[k++] = b;
          idx[k++] = b; idx[k++] = c; idx[k++] = d;
        } else {
          idx[k++] = a; idx[k++] = c; idx[k++] = d;
          idx[k++] = a; idx[k++] = d; idx[k++] = b;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    this.groundUniforms = {
      uGrassCenter: { value: new THREE.Vector2() },
      uGrassFade: { value: new THREE.Vector2(14, 30) },
      uDirtA: { value: new THREE.Color('#9a7a54') },
      uDirtB: { value: new THREE.Color('#c2a377') },
      uSandA: { value: new THREE.Color('#cdb88a') },
      uSandB: { value: new THREE.Color('#e6d6ae') },
      uStoneA: { value: new THREE.Color('#b7ab9a') },
      uStoneB: { value: new THREE.Color('#d6cbb8') },
      uPlaza: { value: new THREE.Vector3(WORLD.plaza.x, WORLD.plaza.z, WORLD.plaza.r) },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.groundUniforms, {
        uMaskMap: shared.uMaskMap,
        uNoise: shared.uNoise,
        uGrassDark: shared.uGrassDark,
        uGrassLight: shared.uGrassLight,
        uGrassDry: shared.uGrassDry,
        uWaterLevel: shared.uWaterLevel,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWPos;
          uniform sampler2D uMaskMap;
          uniform sampler2D uNoise;
          uniform vec3 uGrassDark;
          uniform vec3 uGrassLight;
          uniform vec3 uGrassDry;
          uniform vec3 uDirtA;
          uniform vec3 uDirtB;
          uniform vec3 uSandA;
          uniform vec3 uSandB;
          uniform vec3 uStoneA;
          uniform vec3 uStoneB;
          uniform vec3 uPlaza;
          uniform vec2 uGrassCenter;
          uniform vec2 uGrassFade;
          uniform float uWaterLevel;
          ${GLSL_GRASS_TINT}`
        )
        .replace(
          '#include <color_fragment>',
          `{
            vec2 gp = vWPos.xz;
            vec3 mk = texture2D(uMaskMap, gp / ${WORLD.size.toFixed(1)} + 0.5).rgb;
            float nA = texture2D(uNoise, gp * 0.21).g;
            float nB = texture2D(uNoise, gp * 0.035).r;
            float nC = texture2D(uNoise, gp * 0.83).b;
            vec3 tint = grassTint(gp);
            float farMix = smoothstep(uGrassFade.x, uGrassFade.y, length(gp - uGrassCenter));
            vec3 col = tint * mix(0.4, 0.92, farMix) * (0.86 + 0.28 * mix(nC, nA, farMix));

            float sandAmt = smoothstep(0.3, 0.62, mk.g + (nA - 0.5) * 0.25);
            col = mix(col, mix(uSandA, uSandB, nA) * (0.9 + 0.2 * nC), sandAmt);
            float pathAmt = smoothstep(0.34, 0.6, mk.r + (nA - 0.5) * 0.3);
            col = mix(col, mix(uDirtA, uDirtB, nA * 0.6 + nB * 0.4) * (0.88 + 0.24 * nC), pathAmt);

            // circular paving on the plaza
            vec2 pv = gp - uPlaza.xy;
            float pr = length(pv);
            float ringI = floor(pr / 0.62);
            float ringF = fract(pr / 0.62);
            float cnt = max(6.0, floor(ringI * 3.4 + 6.0));
            float sv = atan(pv.y, pv.x) / 6.2831853 * cnt + ringI * 0.37;
            float segF = fract(sv);
            float joint = max(smoothstep(0.9, 0.97, ringF), smoothstep(1.0 - 0.06 * cnt / (pr * 6.2831853 / 0.62 + 1.0), 1.0, segF));
            float sVar = fract(sin(dot(vec2(ringI, floor(sv)), vec2(12.9898, 78.233))) * 43758.5453);
            vec3 stone = mix(uStoneA, uStoneB, sVar) * (0.92 + 0.16 * nC) * (1.0 - joint * 0.3);
            col = mix(col, stone, smoothstep(0.45, 0.55, mk.b));

            // damp earth at the waterline and below
            float wet = 1.0 - smoothstep(uWaterLevel - 0.02, uWaterLevel + 0.2, vWPos.y);
            col *= mix(1.0, 0.62, wet);
            diffuseColor.rgb = col;
          }`
        );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'terrain';
    return mesh;
  }

  heightAt(x, z) {
    const N = this.N, h = this.heights;
    const fx = clamp((x + WORLD.half) / this.cell, 0, WORLD.seg - 1e-4);
    const fz = clamp((z + WORLD.half) / this.cell, 0, WORLD.seg - 1e-4);
    const ix = fx | 0, iz = fz | 0;
    const tx = fx - ix, tz = fz - iz;
    const i = iz * N + ix;
    return (h[i] * (1 - tx) + h[i + 1] * tx) * (1 - tz) + (h[i + N] * (1 - tx) + h[i + N + 1] * tx) * tz;
  }

  normalAt(x, z, out) {
    const e = 0.35;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  }

  /** Depth of water above the ground at this spot (<= 0 means dry land). */
  waterDepthAt(x, z) {
    if (pondNorm(x, z) > 1.25) return -1;
    return WORLD.waterLevel - this.heightAt(x, z);
  }

  /** Surface type under a point: path / sand / paved, each 0..1. */
  maskAt(x, z, out = {}) {
    const S = MASK_SIZE;
    const px = clamp(Math.floor(((x + WORLD.half) / WORLD.size) * S), 0, S - 1);
    const pz = clamp(Math.floor(((z + WORLD.half) / WORLD.size) * S), 0, S - 1);
    const i = (pz * S + px) * 4;
    out.path = this.maskData[i] / 255;
    out.sand = this.maskData[i + 1] / 255;
    out.paved = this.maskData[i + 2] / 255;
    return out;
  }

  /** True where grass grows (used for placing flowers, treats, birds). */
  isGrassy(x, z) {
    const m = this.maskAt(x, z, _m);
    return m.path < 0.12 && m.sand < 0.12 && m.paved < 0.12;
  }
}

const _m = {};
