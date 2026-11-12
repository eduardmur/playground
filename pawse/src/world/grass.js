import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';
import { shared, GLSL_GRASS_TINT, GLSL_WIND } from './shared.js';
import { WORLD } from './terrain.js';

export const MAX_PUSHERS = 10;

/**
 * A square patch of instanced grass blades that wraps around a moving centre,
 * so it always surrounds the camera. Blades sit on the terrain via the height
 * texture, lean with the wind, and part around dogs ("pushers").
 */
export class Grass {
  constructor({ count = 160000, patch = 56, bladeH = 0.26, bladeW = 0.055, fade = [-2, -1, 18, 27], seed = 7, segs = 3 }) {
    const rnd = mulberry32(seed);

    // one blade: a tapered strip standing on y in [0,1]
    const rows = segs + 1;
    const pos = [];
    const idx = [];
    for (let j = 0; j < rows; j++) {
      const t = j / segs;
      const w = 0.5 * (1 - Math.pow(t, 1.7));
      pos.push(-w, t, 0, w, t, 0);
    }
    for (let j = 0; j < segs; j++) {
      const a = j * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, d, a, d, c);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex(idx);

    // jittered grid so coverage is even
    const side = Math.floor(Math.sqrt(count));
    const n = side * side;
    const cell = patch / side;
    const offsets = new Float32Array(n * 2);
    const rand = new Float32Array(n * 4);
    // shuffled, so drawing only the first N instances thins the grass evenly
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    for (let k = 0; k < n; k++) {
      const i = order[k] % side, j = Math.floor(order[k] / side);
      offsets[k * 2] = (i + rnd()) * cell;
      offsets[k * 2 + 1] = (j + rnd()) * cell;
      rand[k * 4] = rnd();
      rand[k * 4 + 1] = rnd();
      rand[k * 4 + 2] = rnd();
      rand[k * 4 + 3] = rnd();
    }
    this.total = n;
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 2));
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 4));
    geo.instanceCount = n;

    this.baseW = bladeW;
    this.uniforms = {
      uCenter: { value: new THREE.Vector2() },
      uPatch: { value: patch },
      uFade: { value: new THREE.Vector4(...fade) },
      uBladeH: { value: bladeH },
      uBladeW: { value: bladeW },
      uPushers: { value: Array.from({ length: MAX_PUSHERS }, () => new THREE.Vector4(0, 0, 1, 0)) },
    };

    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms, {
        uHeightMap: shared.uHeightMap,
        uMaskMap: shared.uMaskMap,
        uNoise: shared.uNoise,
        uHm: shared.uHm,
        uWaterLevel: shared.uWaterLevel,
        uTime: shared.uTime,
        uWindDir: shared.uWindDir,
        uWindStr: shared.uWindStr,
        uGrassDark: shared.uGrassDark,
        uGrassLight: shared.uGrassLight,
        uGrassDry: shared.uGrassDry,
        uSunDir: shared.uSunDir,
        uBacklight: shared.uBacklight,
      });
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          #define NPUSH ${MAX_PUSHERS}
          attribute vec2 aOffset;
          attribute vec4 aRand;
          uniform sampler2D uHeightMap;
          uniform sampler2D uMaskMap;
          uniform sampler2D uNoise;
          uniform vec2 uHm;
          uniform vec2 uCenter;
          uniform float uPatch;
          uniform vec4 uFade;
          uniform float uBladeH;
          uniform float uBladeW;
          uniform float uWaterLevel;
          uniform float uTime;
          uniform vec2 uWindDir;
          uniform float uWindStr;
          uniform vec4 uPushers[NPUSH];
          uniform vec3 uGrassDark;
          uniform vec3 uGrassLight;
          uniform vec3 uGrassDry;
          uniform vec3 uSunDir;
          uniform float uBacklight;
          varying vec3 vGrassCol;
          ${GLSL_GRASS_TINT}
          ${GLSL_WIND}`
        )
        .replace(
          '#include <beginnormal_vertex>',
          `
          vec2 gW = mod(aOffset - uCenter + uPatch * 0.5, uPatch) - uPatch * 0.5 + uCenter;
          vec4 gHm = texture2D(uHeightMap, gW * uHm.x + uHm.y);
          vec3 gMk = texture2D(uMaskMap, gW / ${WORLD.size.toFixed(1)} + 0.5).rgb;
          float gT = position.y;
          float gDist = length(gW - uCenter);
          float gFade = (1.0 - smoothstep(uFade.z, uFade.w, gDist)) * smoothstep(uFade.x, uFade.y, gDist);

          float gBare = max(gMk.r, max(gMk.g, gMk.b));
          float gPresence = 1.0 - smoothstep(0.16, 0.42, gBare + (aRand.w - 0.5) * 0.22);
          gPresence *= smoothstep(uWaterLevel + 0.03, uWaterLevel + 0.3, gHm.r);
          float gWild = texture2D(uNoise, gW * 0.0061 + 0.21).a;
          float gTall = mix(0.72, 1.55, smoothstep(0.42, 0.68, gWild)) * (1.0 - 0.45 * smoothstep(0.02, 0.16, gBare));

          float gust = gustAt(gW);
          float gAng = aRand.x * 6.2831853;
          vec2 gB = vec2(cos(gAng), sin(gAng));
          vec2 gF = vec2(-gB.y, gB.x);
          float gFl = sin(uTime * (2.0 + aRand.w * 1.6) + aRand.w * 43.0 + gW.x * 0.37 + gW.y * 0.29);
          vec2 gBend = gF * ((aRand.z - 0.5) * 0.7)
                     + uWindDir * (0.1 + gust * 0.85) * uWindStr
                     + gF * gFl * 0.07 * (0.6 + gust);
          float gSquash = 0.0;
          for (int i = 0; i < NPUSH; i++) {
            vec4 pu = uPushers[i];
            vec2 pd = gW - pu.xy;
            float pl = length(pd) + 1e-4;
            float pf = (1.0 - smoothstep(pu.z * 0.3, pu.z, pl)) * pu.w;
            gBend += (pd / pl) * pf * 1.4;
            gSquash = max(gSquash, pf);
          }
          float gBl = length(gBend);
          gBend *= min(1.0, 1.6 / max(gBl, 1e-4));
          gBl = min(gBl, 1.6);

          float gH = uBladeH * (0.6 + aRand.y * 0.8) * gTall * gPresence * gFade;
          float gWd = uBladeW * (0.75 + aRand.y * 0.5) * min(1.0, gPresence * gFade * 3.0);
          vec3 gN = normalize(gHm.gba);
          vec3 objectNormal = normalize(gN + vec3(gBend.x, 0.0, gBend.y) * 0.35 * gT);
          `
        )
        .replace(
          '#include <begin_vertex>',
          `
          vec3 transformed;
          transformed.xz = gW + gB * (position.x * gWd) + gBend * (gT * gT * gH * 0.75);
          transformed.y = gHm.r + gT * gH * (1.0 - 0.6 * gSquash) * (1.0 - 0.22 * gBl * gT);

          vec3 gTint = grassTint(gW);
          vec3 gBase = gTint * 0.36;
          vec3 gTip = gTint * (1.18 + gust * 0.24) + vec3(0.03, 0.045, 0.0) + (aRand.w - 0.5) * vec3(0.05, 0.05, 0.01);
          vGrassCol = mix(gBase, gTip, gT * (0.55 + 0.45 * gT));
          vec3 gV = normalize(cameraPosition - transformed);
          float gBack = pow(max(dot(-gV, uSunDir), 0.0), 2.0);
          vGrassCol *= 1.0 + gBack * gT * uBacklight;
          `
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;')
        .replace('#include <color_fragment>', 'diffuseColor.rgb = vGrassCol;')
        .replace(
          '#include <normal_fragment_maps>',
          'normal = normalize(vNormal);\n#include <normal_fragment_maps>'
        );
    };
    mat.customProgramCacheKey = () => 'grass';

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'grass';
  }

  /** Draw a fraction of the blades (they widen a little to keep the lawn looking full). */
  setDensity(k) {
    this.mesh.geometry.instanceCount = Math.max(1000, Math.floor(this.total * k));
    this.uniforms.uBladeW.value = this.baseW / Math.sqrt(Math.max(k, 0.2));
  }

  setCenter(x, z) {
    this.uniforms.uCenter.value.set(x, z);
  }

  /** pushers: array of {x, z, r, s}. Unused slots are zeroed. */
  setPushers(list) {
    const arr = this.uniforms.uPushers.value;
    for (let i = 0; i < MAX_PUSHERS; i++) {
      const p = list[i];
      if (p) arr[i].set(p.x, p.z, p.r, p.s);
      else arr[i].set(0, 0, 1, 0);
    }
  }
}
