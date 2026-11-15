// Traffic: every car follows a lane, keeps its distance with the Intelligent
// Driver Model, obeys the signals and gives way inside intersections. The cab
// uses the same stepping code, so it queues and yields like everybody else.
import { SIG } from '../world/city.js';
import { clamp, damp, hash2 } from '../core/utils.js';
import { CAR_SPECS, CAR_TYPES, PAINTS } from '../car/models.js';

const B_COMF = 2.2; // comfortable braking, m/s²
const T_HEAD = 1.25; // time headway, s
const S0 = 2.2; // gap kept when stopped, m
const LOOK = 70; // how far ahead a driver looks for the car in front

const _pose = { x: 0, z: 0, dx: 0, dz: -1 };
let carId = 0;

export class Vehicle {
  constructor(typeName) {
    const spec = CAR_SPECS[typeName];
    this.id = ++carId;
    this.typeName = typeName;
    this.type = CAR_TYPES.indexOf(typeName);
    this.len = spec.L;
    this.wid = spec.W;
    this.piece = null; // the lane or connector we are on
    this.s = 0; // distance of our centre along it
    this.v = 0;
    this.acc = 0;
    this.next = null; // the connector we mean to take at the end of this lane
    this.committed = false; // nose is over the stop line
    this.hold = null; // an intersection we have not fully cleared yet
    this.holdS = 0;
    this.waitT = 0;
    this.lat = 0; // offset to the right of the lane centre
    this.x = 0;
    this.z = 0;
    this.dx = 0;
    this.dz = -1;
    this.yaw = 0;
    this.pitch = 0;
    this.brake = 0;
    this.vK = 1;
    this.aMax = 1.6;
    this.paint = PAINTS[0];
    this.isEgo = false;
    this.stopped = 0; // seconds standing still
  }
}

export class Traffic {
  constructor(city, { target = 44 } = {}) {
    this.city = city;
    this.cars = [];
    this.target = target;
    this.speedK = 1; // weather slows everyone down
    this.time = 0;
    this.spawnT = 0;
    this.ego = null;
    this.rnd = Math.random;
    /** Called when an oncoming car goes past the cab: (car, relativeSpeed). */
    this.onPass = null;
  }

  // ------------------------------------------------------------ placement

  place(car, lane, s) {
    car.piece = lane;
    car.s = s;
    // keep the list sorted by distance along the lane
    const arr = lane.cars;
    let i = 0;
    while (i < arr.length && arr[i].s < s) i++;
    arr.splice(i, 0, car);
    car.next = null;
    car.committed = false;
    this.pose(car);
  }

  remove(car) {
    if (car.piece) {
      const i = car.piece.cars.indexOf(car);
      if (i >= 0) car.piece.cars.splice(i, 1);
    }
    this._release(car);
    car.piece = null;
  }

  _release(car) {
    const c = car.hold;
    if (!c) return;
    c.occ = Math.max(0, c.occ - 1);
    c.node.xwalkCars[c.entryLeg] = Math.max(0, c.node.xwalkCars[c.entryLeg] - 1);
    c.node.xwalkCars[c.exitLeg] = Math.max(0, c.node.xwalkCars[c.exitLeg] - 1);
    car.hold = null;
  }

  pose(car) {
    const p = this.city.pose(car.piece, car.s, _pose);
    car.dx = p.dx;
    car.dz = p.dz;
    car.x = p.x - p.dz * car.lat;
    car.z = p.z + p.dx * car.lat;
  }

  /** Nearest thing ahead on our path: { gap, v } or null. */
  leader(car) {
    const piece = car.piece;
    const arr = piece.cars;
    const i = arr.indexOf(car);
    const front = car.s + car.len / 2;
    if (i >= 0 && i < arr.length - 1) {
      const l = arr[i + 1];
      return { gap: l.s - l.len / 2 - front, v: l.v, car: l };
    }
    if (car.offLane) return null; // pulled over into the parking lane: the traffic lane is not our problem
    let dist = piece.len - front;
    let nxt = piece.isLane ? car.next : piece.to;
    for (let hops = 0; nxt && dist < LOOK && hops < 3; hops++) {
      if (nxt.cars.length) {
        const l = nxt.cars[0];
        return { gap: dist + l.s - l.len / 2, v: l.v, car: l };
      }
      dist += nxt.len;
      nxt = nxt.isConn ? nxt.to : null;
    }
    return null;
  }

  _roomIn(conn, car) {
    const first = conn.to.cars[0];
    if (first && first.s - first.len / 2 < car.len + 3.5 && first.v < 2.5) return false;
    return true;
  }

  /** May this car start across the intersection right now? */
  mayEnter(car, lane, conn, distEnd) {
    const node = lane.to;
    if (!this._roomIn(conn, car)) return false;
    if (node.free) return true;
    const axis = lane.dir % 2;
    const sig = node.sig[axis];
    if (sig === SIG.R) return false;
    if (sig === SIG.Y && (car.v * car.v) / (2 * 3.0) < distEnd - 0.5) return false; // can stop comfortably, so stop
    for (const c of conn.conflicts) if (c.occ > 0) return false;
    if (node.xwalkPeds[conn.entryLeg] > 0) return false;
    if (conn.turn !== 'S' && node.xwalkPeds[conn.exitLeg] > 0) return false;
    if (conn.turn === 'L' && car.waitT < 14) {
      // give way to anyone coming straight at us
      for (const ol of conn.oncoming) {
        const oc = ol.cars[ol.cars.length - 1];
        if (!oc || (oc.next && oc.next.turn === 'L')) continue;
        const d = ol.len - (oc.s + oc.len / 2);
        if (oc.v > 1.5 ? d < 9 + oc.v * 4.6 : d < 7) return false;
      }
    }
    return true;
  }

  /**
   * Advance one vehicle. `extra` lets the cab add its own reasons to slow:
   * { v0, gap, v } (a speed cap, and/or an obstacle `gap` metres ahead moving at `v`).
   */
  step(car, dt, extra) {
    const piece = car.piece;
    let v0 = piece.speed * car.vK * this.speedK;
    let gap = Infinity, leadV = 0;

    const lead = this.leader(car);
    if (lead) {
      gap = lead.gap;
      leadV = lead.v;
    }

    let blocked = false;
    if (piece.isLane) {
      const distEnd = piece.len - (car.s + car.len / 2);
      const conn = car.next;
      if (!conn) blocked = true;
      else {
        if (conn.turn !== 'S') v0 = Math.min(v0, Math.sqrt(conn.speed * conn.speed + 2 * 1.2 * Math.max(0, distEnd)));
        if (!car.committed) {
          // only weigh up the junction once we are close enough for it to matter
          if (distEnd < 6 + (car.v * car.v) / (2 * 1.6) + car.v * 1.5) blocked = !this.mayEnter(car, piece, conn, distEnd);
        }
      }
      if (blocked && distEnd + S0 - 0.25 < gap) {
        gap = Math.max(0.05, distEnd + S0 - 0.25);
        leadV = 0;
      }
    } else {
      v0 = Math.min(v0, piece.speed * Math.max(0.8, this.speedK));
    }
    if (extra) {
      if (extra.v0 !== undefined && extra.v0 < v0) v0 = extra.v0;
      if (extra.gap !== undefined && extra.gap < gap) {
        gap = Math.max(0.05, extra.gap);
        leadV = extra.v || 0;
      }
    }

    const a = car.aMax;
    let acc = a * (1 - Math.pow(car.v / Math.max(v0, 0.2), 4));
    if (acc < -2.6) acc = -2.6;
    if (gap < 250) {
      const dv = car.v - leadV;
      const sStar = S0 + Math.max(0, car.v * T_HEAD + (car.v * dv) / (2 * Math.sqrt(a * B_COMF)));
      acc -= a * (sStar / Math.max(gap, 0.1)) ** 2;
    }
    acc = clamp(acc, -7.5, a);
    car.acc = damp(car.acc, acc, acc < car.acc ? 9 : 4.5, dt);
    car.v = Math.max(0, car.v + car.acc * dt);
    if (car.v < 0.02 && car.acc <= 0) car.v = 0;
    car.s += car.v * dt;

    if (car.v < 0.15) {
      car.stopped += dt;
      if (blocked) car.waitT += dt;
    } else {
      car.stopped = 0;
      if (car.v > 2) car.waitT = 0;
    }

    if (piece.isLane) {
      const front = car.s + car.len / 2;
      if (front >= piece.len && !car.committed) {
        if (blocked || !car.next) {
          // never roll over the line
          car.s = piece.len - car.len / 2;
          car.v = 0;
          car.acc = Math.min(car.acc, 0);
        } else {
          const c = car.next;
          car.committed = true;
          car.hold = c;
          c.occ++;
          c.node.xwalkCars[c.entryLeg]++;
          c.node.xwalkCars[c.exitLeg]++;
        }
      }
      if (car.s >= piece.len && car.committed) {
        const c = car.next;
        this._leave(car, piece);
        car.s -= piece.len;
        car.piece = c;
        c.cars.unshift(car);
        this.onEnterConn?.(car, c);
      } else if (car.hold && !car.committed && car.s >= car.holdS) this._release(car);
    } else if (car.s >= piece.len) {
      const lane = piece.to;
      this._leave(car, piece);
      car.s -= piece.len;
      car.piece = lane;
      lane.cars.unshift(car);
      car.committed = false;
      car.holdS = car.len / 2 + 0.6;
      car.next = null;
      this.onEnterLane?.(car, lane);
      if (!car.next) car.next = this.chooseTurn(car, lane);
    }

    this.pose(car);
    car.brake = car.acc < -0.55 || car.v < 0.25 ? 1 : 0;
    car.pitch = damp(car.pitch, clamp(-car.acc * 0.006, -0.02, 0.03), 5, dt);
  }

  _leave(car, piece) {
    const arr = piece.cars;
    if (arr[arr.length - 1] === car) arr.pop();
    else {
      const i = arr.indexOf(car);
      if (i >= 0) arr.splice(i, 1);
    }
  }

  chooseTurn(car, lane) {
    const cs = lane.conns;
    if (!cs.length) return null;
    let total = 0;
    const w = cs.map((c) => {
      const k = c.turn === 'S' ? 6 : c.turn === 'R' ? 2.2 : 1.6;
      total += k;
      return k;
    });
    let r = this.rnd() * total;
    for (let i = 0; i < cs.length; i++) {
      r -= w[i];
      if (r <= 0) return cs[i];
    }
    return cs[cs.length - 1];
  }

  // ------------------------------------------------------------ population

  _spawn(lane, s, v) {
    const r = this.rnd();
    const typeName = r < 0.42 ? 'sedan' : r < 0.62 ? 'hatch' : r < 0.9 ? 'suv' : 'van';
    const car = new Vehicle(typeName);
    car.paint = PAINTS[Math.floor(this.rnd() * PAINTS.length)];
    if (typeName === 'van' && this.rnd() < 0.7) car.paint = PAINTS[0];
    car.vK = 0.84 + this.rnd() * 0.24;
    car.aMax = 1.25 + this.rnd() * 0.7;
    car.v = v;
    this.place(car, lane, s);
    car.next = this.chooseTurn(car, lane);
    this.cars.push(car);
    return car;
  }

  _clear(lane, s, margin) {
    for (const c of lane.cars) if (Math.abs(c.s - s) < margin) return false;
    return true;
  }

  /** Fill the streets around a point; used once at the start. */
  populate(x, z) {
    const lanes = this.city.lanes;
    let guard = 0;
    while (this.cars.length < this.target && guard++ < 600) {
      const lane = lanes[Math.floor(this.rnd() * lanes.length)];
      const mx = (lane.ax + lane.bx) / 2, mz = (lane.az + lane.bz) / 2;
      const d = Math.hypot(mx - x, mz - z);
      if (d > 330 || d < 30) continue;
      const s = 6 + this.rnd() * (lane.len - 14);
      if (!this._clear(lane, s, 13)) continue;
      this._spawn(lane, s, lane.speed * 0.6);
    }
  }

  _trySpawn(ex, ez, edx, edz) {
    const lanes = this.city.lanes;
    for (let tries = 0; tries < 14; tries++) {
      const lane = lanes[Math.floor(this.rnd() * lanes.length)];
      const dx = lane.ax - ex, dz = lane.az - ez;
      const d = Math.hypot(dx, dz);
      if (d < 215 || d > 330) continue;
      // straight down the road we are looking along, things pop into view from further away
      const ahead = (dx * edx + dz * edz) / d;
      const sameLine = lane.road.axis === 'v' ? Math.abs(dx) < 16 : Math.abs(dz) < 16;
      if (sameLine && ahead > 0.5 && d < 300) continue;
      if (!this._clear(lane, 6, 18)) continue;
      this._spawn(lane, 5, lane.speed * 0.7);
      return true;
    }
    return false;
  }

  update(dt, ego) {
    this.time += dt;
    this.city.updateSignals(this.time);
    const ex = ego ? ego.x : 0, ez = ego ? ego.z : 0;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      this.step(car, dt);
      const dx = car.x - ex, dz = car.z - ez;
      const d2 = dx * dx + dz * dz;
      if (d2 > 390 * 390) {
        this.remove(car);
        this.cars.splice(i, 1);
        continue;
      }
      // tell the cab when someone sweeps past in the other direction
      if (ego && this.onPass && d2 < 64) {
        const closing = car.dx * ego.dx + car.dz * ego.dz;
        const side = dx * ego.dx + dz * ego.dz;
        if (closing < -0.7 && car.passSide > 0 && side <= 0) this.onPass(car, car.v + ego.v);
        car.passSide = side;
      } else car.passSide = 1;
    }
    this.spawnT -= dt;
    if (this.cars.length < this.target && this.spawnT <= 0) {
      this.spawnT = 0.25;
      if (ego) this._trySpawn(ex, ez, ego.dx, ego.dz);
    }
  }

  /** Parked cars near a point: fills the fleet's "parked" pool. */
  fillParked(fleet, x, z, radius = 300) {
    fleet.begin('parked');
    const r2 = radius * radius;
    for (const lane of this.city.lanes) {
      if (lane.k !== 0) continue;
      const mx = (lane.ax + lane.bx) / 2, mz = (lane.az + lane.bz) / 2;
      if ((mx - x) ** 2 + (mz - z) ** 2 > r2) continue;
      const yaw = Math.atan2(-lane.tx, -lane.tz);
      for (const sl of this.city.slots(lane)) {
        const type = sl.h < 0.4 ? 0 : sl.h < 0.62 ? 1 : sl.h < 0.9 ? 2 : 3;
        const paint = PAINTS[Math.floor(sl.h2 * PAINTS.length) % PAINTS.length];
        const jit = (hash2(lane.id, Math.round(sl.s)) - 0.5) * 0.05;
        const off = (sl.h2 - 0.5) * 0.3;
        fleet.add('parked', type, sl.x + lane.rx * off, sl.z + lane.rz * off, yaw + jit, paint, 0, 0, 1);
      }
    }
    fleet.end('parked');
  }

  /** Moving cars into the fleet's "moving" pool. */
  fillMoving(fleet, lights) {
    fleet.begin('moving');
    for (const car of this.cars) {
      fleet.add('moving', car.type, car.x, car.z, Math.atan2(-car.dx, -car.dz), car.paint, lights, car.brake, 0.35, car.pitch, 0);
    }
    fleet.end('moving');
  }
}
