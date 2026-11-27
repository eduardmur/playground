// Builds the 3D model the page shows.
//
//   npm run model
//
// Reads the bones from sdf.mjs, triangulates them, bakes soft shading into the vertices and writes
//   public/model/stifle.bin    every mesh, packed
//   src/model/manifest.json    where each mesh is in that file, plus everything measured on the
//                              model: outlines for the 2D schemes, label anchors, the plate's screws
// Both files are committed, so the site builds without running this.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './sdf.mjs';
import { sample, combine, polygonize, orient, outline } from './mc.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { hypot, max, min, round, abs, sign, PI } = Math;
const D = PI / 180;
const started = performance.now();
const CELL = 0.7;

// ---------------------------------------------------------------- meshes

/** Normals, baked shading and a tag per vertex. */
function finish(mesh, f, { shade = f, tag = () => 0 } = {}) {
  orient(mesh, f);
  const n = mesh.positions.length / 3;
  mesh.normals = new Float32Array(n * 3);
  mesh.ao = new Uint8Array(n);
  mesh.tag = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1], z = mesh.positions[i * 3 + 2];
    const nn = S.normal(f, x, y, z);
    mesh.normals.set(nn, i * 3);
    const t = tag(x, y, z);
    mesh.tag[i] = t;
    // how much of the space in front of the surface is taken by the bone itself
    let occ = 0, w = 1, total = 0;
    for (const h of [0.7, 1.6, 3, 5, 8, 12]) {
      const d = shade(x + nn[0] * h, y + nn[1] * h, z + nn[2] * h);
      occ += (w * max(0, h - d)) / h;
      total += w;
      w *= 0.8;
    }
    mesh.ao[i] = t === 1 ? 255 : round(255 * max(0, 1 - occ / total));
  }
  return mesh;
}

const meshes = {};
const outlines = {};
const add = (name, mesh) => {
  meshes[name] = mesh;
  console.log(`  ${name.padEnd(16)} ${String(mesh.positions.length / 3).padStart(6)} vertices ${String(mesh.indices.length / 3).padStart(7)} triangles`);
};
const loops = (grid) => outline(grid).map((l) => l.map(([x, y]) => [round(x * 20) / 20, round(y * 20) / 20]));

/**
 * A sawn face: the part of a cylinder about Z that lies inside the tibia. `facing` is +1 for the
 * face of the plateau segment (it looks away from the axis) and -1 for the face left on the shaft.
 * The rim is put exactly on the bone's surface, so the face meets the clipped bone without a step.
 */
function sawnFace(radius, facing) {
  const step = 0.6;
  const a0 = -175 * D, a1 = 40 * D, z0 = -27, z1 = 27;
  const na = Math.ceil(((a1 - a0) * radius) / step), nz = Math.ceil((z1 - z0) / step);
  const at = (i, j) => { const a = a0 + ((a1 - a0) * i) / na; return [radius * Math.cos(a), radius * Math.sin(a), z0 + ((z1 - z0) * j) / nz]; };
  const f = (i, j) => { const p = at(i, j); return S.tibia(p[0], p[1], p[2]); };
  const val = new Float32Array((na + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= na; i++) val[i + (na + 1) * j] = f(i, j);
  const positions = [], indices = [];
  const made = new Map();
  const corner = (i, j) => {
    const key = `c${i},${j}`;
    if (!made.has(key)) { made.set(key, positions.length / 3); positions.push(...at(i, j)); }
    return made.get(key);
  };
  // where the bone's surface crosses a grid edge, found by bisection along the cylinder
  const crossing = (i, j, di, dj) => {
    const key = `e${i},${j},${di}`;
    if (!made.has(key)) {
      let lo = 0, hi = 1;
      const inside0 = val[i + (na + 1) * j] < 0;
      for (let n = 0; n < 18; n++) { const m = (lo + hi) / 2; if (f(i + di * m, j + dj * m) < 0 === inside0) lo = m; else hi = m; }
      made.set(key, positions.length / 3);
      positions.push(...at(i + (di * (lo + hi)) / 2, j + (dj * (lo + hi)) / 2));
    }
    return made.get(key);
  };
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < na; i++) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const inside = c.map(([a, b]) => val[a + (na + 1) * b] < 0);
      if (!inside.some(Boolean)) continue;
      const poly = [];
      for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4;
        if (inside[k]) poly.push(corner(c[k][0], c[k][1]));
        if (inside[k] !== inside[n]) {
          // an edge is keyed by its lower corner and its direction
          const [ai, aj] = c[k], [bi, bj] = c[n];
          poly.push(crossing(Math.min(ai, bi), Math.min(aj, bj), ai !== bi ? 1 : 0, aj !== bj ? 1 : 0));
        }
      }
      for (let k = 1; k + 1 < poly.length; k++) indices.push(poly[0], poly[k], poly[k + 1]);
    }
  const mesh = { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
  const n = mesh.positions.length / 3;
  mesh.normals = new Float32Array(n * 3);
  mesh.ao = new Uint8Array(n).fill(255);
  mesh.tag = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    const x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1], l = hypot(x, y);
    mesh.normals[i * 3] = (facing * x) / l;
    mesh.normals[i * 3 + 1] = (facing * y) / l;
  }
  // wind the triangles to face the same way as the normals
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const A = mesh.indices[t] * 3, B = mesh.indices[t + 1] * 3, C = mesh.indices[t + 2] * 3, P = mesh.positions;
    const ux = P[B] - P[A], uy = P[B + 1] - P[A + 1], uz = P[B + 2] - P[A + 2];
    const vx = P[C] - P[A], vy = P[C + 1] - P[A + 1], vz = P[C + 2] - P[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz;
    if ((nx * P[A] + ny * P[A + 1]) * facing < 0) { const s2 = mesh.indices[t + 1]; mesh.indices[t + 1] = mesh.indices[t + 2]; mesh.indices[t + 2] = s2; }
  }
  return mesh;
}

console.log('bones');
{
  // One mesh serves for the tibia before and after the cut: the page draws it twice, once keeping
  // what is inside the blade's circle and once what is outside. Only the two sawn faces are extra.
  const grid = sample(S.tibia, [-27, -223, -27, 37.2, 9, 27], CELL);
  add('tibia', finish(polygonize(grid, S.tibia), S.tibia));
  add('cutFragment', sawnFace(S.RADIUS - S.KERF / 2, 1));
  add('cutShaft', sawnFace(S.RADIUS + S.KERF / 2, -1));
  outlines.tibia = loops(grid);
  outlines.fragment = loops(combine(grid, (v, x, y) => max(v, S.blade(x, y) + S.KERF / 2)));
  outlines.shaft = loops(combine(grid, (v, x, y) => max(v, -S.blade(x, y) + S.KERF / 2)));
}
{
  const end = S.femurPoint(7.5, S.FEMUR_LENGTH);
  const grid = sample(S.femur, [min(end[0], -32) - 14, -8, -24, 30, end[1] + 12, 24], 0.8);
  // the flat end of the shaft is a section, not a surface
  const flat = (x, y, z) => (S.femur(x, y, z) > -0.05 && hypot(x - end[0], y - end[1]) < 13 && abs((x - end[0]) * -0.7071 + (y - end[1]) * 0.7071) < 0.5 ? 2 : 0);
  add('femur', finish(polygonize(grid, S.femur), S.femur, { tag: flat }));
  outlines.femur = loops(grid);
}
for (const [name, f, box, cell] of [
  ['patella', S.patella, [-14, 22, -10, 14, 56, 10], 0.6],
  ['fibula', S.fibula, [-21, -218, -27, 5, -6, -8], 0.7],
  ['talus', S.talus, [-12, -234, -12, 20, -200, 12], 0.8],
  ['meniscusMedial', S.meniscusMedial, [-22, -16, -1, 18, 12, 24], 0.36],
  ['meniscusLateral', S.meniscusLateral, [-22, -16, -24, 18, 12, 1], 0.36],
]) {
  const grid = sample(f, box, cell);
  add(name, finish(polygonize(grid, f), f));
  if (name === 'patella' || name === 'talus' || name === 'fibula') outlines[name] = loops(grid);
}

// ---------------------------------------------------------------- the plate

console.log('plate');
const PLATE = { thickness: 3.2, head: [[-11, -9], [2, -9.5], [-5, -17.5]], from: [-1.5, -19], to: [3.5, -64], shaftHolesY: [-34, -46, -58], halfWidth: 5.6 };
const holes = [
  ...PLATE.head,
  ...PLATE.shaftHolesY.map((y) => [PLATE.from[0] + ((y - PLATE.from[1]) / (PLATE.to[1] - PLATE.from[1])) * (PLATE.to[0] - PLATE.from[0]), y]),
];
function footprint(x, y) {
  const [ax, ay] = PLATE.from, [bx, by] = PLATE.to;
  const ex = bx - ax, ey = by - ay;
  const h = min(1, max(0, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
  let d = hypot(x - ax - ex * h, y - ay - ey * h) - PLATE.halfWidth;
  let head = hypot(x + 4.7, y + 12) - 6.5;
  for (const [hx, hy] of PLATE.head) head = S.smin(head, hypot(x - hx, y - hy) - 5.7, 7);
  return S.smin(d, head, 6);
}
// The plate is bent to the bone: its underside is the medial surface of the operated tibia,
// smoothed, and lifted until it clears every bump.
const H = { x0: -26, y0: -78, step: 0.5, nx: 84, ny: 170 };
const surface = new Float32Array(H.nx * H.ny);
for (let j = 0; j < H.ny; j++)
  for (let i = 0; i < H.nx; i++) {
    const hit = S.trace(S.tibiaAfter, [H.x0 + i * H.step, H.y0 + j * H.step, 44], [0, 0, -1], 80);
    surface[i + H.nx * j] = hit ? hit[2] : NaN;
  }
function blur(src, sigma) {
  const r = Math.ceil(sigma * 3);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const pass = (a, dx, dy) => {
    const out = new Float32Array(a.length);
    for (let j = 0; j < H.ny; j++)
      for (let i = 0; i < H.nx; i++) {
        let s = 0, w = 0;
        for (let t = -r; t <= r; t++) {
          const ii = i + t * dx, jj = j + t * dy;
          if (ii < 0 || jj < 0 || ii >= H.nx || jj >= H.ny) continue;
          const v = a[ii + H.nx * jj];
          if (Number.isNaN(v)) continue;
          s += v * k[t + r];
          w += k[t + r];
        }
        out[i + H.nx * j] = w > 0 ? s / w : NaN;
      }
    return out;
  };
  return pass(pass(src, 1, 0), 0, 1);
}
const bed = blur(surface, 3.2 / H.step);
let lift = 0;
for (let j = 0; j < H.ny; j++)
  for (let i = 0; i < H.nx; i++) {
    const q = i + H.nx * j;
    if (Number.isNaN(surface[q]) || footprint(H.x0 + i * H.step, H.y0 + j * H.step) > 0.5) continue;
    lift = max(lift, surface[q] - bed[q]);
  }
lift += 0.15;
function underside(x, y) {
  const fx = min(H.nx - 1.001, max(0, (x - H.x0) / H.step)), fy = min(H.ny - 1.001, max(0, (y - H.y0) / H.step));
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const at = (a, b) => { const v = bed[a + H.nx * b]; return Number.isNaN(v) ? 0 : v; };
  return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty + lift;
}
function plate(x, y, z) {
  const zb = underside(x, y);
  const top = zb + PLATE.thickness;
  let d = S.smax(footprint(x, y), max(zb - z, z - top), 1.1);
  for (const [hx, hy] of holes) {
    const t = min(1, max(0, (z - (top - 1.9)) / 1.9));
    d = S.smax(d, 2.05 + 1.45 * t * t - hypot(x - hx, y - hy), 0.35); // a countersunk hole
  }
  return d;
}
{
  let zLo = Infinity, zHi = -Infinity;
  for (let y = -72; y <= 0; y += 1) for (let x = -19; x <= 11; x += 1) if (footprint(x, y) < 0) { const z = underside(x, y); zLo = min(zLo, z); zHi = max(zHi, z); }
  const grid = sample(plate, [-19, -71.5, zLo - 1, 11, -1, zHi + PLATE.thickness + 1], 0.42);
  add('plate', finish(polygonize(grid, plate), plate));
  console.log(`  lifted ${lift.toFixed(2)} mm off the smoothed bone`);
}
const screws = holes.map(([x, y], i) => {
  const top = underside(x, y) + PLATE.thickness - 0.35;
  const far = S.trace(S.tibiaAfter, [x, y, -46], [0, 0, 1], 90);
  const through = far ? top - far[2] + 1.6 : 24;
  return { x: +x.toFixed(2), y: +y.toFixed(2), top: +top.toFixed(2), length: +min(through, i < 3 ? 34 : 60).toFixed(1), part: i < 3 ? 'fragment' : 'shaft' };
});

// ---------------------------------------------------------------- measured points

console.log('measurements');
/** A point on a surface, found by walking from outside towards a target. */
function on(f, from, to) {
  const p = S.trace(f, from, [to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  if (!p) throw new Error(`nothing between ${from} and ${to}`);
  return { p: p.map((v) => +v.toFixed(2)), n: S.normal(f, p[0], p[1], p[2]).map((v) => +v.toFixed(3)) };
}
const fp = S.femurPoint;
/** A point inside a meniscus, at a place given along and across the plateau. */
function within(f, u, z) {
  let best = null, bestV = Infinity;
  for (let v = -10; v <= 6; v += 0.1) {
    const p = S.plateauPoint(u, v, z);
    const d = f(p[0], p[1], p[2]);
    if (d < bestV) { bestV = d; best = p; }
  }
  if (bestV > 0) throw new Error(`no meniscus at u ${u}, z ${z}`);
  return best;
}
const anchors = {
  femur: on(S.femur, fp(60, 74, 40), fp(4, 74, 2)),
  femurLateral: on(S.femur, fp(60, 74, -40), fp(4, 74, -2)),
  patella: on(S.patella, fp(50, 18, 14), fp(19.6, 18, 2)),
  patellaLateral: on(S.patella, fp(50, 18, -14), fp(19.6, 18, -2)),
  tuberosity: on(S.tibia, [60, -6, 14], [27, -8, 1]),
  tuberosityLateral: on(S.tibia, [60, -6, -14], [27, -8, -1]),
  plateau: on(S.tibia, [-6, 30, 46], [-4, -3, 13]),
  fibula: on(S.fibula, [-30, -90, -50], [-9.5, -90, -15.5]),
  meniscusMedial: on(S.meniscusMedial, [-8, 20, 50], within(S.meniscusMedial, -3, 19.5)),
  meniscusCaudalHorn: on(S.meniscusMedial, [-40, 12, 34], within(S.meniscusMedial, -15, 13)),
  centre: on(S.tibia, [0, 0, 60], [0, 0, 0]),
};

// ligaments: where each one is rooted. Femoral ends are given in the femur's frame.
const ligaments = {
  patellar: { from: fp(18.2, 5.6, 0), to: [29.6, -4.2, -1] },
  cranial: { from: fp(-13.5, 3, -3.6), to: [8.5, 2.2, 1.8] }, // lateral condyle, caudally -> cranial intercondylar area
  caudal: { from: fp(-1.5, -8.5, 3.4), to: [-17.5, -6.5, -1.6] }, // medial condyle, cranially -> caudal edge of the tibia
};
for (const l of Object.values(ligaments)) { l.from = l.from.map((v) => +v.toFixed(2)); l.to = l.to.map((v) => +v.toFixed(2)); }

// two score marks, one each side of the cut, as far apart as the rotation: they meet when it is done
const markAngle = -58;
const mark = (f, r, deg) => on(f, [r * Math.cos(deg * D), r * Math.sin(deg * D), 50], [r * Math.cos(deg * D), r * Math.sin(deg * D), 0]);
const marks = {
  shaft: [mark(S.tibia, S.RADIUS + 0.6, markAngle), mark(S.tibia, S.RADIUS + 3.4, markAngle)],
  fragment: [mark(S.tibia, S.RADIUS - 0.6, markAngle + S.ROTATION), mark(S.tibia, S.RADIUS - 3.4, markAngle + S.ROTATION)],
};
// the medial surface along the cut, for drawing the planned line on the bone
const cutLine = [];
for (let deg = 30; deg >= -150; deg -= 3) {
  const x = S.RADIUS * Math.cos(deg * D), y = S.RADIUS * Math.sin(deg * D);
  const hit = S.trace(S.tibia, [x, y, 50], [0, 0, -1], 100);
  if (hit) cutLine.push([+x.toFixed(2), +y.toFixed(2), +hit[2].toFixed(2)]);
}

// a wire through the tuberosity into the plateau segment holds the rotation while the plate goes on
const wire = { from: [39, -11.6, 2], to: [-8, -2, 2], radius: 0.8 };

const margins = S.plateauMargins();
const chord = 2 * S.RADIUS * Math.sin((S.ROTATION * D) / 2);

// ---------------------------------------------------------------- pack

const parts = [];
let offset = 0;
const push = (typed) => {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { parts.push(new Uint8Array(pad)); offset += pad; }
  const at = offset;
  parts.push(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
  offset += typed.byteLength;
  return at;
};
const oct = (x, y, z) => {
  const l = abs(x) + abs(y) + abs(z) || 1;
  let u = x / l, v = y / l;
  if (z < 0) { const ou = u; u = (1 - abs(v)) * (ou >= 0 ? 1 : -1); v = (1 - abs(ou)) * (v >= 0 ? 1 : -1); }
  return [round(u * 32767), round(v * 32767)];
};
const index = {};
for (const [name, m] of Object.entries(meshes)) {
  const n = m.positions.length / 3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { lo[a] = min(lo[a], m.positions[i * 3 + a]); hi[a] = max(hi[a], m.positions[i * 3 + a]); }
  const pos = new Uint16Array(n * 3);
  const nor = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) pos[i * 3 + a] = round(((m.positions[i * 3 + a] - lo[a]) / (hi[a] - lo[a] || 1)) * 65535);
    nor.set(oct(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]), i * 2);
  }
  const wide = n > 65535;
  index[name] = {
    vertices: n,
    triangles: m.indices.length / 3,
    min: lo.map((v) => +v.toFixed(4)),
    max: hi.map((v) => +v.toFixed(4)),
    position: push(pos),
    normal: push(nor),
    ao: push(m.ao),
    tag: push(m.tag),
    index: push(wide ? m.indices : new Uint16Array(m.indices)),
    wide,
  };
}
const bin = new Uint8Array(offset);
{
  let at = 0;
  for (const p of parts) { bin.set(p, at); at += p.byteLength; }
}

const manifest = {
  units: 'mm',
  tpa: S.TPA,
  target: S.TARGET,
  rotation: S.ROTATION,
  radius: S.RADIUS,
  kerf: S.KERF,
  chord: +chord.toFixed(2),
  stifle: S.STIFLE,
  eminence: S.EMINENCE,
  talus: S.TALUS,
  plateau: { cranial: margins.cranial.map((v) => +v.toFixed(2)), caudal: margins.caudal.map((v) => +v.toFixed(2)) },
  femur: { origin: S.FEMUR_ORIGIN, angle: 180 - S.STIFLE },
  meshes: index,
  outlines,
  anchors,
  ligaments,
  marks,
  cutLine,
  wire,
  plate: { thickness: PLATE.thickness, screws },
};

await mkdir(join(root, 'public/model'), { recursive: true });
await mkdir(join(root, 'src/model'), { recursive: true });
await writeFile(join(root, 'public/model/stifle.bin'), bin);
await writeFile(join(root, 'src/model/manifest.json'), JSON.stringify(manifest));
const tris = Object.values(index).reduce((s, m) => s + m.triangles, 0);
console.log(`\n${tris} triangles, ${(bin.byteLength / 1e6).toFixed(2)} MB, manifest ${(JSON.stringify(manifest).length / 1e3).toFixed(0)} KB, ${((performance.now() - started) / 1000).toFixed(1)} s`);
