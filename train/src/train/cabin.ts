// The carriage: an open saloon with big windows, 2+1 seating in facing bays with a table between,
// built from simple rounded solids. Coordinates are the car's own: +x the way it travels, +y up,
// +z to the right, y = 0 at the floor, x = 0 at mid-length.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as tex from './textures';

export const CAR = {
  floorAboveRail: 1.22,
  halfWidth: 1.34, // inner face of the side walls
  glassZ: 1.43, // the panes sit flush with the outside
  halfLength: 9,
  bays: 9,
  pitch: 2,
  sill: 0.72,
  head: 1.92,
  winHalf: 0.92,
  coveBase: 1.98,
  coveZ: 0.72,
  ceil: 2.26,
  seatX: 0.55, // seat centres are this far from the middle of their bay
  /** middle of the bay the passenger sits in */
  bayX: -2,
};
export const bayCentre = (k: number) => -8 + k * CAR.pitch;
/** The passenger's eyes, seated in the single seat on the left, facing forward. */
export const EYE = new THREE.Vector3(CAR.bayX - CAR.seatX - 0.14, 1.2, -0.99);

type Bag = Map<string, THREE.BufferGeometry[]>;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

function put(bag: Bag, mat: string, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s);
  g.applyMatrix4(_m);
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal'].includes(name) && !(name === 'uv' && mat === 'blob')) g.deleteAttribute(name);
  if (!bag.has(mat)) bag.set(mat, []);
  bag.get(mat)!.push(g);
}
const rbox = (w: number, h: number, d: number, r: number, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/** A flat panel in the plane of two axes, facing `normal`, cut into cells so baked shading has somewhere to live. */
function panel(a: THREE.Vector3, b: THREE.Vector3, origin: THREE.Vector3, na: number, nb: number, flip = false): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, na, nb);
  const n = new THREE.Vector3().crossVectors(a, b).normalize();
  if (flip) n.negate();
  const pos = g.attributes.position, nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5, v = pos.getY(i) + 0.5;
    pos.setXYZ(i, origin.x + a.x * u + b.x * v, origin.y + a.y * u + b.y * v, origin.z + a.z * u + b.z * v);
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  if (flip) {
    const idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
  }
  return g;
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** One seat facing +x, origin on the floor under its middle. */
function seat(bag: Bag, x: number, z: number, facing: 1 | -1, armLeft: boolean, armRight: boolean) {
  const ry = facing === 1 ? 0 : Math.PI;
  const at = (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * facing, ly, z + lz * facing];
  const lean = 0.2 * facing;
  put(bag, 'cloth', rbox(0.5, 0.14, 0.5, 0.055, 3), ...at(0.02, 0.41, 0), 0, ry, 0.06 * facing);
  put(bag, 'cloth', rbox(0.13, 0.7, 0.5, 0.055, 3), ...at(-0.3, 0.8, 0), 0, ry, lean);
  // side bolsters give the back some shape
  for (const s of [-1, 1]) put(bag, 'cloth', rbox(0.1, 0.56, 0.085, 0.04), ...at(-0.262, 0.8, s * 0.21), 0, ry, lean);
  put(bag, 'leather', rbox(0.115, 0.23, 0.33, 0.05, 3), ...at(-0.372, 1.205, 0), 0, ry, lean);
  for (const s of [-1, 1]) put(bag, 'leather', rbox(0.1, 0.21, 0.07, 0.03), ...at(-0.325, 1.2, s * 0.175), 0, ry + s * 0.45 * facing, lean);
  put(bag, 'shell', rbox(0.055, 0.95, 0.53, 0.025), ...at(-0.376, 0.75, 0), 0, ry, lean);
  put(bag, 'shell', rbox(0.36, 0.3, 0.34, 0.02), ...at(0.0, 0.19, 0), 0, ry, 0);
  put(bag, 'shell', rbox(0.46, 0.035, 0.5, 0.015), ...at(0.02, 0.335, 0), 0, ry, 0.06 * facing);
  for (const [s, on] of [[-1, armLeft], [1, armRight]] as const) {
    if (!on) continue;
    put(bag, 'leather', rbox(0.34, 0.04, 0.062, 0.018), ...at(-0.03, 0.655, s * 0.285), 0, ry, 0);
    put(bag, 'shell', rbox(0.3, 0.035, 0.055, 0.012), ...at(-0.04, 0.622, s * 0.285), 0, ry, 0);
    put(bag, 'shell', rbox(0.05, 0.19, 0.05, 0.012), ...at(-0.16, 0.53, s * 0.285), 0, ry, 0.25 * facing);
  }
  put(bag, 'blob', new THREE.PlaneGeometry(0.85, 0.8).rotateX(-Math.PI / 2), x, 0.004, z);
}

/** A bay's furniture, around x = 0: `side` -1 for the single seats on the left, +1 for the pairs on the right. */
function bay(side: -1 | 1): Bag {
  const bag: Bag = new Map();
  const wallZ = side * CAR.halfWidth;
  if (side === -1) {
    for (const f of [1, -1] as const) seat(bag, -CAR.seatX * f, -0.99, f, true, true);
    put(bag, 'wood', rbox(0.5, 0.03, 0.46, 0.012), 0, 0.735, wallZ + 0.235);
    put(bag, 'shell', rbox(0.51, 0.012, 0.47, 0.005), 0, 0.716, wallZ + 0.235);
    put(bag, 'metal', new THREE.CylinderGeometry(0.018, 0.022, 0.71, 12), 0, 0.355, wallZ + 0.42);
    put(bag, 'blob', new THREE.PlaneGeometry(0.75, 0.7).rotateX(-Math.PI / 2), 0, 0.004, wallZ + 0.25);
  } else {
    for (const f of [1, -1] as const) {
      seat(bag, -CAR.seatX * f, 0.53, f, true, f === 1);
      seat(bag, -CAR.seatX * f, 1.05, f, f === -1, true);
    }
    put(bag, 'wood', rbox(0.5, 0.03, 1.0, 0.012), 0, 0.735, wallZ - 0.505);
    put(bag, 'shell', rbox(0.51, 0.012, 1.01, 0.005), 0, 0.716, wallZ - 0.505);
    put(bag, 'metal', new THREE.CylinderGeometry(0.018, 0.022, 0.71, 12), 0, 0.355, wallZ - 0.93);
    put(bag, 'blob', new THREE.PlaneGeometry(0.75, 1.2).rotateX(-Math.PI / 2), 0, 0.004, wallZ - 0.5);
  }
  // a small lamp at the window end of the table
  const lz = wallZ - side * 0.085;
  put(bag, 'lampMetal', new THREE.CylinderGeometry(0.03, 0.034, 0.012, 20), 0, 0.756, lz);
  put(bag, 'lampMetal', new THREE.CylinderGeometry(0.006, 0.006, 0.17, 8), 0, 0.84, lz);
  put(bag, 'shade', new THREE.CylinderGeometry(0.034, 0.05, 0.075, 24, 1, true), 0, 0.955, lz);
  put(bag, 'shadeCap', new THREE.CylinderGeometry(0.034, 0.034, 0.004, 24), 0, 0.992, lz);
  return bag;
}

/** Everything that is not furniture. */
function shell(): Bag {
  const bag: Bag = new Map();
  const L = CAR.halfLength, W = CAR.halfWidth, len = L * 2;
  put(bag, 'carpet', panel(V(len, 0, 0), V(0, 0, -2 * W), V(-L, 0, W), 120, 24));
  put(bag, 'ceiling', panel(V(len, 0, 0), V(0, 0, 2 * CAR.coveZ), V(-L, CAR.ceil, -CAR.coveZ), 60, 8));
  const slant = V(0, CAR.ceil - CAR.coveBase, W - CAR.coveZ); // from the ceiling's edge down to the wall, right side
  for (const s of [-1, 1]) {
    const wz = s * W;
    // wall under the windows
    put(bag, 'wall', panel(V(len, 0, 0), V(0, CAR.sill, 0), V(-L, 0, wz), 120, 8, s === 1));
    put(bag, 'trim', rbox(len, 0.11, 0.06, 0.02), 0, 0.055, wz - s * 0.03);
    // the ledge at the sill, and the thickness of the wall seen in the window openings
    put(bag, 'wall', rbox(len, 0.022, 0.05, 0.008), 0, CAR.sill - 0.004, wz - s * 0.02);
    put(bag, 'trim', box(len, 0.02, CAR.glassZ - W), 0, CAR.sill - 0.012, wz + s * (CAR.glassZ - W) / 2);
    put(bag, 'wall', rbox(len, CAR.coveBase - CAR.head + 0.02, 0.13, 0.015), 0, (CAR.head + CAR.coveBase) / 2 + 0.01, wz + s * 0.045);
    for (let k = 0; k <= CAR.bays; k++) {
      const px = -L + k * CAR.pitch;
      const w = k === 0 || k === CAR.bays ? 0.32 : 0.16;
      put(bag, 'wall', rbox(w, CAR.head - CAR.sill + 0.02, 0.13, 0.02), px + (k === 0 ? 0.08 : k === CAR.bays ? -0.08 : 0), (CAR.head + CAR.sill) / 2, wz + s * 0.045);
    }
    // rubber round each pane
    for (let k = 0; k < CAR.bays; k++) {
      const cx = bayCentre(k), gz = s * (CAR.glassZ - 0.012);
      put(bag, 'trim', box(2 * CAR.winHalf, 0.03, 0.02), cx, CAR.sill + 0.015, gz);
      put(bag, 'trim', box(2 * CAR.winHalf, 0.03, 0.02), cx, CAR.head - 0.015, gz);
      for (const e of [-1, 1]) put(bag, 'trim', box(0.03, CAR.head - CAR.sill, 0.02), cx + e * (CAR.winHalf - 0.015), (CAR.head + CAR.sill) / 2, gz);
    }
    // the cove between wall and ceiling, with a skylight over each bay
    const a = V(0, slant.y, -s * slant.z), base = V(0, CAR.coveBase, wz);
    for (let k = 0; k < CAR.bays; k++) {
      const x0 = -L + k * CAR.pitch, hx0 = x0 + 0.22, hx1 = x0 + CAR.pitch - 0.22;
      const flip = s === 1;
      const piece = (xa: number, xb: number, v0: number, v1: number) =>
        put(bag, 'wall', panel(V(xb - xa, 0, 0), a.clone().multiplyScalar(v1 - v0), base.clone().add(a.clone().multiplyScalar(v0)).setX(xa), Math.max(1, Math.round((xb - xa) * 6)), 2, flip));
      piece(x0, hx0, 0, 1);
      piece(hx1, x0 + CAR.pitch, 0, 1);
      piece(hx0, hx1, 0, 0.16);
      piece(hx0, hx1, 0.84, 1);
    }
    // light lines in the ceiling
    put(bag, 'led', box(len - 0.4, 0.012, 0.05), 0, CAR.ceil - 0.004, s * 0.47);
    put(bag, 'trim', box(len - 0.4, 0.006, 0.02), 0, CAR.ceil - 0.002, s * 0.2);
  }
  // end walls with a glass door each
  for (const e of [-1, 1]) {
    const x = e * L, t = 0.06, dw = 0.42, dh = 2.02;
    const sideW = W + 0.2 - dw;
    for (const s of [-1, 1]) put(bag, 'wall', box(t, CAR.ceil + 0.1, sideW), x + e * t * 0.5, CAR.ceil / 2, s * (dw + sideW / 2));
    put(bag, 'wall', box(t, CAR.ceil + 0.1 - dh, 2 * dw), x + e * t * 0.5, dh + (CAR.ceil + 0.1 - dh) / 2, 0);
    put(bag, 'door', box(0.018, dh - 0.04, 2 * dw - 0.03), x + e * 0.04, dh / 2, 0);
    put(bag, 'metal', box(0.03, dh, 0.03), x + e * 0.015, dh / 2, -dw + 0.015);
    put(bag, 'metal', box(0.03, dh, 0.03), x + e * 0.015, dh / 2, dw - 0.015);
    put(bag, 'metal', box(0.03, 0.03, 2 * dw), x + e * 0.015, dh - 0.015, 0);
    put(bag, 'metal', rbox(0.02, 0.5, 0.025, 0.008), x - e * 0.012, 1.05, dw - 0.09);
    put(bag, 'display', box(0.012, 0.12, 0.6), x - e * 0.004, 2.14, 0);
    put(bag, 'dark', box(0.02, 2.4, 2.9), x + e * 0.9, 1.2, 0);
  }
  return bag;
}

/** Box-projected texture coordinates in metres, so every surface carries its texture at the same scale. */
function projectUV(g: THREE.BufferGeometry) {
  const pos = g.attributes.position, nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    if (ay >= ax && ay >= az) uv.set([pos.getX(i), pos.getZ(i)], i * 2);
    else if (ax >= az) uv.set([pos.getZ(i), pos.getY(i)], i * 2);
    else uv.set([pos.getX(i), pos.getY(i)], i * 2);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ---- baked shading: how much of its surroundings each vertex can see

class Occluders {
  private cell = 0.12;
  private grid = new Map<number, number[]>();
  private tris: Float32Array[] = [];
  private key(ix: number, iy: number, iz: number) {
    return ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
  }
  add(g: THREE.BufferGeometry, offset = new THREE.Vector3()) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const t = new Float32Array(9);
      for (let k = 0; k < 3; k++) t.set([p.getX(i + k) + offset.x, p.getY(i + k) + offset.y, p.getZ(i + k) + offset.z], k * 3);
      const id = this.tris.push(t) - 1;
      const c = this.cell;
      const lo = [0, 1, 2].map((a) => Math.floor(Math.min(t[a], t[a + 3], t[a + 6]) / c));
      const hi = [0, 1, 2].map((a) => Math.floor(Math.max(t[a], t[a + 3], t[a + 6]) / c));
      if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 4000) continue; // a huge sheet: its own vertices will shade it
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        const k = this.key(x, y, z);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(id);
      }
    }
  }
  /** Is there anything within `max` of o along d? Returns 0..1: 1 for a hit right at the start, fading to 0 at max. */
  hit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    const c = this.cell, steps = Math.ceil(max / (c * 0.9));
    let seen = -1, best = max;
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(max, s * c * 0.9);
      const k = this.key(Math.floor((ox + dx * t) / c), Math.floor((oy + dy * t) / c), Math.floor((oz + dz * t) / c));
      if (k === seen) continue;
      seen = k;
      const list = this.grid.get(k);
      if (!list) continue;
      for (const id of list) {
        const tt = rayTri(ox, oy, oz, dx, dy, dz, this.tris[id]);
        if (tt > 1e-4 && tt < best) best = tt;
      }
      if (best < t) break;
    }
    return best < max ? 1 - best / max : 0;
  }
}

function rayTri(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, t: Float32Array): number {
  const e1x = t[3] - t[0], e1y = t[4] - t[1], e1z = t[5] - t[2];
  const e2x = t[6] - t[0], e2y = t[7] - t[1], e2z = t[8] - t[2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-9 && det < 1e-9) return -1;
  const inv = 1 / det;
  const sx = ox - t[0], sy = oy - t[1], sz = oz - t[2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

const DIRS: [number, number, number][] = [];
{
  // a fixed, well-spread set of directions over the hemisphere about +z, cosine-weighted
  const n = 14;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, phi = i * 2.399963;
    const r = Math.sqrt(u), z = Math.sqrt(1 - u);
    DIRS.push([r * Math.cos(phi), r * Math.sin(phi), z]);
  }
}

function bakeAO(g: THREE.BufferGeometry, occ: Occluders, reach = 0.55) {
  const pos = g.attributes.position, nor = g.attributes.normal;
  const ao = new Float32Array(pos.count);
  const cache = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    const key = `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)},${Math.round(nx * 8)},${Math.round(ny * 8)},${Math.round(nz * 8)}`;
    let a = cache.get(key);
    if (a === undefined) {
      // a frame about the normal
      const hx = Math.abs(nx) < 0.9 ? 1 : 0, hy = hx ? 0 : 1;
      let tx = hy * nz, ty = -hx * nz, tz = hx * ny - hy * nx;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      let sum = 0;
      for (const d of DIRS) {
        const dx = tx * d[0] + bx * d[1] + nx * d[2], dy = ty * d[0] + by * d[1] + ny * d[2], dz = tz * d[0] + bz * d[1] + nz * d[2];
        sum += occ.hit(x + nx * 0.006, y + ny * 0.006, z + nz * 0.006, dx, dy, dz, reach);
      }
      a = 1 - sum / DIRS.length;
      cache.set(key, a);
    }
    ao[i] = a;
  }
  g.setAttribute('aAo', new THREE.BufferAttribute(ao, 1));
}

export class Cabin {
  readonly group = new THREE.Group();
  readonly materials: Record<string, THREE.MeshStandardMaterial> = {};
  /** emissive parts whose brightness follows the hour */
  readonly led: THREE.MeshStandardMaterial;
  readonly shade: THREE.MeshStandardMaterial;
  /** where the table lamps are, for the small lights that go with them */
  readonly lamps: THREE.Vector3[] = [];

  constructor(patch: (m: THREE.MeshStandardMaterial) => void) {
    const seatCloth = tex.cloth([50, 53, 58], 3, 46);
    const carpetTex = tex.carpet([70, 72, 78], 5, 9);
    const woodTex = tex.wood(8);
    const metalTex = tex.brushed(9);
    const P = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);
    const S = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
    const M = this.materials;
    M.cloth = P({ ...seatCloth, roughness: 0.95, sheen: 0.18, sheenRoughness: 0.6, sheenColor: new THREE.Color('#62666e'), normalScale: new THREE.Vector2(0.6, 0.6) });
    M.leather = S({ color: '#2a2d35', roughness: 0.58 });
    M.shell = S({ color: '#303236', roughness: 0.52 });
    M.wall = S({ color: '#d6d3cb', roughness: 0.72 });
    M.ceiling = S({ color: '#e6e4de', roughness: 0.8 });
    M.carpet = S({ ...carpetTex, roughness: 0.96 });
    M.trim = S({ color: '#101113', roughness: 0.75 });
    M.dark = S({ color: '#08090a', roughness: 0.9 });
    M.metal = S({ color: '#b9bbbd', roughness: 0.42, metalness: 1, ...metalTex });
    M.lampMetal = S({ color: '#1b1b1d', roughness: 0.38, metalness: 0.7 });
    M.wood = P({ ...woodTex, roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.35 });
    M.door = S({ color: '#aebcbc', roughness: 0.28, emissive: '#aebcbc', emissiveIntensity: 0 });
    M.display = S({ color: '#040506', roughness: 0.16 });
    M.led = S({ color: '#000000', emissive: '#fff3e2', emissiveIntensity: 1 });
    M.shade = S({ color: '#40382c', emissive: '#ffd49a', emissiveIntensity: 1, side: THREE.DoubleSide });
    M.shadeCap = S({ color: '#40382c', emissive: '#ffd49a', emissiveIntensity: 0.6 });
    this.led = M.led;
    this.shade = M.shade;
    for (const m of Object.values(M)) {
      m.shadowSide = THREE.DoubleSide;
      patch(m);
    }
    const blobMat = new THREE.MeshBasicMaterial({ map: tex.blob(), transparent: true, opacity: 0.55, color: 0x000000, depthWrite: false, toneMapped: false });

    const left = bay(-1), right = bay(1), body = shell();
    // what can shade what: the furniture of every bay, and the shell
    const occ = new Occluders();
    const merged = (bag: Bag) => new Map([...bag].map(([k, list]) => [k, mergeGeometries(list)!]));
    const L = merged(left), R = merged(right), B = merged(body);
    for (const [k, g] of B) if (k !== 'blob') occ.add(g);
    for (let k = 0; k < CAR.bays; k++) {
      const o = V(bayCentre(k), 0, 0);
      for (const set of [L, R]) for (const [name, g] of set) if (name !== 'blob') occ.add(g, o);
    }
    const mid = V(bayCentre(4), 0, 0);
    const finishGeo = (g: THREE.BufferGeometry, name: string, offset?: THREE.Vector3) => {
      if (name !== 'blob') {
        if (offset) g.translate(offset.x, offset.y, offset.z);
        bakeAO(g, occ);
        if (offset) g.translate(-offset.x, -offset.y, -offset.z);
      }
      if (name !== 'blob') projectUV(g);
      return g;
    };

    for (const [name, g] of B) {
      const mesh = new THREE.Mesh(finishGeo(g, name), M[name]);
      mesh.castShadow = name !== 'led' && name !== 'dark';
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const dummy = new THREE.Matrix4();
    for (const set of [L, R]) {
      for (const [name, g] of set) {
        const isBlob = name === 'blob';
        const mesh = new THREE.InstancedMesh(finishGeo(g, name, mid), isBlob ? blobMat : M[name], CAR.bays);
        for (let k = 0; k < CAR.bays; k++) mesh.setMatrixAt(k, dummy.makeTranslation(bayCentre(k), 0, 0));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = !isBlob && name !== 'shade' && name !== 'shadeCap';
        mesh.receiveShadow = !isBlob;
        if (isBlob) mesh.renderOrder = 1;
        mesh.frustumCulled = false;
        this.group.add(mesh);
      }
    }
    for (let k = 0; k < CAR.bays; k++) {
      for (const s of [-1, 1]) this.lamps.push(V(bayCentre(k), 0.95, s * (CAR.halfWidth - 0.085)));
    }
  }
}
