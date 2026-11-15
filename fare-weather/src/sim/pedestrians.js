// Who is out on the pavements: robots, some with a dog at heel, and dogs on
// their own carrying parcels. They walk the edges of their block, wait at the
// corners for the lights, and cross on the crosswalks; cars count them and they
// count the cars. Whatever stands on the pavement (lamp posts, trees, benches,
// bus shelters) they step round, and they never stop where one of them is.
// Riders are the same figures, steered by the ride script.
import * as THREE from 'three';
import { SIDEWALK_W, CURB_H, SIG } from '../world/city.js';
import { clamp, damp, dampAngle, angleDiff, mulberry32 } from '../core/utils.js';
import { Robot } from '../robots/robot.js';
import { Dog, randomDog } from '../robots/dog.js';
import { randomLook } from '../robots/looks.js';

const CAST = 40; // how many different robots there are to meet
const COURIERS = 0.13; // the share of the crowd that is a dog out on an errand
const PETS = 0.2; // and the share of robots with a dog at heel
const SHOW = 135; // metres: further off than this nobody is drawn
const SHADOW = 55; // and only those this close cast shadows
const BODY = 0.3, DOG = 0.2; // the room a robot, and a dog, takes up around its middle
const CELL = 4; // metres: the grid the things on the pavement are filed in
const cell = (x, z) => (Math.floor(x / CELL) + 2048) * 4096 + Math.floor(z / CELL) + 2048;

// corner k of a block and which way the two pavement edges leave it: [clockwise, counter-clockwise] headings
const EDGE_OUT = [[1, 2], [2, 3], [3, 0], [0, 1]];
// which two ways you can step off the block at each corner
const CROSS_OUT = [[0, 3], [0, 1], [2, 1], [2, 3]];
const HX = [0, 1, 0, -1], HZ = [-1, 0, 1, 0];

let pedId = 0;

class Ped {
  constructor(rnd) {
    this.id = ++pedId;
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.speed = 1.15 + rnd() * 0.5;
    this.v = 0;
    this.kind = 'robot'; // or 'dog': one out on its own
    this.look = null; // what they look like: robots/looks.js, or a dog's look
    this.body = null; // the figure drawn for them while they are near enough to see
    this.gy = CURB_H; // the ground under their feet
    this.brolly = rnd() < 0.7; // owns an umbrella
    this.pet = null; // a dog at heel: { x, z, yaw, v, still, look, body }
    this.still = 0; // seconds since they last moved
    this.inset = 1.85 + rnd() * 1.15; // in from the kerb: past the row of trees and lamp posts, short of the benches by the wall
    this.nx = 0; // which way is in from the kerb on the pavement being walked (0, 0 off the pavements)
    this.nz = 0;
    this.kerb = 0; // and where that kerb is
    this.far = 0; // how far the last look said it still was to go
    this.farT = 0;
    this.ghost = 0; // seconds left of walking straight through things, for someone who got stuck
    this.mode = 'edge';
    this.tx = 0;
    this.tz = 0;
    this.block = null;
    this.corner = 0;
    this.heading = 0;
    this.cross = null; // { node, leg }
    this.wait = 0;
    this.wave = 0;
    this.gaze = null; // where the head is turned, radians from straight ahead; null lets it wander
    this.sink = 0; // 0..1 ducking into the car
    this.visible = true;
    this.rider = false;
    this.onArrive = null;
    this.dead = false;
  }
}

export class Pedestrians {
  constructor(city, { target = 54, solid = [] } = {}) {
    this.city = city;
    // what stands on the pavements: { x, z, r }, filed by the square of ground it is in
    this.solid = new Map();
    for (const o of solid) {
      const k = cell(o.x, o.z);
      if (!this.solid.has(k)) this.solid.set(k, []);
      this.solid.get(k).push(o);
    }
    this.target = target;
    this.peds = [];
    this.list = this.peds;
    this.rnd = Math.random;
    this.spawnT = 0;
    this.group = new THREE.Group();
    this.time = 0;
    this.spare = []; // figures nobody is wearing
    this.spareDogs = [];
    const rnd = mulberry32(20261114);
    this.cast = Array.from({ length: CAST }, () => randomLook(rnd));
  }

  // ------------------------------------------------------------ geometry of the pavements

  cornerPoint(b, k, inset) {
    const d = inset;
    switch (k) {
      case 0: return [b.x0 + d, b.z0 + d];
      case 1: return [b.x1 - d, b.z0 + d];
      case 2: return [b.x1 - d, b.z1 - d];
      default: return [b.x0 + d, b.z1 - d];
    }
  }

  /** The junction at a block corner and where the block sits relative to it. */
  cornerNode(b, k) {
    const N = this.city.nodes;
    switch (k) {
      case 0: return { node: N[b.i][b.j], qx: 1, qz: 1 };
      case 1: return { node: N[b.i + 1][b.j], qx: -1, qz: 1 };
      case 2: return { node: N[b.i + 1][b.j + 1], qx: -1, qz: -1 };
      default: return { node: N[b.i][b.j + 1], qx: 1, qz: -1 };
    }
  }

  neighbour(b, heading) {
    const i = b.i + HX[heading], j = b.j + HZ[heading];
    if (i < 0 || j < 0 || i >= this.city.NX || j >= this.city.NZ) return null;
    return this.city.blockGrid[i][j];
  }

  /** The corner you reach by walking along an edge from corner k in a heading. */
  edgeEnd(k, heading) {
    return EDGE_OUT[k][0] === heading ? (k + 1) % 4 : (k + 3) % 4;
  }

  /** Stepping off corner k in a heading lands you on this corner of the next block. */
  crossEnd(k, heading) {
    // north/south crossings keep the east-west side; east/west crossings keep the north-south side
    if (heading === 0) return k === 0 ? 3 : 2;
    if (heading === 2) return k === 3 ? 0 : 1;
    if (heading === 1) return k === 1 ? 0 : 3;
    return k === 0 ? 1 : 2;
  }

  // ------------------------------------------------------------ what is in the way

  /** Call fn for everything standing within a few metres of (x, z). */
  _around(x, z, fn) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    for (let a = i - 1; a <= i + 1; a++) {
      for (let b = j - 1; b <= j + 1; b++) {
        const list = this.solid.get((a + 2048) * 4096 + b + 2048);
        if (list) for (const o of list) fn(o);
      }
    }
  }

  /** The nearest point to (x, z) where something `r` across can stand without being inside a lamp post. */
  clear(x, z, r = BODY) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      this._around(x, z, (o) => {
        const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), need = o.r + r + 0.03;
        if (d >= need) return;
        if (d < 1e-4) x += need;
        else {
          x = o.x + (dx / d) * need;
          z = o.z + (dz / d) * need;
        }
        moved = true;
      });
      if (!moved) break;
    }
    return [x, z];
  }

  /**
   * How fast to step sideways (metres a second, positive to the left of the way they are going) to pass whatever
   * stands ahead. Each thing asks for the room it still needs, more urgently the nearer it is; on a pavement
   * the way round is the one that stays between the kerb and the wall.
   */
  _dodge(p, ux, uz, dist) {
    const r = p.kind === 'dog' ? DOG : BODY;
    const look = Math.min(dist, 1.3 + p.speed);
    const lx = -uz, lz = ux; // to the left
    const paved = p.nx || p.nz;
    const inset = paved ? (p.nx ? (p.x - p.kerb) * p.nx : (p.z - p.kerb) * p.nz) : 0;
    const din = lx * p.nx + lz * p.nz; // a step to the left is this much further in from the kerb
    let push = 0;
    this._around(p.x, p.z, (o) => {
      const ox = o.x - p.x, oz = o.z - p.z;
      const ahead = ox * ux + oz * uz;
      if (ahead < -0.25 || ahead > look + o.r) return;
      const lat = ox * lx + oz * lz, room = o.r + r + 0.08;
      if (Math.abs(lat) >= room) return;
      // round the side they are already on; dead ahead, one way or the other for good
      let dir = lat > 0.03 ? -1 : lat < -0.03 ? 1 : p.id & 1 ? 1 : -1;
      let need = room - Math.abs(lat);
      if (paved) {
        const there = inset + dir * need * din;
        if (there < 0.6 || there > SIDEWALK_W - 0.55) {
          // that way leads off the kerb or into the wall: cross over and pass on the other side
          const other = inset - dir * (room + Math.abs(lat)) * din;
          if (other >= 0.6 && other <= SIDEWALK_W - 0.55) {
            dir = -dir;
            need = room + Math.abs(lat);
          }
        }
      }
      push += dir * need * (1 + 3 * (1 - clamp(ahead / (look + o.r), 0, 1)));
    });
    return clamp(push * 1.6, -1.1, 1.1);
  }

  // ------------------------------------------------------------ choosing where to go

  _go(p, mode, toBlock, toCorner, heading) {
    const [x, z] = this.clear(...this.cornerPoint(toBlock, toCorner, p.inset), p.kind === 'dog' ? DOG : BODY);
    p.mode = mode;
    p.tx = x;
    p.tz = z;
    p.nextBlock = toBlock;
    p.nextCorner = toCorner;
    p.heading = heading;
    p.far = p.farT = 0;
    p.nx = p.nz = 0;
    if (mode === 'edge') {
      // which pavement this is: the kerb it runs along, and which way is in from it
      if (heading % 2 === 0) {
        const west = toCorner === 0 || toCorner === 3;
        p.nx = west ? 1 : -1;
        p.kerb = west ? toBlock.x0 : toBlock.x1;
      } else {
        const north = toCorner === 0 || toCorner === 1;
        p.nz = north ? 1 : -1;
        p.kerb = north ? toBlock.z0 : toBlock.z1;
      }
    }
  }

  _decide(p) {
    const b = p.block, k = p.corner, back = (p.heading + 2) % 4;
    const opts = [];
    for (const h of EDGE_OUT[k]) if (h !== back) opts.push({ kind: 'edge', h, w: h === p.heading ? 3 : 1.5 });
    const cn = this.cornerNode(b, k);
    if (!cn.node.free) {
      for (const h of CROSS_OUT[k]) {
        if (h === back) continue;
        const nb = this.neighbour(b, h);
        if (nb) opts.push({ kind: 'cross', h, nb, w: h === p.heading ? 3 : 1 });
      }
    }
    let total = 0;
    for (const o of opts) total += o.w;
    let r = this.rnd() * total;
    let pick = opts[0];
    for (const o of opts) {
      r -= o.w;
      if (r <= 0) { pick = o; break; }
    }
    if (pick.kind === 'edge') this._go(p, 'edge', b, this.edgeEnd(k, pick.h), pick.h);
    else {
      const leg = pick.h % 2 === 0 ? (cn.qx > 0 ? 1 : 3) : cn.qz > 0 ? 2 : 0;
      p.want = { node: cn.node, leg, axis: pick.h % 2, nb: pick.nb, h: pick.h };
      p.mode = 'wait';
      p.wait = 0;
      p.heading = pick.h;
    }
  }

  _tryCross(p) {
    const w = p.want, node = w.node;
    const [x, z] = this.cornerPoint(w.nb, this.crossEnd(p.corner, w.h), p.inset);
    const dist = Math.hypot(x - p.x, z - p.z);
    const need = dist / p.speed + 2.5;
    if (node.sig[w.axis] !== SIG.G || node.rem[w.axis] < need) return false;
    if (node.xwalkCars[w.leg] > 0) return false;
    node.xwalkPeds[w.leg]++;
    p.cross = { node, leg: w.leg };
    this._go(p, 'cross', w.nb, this.crossEnd(p.corner, w.h), w.h);
    return true;
  }

  _release(p) {
    if (p.cross) {
      p.cross.node.xwalkPeds[p.cross.leg] = Math.max(0, p.cross.node.xwalkPeds[p.cross.leg] - 1);
      p.cross = null;
    }
  }

  // ------------------------------------------------------------ population

  _spawn(ex, ez, anywhere) {
    const city = this.city;
    for (let tries = 0; tries < 10; tries++) {
      const b = city.blocks[Math.floor(this.rnd() * city.blocks.length)];
      const k = Math.floor(this.rnd() * 4);
      const p = new Ped(this.rnd);
      if (this.rnd() < COURIERS) {
        p.kind = 'dog';
        p.look = randomDog(this.rnd, 'courier');
        p.speed = 1.5 + this.rnd() * 0.5;
        p.brolly = false;
      } else {
        p.look = this.cast[Math.floor(this.rnd() * this.cast.length)];
        if (this.rnd() < PETS) p.pet = { x: 1e9, z: 0, yaw: 0, v: 0, side: this.rnd() < 0.5 ? 1 : -1, look: randomDog(this.rnd), body: null };
      }
      const cw = this.rnd() < 0.5;
      const heading = EDGE_OUT[k][cw ? 0 : 1];
      const k2 = this.edgeEnd(k, heading);
      const [ax, az] = this.cornerPoint(b, k, p.inset), [bx, bz] = this.cornerPoint(b, k2, p.inset);
      const f = this.rnd();
      const [x, z] = this.clear(ax + (bx - ax) * f, az + (bz - az) * f);
      const d = Math.hypot(x - ex, z - ez);
      if (d > 165 || (!anywhere && d < 75)) continue;
      p.x = x;
      p.z = z;
      p.block = b;
      p.corner = k;
      p.yaw = Math.atan2(-HX[heading], -HZ[heading]);
      if (p.pet) this._heel(p, 1e3);
      this._go(p, 'edge', b, k2, heading);
      this.peds.push(p);
      return p;
    }
    return null;
  }

  populate(x, z) {
    let guard = 0;
    while (this.peds.length < this.target && guard++ < 400) this._spawn(x, z, true);
  }

  /** A figure the ride script controls directly. `look` is a full look from robots/looks.js. */
  addRider(x, z, yaw, look) {
    const p = new Ped(this.rnd);
    p.rider = true;
    p.mode = 'stand';
    p.x = x;
    p.z = z;
    p.yaw = yaw;
    p.look = look;
    p.brolly = true;
    this.peds.push(p);
    return p;
  }

  walkTo(p, x, z, speed, onArrive) {
    p.mode = 'goto';
    p.tx = x;
    p.tz = z;
    p.nx = p.nz = p.far = p.farT = 0;
    p.speed = speed;
    p.onArrive = onArrive || null;
  }

  /** Hand a rider back to the crowd: they walk off along the nearest pavement. */
  release(p, block) {
    p.rider = false;
    if (!block) {
      p.mode = 'leave';
      p.wait = 0;
      return;
    }
    // head for the nearer end of whichever pavement edge we are standing on
    let best = null;
    for (let k = 0; k < 4; k++) {
      const [x, z] = this.cornerPoint(block, k, p.inset);
      const d = Math.hypot(x - p.x, z - p.z);
      if (!best || d < best.d) best = { k, d };
    }
    p.block = block;
    p.speed = 1.2 + this.rnd() * 0.4;
    p.corner = best.k;
    p.heading = Math.abs(p.x - this.cornerPoint(block, best.k, p.inset)[0]) > Math.abs(p.z - this.cornerPoint(block, best.k, p.inset)[1])
      ? (this.cornerPoint(block, best.k, p.inset)[0] > p.x ? 1 : 3)
      : (this.cornerPoint(block, best.k, p.inset)[1] > p.z ? 2 : 0);
    this._go(p, 'edge', block, best.k, p.heading);
  }

  remove(p) {
    this._release(p);
    p.dead = true;
  }

  /** Metres to the nearest person in the cab's way, or Infinity. */
  obstacleAhead(ego) {
    const fx = -Math.sin(ego.yaw), fz = -Math.cos(ego.yaw);
    let gap = Infinity;
    for (const p of this.peds) {
      if (p.mode !== 'cross' && p.mode !== 'goto') continue;
      const dx = p.x - ego.x, dz = p.z - ego.z;
      const f = dx * fx + dz * fz;
      if (f < ego.len / 2 || f > 24) continue;
      const l = Math.abs(-dx * fz + dz * fx);
      if (l > 1.5) continue;
      gap = Math.min(gap, f - ego.len / 2 - 0.4);
    }
    return gap;
  }

  // ------------------------------------------------------------ each frame

  update(dt, ego, rain) {
    const ex = ego.x, ez = ego.z;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      if (p.dead) {
        this._undress(p);
        this.peds.splice(i, 1);
        continue;
      }
      let moving = false;
      if (p.mode === 'edge' || p.mode === 'cross' || p.mode === 'goto') {
        const dx = p.tx - p.x, dz = p.tz - p.z;
        const d = Math.hypot(dx, dz);
        const step = p.speed * dt;
        if (d <= step) {
          p.x = p.tx;
          p.z = p.tz;
          if (p.mode === 'goto') {
            p.mode = 'stand';
            const cb = p.onArrive;
            p.onArrive = null;
            cb?.(p);
          } else {
            if (p.mode === 'cross') this._release(p);
            p.block = p.nextBlock;
            p.corner = p.nextCorner;
            this._decide(p);
          }
        } else {
          const ux = dx / d, uz = dz / d, x0 = p.x, z0 = p.z;
          p.x += ux * step;
          p.z += uz * step;
          // someone who is getting nowhere stops minding what is in the way for a moment
          p.farT += dt;
          if (p.farT > 3) {
            if (p.far > 0 && p.far - d < 0.6 && p.ghost <= 0) p.ghost = 2.5;
            p.far = d;
            p.farT = 0;
          }
          if (p.ghost > 0) p.ghost -= dt;
          else if (p.mode !== 'cross') {
            const side = this._dodge(p, ux, uz, d) * dt;
            [p.x, p.z] = this.clear(p.x - uz * side, p.z + ux * side, p.kind === 'dog' ? DOG : BODY);
          }
          // face the way they are actually going, which is not quite at the corner while stepping round a tree
          p.yaw = dampAngle(p.yaw, Math.atan2(x0 - p.x, z0 - p.z), 9, dt);
          moving = true;
        }
      } else if (p.mode === 'wait') {
        p.wait += dt;
        p.yaw = dampAngle(p.yaw, Math.atan2(-HX[p.heading], -HZ[p.heading]), 4, dt);
        if (!this._tryCross(p) && p.wait > 26) {
          // tired of waiting: carry on round the block instead
          const hs = EDGE_OUT[p.corner];
          const h = hs[this.rnd() < 0.5 ? 0 : 1];
          this._go(p, 'edge', p.block, this.edgeEnd(p.corner, h), h);
        }
      } else if (p.mode === 'leave') {
        p.wait += dt;
        if (p.wait > 30) p.dead = true;
      }
      p.v = moving ? p.speed : 0;
      p.still = moving ? 0 : p.still + dt;
      if (p.pet) this._heel(p, dt);
      if (!p.rider) {
        const d2 = (p.x - ex) ** 2 + (p.z - ez) ** 2;
        if (d2 > 185 * 185 && p.mode !== 'cross') {
          this._release(p);
          this._undress(p);
          this.peds.splice(i, 1);
        }
      }
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.peds.length < this.target) {
      this.spawnT = 0.3;
      this._spawn(ex, ez, false);
    }
    this.time += dt;
    this._draw(dt, ex, ez, rain);
  }

  /** A dog keeps to its robot's side, half a pace behind. */
  _heel(p, dt) {
    const d = p.pet;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    // beside them, or as near to that as the lamp post allows
    const [tx, tz] = this.clear(p.x + fz * -d.side * 0.55 - fx * 0.3, p.z + fx * d.side * 0.55 - fz * 0.3, DOG);
    const dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz);
    if (dist > 6) {
      // too far to have walked: it was with them all along
      d.x = tx;
      d.z = tz;
      d.yaw = p.yaw;
      d.v = 0;
      return;
    }
    d.v = dist < 0.06 ? 0 : Math.min(2.3, dist * 3.5 + 0.2);
    if (d.v > 0) {
      const step = Math.min(dist, d.v * dt);
      // round the lamp post, not through it
      [d.x, d.z] = this.clear(d.x + (dx / dist) * step, d.z + (dz / dist) * step, DOG);
    }
    d.yaw = dampAngle(d.yaw, d.v > 0.5 ? Math.atan2(-dx, -dz) : p.yaw, 7, dt);
  }

  // ------------------------------------------------------------ drawing

  _dress(p) {
    const dog = p.kind === 'dog';
    let c = (dog ? this.spareDogs : this.spare).pop();
    if (!c) {
      c = dog ? new Dog() : new Robot();
      this.group.add(c.group);
    }
    c.setLook(p.look);
    c.group.visible = true;
    p.body = c;
    p.gy = p.mode === 'cross' || p.onRoad ? 0.02 : CURB_H;
    if (p.pet) {
      const d = (p.pet.body = this.spareDogs.pop() || new Dog());
      if (!d.group.parent) this.group.add(d.group);
      d.setLook(p.pet.look);
      d.group.visible = true;
    }
  }

  _undress(p) {
    const c = p.body;
    if (!c) return;
    c.group.visible = false;
    (p.kind === 'dog' ? this.spareDogs : this.spare).push(c);
    p.body = null;
    if (p.pet?.body) {
      p.pet.body.group.visible = false;
      this.spareDogs.push(p.pet.body);
      p.pet.body = null;
    }
  }

  _draw(dt, ex, ez, rain) {
    const time = this.time;
    for (const p of this.peds) {
      const d2 = (p.x - ex) ** 2 + (p.z - ez) ** 2;
      if (!p.visible || d2 > SHOW * SHOW) {
        if (p.body) this._undress(p);
        continue;
      }
      if (!p.body) this._dress(p);
      const c = p.body;
      // on the road the ground is lower than the pavement: step down, do not drop
      p.gy = damp(p.gy, p.mode === 'cross' || p.onRoad ? 0.02 : CURB_H, 14, dt);
      c.group.position.set(p.x, p.gy, p.z);
      c.group.rotation.y = p.yaw;
      c.mesh.castShadow = d2 < SHADOW * SHADOW;
      if (p.kind === 'dog') {
        c.update(dt, { time, speed: p.v, sit: p.still > 1.5 });
        continue;
      }
      let gaze = p.gaze;
      if (p.wave > 0) {
        // whoever is flagging the cab down keeps an eye on it
        gaze = clamp(angleDiff(p.yaw, Math.atan2(p.x - ex, p.z - ez)), -1.1, 1.1);
      }
      c.stand(dt, { time, speed: p.v, wave: p.wave > 0, brolly: rain > 0.12 && p.brolly, sink: p.sink, gaze });
      const pet = p.pet;
      if (pet?.body) {
        pet.body.group.position.set(pet.x, p.gy, pet.z);
        pet.body.group.rotation.y = pet.yaw;
        pet.body.mesh.castShadow = c.mesh.castShadow;
        pet.body.update(dt, { time, speed: pet.v, sit: p.still > 1.5 });
      }
    }
  }
}
