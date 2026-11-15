// The cab. It is one more vehicle in the traffic simulation, plus a plan: a
// route to a kerbside zone, lane changes to set up its turns, pulling in to
// stop and waiting for a gap to pull out again.
import { Vehicle } from './traffic.js';
import { LANE_W } from '../world/city.js';
import { clamp, damp, smoothstep, easeInOut, angleDiff } from '../core/utils.js';

const S0 = 2.2;

function insertSorted(arr, car) {
  let i = 0;
  while (i < arr.length && arr[i].s < car.s) i++;
  arr.splice(i, 0, car);
}

export class Ego extends Vehicle {
  constructor(city, traffic) {
    super('cab');
    this.isEgo = true;
    this.city = city;
    this.traffic = traffic;
    this.aMax = 1.45;
    this.vK = 0.98;
    this.mode = 'cruise'; // cruise | route | parked
    this.legs = null;
    this.legIdx = 0;
    this.stop = null; // the zone we are heading for
    this.offLane = false;
    this.waitGap = false; // parked, indicator on, waiting to pull out
    this.pullOut = null;
    this.changing = null;
    this.blinker = 0; // -1 left, +1 right
    this.blinkT = 0;
    this.blinkOn = false;
    this.hazard = false;
    this.yaw = 0;
    this.yawRate = 0;
    this.latAcc = 0;
    this.slip = 0;
    this.odometer = 0;
    this.onArrive = null;
    this.onBlink = null;
    this._prevLat = 0;
    traffic.ego = this;
    traffic.onEnterLane = (car, lane) => {
      if (car === this) this._enteredLane(lane);
    };
  }

  spawn(lane, s) {
    this.traffic.place(this, lane, s);
    this.next = this.traffic.chooseTurn(this, lane);
    this.yaw = Math.atan2(-this.dx, -this.dz);
  }

  /** Park at a zone straight away (used when the shift starts at the kerb). */
  spawnParked(zone) {
    const lane = zone.lane;
    this.piece = lane;
    this.s = zone.s;
    this.lat = lane.curbOff;
    this.offLane = true;
    this.mode = 'parked';
    this.stop = zone;
    this.v = 0;
    this.traffic.pose(this);
    this.yaw = Math.atan2(-this.dx, -this.dz);
  }

  // ------------------------------------------------------------ planning

  _toLegs(steps) {
    const legs = [];
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (!st.isLane) continue;
      const nx = steps[i + 1];
      if (!nx) legs.push({ lane: st, exit: 'stop' });
      else if (nx.isConn) legs.push({ lane: st, exit: nx });
      else legs.push({ lane: st, exit: 'switch', to: nx });
    }
    return legs;
  }

  /** Plan a route to a kerbside zone from wherever we are. Returns false if there is none. */
  setDestination(zone, noSwitchNow = false) {
    let startLane, startS;
    const here = this.piece;
    if (here.isConn) {
      startLane = here.to;
      startS = 0;
    } else if (this.committed && this.next) {
      startLane = this.next.to;
      startS = 0;
    } else {
      startLane = here;
      startS = this.offLane ? this.s : this.s + (this.v * this.v) / (2 * 1.6) + 4;
    }
    const tight = startLane === here && (noSwitchNow || here.len - this.s < 46 || this.changing);
    const r = this.city.route(startLane, startS, zone.lane, zone.s, tight ? startLane : null);
    if (!r) return false;
    this.legs = this._toLegs(r.steps);
    this.stop = zone;
    if (startLane === here) {
      this.legIdx = 0;
      const ex = this.legs[0].exit;
      if (!this.committed) this.next = ex && ex.isConn ? ex : ex === 'stop' ? this.next : null;
    } else this.legIdx = -1;
    if (this.mode !== 'parked') this.mode = 'route';
    this.routeTime = r.time;
    return true;
  }

  /** Leave the kerb as soon as the lane is clear. */
  depart() {
    if (this.mode !== 'parked') return;
    this.waitGap = true;
  }

  cruise() {
    this.legs = null;
    this.stop = null;
    if (this.mode !== 'parked') this.mode = 'cruise';
  }

  _enteredLane(lane) {
    if (this.mode === 'route' && this.legs) {
      this.legIdx++;
      const leg = this.legs[this.legIdx];
      if (!leg || leg.lane !== lane) {
        this.setDestination(this.stop);
        return;
      }
      this.next = leg.exit && leg.exit.isConn ? leg.exit : null;
    }
  }

  _gapOK(lane, s, back, fwd) {
    for (const c of lane.cars) {
      if (c === this) continue;
      const rel = c.s - s;
      if (rel > -(back + (c.v || 0) * 1.4) && rel < fwd) return false;
    }
    return true;
  }

  /** Metres left to the stop along the plan. */
  remaining() {
    if (!this.legs || !this.stop) return 0;
    let d = 0;
    let i = this.legIdx;
    if (this.piece.isConn) d += this.piece.len - this.s;
    else {
      const leg = this.legs[i];
      if (!leg || leg.lane !== this.piece) d += this.piece.len - this.s + (this.next ? this.next.len : 0);
      else {
        d += (leg.exit === 'stop' ? this.stop.s : leg.lane.len) - this.s;
        if (leg.exit && leg.exit.isConn) d += leg.exit.len;
      }
    }
    for (i = i + 1; i < this.legs.length; i++) {
      const leg = this.legs[i];
      if (leg.exit === 'switch') continue;
      d += leg.exit === 'stop' ? this.stop.s : leg.lane.len + leg.exit.len;
    }
    return Math.max(0, d);
  }

  // ------------------------------------------------------------ each frame

  /** obstacleGap: metres to a pedestrian in our path, or Infinity. */
  update(dt, obstacleGap = Infinity) {
    const tr = this.traffic;
    const extra = {};
    if (obstacleGap < 60) {
      extra.gap = obstacleGap;
      extra.v = 0;
    }
    const s0 = this.s;

    if (this.mode === 'parked') {
      this.v = 0;
      this.acc = damp(this.acc, 0, 6, dt);
      this.brake = 1;
      if (this.waitGap && this._gapOK(this.piece, this.s, 15, 7.5)) {
        this.waitGap = false;
        this.offLane = false;
        insertSorted(this.piece.cars, this);
        this.pullOut = { lane: this.piece, s0: this.s };
        this.mode = this.legs ? 'route' : 'cruise';
        if (!this.next && !(this.legs && this.legs[this.legIdx]?.exit === 'stop')) this.next = tr.chooseTurn(this, this.piece);
      }
    }

    if (this.mode !== 'parked') {
      const leg = this.mode === 'route' && this.legs ? this.legs[this.legIdx] : null;
      if (this.pullOut) {
        if (this.piece !== this.pullOut.lane) this.pullOut = null;
        else {
          this.lat = this.piece.curbOff * (1 - smoothstep(this.pullOut.s0 + 0.5, this.pullOut.s0 + 11.5, this.s));
          if (this.lat < 0.02) {
            this.lat = 0;
            this.pullOut = null;
          }
        }
      }
      if (leg && this.piece === leg.lane) {
        if (leg.exit === 'stop') {
          const d = this.stop.s - this.s;
          const g = d + S0 - 0.25;
          if (extra.gap === undefined || g < extra.gap) {
            extra.gap = g;
            extra.v = 0;
          }
          if (d < 15 && d > -3) {
            const want = this.piece.curbOff * smoothstep(this.stop.s - 14, this.stop.s - 1.5, this.s);
            if (!this.pullOut || want > this.lat) {
              this.lat = Math.max(this.lat, want);
              this.pullOut = null;
            }
            extra.v0 = 2 + Math.max(0, d) * 0.5;
          }
          if (this.lat > 1.7 && !this.offLane) {
            const i = this.piece.cars.indexOf(this);
            if (i >= 0) this.piece.cars.splice(i, 1);
            this.offLane = true;
          }
          if (d < 1.2 && this.v < 0.05) {
            this.mode = 'parked';
            this.v = 0;
            this.lat = this.piece.curbOff;
            if (!this.offLane) {
              const i = this.piece.cars.indexOf(this);
              if (i >= 0) this.piece.cars.splice(i, 1);
              this.offLane = true;
            }
            this.legs = null;
            const zone = this.stop;
            this.onArrive?.(zone);
          }
        } else if (leg.exit === 'switch' && !this.changing) this._tryLaneChange(leg);
      }
      if (this.changing) {
        const c = this.changing;
        c.t += dt / 3.4;
        this.lat = c.lat0 * (1 - easeInOut(Math.min(1, c.t)));
        c.ghost.s = this.s;
        c.ghost.v = this.v;
        if (c.t > 0.55 && c.ghost.live) {
          const i = c.from.cars.indexOf(c.ghost);
          if (i >= 0) c.from.cars.splice(i, 1);
          c.ghost.live = false;
        }
        if (c.t >= 1) {
          this.lat = 0;
          this.changing = null;
        }
      }
      if (this.mode !== 'parked') tr.step(this, dt, extra);
    }
    if (this.mode === 'parked') tr.pose(this);

    // how the body is pointing: along the path, plus the slide of a lane change or pull-in
    const ds = this.s - s0;
    let slip = 0;
    if (ds > 1e-4 && this.piece.isLane) slip = clamp(Math.atan((this.lat - this._prevLat) / ds), -0.4, 0.4);
    this._prevLat = this.lat;
    this.slip = damp(this.slip, slip, 6, dt);
    const yaw = Math.atan2(-this.dx, -this.dz) - this.slip;
    const rate = dt > 0 ? angleDiff(this.yaw, yaw) / dt : 0;
    this.yawRate = damp(this.yawRate, clamp(rate, -1.5, 1.5), 8, dt);
    this.yaw = yaw;
    this.latAcc = this.v * this.yawRate;
    this.odometer += Math.max(0, ds);
    this._blink(dt);
  }

  _tryLaneChange(leg) {
    const from = this.piece, to = leg.to;
    const distEnd = from.len - this.s;
    if (distEnd < 30) {
      // no room left to move over: plan again from where we really are
      this.setDestination(this.stop, true);
      return;
    }
    if (this.s < 7 || this.v < 1.5 || this.pullOut || this.offLane) return;
    if (!this._gapOK(to, this.s, 11, 9)) return;
    const arr = from.cars;
    const i = arr.indexOf(this);
    const ghost = { s: this.s, len: this.len, v: this.v, next: null, live: true, isGhost: true };
    if (i >= 0) arr[i] = ghost;
    else ghost.live = false;
    this.piece = to;
    insertSorted(to.cars, this);
    const dir = to.k > from.k ? -1 : 1; // a higher lane index is further left
    this.lat = dir < 0 ? LANE_W : -LANE_W;
    this._prevLat = this.lat;
    this.changing = { from, ghost, t: 0, lat0: this.lat, dir };
    this.legIdx++;
    const nl = this.legs[this.legIdx];
    this.next = nl && nl.exit && nl.exit.isConn ? nl.exit : null;
    if (!this.next && !(nl && nl.exit === 'stop')) this.next = this.traffic.chooseTurn(this, to);
  }

  _blink(dt) {
    let b = 0;
    if (this.mode === 'parked') b = this.waitGap ? -1 : 0;
    else if (this.pullOut) b = -1;
    else if (this.changing) b = this.changing.dir;
    else if (this.piece.isConn) b = this.piece.turn === 'L' ? -1 : this.piece.turn === 'R' ? 1 : 0;
    else {
      const leg = this.mode === 'route' && this.legs ? this.legs[this.legIdx] : null;
      if (leg && leg.exit === 'stop' && this.piece === leg.lane) b = this.stop.s - this.s < 30 ? 1 : 0;
      else if (this.next && this.next.turn !== 'S' && this.piece.len - this.s < 40) b = this.next.turn === 'L' ? -1 : 1;
    }
    if (b !== this.blinker) {
      this.blinker = b;
      this.blinkT = 0;
      this.blinkOn = false;
    }
    if (b !== 0 || this.hazard) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.blinkT = 0.37;
        this.blinkOn = !this.blinkOn;
        this.onBlink?.(this.blinkOn);
      }
    } else this.blinkOn = false;
  }
}
