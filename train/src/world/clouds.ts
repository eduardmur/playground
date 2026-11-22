// Clouds: a broken layer of cumulus well above the summits and a veil of cirrus higher still.
// Cheap on purpose: a few lookups of the shared noise texture, lit from the sun's side, hazed by
// distance. The same field throws moving shadows on the land, and the CPU can read it too (for the
// light inside the car).
import * as THREE from 'three';

export const CLOUD_ALT = 5300; // metres above sea level
const TILE = 23000; // metres to one tile of the largest noise

export const CLOUDS = /* glsl */ `
uniform vec4 uCloud;      // origin of local coordinates within the cloud field (x, z), coverage 0..1, time
const float CLOUD_ALT = ${CLOUD_ALT.toFixed(1)};

// how much cloud stands over a point of the map, 0..1
float cloudAt(vec2 xz) {
  vec2 p = (xz + uCloud.xy) / ${TILE.toFixed(1)} + uCloud.w * vec2(0.00042, 0.00017);
  float n = texture(tNoise, p).b * 0.58 + texture(tNoise, p * 3.1 + 0.31).a * 0.29 + texture(tNoise, p * 9.7 + 0.73).b * 0.13;
  float edge = 0.78 - 0.5 * uCloud.z;
  return smoothstep(edge, edge + 0.2, n);
}
// the shadow the clouds throw on something at pos, 1 = full sun
float cloudShadow(vec3 pos, vec3 lightDir) {
  if (lightDir.y < 0.03) return 1.0;
  vec2 xz = pos.xz + lightDir.xz * ((CLOUD_ALT - pos.y) / lightDir.y);
  return mix(1.0, 1.0 - 0.8 * cloudAt(xz), smoothstep(0.03, 0.2, lightDir.y));
}
`;

export const cloudUniform = () => ({ value: new THREE.Vector4(0, 0, 0.42, 0) });

/** Keep the uniform's origin and clock current. Coordinates wrap at a whole number of tiles, so nothing jumps. */
export function updateClouds(u: THREE.Vector4, originX: number, originZ: number, time: number, coverage: number) {
  const wrap = TILE * 64;
  u.set(((originX % wrap) + wrap) % wrap, ((originZ % wrap) + wrap) % wrap, coverage, time);
}

/** The same field on the CPU, from the noise texture's own pixels. */
export function cloudAtCPU(noise: THREE.DataTexture, u: THREE.Vector4, localX: number, localZ: number): number {
  const data = noise.image.data as Uint8Array, size = noise.image.width;
  const tap = (px: number, py: number, ch: number) => {
    const fx = (((px % 1) + 1) % 1) * size - 0.5, fy = (((py % 1) + 1) % 1) * size - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const at = (x: number, y: number) => data[((((y % size) + size) % size) * size + (((x % size) + size) % size)) * 4 + ch] / 255;
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };
  const px = (localX + u.x) / TILE + u.w * 0.00042, py = (localZ + u.y) / TILE + u.w * 0.00017;
  const n = tap(px, py, 2) * 0.58 + tap(px * 3.1 + 0.31, py * 3.1 + 0.31, 3) * 0.29 + tap(px * 9.7 + 0.73, py * 9.7 + 0.73, 2) * 0.13;
  const edge = 0.78 - 0.5 * u.z;
  const t = Math.min(1, Math.max(0, (n - edge) / 0.2));
  return t * t * (3 - 2 * t);
}
