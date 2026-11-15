// A humanoid robot, built the way they are: a dark flexible under-frame that
// shows at the joints, and plain hard shells over it, each riding on one bone.
// One skinned mesh of about 3,000 triangles on a 17-bone skeleton. Nothing is
// painted on it: every surface is shell, glass or rubber, and the material
// (robots/robot.js) gives each of the three its colour and finish.
import * as THREE from 'three';

export const BONES = [
  // name, parent, rest position
  ['root', -1, [0, 0.94, 0]],
  ['spine', 0, [0, 1.08, 0]],
  ['chest', 1, [0, 1.26, 0]],
  ['neck', 2, [0, 1.49, 0.004]],
  ['head', 3, [0, 1.555, 0]],
  ['armR', 2, [0.195, 1.405, 0]],
  ['foreR', 5, [0.215, 1.115, 0]],
  ['handR', 6, [0.228, 0.865, -0.004]],
  ['armL', 2, [-0.195, 1.405, 0]],
  ['foreL', 8, [-0.215, 1.115, 0]],
  ['handL', 9, [-0.228, 0.865, -0.004]],
  ['thighR', 0, [0.088, 0.93, 0]],
  ['shinR', 11, [0.092, 0.5, -0.004]],
  ['footR', 12, [0.095, 0.085, 0.01]],
  ['thighL', 0, [-0.088, 0.93, 0]],
  ['shinL', 14, [-0.092, 0.5, -0.004]],
  ['footL', 15, [-0.095, 0.085, 0.01]],
];
export const B = Object.fromEntries(BONES.map((b, i) => [b[0], i]));

/** What a surface is made of; the material reads this per vertex. A part is all one kind. */
export const KIND = { SHELL: 0, GLASS: 1, RUBBER: 2 };

const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

class Mesh {
  constructor() {
    this.pos = [];
    this.si = [];
    this.sw = [];
    this.kd = [];
    this.idx = [];
    this.n = 0;
    this.kind = KIND.SHELL;
  }

  vert(p, w) {
    this.pos.push(p[0], p[1], p[2]);
    this.si.push(w[0], w[2] ?? 0, w[4] ?? 0, w[6] ?? 0);
    this.sw.push(w[1], w[3] ?? 0, w[5] ?? 0, w[7] ?? 0);
    this.kd.push(this.kind);
    return this.n++;
  }

  /** A triangle, turned if need be so that it faces away from `inside`. */
  tri(a, b, c, inside) {
    const P = this.pos;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (ax + P[b * 3] + P[c * 3]) / 3 - inside[0], my = (ay + P[b * 3 + 1] + P[c * 3 + 1]) / 3 - inside[1], mz = (az + P[b * 3 + 2] + P[c * 3 + 2]) / 3 - inside[2];
    if (nx * mx + ny * my + nz * mz >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  /**
   * A tube through a list of rings.
   * ring: { c: centre, rx, rz, exp (2 = ellipse, higher = boxier), w: skin weights }
   * opts: { n segments, capStart, capEnd }
   */
  tube(rings, { n = 10, capStart = false, capEnd = false }) {
    const rows = [];
    for (const r of rings) {
      const e = r.exp || 2;
      const row = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const s = Math.sin(a), c = Math.cos(a);
        const rad = Math.pow(Math.pow(Math.abs(s), e) + Math.pow(Math.abs(c), e), -1 / e);
        row.push(this.vert([r.c[0] + s * rad * r.rx, r.c[1], r.c[2] - c * rad * r.rz], r.w));
      }
      rows.push(row);
    }
    for (let j = 0; j < rings.length - 1; j++) {
      const mid = [(rings[j].c[0] + rings[j + 1].c[0]) / 2, (rings[j].c[1] + rings[j + 1].c[1]) / 2, (rings[j].c[2] + rings[j + 1].c[2]) / 2];
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        this.tri(rows[j][k], rows[j][k2], rows[j + 1][k2], mid);
        this.tri(rows[j][k], rows[j + 1][k2], rows[j + 1][k], mid);
      }
    }
    const cap = (j, jIn) => {
      const cen = this.vert(rings[j].c, rings[j].w);
      for (let k = 0; k < n; k++) this.tri(cen, rows[j][k], rows[j][(k + 1) % n], rings[jIn].c);
    };
    if (capStart) cap(0, 1);
    if (capEnd) cap(rings.length - 1, rings.length - 2);
    return rows;
  }

  /** A tube up the Y axis from rows of [y, rx, rz, x, z, exp]. `w` is the skin weights, or a function of height. */
  stack(rows, w, opts) {
    const weights = typeof w === 'function' ? w : () => w;
    return this.tube(rows.map(([y, rx, rz, x = 0, z = 0, exp = 2]) => ({ c: [x, y, z], rx, rz, exp, w: weights(y) })), opts);
  }

  /** A ball joint. */
  ball(c, r, w, n = 6) {
    const rows = [];
    for (const deg of [150, 110, 70, 30]) {
      const ph = (deg * Math.PI) / 180;
      rows.push([c[1] + Math.cos(ph) * r, Math.sin(ph) * r, Math.sin(ph) * r, c[0], c[2]]);
    }
    this.stack(rows, w, { n, capStart: true, capEnd: true });
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kd, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    weldNormals(g);
    return g;
  }
}

/** Vertices that share a position should share a normal, or the join shows as a crease. */
export function weldNormals(g) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 2000)},${Math.round(p.getY(i) * 2000)},${Math.round(p.getZ(i) * 2000)}`;
    let e = map.get(key);
    if (!e) map.set(key, (e = { x: 0, y: 0, z: 0, ids: [] }));
    e.x += n.getX(i);
    e.y += n.getY(i);
    e.z += n.getZ(i);
    e.ids.push(i);
  }
  for (const e of map.values()) {
    if (e.ids.length < 2) continue;
    const l = Math.hypot(e.x, e.y, e.z) || 1;
    for (const i of e.ids) n.setXYZ(i, e.x / l, e.y / l, e.z / l);
  }
}

// ---------------------------------------------------------------- outlines: [y, half width, half depth, centre z, boxiness]

/** The visor: degrees either side of straight ahead, and its bottom and top. */
const VISOR = { half: 72, y0: 1.6, y1: 1.722 };

const HEAD = [
  [1.563, 0.05, 0.062, -0.006, 2.2],
  [1.582, 0.067, 0.083, -0.006, 2.4],
  [1.61, 0.0745, 0.0925, -0.004, 2.5],
  [1.645, 0.0775, 0.097, 0.0, 2.5],
  [1.685, 0.0775, 0.098, 0.002, 2.5],
  [1.72, 0.071, 0.093, 0.004, 2.4],
  [1.745, 0.05, 0.068, 0.006, 2.2],
  [1.757, 0.014, 0.02, 0.006, 2.0],
];
const CHEST = [
  [1.16, 0.128, 0.09, -0.002, 2.6],
  [1.186, 0.152, 0.105, -0.006, 2.8],
  [1.27, 0.172, 0.118, -0.012, 3.0],
  [1.36, 0.182, 0.116, -0.008, 3.0],
  [1.418, 0.178, 0.099, 0.0, 2.8],
  [1.452, 0.142, 0.081, 0.004, 2.4],
  [1.476, 0.08, 0.07, 0.006, 2.1],
  [1.498, 0.062, 0.064, 0.006, 2.0],
];
const WAIST = [
  [0.985, 0.124, 0.087, 0.002, 2.3],
  [1.04, 0.119, 0.084, 0.0, 2.2],
  [1.1, 0.119, 0.084, -0.002, 2.2],
  [1.15, 0.124, 0.087, -0.004, 2.3],
  [1.19, 0.128, 0.09, -0.006, 2.3],
];
const PELVIS = [
  [0.858, 0.05, 0.07, 0.002, 2.2],
  [0.9, 0.104, 0.096, 0.004, 2.5],
  [0.945, 0.152, 0.109, 0.006, 2.8],
  [0.992, 0.158, 0.106, 0.004, 2.7],
  [1.013, 0.128, 0.09, 0.002, 2.4],
];
/** Frames: 'a' is the broad one, 'b' the slight one. [chest, waist, limbs] as fractions of 'a'. */
const FRAMES = { a: [1, 1, 1], b: [0.9, 0.88, 0.9] };

function at(rows, y) {
  let i = 1;
  while (i < rows.length - 1 && rows[i][0] < y) i++;
  const t = Math.max(0, Math.min(1, (y - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0])));
  return { rx: lerp(rows[i - 1][1], rows[i][1], t), rz: lerp(rows[i - 1][2], rows[i][2], t), zc: lerp(rows[i - 1][3], rows[i][3], t), e: lerp(rows[i - 1][4], rows[i][4], t) };
}
function on(o, a, y, off) {
  const s = Math.sin(a), c = Math.cos(a);
  const rad = Math.pow(Math.pow(Math.abs(s), o.e) + Math.pow(Math.abs(c), o.e), -1 / o.e);
  return [s * rad * (o.rx + off), y, o.zc - c * rad * (o.rz + off)];
}

/** A point on the head's surface: angle a (0 = straight ahead, positive toward the right ear), height y, pushed out by `off`. */
export function headPoint(a, y, off = 0) {
  return on(at(HEAD, y), a, y, off);
}

/** The trunk's outline at a height: chest shell, bare waist or pelvis shell. */
function trunkAt(frame, y) {
  const f = FRAMES[frame] || FRAMES.a;
  const rows = y >= 1.16 ? CHEST : y > 1.013 ? WAIST : PELVIS;
  const k = y >= 1.16 ? f[0] : y > 1.013 ? f[1] : 1;
  const o = at(rows, y);
  o.rx *= k;
  o.rz *= y >= 1.16 ? lerp(1, k, 0.7) : k;
  return o;
}

/** A point on the trunk: angle a (0 = front, positive toward the right arm), height y, pushed out by `off`. */
export function trunkPoint(frame, a, y, off = 0) {
  return on(trunkAt(frame, y), a, y, off);
}

/** Which bones a point of the trunk at height y follows. */
export function trunkWeights(y) {
  if (y >= 1.16) return [B.chest, 1];
  if (y < 1.0) return [B.root, 1];
  if (y < 1.08) { const t = sstep(1.0, 1.08, y); return [B.root, 1 - t, B.spine, t]; }
  const t = sstep(1.08, 1.16, y);
  return [B.spine, 1 - t, B.chest, t];
}

// ---------------------------------------------------------------- the frame

const cache = new Map();

/** frame: 'a' or 'b'. Both hang on the same skeleton. */
export function buildFrame(frame = 'a') {
  if (cache.has(frame)) return cache.get(frame);
  const [fc, fw, fl] = FRAMES[frame] || FRAMES.a;
  const m = new Mesh();
  /** A closed shell through rows of [y, rx, rz, zc, exp, x]. */
  const shell = (rows, w, n) => m.tube(rows.map(([y, rx, rz, zc = 0, exp = 2, x = 0]) => ({ c: [x, y, zc], rx, rz, exp, w })), { n, capStart: true, capEnd: true });

  // ---- under-frame: waist and neck
  m.kind = KIND.RUBBER;
  m.stack(WAIST.map(([y, rx, rz, zc, exp]) => [y, rx * fw, rz * fw, 0, zc, exp]), trunkWeights, { n: 12 });
  m.stack([[1.44, 0.054, 0.056, 0, 0.006], [1.5, 0.05, 0.053, 0, 0.004], [1.585, 0.049, 0.052, 0, 0]], (y) => (y < 1.47 ? [B.chest, 1] : y < 1.52 ? [B.chest, 0.5, B.neck, 0.5] : [B.neck, 0.5, B.head, 0.5]), { n: 8 });

  // ---- trunk shells
  m.kind = KIND.SHELL;
  shell(CHEST.map(([y, rx, rz, zc, exp]) => [y, rx * fc, rz * lerp(1, fc, 0.7), zc, exp]), [B.chest, 1], 14);
  shell(PELVIS, [B.root, 1], 14);

  // ---- head: a plain helmet with a blank glass visor let into the front
  const headW = [B.head, 1];
  shell(HEAD, headW, 16);
  {
    m.kind = KIND.GLASS;
    const cols = 9, ys = [VISOR.y0, 1.622, 1.661, 1.7, VISOR.y1];
    const grid = ys.map((y) => {
      const row = [];
      for (let k = 0; k <= cols; k++) row.push(m.vert(headPoint(((-VISOR.half + (2 * VISOR.half * k) / cols) * Math.PI) / 180, y, 0.0028), headW));
      return row;
    });
    for (let j = 0; j < ys.length - 1; j++) {
      const inside = [0, (ys[j] + ys[j + 1]) / 2, 0];
      for (let k = 0; k < cols; k++) {
        m.tri(grid[j][k], grid[j][k + 1], grid[j + 1][k + 1], inside);
        m.tri(grid[j][k], grid[j + 1][k + 1], grid[j + 1][k], inside);
      }
    }
  }

  // ---- arms
  for (const s of [1, -1]) {
    const up = s > 0 ? B.armR : B.armL, lo = s > 0 ? B.foreR : B.foreL, hand = s > 0 ? B.handR : B.handL;
    const cx = (y) => s * ((y > 1.115 ? lerp(0.215, 0.2, (y - 1.115) / 0.3) : lerp(0.228, 0.215, (y - 0.865) / 0.25)) - 0.022 * sstep(1.41, 1.458, y));
    const armRows = (list) => list.map(([y, r]) => [y, r * fl, r * fl * (y > 1.2 ? 1.06 : 1), 0, 2.2, cx(y)]);
    // shoulder joint, then the sleeve that shows at the elbow and the wrist
    m.kind = KIND.RUBBER;
    m.ball([s * 0.196, 1.405, 0], 0.05 * fl, [B.chest, 1]);
    const elbow = (y) => {
      if (y > 1.17) return [up, 1];
      if (y > 1.06) { const t = sstep(1.17, 1.06, y); return [up, 1 - t, lo, t]; }
      return [lo, 1];
    };
    m.stack([[1.2, 0.033], [1.15, 0.036], [1.115, 0.038], [1.08, 0.034], [1.045, 0.029]].map(([y, r]) => [y, r * fl, r * fl, cx(y), 0]), elbow, { n: 8 });
    m.stack([[0.905, 0.026], [0.875, 0.024], [0.852, 0.024]].map(([y, r]) => [y, r * fl, r * fl, cx(y), -0.004]), (y) => (y > 0.87 ? [lo, 1] : [hand, 1]), { n: 6 });
    // shells: upper arm with its shoulder cap, forearm
    m.kind = KIND.SHELL;
    shell(armRows([[1.165, 0.036], [1.182, 0.045], [1.25, 0.049], [1.33, 0.054], [1.385, 0.061], [1.425, 0.056], [1.448, 0.04], [1.458, 0.014]]), [up, 1], 8);
    shell(armRows([[0.893, 0.027], [0.905, 0.034], [0.94, 0.04], [1.0, 0.045], [1.07, 0.044], [1.085, 0.038]]), [lo, 1], 8);

    // hand: a palm, four fingers a little curled toward it, and a thumb
    m.kind = KIND.RUBBER;
    const hx = s * 0.228, hw = [hand, 1];
    m.tube(
      [[0.862, 0.014, 0.026, -0.006], [0.84, 0.0155, 0.04, -0.01], [0.795, 0.014, 0.042, -0.012], [0.78, 0.011, 0.039, -0.012]].map(([y, rx, rz, z]) => ({ c: [hx, y, z], rx: rx * fl, rz: rz * fl, exp: 4, w: hw })),
      { n: 8, capStart: true, capEnd: true },
    );
    [[-0.0285, 0.95], [-0.0095, 1.05], [0.0095, 1], [0.0285, 0.84]].forEach(([z, l]) => {
      m.tube(
        [[0, 0.0085, 0], [0.039 * l, 0.008, 0.005], [0.077 * l, 0.0062, 0.017]].map(([d, r, curl]) => ({ c: [hx - s * curl, 0.784 - d, -0.012 + z * fl], rx: r * fl, rz: r * fl, exp: 3, w: hw })),
        { n: 6, capEnd: true },
      );
    });
    m.tube(
      [[0.842, -0.05, 0.004, 0.0095], [0.808, -0.066, 0.01, 0.0085], [0.778, -0.074, 0.018, 0.0068]].map(([y, z, x, r]) => ({ c: [hx - s * x, y, z * fl], rx: r * fl, rz: r * fl, exp: 3, w: hw })),
      { n: 6, capStart: true, capEnd: true },
    );
  }

  // ---- legs
  for (const s of [1, -1]) {
    const up = s > 0 ? B.thighR : B.thighL, lo = s > 0 ? B.shinR : B.shinL, foot = s > 0 ? B.footR : B.footL;
    const cx = (y) => s * lerp(0.095, 0.088, sstep(0.085, 0.93, y));
    const legRows = (list) => list.map(([y, r, z = 0]) => [y, r * fl, r * fl * 1.08, z, 2.3, cx(y)]);
    // hip joint, and the sleeves that show at the knee and the ankle
    m.kind = KIND.RUBBER;
    m.ball([s * 0.09, 0.928, 0.002], 0.07, [B.root, 1]);
    const knee = (y) => {
      if (y > 0.57) return [up, 1];
      if (y > 0.44) { const t = sstep(0.57, 0.44, y); return [up, 1 - t, lo, t]; }
      return [lo, 1];
    };
    m.stack([[0.59, 0.044], [0.545, 0.047], [0.5, 0.05], [0.46, 0.043], [0.425, 0.038]].map(([y, r]) => [y, r * fl, r * fl * 1.05, cx(y), 0]), knee, { n: 8 });
    m.stack([[0.152, 0.03], [0.1, 0.033], [0.07, 0.036]].map(([y, r]) => [y, r * fl, r * fl, cx(y), 0.008]), (y) => (y > 0.12 ? [lo, 1] : [foot, 1]), { n: 8 });
    // shells: thigh, a cap over the knee, shin
    m.kind = KIND.SHELL;
    shell(legRows([[0.56, 0.05], [0.573, 0.062], [0.6, 0.068], [0.7, 0.078], [0.82, 0.086, 0.002], [0.885, 0.08, 0.002], [0.905, 0.058, 0.002]]), [up, 1], 10);
    shell(legRows([[0.128, 0.034, 0.008], [0.145, 0.042, 0.008], [0.2, 0.046, 0.01], [0.3, 0.055, 0.012], [0.4, 0.062, 0.01], [0.46, 0.056, 0.002], [0.478, 0.047, 0]]), [lo, 1], 10);
    m.tube(
      [[0.462, 0.02, 0.008], [0.478, 0.036, 0.015], [0.522, 0.036, 0.015], [0.538, 0.02, 0.008]].map(([y, rx, rz]) => ({ c: [cx(y), y, -0.05 * fl], rx: rx * fl, rz, exp: 3, w: [lo, 1] })),
      { n: 8, capStart: true, capEnd: true },
    );

    // foot: lofted from heel to toe, flat underneath: a rubber sole, and a shell over it
    const fx = s * 0.095;
    const S = [[0.085, 0.022, 0.045], [0.06, 0.038, 0.088], [0.008, 0.043, 0.104], [-0.05, 0.047, 0.078], [-0.112, 0.049, 0.056], [-0.168, 0.044, 0.043], [-0.2, 0.026, 0.03]];
    const loft = (prof) => {
      const rows = S.map(([z, w, h]) => prof.map(([px, py]) => m.vert([fx + px * w, py * h, z], [foot, 1])));
      for (let j = 0; j < S.length - 1; j++) {
        const inside = [fx, 0.03, (S[j][0] + S[j + 1][0]) / 2];
        for (let k = 0; k < prof.length; k++) {
          const k2 = (k + 1) % prof.length;
          m.tri(rows[j][k], rows[j][k2], rows[j + 1][k2], inside);
          m.tri(rows[j][k], rows[j + 1][k2], rows[j + 1][k], inside);
        }
      }
      for (const [j, jIn] of [[0, 1], [S.length - 1, S.length - 2]]) {
        const cen = m.vert([fx, S[j][2] * 0.5, S[j][0]], [foot, 1]);
        const inside = [fx, 0.03, S[jIn][0]];
        for (let k = 0; k < prof.length; k++) m.tri(cen, rows[j][k], rows[j][(k + 1) % prof.length], inside);
      }
    };
    m.kind = KIND.RUBBER;
    loft([[-1, 0], [-1, 0.24], [1, 0.24], [1, 0]]);
    m.kind = KIND.SHELL;
    loft([[-1, 0.24], [-1, 0.45], [-0.76, 0.85], [-0.32, 1], [0.32, 1], [0.76, 0.85], [1, 0.45], [1, 0.24]]);
  }

  const g = m.build();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.25);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.6, 0, -0.6), new THREE.Vector3(0.6, 1.9, 0.6));
  cache.set(frame, g);
  return g;
}
