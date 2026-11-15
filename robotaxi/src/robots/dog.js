// A four-legged robot: a box of a body, a sensor head with a strip of glass
// across the front, an aerial for a tail, and legs whose knees point backward.
// Some trot at a robot's heel, some carry parcels on their own. One skinned
// mesh, as plain as the robots, with its feet placed by a small solver so that
// they stay where they land.
import * as THREE from 'three';
import { KIND, weldNormals } from './frame.js';
import { shellMaterial } from './robot.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

const LU = 0.25, LL = 0.26; // upper and lower leg
const HIP_X = 0.15, HIP_Y = -0.03, HIP_Z = 0.235; // where a leg hangs, from the middle of the body
const BODY_Y = 0.47, FOOT = 0.024;
const CYCLE = 0.5, DUTY = 0.56; // seconds per stride at a trot; the share of it a foot spends on the ground

const DOG_SHELLS = [[0.6, 0.6, 0.585], [0.6, 0.6, 0.585], [0.42, 0.43, 0.44], [0.26, 0.27, 0.285], [0.05, 0.052, 0.058]];

// bones: body, head, tail, then upper and lower for each leg (front right, front left, rear right, rear left)
const BODY = 0, HEAD = 1, TAIL = 2;
const legSide = (i) => (i % 2 ? -1 : 1), legEnd = (i) => (i < 2 ? -1 : 1);
const REST = [[0, BODY_Y + 0.03, 0], [0, 0.06, -0.34], [0, 0.085, 0.33]];
for (let i = 0; i < 4; i++) REST.push([legSide(i) * HIP_X, HIP_Y, legEnd(i) * HIP_Z], [0, -LU, 0]);
const PARENT = [-1, 0, 0, 0, 3, 0, 5, 0, 7, 0, 9];

class Parts {
  constructor() {
    this.pos = [];
    this.si = [];
    this.kd = [];
    this.idx = [];
    this.n = 0;
    this.kind = KIND.SHELL;
    this.bone = BODY;
  }

  v(p) {
    this.pos.push(p[0], p[1], p[2]);
    this.si.push(this.bone, 0, 0, 0);
    this.kd.push(this.kind);
    return this.n++;
  }

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

  /** A capped tube through rings of [x, y, z, r1, r2], each ring lying square to `axis`. */
  tube(rings, { axis = 'y', n = 6, exp = 2 } = {}) {
    const rows = rings.map(([cx, cy, cz, r1, r2]) => {
      const row = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + Math.PI / n;
        const s = Math.sin(a), c = Math.cos(a);
        const rad = Math.pow(Math.abs(s) ** exp + Math.abs(c) ** exp, -1 / exp);
        const p1 = c * rad * r1, p2 = s * rad * r2;
        row.push(this.v(axis === 'y' ? [cx + p1, cy, cz + p2] : axis === 'z' ? [cx + p1, cy + p2, cz] : [cx, cy + p2, cz + p1]));
      }
      return row;
    });
    const mid = (j) => [(rings[j][0] + rings[j + 1][0]) / 2, (rings[j][1] + rings[j + 1][1]) / 2, (rings[j][2] + rings[j + 1][2]) / 2];
    for (let j = 0; j < rings.length - 1; j++) {
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        this.tri(rows[j][k], rows[j][k2], rows[j + 1][k2], mid(j));
        this.tri(rows[j][k], rows[j + 1][k2], rows[j + 1][k], mid(j));
      }
    }
    for (const [j, jIn] of [[0, 1], [rings.length - 1, rings.length - 2]]) {
      const cen = this.v(rings[j]);
      for (let k = 0; k < n; k++) this.tri(cen, rows[j][k], rows[j][(k + 1) % n], rings[jIn]);
    }
  }

  ball(c, r, n = 5) {
    this.tube([150, 110, 70, 30].map((deg) => {
      const ph = (deg * Math.PI) / 180;
      return [c[0], c[1] + Math.cos(ph) * r, c[2], Math.sin(ph) * r, Math.sin(ph) * r];
    }), { n });
  }

  /** A flat panel facing forward. */
  panel(x0, x1, y0, y1, z) {
    const a = this.v([x0, y0, z]), b = this.v([x1, y0, z]), c = this.v([x1, y1, z]), d = this.v([x0, y1, z]);
    this.tri(a, b, c, [0, 0, z + 1]);
    this.tri(a, c, d, [0, 0, z + 1]);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.si.map((_, i) => (i % 4 ? 0 : 1)), 4));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kd, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    weldNormals(g);
    return g;
  }
}

const geos = new Map();
/** kind: 'pet', or 'courier' with a parcel box on its back. */
function dogGeometry(kind) {
  if (geos.has(kind)) return geos.get(kind);
  const p = new Parts();
  const y = BODY_Y + 0.03;
  const set = (bone, k = KIND.SHELL) => {
    p.bone = bone;
    p.kind = k;
  };
  // body, a rail along the back, a neck, the housing each leg turns in
  set(BODY);
  p.tube([[0, y, -0.34, 0.07, 0.05], [0, y, -0.31, 0.102, 0.076], [0, y, 0.31, 0.102, 0.076], [0, y, 0.34, 0.07, 0.05]], { axis: 'z', n: 8, exp: 5 });
  set(BODY, KIND.RUBBER);
  p.tube([[0, y + 0.078, -0.25, 0.036, 0.007], [0, y + 0.078, 0.25, 0.036, 0.007]], { axis: 'z', n: 4, exp: 6 });
  p.tube([[0, y + 0.03, -0.31, 0.042, 0.042], [0, y + 0.05, -0.375, 0.038, 0.038]], { axis: 'z', n: 6 });
  for (let i = 0; i < 4; i++) {
    const sx = legSide(i), z = legEnd(i) * HIP_Z;
    p.tube([[sx * 0.095, y + HIP_Y, z, 0.052, 0.052], [sx * 0.128, y + HIP_Y, z, 0.046, 0.046]], { axis: 'x', n: 8 });
  }
  if (kind === 'courier') {
    set(BODY);
    p.tube([[0, y + 0.155, -0.17, 0.092, 0.07], [0, y + 0.155, 0.17, 0.092, 0.07]], { axis: 'z', n: 8, exp: 7 });
  }
  // head: a box with a strip of glass across the front
  set(HEAD);
  p.tube([[0, y + 0.075, -0.37, 0.06, 0.045], [0, y + 0.075, -0.39, 0.078, 0.058], [0, y + 0.07, -0.47, 0.074, 0.054], [0, y + 0.068, -0.495, 0.055, 0.038]], { axis: 'z', n: 8, exp: 4 });
  set(HEAD, KIND.GLASS);
  p.panel(-0.052, 0.052, y + 0.052, y + 0.088, -0.4965);
  // tail: an aerial
  set(TAIL, KIND.RUBBER);
  p.tube([[0, y + 0.085, 0.335, 0.009, 0.009], [0, y + 0.14, 0.378, 0.008, 0.008], [0, y + 0.2, 0.42, 0.006, 0.006]], { n: 5 });
  // legs: a shell on the upper half, a bare strut below the knee, a rubber foot
  for (let i = 0; i < 4; i++) {
    const x = legSide(i) * HIP_X, z = legEnd(i) * HIP_Z, hy = y + HIP_Y;
    set(3 + i * 2);
    p.tube([[x, hy + 0.03, z, 0.03, 0.036], [x, hy - 0.02, z, 0.036, 0.047], [x, hy - 0.2, z, 0.028, 0.034], [x, hy - 0.245, z, 0.021, 0.025]], { n: 6, exp: 2.6 });
    set(4 + i * 2, KIND.RUBBER);
    p.ball([x, hy - LU, z], 0.03);
    p.tube([[x, hy - LU, z, 0.019, 0.021], [x, hy - LU - LL + 0.02, z, 0.014, 0.015]], { n: 5 });
    p.ball([x, hy - LU - LL, z], FOOT + 0.003);
  }
  const g = p.build();
  geos.set(kind, g);
  return g;
}

/** What a dog looks like. `rnd` gives numbers in [0, 1). */
export function randomDog(rnd, kind = 'pet') {
  return { shell: DOG_SHELLS[Math.floor(rnd() * DOG_SHELLS.length) % DOG_SHELLS.length], kind, size: 0.82 + rnd() * 0.3 };
}

export class Dog {
  constructor(look = null) {
    this.group = new THREE.Group();
    const bones = (this.bones = REST.map(() => new THREE.Bone()));
    REST.forEach((p, i) => {
      bones[i].position.fromArray(p);
      if (PARENT[i] >= 0) bones[PARENT[i]].add(bones[i]);
    });
    const mesh = (this.mesh = new THREE.SkinnedMesh(dogGeometry('pet'), shellMaterial(DOG_SHELLS[0])));
    mesh.add(bones[0]);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.4, 0), 0.8);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.phase = Math.random();
    this.seed = Math.random() * 100;
    this.s = { walk: 0, sit: 0 };
    if (look) this.setLook(look);
  }

  setLook(look) {
    this.look = look;
    this.mesh.geometry = dogGeometry(look.kind);
    this.mesh.material = shellMaterial(look.shell);
    this.group.scale.setScalar(look.size);
    this.s.walk = this.s.sit = 0;
  }

  /** o: { time, speed (m/s over the ground), sit: whether it should be sitting } */
  update(dt, o) {
    const b = this.bones, s = this.s;
    const size = this.group.scale.x;
    const speed = (o.speed || 0) / size;
    s.walk = damp(s.walk, speed > 0.1 ? 1 : 0, 9, dt);
    s.sit = damp(s.sit, o.sit && speed < 0.1 ? 1 : 0, 4, dt);
    // a trot: diagonal legs together, the stride as long as the speed asks for
    this.phase += (dt / CYCLE) * (speed > 0.1 ? clamp(speed / 1.2, 0.8, 1.6) : 0);
    const t = o.time + this.seed, w = s.walk, sit = s.sit;
    const stride = clamp(speed * CYCLE * DUTY, 0, 0.42) * w;
    const bob = Math.sin(this.phase * TAU * 2);
    const by = BODY_Y + 0.03 - 0.012 + 0.008 * bob * w - 0.15 * sit, bz = 0.05 * sit;
    const pitch = 0.5 * sit + 0.02 * bob * w;
    b[BODY].position.set(0, by, bz);
    b[BODY].rotation.set(pitch, 0, 0.03 * Math.sin(this.phase * TAU) * w);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      // where this foot is in its stride: on the ground going back, or lifted and coming forward
      const u = (this.phase + (i === 0 || i === 3 ? 0 : 0.5)) % 1;
      let fz = legEnd(i) * HIP_Z + 0.015 - (rear ? 0.13 * sit : 0), fy = FOOT;
      if (u < DUTY) fz += stride * (u / DUTY - 0.5);
      else {
        const k = (u - DUTY) / (1 - DUTY);
        fz += stride * 0.5 * Math.cos(Math.PI * k);
        fy += 0.07 * Math.sin(Math.PI * k) * w;
      }
      // the hip, carried by the body; then hip to foot as the body sees it
      const lz = legEnd(i) * HIP_Z;
      const hy = by + HIP_Y * cp - lz * sp, hz = bz + HIP_Y * sp + lz * cp;
      const dy = fy - hy, dz = fz - hz;
      const y = dy * cp + dz * sp, z = -dy * sp + dz * cp;
      const l = clamp(Math.hypot(y, z), Math.abs(LU - LL) + 0.02, LU + LL - 0.004);
      const hip = Math.acos(clamp((LU * LU + l * l - LL * LL) / (2 * LU * l), -1, 1));
      const knee = Math.acos(clamp((LU * LU + LL * LL - l * l) / (2 * LU * LL), -1, 1));
      // knees point backward: the upper leg hangs behind the line from hip to foot
      b[3 + i * 2].rotation.x = Math.atan2(-z, -y) - hip;
      b[4 + i * 2].rotation.x = Math.PI - knee;
    }
    // looks up when it sits, looks about when it has nothing to do; the tail says the rest
    b[HEAD].rotation.set(-0.3 * sit - 0.03 * w + 0.05 * Math.sin(t * 0.9) * (1 - w), 0.35 * Math.sin(t * 0.43) * (1 - w), 0);
    b[TAIL].rotation.set(0.15 * sit, Math.sin(t * (7 + 5 * sit)) * (0.18 + 0.45 * sit + 0.12 * w), 0);
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.skeleton.dispose();
  }
}
