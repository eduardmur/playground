import * as THREE from 'three';

/**
 * One smooth body out of many parts.
 *
 * Each part is a signed distance function in the space of the bone it belongs to. The parts are
 * blended with smooth unions (so a thigh flows into the hip and the neck into the chest), the
 * surface is extracted on a grid (surface nets) and snapped onto the exact field, and every vertex
 * is skinned to the bones of the parts it is close to. Colour, ambient occlusion and fur length come
 * from the same parts, blended the same way.
 *
 * A part: { bone, sdf(x, y, z), box: [x0, y0, z0, x1, y1, z1], k, color(x, y, z, out), fur }
 *   sdf, box, color and fur are in the bone's own space at the bind pose; k is how softly the part
 *   joins what came before it (metres); fur is a number or a function (x, y, z) => number.
 *   Optional `reach` (metres): how far the part's bone pulls on the skin around it, for a part that
 *   lies close to skin it should not move (a floppy ear beside the cheek).
 */

// ------------------------------------------------------------- distances

/** Ellipsoid, iq's bound (good near the surface, which is all that matters here). */
export function sdEllipsoid(x, y, z, rx, ry, rz) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}

/** A capsule whose radius runs from r1 at a to r2 at b (iq's round cone). */
export function sdRoundCone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const cx = pax * l2 - bax * y, cy = pay * l2 - bay * y, cz = paz * l2 - baz * y;
  const x2 = cx * cx + cy * cy + cz * cz;
  const y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

/** Polynomial smooth minimum. */
export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// ------------------------------------------------------------------ setup

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _c = new THREE.Color();

/** Bake each part's transforms: root -> bone (as 12 numbers), and its box in root space. */
function prepare(parts, bones) {
  return parts.map((part) => {
    const bi = bones.indexOf(part.bone);
    if (bi < 0) throw new Error('a part belongs to a bone that is not in the skeleton');
    const toRoot = part.bone.matrixWorld.clone();
    const e = _m.copy(toRoot).invert().elements;
    const inv = [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]];
    const pad = part.k + 0.004;
    const [x0, y0, z0, x1, y1, z1] = part.box;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      _p.set(c & 1 ? x1 + pad : x0 - pad, c & 2 ? y1 + pad : y0 - pad, c & 4 ? z1 + pad : z0 - pad).applyMatrix4(toRoot);
      lo[0] = Math.min(lo[0], _p.x); lo[1] = Math.min(lo[1], _p.y); lo[2] = Math.min(lo[2], _p.z);
      hi[0] = Math.max(hi[0], _p.x); hi[1] = Math.max(hi[1], _p.y); hi[2] = Math.max(hi[2], _p.z);
    }
    return { ...part, bi, inv, lo, hi };
  });
}

/** A root-space point in a part's own space: writes into `out` (array of 3). */
function local(p, x, y, z, out) {
  const m = p.inv;
  out[0] = m[0] * x + m[3] * y + m[6] * z + m[9];
  out[1] = m[1] * x + m[4] * y + m[7] * z + m[10];
  out[2] = m[2] * x + m[5] * y + m[8] * z + m[11];
  return out;
}

const inside = (p, x, y, z) => x >= p.lo[0] && x <= p.hi[0] && y >= p.lo[1] && y <= p.hi[1] && z >= p.lo[2] && z <= p.hi[2];
const L = [0, 0, 0];

/** The blended field at a root-space point, the same way the grid builds it. */
function field(parts, x, y, z) {
  let f = 1e9;
  for (const p of parts) {
    if (!inside(p, x, y, z)) continue;
    local(p, x, y, z, L);
    f = smin(f, p.sdf(L[0], L[1], L[2]), p.k);
  }
  return f;
}

// --------------------------------------------------------------- building

/**
 * Build the skinned geometry. `bones` must have their bind pose in matrixWorld, relative to the
 * mesh's own space (the caller builds the rig with an identity root, so world is root space).
 */
export function buildSkin(parts, bones, { cell = 0.008, ao = 0.6 } = {}) {
  const P = prepare(parts, bones);

  // the grid
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of P) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p.lo[a]); hi[a] = Math.max(hi[a], p.hi[a]); }
  for (let a = 0; a < 3; a++) { lo[a] -= cell * 2; hi[a] += cell * 2; }
  const nx = Math.ceil((hi[0] - lo[0]) / cell) + 1, ny = Math.ceil((hi[1] - lo[1]) / cell) + 1, nz = Math.ceil((hi[2] - lo[2]) / cell) + 1;
  const F = new Float32Array(nx * ny * nz).fill(1e9);
  const at = (i, j, k) => i + nx * (j + ny * k);

  // each part writes only into its own box, in order
  for (const p of P) {
    const i0 = Math.max(0, Math.floor((p.lo[0] - lo[0]) / cell)), i1 = Math.min(nx - 1, Math.ceil((p.hi[0] - lo[0]) / cell));
    const j0 = Math.max(0, Math.floor((p.lo[1] - lo[1]) / cell)), j1 = Math.min(ny - 1, Math.ceil((p.hi[1] - lo[1]) / cell));
    const k0 = Math.max(0, Math.floor((p.lo[2] - lo[2]) / cell)), k1 = Math.min(nz - 1, Math.ceil((p.hi[2] - lo[2]) / cell));
    for (let k = k0; k <= k1; k++) {
      const z = lo[2] + k * cell;
      for (let j = j0; j <= j1; j++) {
        const y = lo[1] + j * cell;
        let idx = at(i0, j, k);
        for (let i = i0; i <= i1; i++, idx++) {
          const x = lo[0] + i * cell;
          if (!inside(p, x, y, z)) continue;
          local(p, x, y, z, L);
          F[idx] = smin(F[idx], p.sdf(L[0], L[1], L[2]), p.k);
        }
      }
    }
  }

  // surface nets: one vertex in every cell the surface passes through
  const vid = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = F[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + t * ((b & 1) - (a & 1));
          sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
          n++;
        }
        vid[at(i, j, k)] = pos.length / 3;
        pos.push(lo[0] + (i + sx / n) * cell, lo[1] + (j + sy / n) * cell, lo[2] + (k + sz / n) * cell);
      }
    }
  }

  // a quad across every grid edge with a sign change, joining the four cells around it
  const index = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, c, b, a, d, c);
    else index.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = F[at(i, j, k)];
        const inA = v0 < 0;
        if (i < nx - 1 && inA !== F[at(i + 1, j, k)] < 0) quad(vid[at(i, j - 1, k - 1)], vid[at(i, j, k - 1)], vid[at(i, j, k)], vid[at(i, j - 1, k)], inA);
        if (j < ny - 1 && inA !== F[at(i, j + 1, k)] < 0) quad(vid[at(i - 1, j, k - 1)], vid[at(i - 1, j, k)], vid[at(i, j, k)], vid[at(i, j, k - 1)], inA);
        if (k < nz - 1 && inA !== F[at(i, j, k + 1)] < 0) quad(vid[at(i - 1, j - 1, k)], vid[at(i, j - 1, k)], vid[at(i, j, k)], vid[at(i - 1, j, k)], inA);
      }
    }
  }

  // onto the exact surface, with normals from the field
  const count = pos.length / 3;
  const position = new Float32Array(pos), normal = new Float32Array(count * 3);
  const e = cell * 0.25;
  const grad = (x, y, z, out) => {
    out[0] = field(P, x + e, y, z) - field(P, x - e, y, z);
    out[1] = field(P, x, y + e, z) - field(P, x, y - e, z);
    out[2] = field(P, x, y, z + e) - field(P, x, y, z - e);
    const l = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= l; out[1] /= l; out[2] /= l;
    return out;
  };
  // one Newton step: surface nets already put each vertex within half a cell of the surface, and the
  // gradient taken there is close enough to the normal where it lands
  const g = [0, 0, 0];
  for (let v = 0; v < count; v++) {
    let x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2];
    const d = field(P, x, y, z);
    grad(x, y, z, g);
    if (Math.abs(d) < cell) { x -= g[0] * d; y -= g[1] * d; z -= g[2] * d; }
    position[v * 3] = x; position[v * 3 + 1] = y; position[v * 3 + 2] = z;
    normal[v * 3] = g[0]; normal[v * 3 + 1] = g[1]; normal[v * 3 + 2] = g[2];
  }

  /** The grid, read back with trilinear interpolation: cheap, and plenty for shading. */
  const sample = (x, y, z) => {
    const fx = (x - lo[0]) / cell, fy = (y - lo[1]) / cell, fz = (z - lo[2]) / cell;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return 1;
    const tx = fx - i, ty = fy - j, tz = fz - k;
    const c = (a, b, t) => a + (b - a) * t;
    const v = (di, dj, dk) => Math.min(F[at(i + di, j + dj, k + dk)], 1);
    return c(
      c(c(v(0, 0, 0), v(1, 0, 0), tx), c(v(0, 1, 0), v(1, 1, 0), tx), ty),
      c(c(v(0, 0, 1), v(1, 0, 1), tx), c(v(0, 1, 1), v(1, 1, 1), tx), ty),
      tz
    );
  };

  // every triangle faces outwards, the way the field says
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = position[b] - position[a], uy = position[b + 1] - position[a + 1], uz = position[b + 2] - position[a + 2];
    const vx = position[c] - position[a], vy = position[c + 1] - position[a + 1], vz = position[c + 2] - position[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const dot = fx * (normal[a] + normal[b] + normal[c]) + fy * (normal[a + 1] + normal[b + 1] + normal[c + 1]) + fz * (normal[a + 2] + normal[b + 2] + normal[c + 2]);
    if (dot < 0) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
  }

  // bones, colour, fur and shade for every vertex, from the parts it is near
  const skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4);
  const color = new Float32Array(count * 3), fur = new Float32Array(count);
  const d = new Float32Array(P.length);
  const boneW = new Float32Array(bones.length);
  const SKIN = cell * 2.2, PAINT = cell * 0.7;
  for (let v = 0; v < count; v++) {
    const x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2];
    let dmin = Infinity;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (!inside(p, x, y, z)) { d[i] = Infinity; continue; }
      local(p, x, y, z, L);
      d[i] = p.sdf(L[0], L[1], L[2]);
      dmin = Math.min(dmin, d[i]);
    }
    boneW.fill(0);
    let cr = 0, cg = 0, cb = 0, cw = 0, fw = 0, fs = 0;
    for (let i = 0; i < P.length; i++) {
      if (d[i] === Infinity) continue;
      const p = P[i];
      boneW[p.bi] += Math.exp(-(d[i] - dmin) / (p.reach ?? SKIN));
      const w = Math.exp(-(d[i] - dmin) / PAINT);
      if (w < 1e-4) continue;
      local(p, x, y, z, L);
      if (typeof p.color === 'function') p.color(L[0], L[1], L[2], _c);
      else _c.copy(p.color);
      cr += _c.r * w; cg += _c.g * w; cb += _c.b * w; cw += w;
      fs += (typeof p.fur === 'function' ? p.fur(L[0], L[1], L[2]) : p.fur ?? 1) * w;
      fw += w;
    }
    // the four strongest bones
    for (let s = 0; s < 4; s++) {
      let best = -1, bw = 0;
      for (let b = 0; b < boneW.length; b++) if (boneW[b] > bw) { bw = boneW[b]; best = b; }
      if (best < 0) break;
      skinIndex[v * 4 + s] = best;
      skinWeight[v * 4 + s] = bw;
      boneW[best] = 0;
    }
    const ws = skinWeight[v * 4] + skinWeight[v * 4 + 1] + skinWeight[v * 4 + 2] + skinWeight[v * 4 + 3] || 1;
    for (let s = 0; s < 4; s++) skinWeight[v * 4 + s] /= ws;

    // ambient occlusion from the field: creases under the chin, behind the elbow, between the legs
    let occ = 0;
    const nxv = normal[v * 3], nyv = normal[v * 3 + 1], nzv = normal[v * 3 + 2];
    for (let s = 1, wgt = 1; s <= 4; s++, wgt *= 0.5) {
      const h = s * 0.012;
      occ += (h - sample(x + nxv * h, y + nyv * h, z + nzv * h)) * wgt;
    }
    const shade = 1 - ao * Math.min(1, Math.max(0, occ * 14));
    color[v * 3] = (cr / cw) * shade;
    color[v * 3 + 1] = (cg / cw) * shade;
    color[v * 3 + 2] = (cb / cw) * shade;
    fur[v] = fs / fw;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setAttribute('fur', new THREE.BufferAttribute(fur, 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}
