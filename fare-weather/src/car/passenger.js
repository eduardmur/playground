// A rider sitting in the cab: the same robot that was standing at the kerb,
// folded into the seat, with a belt across it and whatever it is carrying.
import * as THREE from 'three';
import { Robot } from '../robots/robot.js';
import { normalizeLook } from '../robots/looks.js';
import { trunkPoint, trunkWeights } from '../robots/frame.js';
import { easeOut } from '../core/utils.js';

// Where a body goes in a seat, in the seat anchor's space (cabin.js): the hip joint, and the floor under the feet.
const SEAT = { hipY: 0.625, hipZ: 0.285, floorY: 0.312 };
const FIT = 0.96; // the cab is low; nobody notices four per cent

const BELT = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.016, 0.016, 0.018), roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
const CAKE = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.82, 0.8, 0.74), roughness: 0.5 });
const BOARD = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.5, 0.42, 0.3), roughness: 0.8 });

const belts = new Map();
/**
 * A seat belt as a ribbon lying on the trunk and skinned to it, so it moves with the body:
 * over the shoulder nearer the door, across the chest to the far hip, and across the lap.
 */
function beltGeometry(frame, side) {
  const key = frame + side;
  if (belts.has(key)) return belts.get(key);
  const pos = [], si = [], sw = [], idx = [];
  const R = 0.15, HW = 0.023, OFF = 0.007;
  const strip = (path) => {
    const base = pos.length / 3;
    path.forEach(([a, y], j) => {
      // across the ribbon: at right angles to the way it runs, measured on the unrolled surface
      const p = path[Math.max(0, j - 1)], q = path[Math.min(path.length - 1, j + 1)];
      const ds = (q[0] - p[0]) * R, dy = q[1] - p[1];
      const l = Math.hypot(ds, dy) || 1;
      const nx = dy / l, ny = -ds / l;
      for (const e of [-1, 1]) {
        const yy = y + e * HW * ny;
        pos.push(...trunkPoint(frame, a + (e * HW * nx) / R, yy, OFF));
        const w = trunkWeights(yy);
        si.push(w[0], w[2] ?? 0, 0, 0);
        sw.push(w[1], w[3] ?? 0, 0, 0);
      }
      if (j) {
        const v = base + j * 2;
        idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
      }
    });
  };
  const s = side;
  const cross = [[s * 2.15, 1.42], [s * 1.75, 1.452], [s * 1.25, 1.458], [s * 0.95, 1.436]];
  for (let j = 1; j <= 12; j++) {
    const t = j / 12;
    cross.push([s * (0.95 - 2.0 * t), 1.436 - 0.406 * t]);
  }
  strip(cross);
  const lap = [];
  for (let j = 0; j <= 10; j++) lap.push([s * (1.5 - 2.75 * (j / 10)), 1.034]);
  strip(lap);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  belts.set(key, g);
  return g;
}

let cakeGeo = null;
function cake() {
  cakeGeo ||= [
    ...[[0.15, 0.09, 0], [0.115, 0.08, 0.09], [0.08, 0.075, 0.17]].map(([r, h, y]) => new THREE.CylinderGeometry(r, r, h, 24).translate(0, y + h / 2 + 0.006, 0)),
    new THREE.CylinderGeometry(0.18, 0.18, 0.012, 24),
  ];
  const g = new THREE.Group();
  cakeGeo.forEach((geo, i) => {
    const m = new THREE.Mesh(geo, i < 3 ? CAKE : BOARD);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  });
  return g;
}

export class Passenger {
  /** look: a rider from data/riders.js or a full look; side: +1 if their door is on the car's right. */
  constructor(look, side = 1) {
    this.look = look = normalizeLook(look);
    this.side = side;
    this.group = new THREE.Group();
    const body = (this.body = new Robot(look));
    const sc = body.group.scale;
    sc.set(sc.x * FIT, Math.min(1, sc.y) * FIT, sc.z * FIT);
    body.mesh.frustumCulled = false;
    this.group.add(body.group);

    const belt = (this.belt = new THREE.SkinnedMesh(beltGeometry(look.frame, side), BELT));
    belt.bind(body.mesh.skeleton, body.mesh.bindMatrix);
    belt.frustumCulled = false;
    belt.visible = false;
    body.group.add(belt);

    this.cake = !!look.cake;
    this.calling = false; // set by the ride script for as long as a call lasts: a hand at the ear, and down again after
    if (this.cake) {
      const c = cake();
      c.position.set(0, SEAT.hipY / sc.y + 0.092, SEAT.hipZ / sc.x - 0.275);
      body.group.add(c);
    }

    this.group.visible = false;
    this.state = 'out'; // out | entering | in | leaving
    this.t = 0;
    this.seed = body.seed;
    this.onDone = null;
  }

  enter(onDone) {
    this.state = 'entering';
    this.t = 0;
    this.group.visible = true;
    this.belt.visible = false;
    this.onDone = onDone || null;
  }

  /** Already in the seat and buckled up, with no getting in: for a ride that is under way when the game opens. */
  settle() {
    this.state = 'in';
    this.group.visible = true;
    this.belt.visible = true;
  }

  leave(onDone) {
    this.state = 'leaving';
    this.t = 0;
    this.belt.visible = false;
    this.onDone = onDone || null;
  }

  buckle() {
    this.belt.visible = true;
  }

  /** Free what this figure put on the graphics card once they have got out. */
  dispose() {
    this.group.removeFromParent();
    this.body.dispose();
  }

  /**
   * talk: 0..1 while this rider is speaking; turn: where they are looking
   * (-1 out of their window .. +1 toward the middle of the car); lean, pitch: the car's motion.
   */
  update(dt, time, talk, turn, lean, pitch) {
    const g = this.group;
    let e = 0, hop = 0;
    if (this.state === 'entering' || this.state === 'leaving') {
      this.t += dt / (this.state === 'entering' ? 1.0 : 0.75);
      const k = Math.min(1, this.t);
      e = this.state === 'entering' ? 1 - easeOut(k) : k * k;
      hop = Math.sin(k * Math.PI) * 0.03;
      if (k >= 1) {
        const leaving = this.state === 'leaving';
        this.state = leaving ? 'out' : 'in';
        if (leaving) g.visible = false;
        const cb = this.onDone;
        this.onDone = null;
        cb?.();
      }
    }
    if (!g.visible) return;
    // swung in from the door: a little high, still half turned toward the opening
    g.position.set(this.side * e * 0.62, e * 0.05 + hop, e * -0.05);
    g.rotation.y = -this.side * e * 0.55;
    this.body.sit(dt, { time, enter: e, side: this.side, talk, turn, lean, pitch, hold: this.cake ? 'cake' : this.calling ? 'call' : null }, SEAT);
  }
}
