// Marching cubes over a sampled field, with shared vertices, and marching squares for outlines.
import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';

/** Sample f on a regular grid that covers the box. */
export function sample(f, box, cell) {
  const [x0, y0, z0, x1, y1, z1] = box;
  const nx = Math.ceil((x1 - x0) / cell) + 1;
  const ny = Math.ceil((y1 - y0) / cell) + 1;
  const nz = Math.ceil((z1 - z0) / cell) + 1;
  const data = new Float32Array(nx * ny * nz);
  let q = 0;
  for (let k = 0; k < nz; k++) {
    const z = z0 + k * cell;
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * cell;
      for (let i = 0; i < nx; i++) data[q++] = f(x0 + i * cell, y, z);
    }
  }
  return { data, nx, ny, nz, x0, y0, z0, cell };
}

/** The same grid with another field combined in, point by point. */
export function combine(grid, g) {
  const { nx, ny, nz, x0, y0, z0, cell } = grid;
  const data = new Float32Array(grid.data.length);
  let q = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++, q++) data[q] = g(grid.data[q], x0 + i * cell, y0 + j * cell, z0 + k * cell);
  return { ...grid, data };
}

// corner offsets and the two corners of each of the twelve edges, in the table's numbering
const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const EDGE = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
// each edge as (corner it starts from, axis it runs along)
const EDGE_KEY = EDGE.map(([a, b]) => {
  const ca = CORNER[a], cb = CORNER[b];
  const axis = ca[0] !== cb[0] ? 0 : ca[1] !== cb[1] ? 1 : 2;
  const base = [Math.min(ca[0], cb[0]), Math.min(ca[1], cb[1]), Math.min(ca[2], cb[2])];
  return { base, axis };
});

/**
 * Triangulate the surface where the field is zero. `f` is the exact field, used to put each vertex
 * on the surface rather than where straight interpolation would. `rows` limits the work to cells
 * with j in [from, to): two meshes cut from one grid this way meet without a seam.
 */
export function polygonize(grid, f, rows) {
  const { data, nx, ny, nz, x0, y0, z0, cell } = grid;
  const j0 = rows ? Math.max(0, rows[0]) : 0;
  const j1 = rows ? Math.min(ny - 1, rows[1]) : ny - 1;
  const slab = nx * ny;
  const vertexOf = new Map();
  const positions = [];
  const indices = [];
  const idx = new Int32Array(12);

  const vertex = (i, j, k, axis) => {
    const key = (i + nx * (j + ny * k)) * 3 + axis;
    let v = vertexOf.get(key);
    if (v !== undefined) return v;
    const ax = x0 + i * cell, ay = y0 + j * cell, az = z0 + k * cell;
    const bx = ax + (axis === 0 ? cell : 0), by = ay + (axis === 1 ? cell : 0), bz = az + (axis === 2 ? cell : 0);
    let fa = data[i + nx * (j + ny * k)];
    let fb = data[i + (axis === 0 ? 1 : 0) + nx * (j + (axis === 1 ? 1 : 0) + ny * (k + (axis === 2 ? 1 : 0)))];
    // regula falsi on the exact field
    let ta = 0, tb = 1, t = fa / (fa - fb);
    for (let n = 0; n < 4; n++) {
      const ft = f(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
      if (Math.abs(ft) < 1e-4) break;
      if (ft < 0 === fa < 0) { ta = t; fa = ft; } else { tb = t; fb = ft; }
      t = ta + ((tb - ta) * fa) / (fa - fb);
    }
    v = positions.length / 3;
    positions.push(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
    vertexOf.set(key, v);
    return v;
  };

  for (let k = 0; k < nz - 1; k++) {
    for (let j = j0; j < j1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const q = i + nx * (j + ny * k);
        let cube = 0;
        if (data[q] < 0) cube |= 1;
        if (data[q + 1] < 0) cube |= 2;
        if (data[q + 1 + nx] < 0) cube |= 4;
        if (data[q + nx] < 0) cube |= 8;
        if (data[q + slab] < 0) cube |= 16;
        if (data[q + 1 + slab] < 0) cube |= 32;
        if (data[q + 1 + nx + slab] < 0) cube |= 64;
        if (data[q + nx + slab] < 0) cube |= 128;
        const bits = edgeTable[cube];
        if (bits === 0) continue;
        for (let e = 0; e < 12; e++) {
          if (!(bits & (1 << e))) continue;
          const { base, axis } = EDGE_KEY[e];
          idx[e] = vertex(i + base[0], j + base[1], k + base[2], axis);
        }
        for (let t = cube * 16; triTable[t] !== -1; t += 3) {
          const a = idx[triTable[t]], b = idx[triTable[t + 1]], c = idx[triTable[t + 2]];
          if (a !== b && b !== c && a !== c) indices.push(a, b, c);
        }
      }
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** Make every triangle face the way the field grows (outwards). */
export function orient(mesh, f) {
  const { positions: p, indices: ix } = mesh;
  let agree = 0, total = 0;
  for (let t = 0; t < ix.length; t += 3 * 97) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) continue;
    const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    const e = 0.05;
    const g = f(cx + (nx / l) * e, cy + (ny / l) * e, cz + (nz / l) * e) - f(cx - (nx / l) * e, cy - (ny / l) * e, cz - (nz / l) * e);
    agree += g > 0 ? 1 : 0;
    total++;
  }
  if (agree * 2 < total) for (let t = 0; t < ix.length; t += 3) { const s = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = s; }
  return mesh;
}

/**
 * The outline of a solid seen along Z: the zero contour of the smallest value met along each
 * column of the grid. Returns closed loops of [x, y] points, longest first.
 */
export function outline(grid, tolerance = 0.12) {
  const { data, nx, ny, nz, x0, y0, cell } = grid;
  const flat = new Float32Array(nx * ny).fill(Infinity);
  for (let k = 0; k < nz; k++)
    for (let q = 0, o = k * nx * ny; q < nx * ny; q++) if (data[o + q] < flat[q]) flat[q] = data[o + q];

  // marching squares: collect segments, keyed by the grid edges they join
  const pointOf = new Map();
  const points = [];
  const point = (i, j, axis) => {
    const key = (i + nx * j) * 2 + axis;
    let v = pointOf.get(key);
    if (v !== undefined) return v;
    const fa = flat[i + nx * j], fb = flat[i + (axis ? 0 : 1) + nx * (j + (axis ? 1 : 0))];
    const t = fa / (fa - fb);
    v = points.length;
    points.push([x0 + (i + (axis ? 0 : t)) * cell, y0 + (j + (axis ? t : 0)) * cell]);
    pointOf.set(key, v);
    return v;
  };
  const next = new Map();
  const link = (a, b) => { if (!next.has(a)) next.set(a, []); if (!next.has(b)) next.set(b, []); next.get(a).push(b); next.get(b).push(a); };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = flat[i + nx * j] < 0, b = flat[i + 1 + nx * j] < 0, c = flat[i + 1 + nx * (j + 1)] < 0, d = flat[i + nx * (j + 1)] < 0;
      const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const B = () => point(i, j, 0), R = () => point(i + 1, j, 1), T = () => point(i, j + 1, 0), L = () => point(i, j, 1);
      switch (code) {
        case 1: case 14: link(L(), B()); break;
        case 2: case 13: link(B(), R()); break;
        case 3: case 12: link(L(), R()); break;
        case 4: case 11: link(R(), T()); break;
        case 6: case 9: link(B(), T()); break;
        case 7: case 8: link(L(), T()); break;
        case 5: link(L(), T()); link(B(), R()); break;
        case 10: link(L(), B()); link(R(), T()); break;
      }
    }
  }
  // chain the segments into loops
  const seen = new Set();
  const loops = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = -1, at = start;
    while (at !== undefined && !seen.has(at)) {
      seen.add(at);
      loop.push(points[at]);
      const n = next.get(at);
      const to = n[0] !== prev ? n[0] : n[1];
      prev = at;
      at = to;
    }
    if (loop.length > 8) loops.push(simplify(loop, tolerance));
  }
  loops.sort((p, q) => q.length - p.length);
  return loops;
}

/** Douglas-Peucker on a closed loop. */
function simplify(loop, tol) {
  const keep = new Uint8Array(loop.length);
  const far = (a, b) => {
    let best = -1, bestD = tol;
    const [ax, ay] = loop[a], [bx, by] = loop[b];
    const ex = bx - ax, ey = by - ay, l = Math.hypot(ex, ey) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((loop[i][0] - ax) * ey - (loop[i][1] - ay) * ex) / l;
      if (d > bestD) { bestD = d; best = i; }
    }
    return best;
  };
  const mid = loop.length >> 1;
  keep[0] = keep[mid] = keep[loop.length - 1] = 1;
  const stack = [[0, mid], [mid, loop.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const m = far(a, b);
    if (m < 0) continue;
    keep[m] = 1;
    stack.push([a, m], [m, b]);
  }
  return loop.filter((_, i) => keep[i]);
}
