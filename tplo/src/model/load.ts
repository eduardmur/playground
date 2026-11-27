import * as THREE from 'three';
import manifest from './manifest.json';

export type MeshName = keyof typeof manifest.meshes;

export const model = manifest;

/** Unpack one mesh: positions back to millimetres, normals from their two-number form. */
function unpack(buffer: ArrayBuffer, name: MeshName): THREE.BufferGeometry {
  const m = manifest.meshes[name];
  const n = m.vertices;
  const pos = new Uint16Array(buffer, m.position, n * 3);
  const oct = new Int16Array(buffer, m.normal, n * 2);
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) position[i * 3 + a] = m.min[a] + (pos[i * 3 + a] / 65535) * (m.max[a] - m.min[a]);
    let x = oct[i * 2] / 32767, y = oct[i * 2 + 1] / 32767;
    const z = 1 - Math.abs(x) - Math.abs(y);
    const t = Math.max(-z, 0);
    x += x >= 0 ? -t : t;
    y += y >= 0 ? -t : t;
    const l = Math.hypot(x, y, z) || 1;
    normal[i * 3] = x / l;
    normal[i * 3 + 1] = y / l;
    normal[i * 3 + 2] = z / l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('ao', new THREE.BufferAttribute(new Uint8Array(buffer, m.ao, n).slice(), 1, true));
  g.setAttribute('tag', new THREE.BufferAttribute(new Uint8Array(buffer, m.tag, n).slice(), 1, false));
  const count = m.triangles * 3;
  g.setIndex(new THREE.BufferAttribute(m.wide ? new Uint32Array(buffer, m.index, count).slice() : new Uint16Array(buffer, m.index, count).slice(), 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export async function loadGeometry(): Promise<Record<MeshName, THREE.BufferGeometry>> {
  const res = await fetch(`${import.meta.env.BASE_URL}model/stifle.bin`);
  if (!res.ok) throw new Error(`model: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const out = {} as Record<MeshName, THREE.BufferGeometry>;
  for (const name of Object.keys(manifest.meshes) as MeshName[]) out[name] = unpack(buffer, name);
  return out;
}
