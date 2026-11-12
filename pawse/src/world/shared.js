import * as THREE from 'three';
import { Noise2D } from '../core/utils.js';

/**
 * Uniforms shared by many materials (wind, time, sun, grass palette).
 * Materials hold references to these very objects, so updating `.value`
 * once per frame updates every shader that uses them.
 */
export const shared = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.86, 0.5).normalize() },
  uWindStr: { value: 1 },
  uNoise: { value: null },
  uHeightMap: { value: null },
  uMaskMap: { value: null },
  uHm: { value: new THREE.Vector2(1, 0) },
  uWaterLevel: { value: 0 },

  uGrassDark: { value: new THREE.Color('#3d7a2a') },
  uGrassLight: { value: new THREE.Color('#7db53a') },
  uGrassDry: { value: new THREE.Color('#b9b04c') },

  uSunDir: { value: new THREE.Vector3(0.6, 0.5, -0.3).normalize() },
  uSunColor: { value: new THREE.Color('#ffd9a8') },
  uBacklight: { value: 1 },

  uSkyZenith: { value: new THREE.Color('#4a7cc9') },
  uSkyHorizon: { value: new THREE.Color('#ffd7a0') },
  uAmbient: { value: new THREE.Color('#ffffff') },
};

/** Tiling RGBA noise texture: four independent fbm channels. */
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const noises = [new Noise2D(11), new Noise2D(23), new Noise2D(37), new Noise2D(59)];
  const base = 4; // lattice cells across the texture for the first octave
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * base, v = (y / size) * base;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        const n = noises[c].fbm(u, v, 4, 2, 0.5, base);
        data[i + c] = Math.max(0, Math.min(255, Math.round((0.5 + n * 0.95) * 255)));
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- GLSL chunks

export const GLSL_GRASS_TINT = /* glsl */ `
vec3 grassTint(vec2 p) {
  float a = texture2D(uNoise, p * 0.0075).r;
  float b = texture2D(uNoise, p * 0.041 + 0.37).g;
  float k = smoothstep(0.3, 0.7, a * 0.62 + b * 0.38);
  vec3 c = mix(uGrassDark, uGrassLight, k);
  c = mix(c, uGrassDry, smoothstep(0.58, 0.85, b) * 0.4);
  return c;
}
`;

/** Rolling gusts: bands of stronger wind that travel across the park. */
export const GLSL_WIND = /* glsl */ `
float gustAt(vec2 p) {
  vec2 q = p * 0.011 - uWindDir * uTime * 0.042;
  float g = texture2D(uNoise, q).b;
  float g2 = texture2D(uNoise, q * 2.7 + 0.5).a;
  return smoothstep(0.32, 0.82, g * 0.7 + g2 * 0.3);
}
`;

export const GLSL_WIND_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStr;
uniform sampler2D uNoise;
`;

/**
 * Makes any (instanced) standard material sway in the wind, bending more the
 * higher a vertex is above its own origin. Used for flowers, reeds, bushes.
 */
export function addSway(material, amount = 1, opts = {}) {
  const tintMask = !!opts.tintMask;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWindDir = shared.uWindDir;
    shader.uniforms.uWindStr = shared.uWindStr;
    shader.uniforms.uNoise = shared.uNoise;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${GLSL_WIND_UNIFORMS}
        ${GLSL_WIND}
        ${tintMask ? 'attribute float aTint;' : ''}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 swOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 swOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif
          float swG = gustAt(swOrigin.xz);
          float swPh = swOrigin.x * 1.7 + swOrigin.z * 2.3;
          float swH = max(transformed.y, 0.0);
          float swAmt = (0.06 + swG * 0.5) * uWindStr * ${amount.toFixed(3)};
          float swF = sin(uTime * 2.4 + swPh) * 0.05 * ${amount.toFixed(3)} * (0.6 + swG);
          vec2 swD = uWindDir * swAmt + vec2(cos(swPh), sin(swPh)) * swF;
          // the instance may be rotated about Y: undo that so wind stays in world space
          #ifdef USE_INSTANCING
            vec3 swAx = normalize(instanceMatrix[0].xyz);
            vec3 swAz = normalize(instanceMatrix[2].xyz);
            vec2 swL = vec2(dot(vec3(swD.x, 0.0, swD.y), swAx), dot(vec3(swD.x, 0.0, swD.y), swAz));
          #else
            vec2 swL = swD;
          #endif
          transformed.xz += swL * swH * swH * 0.9;
          transformed.y -= dot(swL, swL) * swH * 0.25;
        }`
      );
    if (tintMask) {
      // instance colour only tints vertices flagged with aTint (petals), not stems
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = mix(color.rgb, color.rgb * instanceColor.rgb, aTint);
        #endif`
      );
    }
  };
  material.customProgramCacheKey = () => `sway-${amount}-${tintMask}`;
  return material;
}
