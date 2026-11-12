import * as THREE from 'three';
import { shared } from './shared.js';
import { WORLD } from './terrain.js';

const MAX_RIPPLES = 16;

/**
 * Stylised pond water. Depth comes from the terrain height texture, so the
 * shoreline, shallows and foam follow the pond bed without a depth pre-pass.
 */
export class Water {
  constructor() {
    this.ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
    this.next = 0;

    const uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: shared.uTime,
      uNoise: shared.uNoise,
      uHeightMap: shared.uHeightMap,
      uHm: shared.uHm,
      uWaterLevel: shared.uWaterLevel,
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uSkyZenith: shared.uSkyZenith,
      uSkyHorizon: shared.uSkyHorizon,
      uAmbient: shared.uAmbient,
      uDeep: { value: new THREE.Color('#0d5560') },
      uShallow: { value: new THREE.Color('#58b3a2') },
      uTreeLine: { value: new THREE.Color('#2c5a3a') },
      uRipples: { value: this.ripples },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      fog: true,
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #define NR ${MAX_RIPPLES}
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform sampler2D uNoise;
        uniform sampler2D uHeightMap;
        uniform vec2 uHm;
        uniform float uWaterLevel;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyZenith;
        uniform vec3 uSkyHorizon;
        uniform vec3 uAmbient;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uTreeLine;
        uniform vec4 uRipples[NR];
        varying vec3 vWorld;

        void main() {
          vec2 p = vWorld.xz;
          float ground = texture2D(uHeightMap, p * uHm.x + uHm.y).r;
          float depth = uWaterLevel - ground;
          if (depth < -0.03) discard;
          float t = uTime;

          vec2 n1 = texture2D(uNoise, p * 0.06 + t * vec2(0.013, 0.008)).rg - 0.5;
          vec2 n2 = texture2D(uNoise, p * 0.17 - t * vec2(0.011, 0.017)).ba - 0.5;
          vec2 n3 = texture2D(uNoise, p * 0.53 + t * vec2(0.021, -0.015)).rb - 0.5;
          vec2 nn = n1 * 0.9 + n2 * 0.6 + n3 * 0.35;

          float rip = 0.0;
          for (int i = 0; i < NR; i++) {
            vec4 r = uRipples[i];
            float age = t - r.z;
            if (age > 0.0 && age < 5.0 && r.w > 0.0) {
              vec2 dv = p - r.xy;
              float dl = length(dv) + 1e-4;
              float ring = dl - age * 1.5;
              float env = exp(-ring * ring * 5.0) * exp(-age * 0.9) * r.w / (1.0 + dl * 0.4);
              float w = sin(ring * 11.0) * env;
              nn += (dv / dl) * w * 1.6;
              rip += abs(w);
            }
          }

          vec3 N = normalize(vec3(nn.x * 0.55, 1.0, nn.y * 0.55));
          vec3 V = normalize(cameraPosition - vWorld);
          float ndv = max(dot(N, V), 0.0);
          float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
          vec3 R = reflect(-V, N);
          vec3 light = uAmbient * 0.55 + uSunColor * 0.5;
          vec3 sky = mix(uSkyHorizon, uSkyZenith, 1.0 - exp(-max(R.y, 0.0) * 3.0));
          // low reflections pick up the dark line of trees around the pond
          sky = mix(uTreeLine * light, sky, smoothstep(0.04, 0.34, R.y));

          float sr = max(dot(R, uSunDir), 0.0);
          vec3 spec = uSunColor * (pow(sr, 900.0) * 30.0 + pow(sr, 120.0) * 1.3 + pow(sr, 14.0) * 0.07);
          float sparkle = texture2D(uNoise, p * 1.9 + t * 0.05).r * texture2D(uNoise, p * 2.7 - t * 0.04).g;
          spec += uSunColor * smoothstep(0.4, 0.58, sparkle) * pow(sr, 18.0) * 7.0;

          vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 1.0, depth)) * light;
          vec3 col = mix(body, sky, clamp(fres * 0.9 + 0.06, 0.0, 1.0)) + spec;

          float fn = texture2D(uNoise, p * 0.9 + t * 0.03).a;
          float foam = 1.0 - smoothstep(0.0, 0.055, depth - (fn - 0.5) * 0.05 + sin(t * 1.3 + fn * 9.0) * 0.012);
          col = mix(col, light * 0.95, foam * 0.6 + clamp(rip * 0.5, 0.0, 0.35));

          float alpha = mix(0.5, 0.93, smoothstep(0.0, 0.8, depth));
          alpha = max(alpha, max(fres, foam * 0.8));
          alpha *= smoothstep(-0.03, 0.02, depth);

          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });

    const geo = new THREE.CircleGeometry(WORLD.pond.r * 1.45, 72);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(WORLD.pond.x, WORLD.waterLevel, WORLD.pond.z);
    this.mesh.renderOrder = 5;
    this.mesh.name = 'water';
  }

  addRipple(x, z, strength = 1) {
    const r = this.ripples[this.next];
    r.set(x, z, shared.uTime.value, strength);
    this.next = (this.next + 1) % MAX_RIPPLES;
  }
}
