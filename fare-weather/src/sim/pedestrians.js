// Who is out on the pavements: robots, some with a dog at heel, and dogs on
// their own carrying parcels. They walk the edges of their block, wait at the
// corners for the lights, and cross on the crosswalks; cars count them and they
// count the cars. Riders are the same figures, steered by the ride script.
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
    this.inset = SIDEWALK_W / 2 - 0.2 + (rnd() - 0.5) * 1.4; // far enough in to stay on the kerb at rounded corners
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
  constructor(city, { target = 54 } = {}) {
    this.city = city;
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

  // ------------------------------------------------------------ choosing where to go

  _go(p, mode, toBlock, toCorner, heading) {
    const [x, z] = this.cornerPoint(toBlock, toCorner, p.inset);
    p.mode = mode;
    p.tx = x;
    p.tz = z;
    p.nextBlock = toBlock;
    p.nextCorner = toCorner;
    p.heading = heading;
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
      const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
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
          p.x += (dx / d) * step;
          p.z += (dz / d) * step;
          p.yaw = dampAngle(p.yaw, Math.atan2(-dx, -dz), 9, dt);
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
    const tx = p.x + fz * -d.side * 0.55 - fx * 0.3, tz = p.z + fx * d.side * 0.55 - fz * 0.3;
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
      d.x += (dx / dist) * step;
      d.z += (dz / dist) * step;
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
