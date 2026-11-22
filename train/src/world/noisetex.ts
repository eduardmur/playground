import * as THREE from 'three';

/**
 * A tiling texture of smooth noise for cheap detail in fragment shaders:
 *   r, g  slope of a fractal height field (for bump detail), 0.5 = level
 *   b     that height
 *   a     a second, unrelated fractal value
 * World-anchored lookups use tile sizes that divide the 4096 m the origin moves by, so the pattern
 * never jumps.
 */
export function makeNoiseTexture(size = 512): THREE.DataTexture {
  const rand = mulberry(20261122);
  const fbm = (seedOctaves: Float32Array[][]) => {
    const out = new Float32Array(size * size);
    let amp = 1, cells = 4;
    for (const [gx, gy] of seedOctaves) {
      const s = size / cells;
      for (let y = 0; y < size; y++) {
        const fy = y / s, iy = Math.floor(fy), ty = fy - iy;
        const uy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
        const y0 = iy % cells, y1 = (iy + 1) % cells;
        for (let x = 0; x < size; x++) {
          const fx = x / s, ix = Math.floor(fx), tx = fx - ix;
          const ux = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
          const x0 = ix % cells, x1 = (ix + 1) % cells;
          const d = (cx: number, cy: number, dx: number, dy: number) => gx[cy * cells + cx] * dx + gy[cy * cells + cx] * dy;
          const a = d(x0, y0, tx, ty), b = d(x1, y0, tx - 1, ty), c = d(x0, y1, tx, ty - 1), e = d(x1, y1, tx - 1, ty - 1);
          out[y * size + x] += (a + (b - a) * ux + (c - a) * uy + (a - b - c + e) * ux * uy) * amp;
        }
      }
      amp *= 0.55;
      cells *= 2;
    }
    return out;
  };
  const octaves = (n: number) => {
    const list: Float32Array[][] = [];
    for (let o = 0, cells = 4; o < n; o++, cells *= 2) {
      const gx = new Float32Array(cells * cells), gy = new Float32Array(cells * cells);
      for (let i = 0; i < gx.length; i++) {
        const a = rand() * Math.PI * 2;
        gx[i] = Math.cos(a);
        gy[i] = Math.sin(a);
      }
      list.push([gx, gy]);
    }
    return list;
  };
  const h = fbm(octaves(6)), h2 = fbm(octaves(6));
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  const to8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = to8(0.5 + (at(x + 1, y) - at(x - 1, y)) * 9);
      data[i + 1] = to8(0.5 + (at(x, y + 1) - at(x, y - 1)) * 9);
      data[i + 2] = to8(0.5 + h[y * size + x] * 0.85);
      data[i + 3] = to8(0.5 + h2[y * size + x] * 0.85);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
