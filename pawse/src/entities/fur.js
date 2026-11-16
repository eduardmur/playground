import * as THREE from 'three';

/**
 * Fur by shell texturing: the body is drawn again a dozen or so times, each copy pushed a little
 * further out along the normals, and each copy keeps only the pixels that fall inside a strand.
 * Strands taper and end at different heights, droop a little, and are darker at the root, which is
 * most of what makes fur read as fur. No textures: the strands come from a hashed 3D cell pattern
 * over the bind-pose position, so they stay put on the body as it moves.
 *
 * Geometry needs position, normal, color and `fur` (a per-vertex length factor; 0 for bare skin).
 */

/** `geo` repeated once per layer, with a `shell` attribute from 1/layers up to 1. */
export function shellGeometry(geo, layers) {
  const out = new THREE.BufferGeometry();
  const n = geo.attributes.position.count;
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const src = attr.array, size = attr.itemSize;
    const arr = new src.constructor(src.length * layers);
    for (let l = 0; l < layers; l++) arr.set(src, l * src.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, size, attr.normalized));
  }
  const shell = new Float32Array(n * layers);
  for (let l = 0; l < layers; l++) shell.fill((l + 1) / layers, l * n, (l + 1) * n);
  out.setAttribute('shell', new THREE.BufferAttribute(shell, 1));
  const idx = geo.index.array, index = new Uint32Array(idx.length * layers);
  for (let l = 0; l < layers; l++) for (let i = 0; i < idx.length; i++) index[l * idx.length + i] = idx[i] + l * n;
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.boundingSphere = geo.boundingSphere?.clone() ?? null;
  return out;
}

/** Give a plain geometry the attributes fur needs: a flat colour and a fur factor. */
export function furAttributes(geo, color, fur = 1) {
  const n = geo.attributes.position.count;
  if (!geo.attributes.color) {
    const c = new THREE.Color(color), arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  const f = new Float32Array(n);
  const p = geo.attributes.position;
  for (let i = 0; i < n; i++) f[i] = typeof fur === 'function' ? fur(p.getX(i), p.getY(i), p.getZ(i)) : fur;
  geo.setAttribute('fur', new THREE.BufferAttribute(f, 1));
  return geo;
}

const VERT_HEAD = /* glsl */ `
attribute float shell;
attribute float fur;
uniform float uFurLen;
uniform float uWet;
varying float vShell;
varying vec3 vRoot;
`;
const VERT_PUSH = /* glsl */ `
vShell = shell;
vRoot = position;
float furL = uFurLen * fur * (1.0 - 0.45 * uWet);
vec3 furN = normalize(normal);
transformed += furN * shell * furL;
// combed back towards the tail and down, more towards the tips, flatter when wet
vec3 furComb = normalize(vec3(0.0, -0.55, -1.0));
furComb -= furN * dot(furComb, furN);
transformed += furComb * shell * shell * furL * mix(0.75, 1.2, uWet);
transformed.y -= shell * shell * furL * mix(0.25, 0.6, uWet);
`;
const FRAG_HEAD = /* glsl */ `
uniform float uCell;
uniform float uWet;
varying float vShell;
varying vec3 vRoot;
float furHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 furHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float furTint = 1.0;
// how far inside the nearest strand this fragment is (negative: between strands); sets furTint
float furStrand(vec3 q) {
  vec3 c = floor(q);
  vec3 j = furHash3(c) * 0.5 + 0.25;
  float tall = 0.45 + 0.55 * furHash(c + 7.13);
  float h = vShell / tall;
  if (h > 1.0) return -1.0;
  float s = 0.48 * (1.0 - h * h) - length(fract(q) - j);
  if (s >= 0.0) furTint = 0.82 + 0.36 * furHash(c + 3.7); // no two strands quite the same shade
  return s;
}
`;
const FRAG_CUT = /* glsl */ `
  vec3 furQ = vRoot / uCell;
  float furS = max(furStrand(furQ), furStrand(furQ + vec3(0.5, 0.31, 0.77)));
  // far away the strands are smaller than a pixel: let the lower layers fill in instead of shimmering
  float furPx = length(fwidth(furQ));
  furS += 0.3 * smoothstep(0.35, 1.4, furPx) * (1.0 - vShell);
  if (furS < 0.0) discard;
`;
const FRAG_SHADE = /* glsl */ `
diffuseColor.rgb *= mix(0.66, 1.14, vShell) * furTint; // dark at the root, catching the light at the tips
`;

/**
 * The materials for one dog: `skin` (the body itself: the undercoat, a little darker) and `shell`
 * (the fur). `len` is the longest fur in metres before the rig's scale.
 */
export function furMaterials(len) {
  const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  skin.userData.base = THREE.MathUtils.lerp(1, 0.8, THREE.MathUtils.clamp(len / 0.02, 0, 1));
  skin.color.setScalar(skin.userData.base);

  const uniforms = {
    uFurLen: { value: len },
    uWet: { value: 0 },
    uCell: { value: THREE.MathUtils.lerp(0.0022, 0.0034, THREE.MathUtils.clamp(len / 0.03, 0, 1)) },
  };
  // Lambert, not PBR: the fur is many layers of pixels deep, and this halves what each one costs
  const shell = new THREE.MeshLambertMaterial({ vertexColors: true });
  shell.userData.uniforms = uniforms;
  shell.customProgramCacheKey = () => 'pawse-fur-shell';
  shell.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_PUSH}`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('void main() {', `void main() {\n${FRAG_CUT}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_SHADE}`);
  };
  return { skin, shell };
}

/** How many layers a coat this long needs. */
export const layersFor = (len) => Math.round(THREE.MathUtils.clamp(5 + len * 250, 6, 12));
