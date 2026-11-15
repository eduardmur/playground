// A robot: the skinned frame from robots/frame.js on its skeleton, and the few
// things the game asks of it: stand about, walk, flag the cab down, duck into
// it, and sit. They are plain machines, one much like the next.
//
// Conventions: the body faces -Z with its right arm on +X. Turning a bone about
// X by a positive angle swings whatever hangs from it forward, so a thigh or an
// upper arm swings forward with +x, a knee bends with -x, an elbow with +x.
import * as THREE from 'three';
import { BONES, B, buildFrame } from './frame.js';
import { env, patchMaterial } from '../world/shared.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const smooth = (t) => t * t * (3 - 2 * t);

/** Each bone's rest position relative to its parent. */
const REST = BONES.map(([, parent, p]) => (parent < 0 ? p : [p[0] - BONES[parent][2][0], p[1] - BONES[parent][2][1], p[2] - BONES[parent][2][2]]));
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const LT = len(REST[B.shinR]), LS = len(REST[B.footR]); // thigh, shin
const L1 = len(REST[B.foreR]), L2 = len(REST[B.handR]); // upper arm, forearm
const SOLE = 0.085, TOE = 0.2, HEEL = 0.075; // the foot, from the ankle

// The upper arm does not hang quite straight down in the rest pose; this is the small turn that says so.
const ARM_TILT = Math.atan2(REST[B.foreR][0], -REST[B.foreR][1]);
const QR = [new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ARM_TILT), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ARM_TILT)];
const FORE = [new THREE.Vector3(...REST[B.handR]).normalize(), new THREE.Vector3(...REST[B.handL]).normalize()];

/** A smooth curve through keys [[u, value], ...] that repeats every 1. The first key must be at u = 0. */
function periodic(keys) {
  const n = keys.length;
  const U = keys.map((k) => k[0]), V = keys.map((k) => k[1]);
  const M = keys.map((_, i) => {
    const p = (i + n - 1) % n, q = (i + 1) % n;
    return (V[q] - V[p]) / ((i === n - 1 ? U[q] + 1 : U[q]) - (i === 0 ? U[p] - 1 : U[p]));
  });
  return (u) => {
    u -= Math.floor(u);
    let i = n - 1;
    while (i > 0 && U[i] > u) i--;
    const j = (i + 1) % n;
    const h = (j === 0 ? 1 : U[j]) - U[i];
    const t = (u - U[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * V[i] + (t3 - 2 * t2 + t) * h * M[i] + (-2 * t3 + 3 * t2) * V[j] + (t3 - t2) * h * M[j];
  };
}

// One leg through a stride, starting as its heel lands. The other leg is half a stride behind.
const THIGH = periodic([[0, 0.9], [0.1, 0.72], [0.3, 0.15], [0.5, -0.7], [0.56, -0.8], [0.62, -0.6], [0.75, 0.3], [0.88, 1.0], [0.95, 1.0]]);
const KNEE = periodic([[0, 0.08], [0.12, 0.3], [0.38, 0.1], [0.5, 0.25], [0.6, 0.7], [0.72, 1.08], [0.84, 0.6], [0.95, 0.06]]);
const FOOT = periodic([[0, 0.3], [0.08, 0], [0.4, 0], [0.52, -0.3], [0.6, -0.75], [0.72, -0.6], [0.85, -0.05], [0.95, 0.3]]);

// ---------------------------------------------------------------- materials

const BLANK = new THREE.MeshStandardMaterial({ color: 0x808080 });
const DARK = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.012, 0.012, 0.014), roughness: 0.5, metalness: 0.1 });
const METAL = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.3, 0.3, 0.32), roughness: 0.35, metalness: 0.8 });

// What each surface is made of comes with the geometry (frame.js KIND): a satin shell in the
// robot's one colour, black glass, dark rubber. Nothing else is drawn on them.
const HOOKS = {
  vertexPars: 'attribute float aKind; varying float vKind;',
  vertex: 'vKind = aKind;',
  fragPars: /* glsl */ `
    uniform vec3 uShell; uniform float uWet;
    varying float vKind;
    float gRough;
  `,
  fragColor: /* glsl */ `
    float kd = floor(vKind + 0.5);
    if (kd < 0.5) { diffuseColor.rgb = uShell; gRough = mix(0.42, 0.26, uWet); }
    else if (kd < 1.5) { diffuseColor.rgb = vec3(0.01, 0.011, 0.014); gRough = 0.07; }
    else { diffuseColor.rgb = vec3(0.014, 0.014, 0.016); gRough = mix(0.84, 0.5, uWet); }
  `,
  fragSurface: 'roughnessFactor = gRough; metalnessFactor = 0.0;',
};

const shells = new Map();
/** The material for anything built with an `aKind` attribute, robot or dog, in a shell colour. */
export function shellMaterial(c) {
  const key = c.join();
  let m = shells.get(key);
  if (!m) {
    m = patchMaterial(new THREE.MeshStandardMaterial(), HOOKS, { uShell: { value: new THREE.Color(c[0], c[1], c[2]) }, uWet: env.uWet }, null, 'robot');
    shells.set(key, m);
  }
  return m;
}

const canopies = new Map();
function canopyMaterial(c) {
  const key = c.join();
  let m = canopies.get(key);
  if (!m) canopies.set(key, (m = new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0], c[1], c[2]), roughness: 0.6, side: THREE.DoubleSide })));
  return m;
}

let brolly = null;
/** An umbrella: canopy, shaft and handle, with its origin at the grip. */
function umbrellaGeometry() {
  if (brolly) return brolly;
  const pts = [];
  for (let i = 0; i <= 5; i++) {
    const r = (i / 5) * 0.53;
    pts.push(new THREE.Vector2(Math.max(0.001, r), 0.2 * (1 - Math.pow(r / 0.53, 1.9))));
  }
  const canopy = new THREE.LatheGeometry(pts.reverse(), 10).translate(0, 0.78, 0);
  const shaft = new THREE.CylinderGeometry(0.006, 0.006, 1.0, 5).translate(0, 0.48, 0);
  const handle = new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6).translate(0, -0.02, 0);
  return (brolly = { canopy, shaft, handle });
}

// ---------------------------------------------------------------- scratch

const _chain = new THREE.Matrix4(), _basis = new THREE.Matrix4();
const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _a = new THREE.Vector3(), _p = new THREE.Vector3();

export class Robot {
  constructor(look = null) {
    this.group = new THREE.Group();
    const bones = (this.bones = BONES.map(([name]) => {
      const b = new THREE.Bone();
      b.name = name;
      return b;
    }));
    BONES.forEach(([, parent], i) => {
      bones[i].position.fromArray(REST[i]);
      if (parent >= 0) bones[parent].add(bones[i]);
    });
    const mesh = (this.mesh = new THREE.SkinnedMesh(buildFrame('a'), BLANK));
    mesh.add(bones[0]);
    mesh.bind(new THREE.Skeleton(bones));
    // skinned meshes otherwise work their bounds out vertex by vertex; any pose fits inside this
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    // heads a touch larger than life read better through a windscreen
    bones[B.head].scale.setScalar(1.05);
    this.umbrella = null;
    this.phase = Math.random() * TAU;
    this.seed = Math.random() * 100;
    this.rate = 4.9;
    this.s = { walk: 0, wave: 0, brolly: 0, yaw: 0, nod: 0, call: 0 };
    if (look) this.setLook(look);
  }

  /** Become another robot: same skeleton, another frame, shade and build. */
  setLook(look) {
    this.look = look;
    this.mesh.geometry = buildFrame(look.frame);
    this.mesh.material = shellMaterial(look.shell);
    this.group.scale.set(look.build[0], look.build[1], look.build[0]);
    this.rate = 4.9 / look.build[1];
    if (this.umbrella) {
      this.umbrella.children[0].material = canopyMaterial(look.brolly);
      this.umbrella.visible = false;
    }
    const s = this.s;
    s.walk = s.wave = s.brolly = s.yaw = s.nod = s.call = 0;
  }

  _umbrella() {
    if (!this.umbrella) {
      const g = umbrellaGeometry();
      const u = (this.umbrella = new THREE.Group());
      const canopy = new THREE.Mesh(g.canopy, canopyMaterial(this.look.brolly));
      canopy.castShadow = true;
      u.add(canopy, new THREE.Mesh(g.shaft, METAL), new THREE.Mesh(g.handle, DARK));
      // in the right fist, leaning back over the head
      u.position.set(0.176, -0.055, -0.335);
      u.rotation.set(0.27, 0, 0.15);
      this.bones[B.chest].add(u);
    }
    return this.umbrella;
  }

  // ------------------------------------------------------------ arms

  /** After the trunk is posed: the matrix that takes a point in the character's own space into the chest's. */
  _chest() {
    const b = this.bones;
    b[B.root].updateMatrix();
    b[B.spine].updateMatrix();
    b[B.chest].updateMatrix();
    return _chain.multiplyMatrices(b[B.root].matrix, b[B.spine].matrix).multiply(b[B.chest].matrix).invert();
  }

  /**
   * Put a wrist somewhere: arm i (0 right, 1 left), target t and elbow direction `pole`, both in the
   * chest's space. Blended over whatever the arm was doing by `weight`.
   */
  _reach(i, t, pole, weight) {
    const b = this.bones;
    const arm = b[i ? B.armL : B.armR], fore = b[i ? B.foreL : B.foreR];
    _t.copy(t).sub(arm.position);
    const d0 = _t.length() || 1e-6;
    const d = clamp(d0, Math.abs(L1 - L2) + 0.03, L1 + L2 - 0.003);
    _d.copy(_t).divideScalar(d0);
    _t.copy(_d).multiplyScalar(d);
    // the elbow sits off the line from shoulder to wrist, on the side the pole points to
    const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const off = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    _n.copy(pole).addScaledVector(_d, -pole.dot(_d));
    if (_n.lengthSq() < 1e-8) _n.set(0, 0, 1).addScaledVector(_d, -_d.z);
    _n.normalize();
    _e.copy(_d).multiplyScalar(along).addScaledVector(_n, off);
    // upper arm: its length lies along -Y and the elbow hinges about X
    _x.crossVectors(_n, _d);
    _y.copy(_e).normalize().negate();
    _z.crossVectors(_x, _y);
    _q1.setFromRotationMatrix(_basis.makeBasis(_x, _y, _z)).multiply(QR[i]);
    // forearm: whatever takes it from its rest direction to the wrist, as the upper arm sees it
    _f.copy(_t).sub(_e).applyQuaternion(_q2.copy(_q1).invert()).normalize();
    _q2.setFromUnitVectors(FORE[i], _f);
    if (weight > 0.999) {
      arm.quaternion.copy(_q1);
      fore.quaternion.copy(_q2);
    } else {
      arm.quaternion.slerp(_q1, weight);
      fore.quaternion.slerp(_q2, weight);
    }
  }

  // ------------------------------------------------------------ on their feet

  /**
   * o: { time, speed (m/s over the ground), wave, brolly (what they are doing with their hands),
   *      sink (0..1, ducking into a car), gaze (where to look, radians from straight ahead) }
   */
  stand(dt, o) {
    const b = this.bones, s = this.s, L = this.look;
    const speed = o.speed || 0;
    const sink = o.sink || 0;
    s.walk = damp(s.walk, speed > 0.1 ? 1 : 0, 8, dt);
    s.wave = damp(s.wave, o.wave ? 1 : 0, 6, dt);
    s.brolly = damp(s.brolly, o.brolly ? 1 : 0, 5, dt);
    this.phase += dt * speed * this.rate;
    const t = o.time + this.seed;
    const w = s.walk, u = this.phase / TAU;
    const slim = L.frame === 'b' ? 1 : 0;
    const A = 0.43;
    const lean = -0.03 * w - 0.5 * sink;

    // legs, each in the plane it swings in: thigh from the vertical, bend of the knee, foot from level
    let reach = 0;
    const prop = this.seed % 2 < 1 ? 1 : -1; // which leg takes the weight when standing about
    for (let i = 0; i < 2; i++) {
      const ui = u + i * 0.5, side = i ? -1 : 1;
      const easy = side !== prop;
      // a machine never quite locks its knees
      let a = w * (A * THIGH(ui) + 0.05) + (1 - w) * (easy ? 0.07 : 0.01);
      let k = w * (KNEE(ui) * 0.94 + 0.12) + (1 - w) * (easy ? 0.16 : 0.05);
      let p = w * FOOT(ui) * 0.85;
      if (sink > 0) {
        a = lerp(a, 0.85, sink);
        k = lerp(k, 1.45, sink);
        p = lerp(p, 0, sink);
      }
      // how far below the hip this leg's lowest point is: the one that reaches furthest is standing on the ground
      reach = Math.max(reach, LT * Math.cos(a) + LS * Math.cos(a - k) + SOLE * Math.cos(p) + (p < 0 ? -TOE : HEEL) * Math.sin(p));
      b[i ? B.thighL : B.thighR].rotation.set(a - lean, 0, side * 0.028);
      b[i ? B.shinL : B.shinR].rotation.set(-k, 0, 0);
      b[i ? B.footL : B.footR].rotation.set(p - (a - k), 0, 0);
    }

    // hips: carried over the standing leg, turning a little with each step
    const c = Math.cos(TAU * u), sn = Math.sin(TAU * (u - 0.05));
    const twist = 0.07 * w * c;
    const roll = (0.022 + 0.012 * slim) * w * sn + (1 - w) * (1 - sink) * prop * 0.022;
    const hum = Math.sin(t * 1.3);
    b[B.root].position.set(0.014 * w * sn + (1 - w) * (1 - sink) * prop * 0.012, reach + 0.01, 0);
    b[B.root].rotation.set(lean, twist, roll);
    b[B.spine].rotation.set(-0.15 * sink + 0.006 * hum * (1 - w), -twist * 0.7, -roll * 0.6);
    b[B.chest].rotation.set(-0.015 * w - 0.12 * sink, -twist, -roll * 0.6);
    // the head keeps level, and looks about when there is nothing else to do: in steps, the way a camera pans
    const scan = Math.sin(t * 0.21) + 0.4 * Math.sin(t * 0.67 + 1.7);
    const idle = (1 - w) * 0.34 * Math.round(scan * 2) * 0.5;
    s.yaw = damp(s.yaw, o.gaze ?? idle, 3.5, dt);
    b[B.neck].rotation.set(0.03 * w - 0.2 * sink, twist * 0.35 + s.yaw * 0.4, 0);
    b[B.head].rotation.set(0.02 - 0.1 * sink, twist * 0.35 + s.yaw * 0.6, 0);

    // arms swing against the legs, elbows held a little bent
    const amp = 0.25;
    for (let i = 0; i < 2; i++) {
      const side = i ? -1 : 1;
      const f = -side * c; // 1 when this arm is furthest forward
      b[i ? B.armL : B.armR].rotation.set(w * (amp * f + 0.02) + (1 - w) * 0.02 + 0.5 * sink, 0, side * 0.075);
      b[i ? B.foreL : B.foreR].rotation.set(0.16 + w * (0.16 + 0.16 * Math.max(0, f)) + 0.5 * sink, 0, 0);
      b[i ? B.handL : B.handR].rotation.set(0.1, 0, -side * 0.08);
    }
    // right hand: an umbrella
    if (s.brolly > 0.01) {
      this._reach(0, _a.set(0.172, -0.085, -0.265), _p.set(0.35, -1, 0.4), smooth(s.brolly));
    }
    if (s.brolly > 0.01 || this.umbrella) {
      const um = this._umbrella();
      um.visible = s.brolly > 0.03;
      const k = 0.1 + 0.9 * smooth(s.brolly);
      um.children[0].scale.set(k, 0.55 + 0.45 * k, k);
    }
    // left hand: a wave at the cab
    if (s.wave > 0.01) {
      const ph = t * 7.5;
      this._reach(1, _a.set(-0.35 - 0.08 * Math.sin(ph), 0.54 + 0.02 * Math.cos(ph * 2), -0.14), _p.set(-1, -0.45, 0.25), smooth(s.wave));
      b[B.handL].rotation.set(0, 0, 0.25 * Math.sin(ph - 0.6) * s.wave);
    }
  }

  // ------------------------------------------------------------ in a seat

  /**
   * The group's origin is the seat's: its floor is at y = seat.floorY, the hip joint belongs at (0, seat.hipY, seat.hipZ).
   * o: { time, enter (0 settled .. 1 still half out of the door), side (+1: the door is on +X),
   *      talk (0..1 while speaking), turn (-1 out of the window .. +1 toward the other seat), lean, pitch (the car's motion),
   *      hold: null | 'call' (for as long as a call lasts) | 'cake' }
   */
  sit(dt, o, seat) {
    const b = this.bones, s = this.s;
    const sx = this.group.scale.x, sy = this.group.scale.y;
    const e = o.enter || 0, side = o.side;
    const t = o.time + this.seed;
    const hum = Math.sin(t * 1.25);
    const lean = lerp(0.44, -0.22, e) + o.pitch;
    const hipY = (seat.hipY + 0.07 * e) / sy, hipZ = seat.hipZ / sx;
    b[B.root].position.set(0, hipY + 0.01, hipZ);
    b[B.root].rotation.set(lean, 0, 0);

    // thighs along the cushion, shins down into the footwell until the soles find the floor
    const a = lerp(1.74, 1.36, e); // knees a little higher than the hips, as in any low car
    const drop = (seat.hipY - seat.floorY) / sy - SOLE;
    const k = lerp(a - Math.acos(clamp((drop - LT * Math.cos(a)) / LS, -1, 1)), 1.3, e);
    for (let i = 0; i < 2; i++) {
      const out = i ? -1 : 1;
      b[i ? B.thighL : B.thighR].rotation.set(a - lean, 0, out * 0.075);
      b[i ? B.shinL : B.shinR].rotation.set(-k, 0, 0);
      b[i ? B.footL : B.footR].rotation.set(0.1 + 0.25 * e - (a - k), 0, 0);
    }

    // upper body: rides the car's motion
    const sway = o.lean;
    b[B.spine].rotation.set(-0.05 + 0.005 * hum, 0, sway * 0.6);
    b[B.chest].rotation.set(-0.07 - 0.1 * e, 0, sway * 0.6);
    // the head wanders, turns to whoever is talking, nods along with its own voice
    s.call = damp(s.call, o.hold === 'call' ? 1 : 0, 3.2, dt);
    const call = smooth(s.call); // 0..1: how far the hand is on its way to the ear, or back from it
    const busy = 1 - 0.7 * call;
    const idle = (Math.sin(t * 0.23) * 0.12 + Math.sin(t * 0.61 + 1.3) * 0.05) * busy;
    s.yaw = damp(s.yaw, o.turn * 0.55 * side * busy + idle, 2.2, dt);
    s.nod = damp(s.nod, o.talk, 10, dt);
    const yaw = s.yaw + Math.sin(t * 7.3) * 0.03 * s.nod;
    const nod = Math.sin(t * 5.1) * 0.04 * s.nod + Math.sin(t * 0.4) * 0.02;
    const tilt = -side * 0.09 * call;
    b[B.neck].rotation.set(-0.17 - 0.22 * e + nod * 0.5, yaw * 0.45, -sway * 0.5 + tilt * 0.4);
    b[B.head].rotation.set(-0.15 + nod, yaw * 0.55, -sway * 0.3 + tilt);

    // hands: on the thighs unless they are busy
    const m = this._chest();
    const talk = s.nod;
    for (let i = 0; i < 2; i++) {
      const out = i ? -1 : 1; // which side of the body this arm is on
      const door = out === side; // the arm nearer the door
      const hand = b[i ? B.handL : B.handR];
      // on top of the thigh, a little short of the knee
      const along = 0.6 * LT;
      let x = out * (0.118 + along * 0.075), y = hipY - Math.cos(a) * along + 0.105, z = hipZ - Math.sin(a) * along + 0.02;
      let px = out * 0.55, py = -0.5, pz = 1;
      hand.rotation.set(0.2, 0, 0);
      if (o.hold === 'cake') {
        x = out * 0.215;
        y += 0.045;
        z -= 0.05;
        px = out;
        py = -0.4;
        pz = 0.5;
      } else if (!door && talk > 0.02) {
        // the free hand lifts off the knee to make a point
        y += talk * (0.07 + 0.03 * Math.sin(t * 3.1));
        z -= talk * 0.04;
        x -= out * talk * 0.03 * Math.sin(t * 2.3);
      }
      this._reach(i, _a.set(x, y, z).applyMatrix4(m), _p.set(px, py, pz).transformDirection(m), 1);
      if (door && call > 0.001) {
        // taking a call: the hand nearer the door goes to the side of the head, where the hearing is, and comes
        // back to the knee when the call is over. Aimed from the chest, not the seat
        this._reach(i, _a.set(out * 0.1, 0.2, -0.12), _p.set(out * 0.2, -1, 0.1), call);
        hand.rotation.set(lerp(0.2, -0.15, call), 0, out * 0.1 * call);
      }
    }
  }

  /** Let go of what only this figure owns. Frames and materials are shared and stay. */
  dispose() {
    this.group.removeFromParent();
    this.mesh.skeleton.dispose();
  }
}
