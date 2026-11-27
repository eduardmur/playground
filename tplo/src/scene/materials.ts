import * as THREE from 'three';

/** Colours of the things in the scene. They are the same in the light and the dark theme. */
export const TINT = {
  bone: new THREE.Color('#e7dfd0'),
  cut: new THREE.Color('#c98f7c'), // cancellous bone, where the saw has been
  section: new THREE.Color('#cfc6b6'), // the flat end of a bone shown cut short
  ligament: new THREE.Color('#d6d0c4'),
  meniscus: new THREE.Color('#c3c6c8'),
  steel: new THREE.Color('#c4c8cc'),
  accent: new THREE.Color('#e5533d'),
};

/** Turn the baked shading and the surface tags into a per-vertex colour the material multiplies in. */
export function bake(geometry: THREE.BufferGeometry, base = TINT.bone, strength = 1): THREE.BufferGeometry {
  const ao = geometry.getAttribute('ao');
  const tag = geometry.getAttribute('tag');
  const n = ao.count;
  const color = new Float32Array(n * 3);
  const cut = TINT.cut.clone();
  const section = TINT.section.clone();
  for (let i = 0; i < n; i++) {
    // deepen the shading a little in the hollows, leave open surfaces alone
    const a = ao.getX(i);
    const k = 1 - strength * (1 - Math.pow(a, 2.2));
    const t = tag.getX(i);
    const c = t === 1 ? cut : t === 2 ? section : base;
    color[i * 3] = (c.r / base.r) * k;
    color[i * 3 + 1] = (c.g / base.g) * k;
    color[i * 3 + 2] = (c.b / base.b) * k;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return geometry;
}

export function solid(color: THREE.Color, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, vertexColors: true, ...opts });
}

export function steel(opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  // the room that lights the bone is kept dim, so metal is given more of it to reflect
  return new THREE.MeshStandardMaterial({ color: TINT.steel, roughness: 0.32, metalness: 1, envMapIntensity: 3.2, ...opts });
}

/** What the saw has done so far. The tibia's two pieces are one mesh drawn twice, each keeping its side of the blade's circle. */
export interface Cut { radius: { value: number }; kerf: { value: number }; depth: { value: number } }
export const newCut = (radius: number): Cut => ({ radius: { value: radius }, kerf: { value: 0 }, depth: { value: 1e4 } });

const CLIP_PARS = /* glsl */ `
  varying vec3 vObj;
  uniform float uSide, uRadius, uKerf, uDepth;
  void clipToCut() {
    float r = length(vObj.xy);
    float k = vObj.z > uDepth ? uKerf * 0.5 : 0.0; // the kerf is open only as far as the blade has gone
    if (uSide > 0.0 ? r > uRadius - k : r < uRadius + k) discard;
  }`;

/** Make a built-in material keep one side of the cut: side +1 is the plateau segment, -1 the rest. */
export function clip<T extends THREE.Material>(m: T, cut: Cut, side: number): T {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uSide: { value: side }, uRadius: cut.radius, uKerf: cut.kerf, uDepth: cut.depth });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLIP_PARS}`)
      .replace('void main() {', 'void main() {\nclipToCut();');
  };
  m.customProgramCacheKey = () => `cut${side}`;
  return m;
}

/**
 * How a bone looks when it has to be seen through: bright where the surface turns away from the
 * eye, nearly clear where it faces it. On a dark ground this reads as a radiograph.
 */
export function glass(cut?: Cut, side = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: cut ? { CLIP: 1 } : {},
    uniforms: {
      ...(cut ? { uSide: { value: side }, uRadius: cut.radius, uKerf: cut.kerf, uDepth: cut.depth } : {}),
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0 },
      uBase: { value: 0.05 },
      uRim: { value: 0.75 },
      uPower: { value: 1.7 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vObj;
      void main() {
        vObj = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity, uBase, uRim, uPower;
      varying vec3 vN;
      varying vec3 vV;
      #ifdef CLIP
      ${CLIP_PARS}
      #endif
      void main() {
        #ifdef CLIP
        clipToCut();
        #endif
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        gl_FragColor = vec4(uColor, (uBase + uRim * pow(f, uPower)) * uOpacity);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Set a glass material for a dark or a light ground. */
export function tuneGlass(m: THREE.ShaderMaterial, dark: boolean, metal = false): void {
  if (dark) {
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.SrcAlphaFactor;
    m.blendDst = THREE.OneFactor;
    m.blendEquation = THREE.AddEquation;
    (m.uniforms.uColor.value as THREE.Color).setRGB(0.86, 0.9, 1.0);
    m.uniforms.uBase.value = metal ? 0.55 : 0.035;
    m.uniforms.uRim.value = metal ? 0.45 : 0.62;
  } else {
    m.blending = THREE.NormalBlending;
    (m.uniforms.uColor.value as THREE.Color).setRGB(0.1, 0.11, 0.14);
    m.uniforms.uBase.value = metal ? 0.6 : 0.03;
    m.uniforms.uRim.value = metal ? 0.4 : 0.5;
  }
  m.uniforms.uPower.value = metal ? 1.0 : 1.6;
  m.needsUpdate = true;
}
