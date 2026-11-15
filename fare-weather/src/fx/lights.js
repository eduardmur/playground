// Cheap light: nothing here is a real light source. Glows are camera-facing
// sprites (lamp heads, headlights, beacons); pools are soft additive patches
// laid on the road under lamps and in front of cars; cones are the shafts you
// see under a lamp when the air is full of rain or fog.
import * as THREE from 'three';
import { env, LAYER } from '../world/shared.js';

const FOG_GLSL = /* glsl */ `
  uniform float uFogDensity;
  float fogFade(float d) { return exp(-uFogDensity * uFogDensity * d * d); }
`;
export const fxUniforms = { uFogDensity: { value: 0.001 }, uHaze: { value: 0 }, uGlowBoost: { value: 1 }, uGlowSize: { value: 1 } };

/** Camera-facing additive sprites. Instances: position, colour, size, facing direction (or zero), blink phase. */
export class Glows {
  constructor(capacity, { reflect = true, dynamic = false } = {}) {
    this.cap = capacity;
    this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const usage = dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(usage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(usage);
    this.aDir = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(usage);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(usage); // size, blink phase, group
    g.setAttribute('aPos', this.aPos);
    g.setAttribute('aCol', this.aCol);
    g.setAttribute('aDir', this.aDir);
    g.setAttribute('aMisc', this.aMisc);
    g.instanceCount = 0;
    this.uniforms = {
      uTime: env.uTime, uFogDensity: fxUniforms.uFogDensity, uHaze: fxUniforms.uHaze, uBoost: fxUniforms.uGlowBoost, uSizeK: fxUniforms.uGlowSize,
      uGroup: { value: new THREE.Vector4(1, 1, 1, 1) }, // brightness of each of four groups
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aPos, aCol, aDir, aMisc;
        uniform float uTime, uHaze, uFogDensity, uBoost, uSizeK;
        uniform vec4 uGroup;
        varying vec2 vUv; varying vec3 vCol;
        void main() {
          vUv = position.xy;
          vec3 toCam = cameraPosition - aPos;
          float dist = length(toCam);
          float f = 1.0;
          if (dot(aDir, aDir) > 0.01) {
            // a beam: bright when it points at you, faint from the side
            float d = max(dot(toCam / dist, aDir), 0.0);
            f = 0.04 + 0.96 * pow(d, 5.0);
          }
          float blink = aMisc.y > 0.0 ? smoothstep(0.82, 0.9, fract(uTime * 0.65 + aMisc.y)) * (1.0 - smoothstep(0.96, 1.0, fract(uTime * 0.65 + aMisc.y))) : 1.0;
          int gi = int(aMisc.z + 0.5);
          float gk = gi == 0 ? uGroup.x : gi == 1 ? uGroup.y : gi == 2 ? uGroup.z : uGroup.w;
          vCol = aCol * f * blink * gk * uBoost * exp(-uFogDensity * uFogDensity * dist * dist * 0.35);
          // haze swells a light; far away it is held at about a pixel and dimmed to match
          float want = aMisc.x * (1.0 + uHaze * 1.3) * uSizeK;
          float size = max(want, dist * 0.0016);
          vCol *= (want * want) / (size * size);
          vec4 mv = viewMatrix * vec4(aPos, 1.0);
          mv.xy += position.xy * size;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vCol;
        void main() {
          float r2 = dot(vUv, vUv);
          if (r2 > 1.0) discard;
          float core = exp(-r2 * 26.0);
          float halo = exp(-r2 * 4.5) * 0.22;
          float a = (core + halo) * (1.0 - r2);
          gl_FragColor = vec4(vCol * a, 1.0);
        }
      `,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    if (!reflect) this.mesh.layers.set(LAYER.NOREFLECT);
    this.geo = g;
  }

  clear() {
    this.n = 0;
  }

  add(x, y, z, r, g, b, size, dx = 0, dy = 0, dz = 0, phase = 0, group = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.aPos.setXYZ(i, x, y, z);
    this.aCol.setXYZ(i, r, g, b);
    this.aDir.setXYZ(i, dx, dy, dz);
    this.aMisc.setXYZ(i, size, phase, group);
  }

  commit() {
    this.geo.instanceCount = this.n;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aDir.needsUpdate = this.aMisc.needsUpdate = true;
  }
}

/** Soft patches of light lying on the ground. Instances: centre, half sizes, heading, colour. */
export class Pools {
  constructor(capacity, { dynamic = false } = {}) {
    this.cap = capacity;
    this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, -1, 0, 1, 1, 0, 1, 1, 0, -1], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const usage = dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(usage);
    this.aShape = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(usage); // half w, half l, cos, sin
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(usage); // rgb, kind (0 round, 1 beam)
    g.setAttribute('aPos', this.aPos);
    g.setAttribute('aShape', this.aShape);
    g.setAttribute('aCol', this.aCol);
    g.instanceCount = 0;
    this.uniforms = { uFogDensity: fxUniforms.uFogDensity, uGain: { value: 1 }, uWet: env.uWet, uNoise: env.uNoise };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute vec4 aShape, aCol;
        varying vec2 vUv; varying vec4 vCol; varying float vDist; varying vec2 vW;
        void main() {
          vUv = position.xz;
          vec2 q = position.xz * aShape.xy;
          vec2 w = vec2(q.x * aShape.z - q.y * aShape.w, q.x * aShape.w + q.y * aShape.z);
          vec3 p = aPos + vec3(w.x, 0.0, w.y);
          vW = p.xz;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vDist = length(mv.xyz);
          vCol = aCol;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uGain, uWet; uniform sampler2D uNoise;
        ${FOG_GLSL}
        varying vec2 vUv; varying vec4 vCol; varying float vDist; varying vec2 vW;
        void main() {
          float a;
          if (vCol.a < 0.5) {
            float r2 = dot(vUv, vUv);
            a = 1.0 / (1.0 + r2 * 9.0);
            a = a * a * (1.0 - smoothstep(0.55, 1.0, r2));
          } else {
            // a headlight beam: starts at v = -1 (the bumper) and widens away from it
            float t = vUv.y * 0.5 + 0.5;
            float wid = mix(0.28, 1.0, t);
            float x = vUv.x / wid;
            a = exp(-x * x * 2.6) * smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.35, 1.0, t)) * 0.9;
          }
          // the road is not uniformly matte: break the patch up a little
          a *= 0.8 + 0.4 * texture2D(uNoise, vW * 0.11).g;
          a *= 1.0 - 0.55 * uWet;
          gl_FragColor = vec4(vCol.rgb * a * uGain * fogFade(vDist), 1.0);
        }
      `,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.layers.set(LAYER.NOREFLECT);
    this.geo = g;
  }

  clear() {
    this.n = 0;
  }

  /** heading: unit vector the long axis points along. */
  add(x, y, z, halfW, halfL, hx, hz, r, g, b, kind = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.aPos.setXYZ(i, x, y, z);
    // local +z maps to (hx, hz)
    this.aShape.setXYZW(i, halfW, halfL, hz, -hx);
    this.aCol.setXYZW(i, r, g, b, kind);
  }

  commit() {
    this.geo.instanceCount = this.n;
    this.aPos.needsUpdate = this.aShape.needsUpdate = this.aCol.needsUpdate = true;
  }
}

/** Shafts of light under street lamps, visible when the air is thick. */
export class Cones {
  constructor(lamps) {
    const base = new THREE.CylinderGeometry(0.3, 5.2, 8.7, 20, 1, true);
    base.translate(0, -4.35, 0);
    const mesh = new THREE.InstancedMesh(
      base,
      new THREE.ShaderMaterial({
        uniforms: { uAmt: { value: 0 }, uColor: { value: new THREE.Color(1, 0.78, 0.5) }, uFogDensity: fxUniforms.uFogDensity },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV; varying float vH; varying float vDist;
          void main() {
            vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
            vV = normalize(cameraPosition - wp.xyz);
            vH = -position.y / 8.7;
            vec4 mv = viewMatrix * wp;
            vDist = length(mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uAmt; uniform vec3 uColor;
          ${FOG_GLSL}
          varying vec3 vN; varying vec3 vV; varying float vH; varying float vDist;
          void main() {
            float face = abs(dot(normalize(vN), normalize(vV)));
            float a = pow(face, 2.2) * (1.0 - vH) * (1.0 - vH) * (1.0 - vH) * smoothstep(0.0, 0.08, vH) * 0.45;
            a *= smoothstep(1.5, 9.0, vDist);
            gl_FragColor = vec4(uColor * a * uAmt * fogFade(vDist * 0.6), 1.0);
          }
        `,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
      }),
      lamps.length,
    );
    const m = new THREE.Matrix4();
    lamps.forEach((l, i) => {
      m.makeTranslation(l.x, l.y - 0.05, l.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.frustumCulled = false;
    mesh.renderOrder = 15;
    mesh.layers.set(LAYER.NOREFLECT);
    mesh.visible = false;
    this.mesh = mesh;
  }

  set(amount) {
    this.mesh.visible = amount > 0.01;
    this.mesh.material.uniforms.uAmt.value = amount;
  }
}
