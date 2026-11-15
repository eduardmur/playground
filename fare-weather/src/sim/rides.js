// The shift: a ride comes in, the cab drives to the kerb, someone gets in, says
// a thing or two to themselves on the way, and gets out again. Each stage is a
// generator that yields "wait this long", "wait until this is true" or "wait
// for this promise", which keeps the sequence readable as a script.
import { RIDERS, CAR_LINES, VOICES } from '../data/riders.js';
import { Passenger } from '../car/passenger.js';
import { normalizeLook } from '../robots/looks.js';
import { riderFile, carFile } from '../audio/manifest.js';
import { clamp, clockText, lerp, easeInOut } from '../core/utils.js';

const NAMES = ['Alex', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Avery', 'Quinn', 'Rowan', 'Sasha', 'Devon', 'Elliot', 'Harper', 'Jules', 'Kai', 'Lane', 'Micah', 'Noa', 'Reese', 'Sky', 'Tatum'];
const SAVE_KEY = 'fare-weather.save';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const inHours = (h, [a, b]) => (a <= b ? h >= a && h < b : h >= a || h < b);

export class Rides {
  constructor(game) {
    this.game = game;
    this.state = 'off';
    this.ride = null;
    this.co = null;
    this.wait = 0;
    this.until = null;
    this.arrived = false;
    this.seat = null; // the rider in the cab: there is only ever one, in the right-hand seat
    this.figure = null; // the same rider out on the pavement
    this.status = { label: '', headline: 'Fare Weather', sub: '', rider: null, riderColor: null };
    this.statusT = 0;
    this.lastId = null;
    this.sinceQuiet = 0;
    this.said = {};
    this.stopT = 0;
    this.onMet = null; // (rider) when a scripted rider's trip is finished
    this.onFare = null; // ({ name, fare, tip })
    this.stats = { trips: 0, meters: 0, earned: 0, met: {} };
    try {
      Object.assign(this.stats, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'));
    } catch {
      /* a fresh shift */
    }
    game.ego.onArrive = () => {
      this.arrived = true;
    };
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.stats));
    } catch {
      /* fine */
    }
  }

  reset() {
    this.stats = { trips: 0, meters: 0, earned: 0, met: {} };
    this.save();
  }

  start() {
    if (this.state !== 'off') return;
    this.state = 'idle';
    this.co = this._shift();
  }

  // ------------------------------------------------------------ choosing a fare

  /** One of the riders with something to say, as a ride: who, from where, to where. */
  _scripted(r) {
    const { city } = this.game;
    return {
      ...r, quiet: false,
      look: normalizeLook({ ...r.look, voice: r.id }),
      name: VOICES[r.id].name,
      fromZone: city.poi[r.from], toZone: city.poi[r.to],
    };
  }

  _pick() {
    const { city, ego, hour } = this.game;
    const fits = RIDERS.filter((r) => r.id !== this.lastId && (!r.hours || inHours(hour, r.hours)));
    const wantQuiet = !fits.length || (this.sinceQuiet >= 2 && Math.random() < 0.3);
    if (!wantQuiet) {
      // whoever has ridden least goes first
      const least = Math.min(...fits.map((r) => this.stats.met[r.id] || 0));
      // and of those, most likely someone nearby, so the cab is not empty for long
      const pool = fits.filter((x) => (this.stats.met[x.id] || 0) === least);
      const w = pool.map((x) => {
        const z = city.poi[x.from];
        return 1 / (120 + Math.hypot(z.cx - ego.x, z.cz - ego.z)) ** 2;
      });
      let roll = Math.random() * w.reduce((a, b) => a + b, 0);
      let r = pool[0];
      for (let i = 0; i < pool.length; i++) {
        roll -= w[i];
        if (roll <= 0) { r = pool[i]; break; }
      }
      this.sinceQuiet++;
      return this._scripted(r);
    }
    this.sinceQuiet = 0;
    // an ordinary fare between two addresses: someone who just wants to get there
    const zones = city.zones;
    let from = null, to = null;
    for (let i = 0; i < 60 && !from; i++) {
      const z = pick(zones);
      const d = Math.hypot(z.cx - ego.x, z.cz - ego.z);
      if (d > 140 && d < 420 && z.block) from = z;
    }
    from = from || pick(zones.filter((z) => z.block));
    for (let i = 0; i < 80 && !to; i++) {
      const z = pick(zones);
      const d = Math.hypot(z.cx - from.cx, z.cz - from.cz);
      if (d > 380 && d < 950) to = z;
    }
    to = to || pick(zones);
    return {
      id: null, quiet: true, color: '#7f8a96', name: pick(NAMES), fromZone: from, toZone: to,
      look: pick(this.game.peds.cast), // someone off the street
    };
  }

  // ------------------------------------------------------------ helpers

  /** A point given in the cab's own frame (x to its right, z toward its tail), in the world. */
  _local(lx, lz) {
    const e = this.game.ego;
    const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
    return [e.x - fz * lx - fx * lz, e.z + fx * lx - fz * lz];
  }

  _walk(fig, [x, z], speed = 1.3) {
    let done = false;
    this.game.peds.walkTo(fig, x, z, speed, () => (done = true));
    return () => done;
  }

  _tween(seconds, fn) {
    let t = 0, last = this.game.time;
    return () => {
      const now = this.game.time;
      t += (now - last) / seconds;
      last = now;
      fn(Math.min(1, t));
      return t >= 1;
    };
  }

  /** One of the rider's own lines: `clip` names the recording (data/riders.js, clipsOf). */
  _say(ride, clip, text) {
    return this.game.audio.say(riderFile(ride.id, clip), [{ who: ride.id, name: ride.name, text }]);
  }

  /** Wait this long, or until the cab has arrived, whichever comes first. */
  _pause(seconds) {
    const end = this.game.time + seconds;
    return () => this.arrived || this.game.time >= end;
  }

  /** One of the car's own lines for an occasion. */
  _car(when) {
    const opts = CAR_LINES.filter((l) => l.when === when);
    if (!opts.length) return Promise.resolve();
    const line = pick(opts);
    return this.game.audio.say(carFile(line.id), [{ who: 'nim', name: 'Nim', text: line.text }]);
  }

  _setStatus(s) {
    Object.assign(this.status, { label: '', headline: '', sub: '', rider: null, riderColor: null }, s);
    this.game.hud?.setRide(this.status);
  }

  // ------------------------------------------------------------ the script

  *_shift() {
    yield* this._opening();
    yield rand(3.5, 6.5);
    for (;;) {
      yield* this._oneRide();
      yield rand(3.5, 6.5);
    }
  }

  /** The game opens in the middle of things: someone is already aboard and the cab is on its way. */
  *_opening() {
    const g = this.game, ego = g.ego, cabin = g.cabin;
    // someone with a story, on their way somewhere a few minutes off; whoever has ridden least
    const away = (r) => Math.hypot(g.city.poi[r.to].cx - ego.x, g.city.poi[r.to].cz - ego.z);
    const fits = RIDERS.filter((r) => (!r.hours || inHours(g.hour, r.hours)) && away(r) > 320 && away(r) < 1000);
    const least = Math.min(...fits.map((r) => this.stats.met[r.id] || 0));
    // ?rider=maya opens with that rider whatever the hour: for hearing one voice or one scene
    const asked = RIDERS.find((r) => r.id === g.params.get('rider'));
    const ride = asked ? this._scripted(asked) : fits.length ? this._scripted(pick(fits.filter((r) => (this.stats.met[r.id] || 0) === least))) : this._pick();
    this.ride = ride;
    this.lastId = ride.id;
    this.said = {};
    const pass = (this.seat = new Passenger(ride.look, 1));
    cabin.seatAnchor.add(pass.group);
    pass.settle();
    for (let i = 0; i < 12 && !ego.setDestination(ride.toZone); i++) ride.toZone = pick(g.city.zones);
    this.tripStart = ego.odometer;
    this.tripT0 = g.time;
    this.state = 'toDropoff';
    this._setStatus({ label: 'On board', headline: ride.name, sub: ride.toZone.name, rider: ride.name, riderColor: ride.color });
    ego.depart();
    yield 2;
    if (!ride.quiet) yield this._say(ride, 'hello', ride.hello);
    yield* this._trip(ride);
    yield* this._alighting(ride);
    this.ride = null;
  }

  *_oneRide() {
    const g = this.game, ego = g.ego, peds = g.peds, audio = g.audio;
    this.state = 'idle';
    this._setStatus({ label: 'Online', headline: 'Waiting for a ride', sub: this.stats.trips ? `${this.stats.trips} trip${this.stats.trips === 1 ? '' : 's'} so far` : 'First fare of the shift' });
    yield rand(2.5, 5);

    const ride = (this.ride = this._pick());
    this.lastId = ride.id;
    this.said = {};
    const zf = ride.fromZone;
    // they are already waiting at the kerb
    this.figure = peds.addRider(...peds.clear(zf.cx + zf.nx * 1.35, zf.cz + zf.nz * 1.35), Math.atan2(zf.nx, zf.nz), ride.look);
    audio.play('chime_request');
    g.screen.say(`New ride  ·  ${ride.name}`, 4);
    this.state = 'toPickup';
    this._setStatus({ label: 'Picking up', headline: ride.name, sub: zf.name, rider: ride.name, riderColor: ride.color });

    const here = ego.mode === 'parked' && Math.hypot(ego.x - zf.cx, ego.z - zf.cz) < 6;
    if (!here) {
      this.arrived = false;
      if (!ego.setDestination(zf)) {
        // no way there: give up on this one
        peds.remove(this.figure);
        this.figure = null;
        return;
      }
      yield 1.4;
      ego.depart();
      yield () => this.arrived;
    }
    yield* this._boarding(ride);
    yield* this._trip(ride);
    yield* this._alighting(ride);
    this.ride = null;
  }

  *_boarding(ride) {
    const g = this.game, ego = g.ego, cabin = g.cabin, audio = g.audio, peds = g.peds;
    const fig = this.figure;
    this.state = 'boarding';
    ego.hazard = true;
    fig.wave = 0;
    audio.play('chime_pickup');
    this._setStatus({ label: 'Picking up', headline: ride.name, sub: 'Door opening', rider: ride.name, riderColor: ride.color });
    yield 0.7;

    // the kerb is on the cab's right, and so is the rider's seat
    cabin.setDoor('R', true);
    audio.play('door_open', { pan: 0.5 });
    yield this._walk(fig, this._local(1.5, 0.15));
    // turn side-on to the seat and duck in under the door
    const yaw0 = ego.yaw + Math.PI / 2, [x0, z0] = this._local(1.5, 0.15), [x1, z1] = this._local(1.12, 0.12);
    fig.yaw = yaw0;
    yield this._tween(0.6, (k) => {
      const m = easeInOut(k);
      fig.sink = m;
      fig.yaw = yaw0 - m * 2.05;
      fig.x = lerp(x0, x1, m);
      fig.z = lerp(z0, z1, m);
    });
    peds.remove(fig);
    this.figure = null;

    const pass = (this.seat = new Passenger(ride.look, 1));
    cabin.seatAnchor.add(pass.group);
    audio.play('seat', { pan: 0.5 });
    let seated = false;
    pass.enter(() => (seated = true));
    yield () => seated;
    yield 0.3;
    cabin.setDoor('R', false);
    audio.play('door_close', { pan: 0.5 });
    yield 1.35;

    this._setStatus({ label: 'On board', headline: ride.name, sub: ride.toZone.name, rider: ride.name, riderColor: ride.color });
    if (ride.quiet) {
      const h = g.hour;
      yield this._car(h >= 4.5 && h < 11 ? 'welcome_morning' : h >= 18 || h < 4.5 ? 'welcome_night' : 'welcome');
    } else yield this._say(ride, 'hello', ride.hello);
    audio.play('belt', { pan: 0.5 });
    pass.buckle();
    yield 0.55;
    ego.hazard = false;
    // if the planner cannot reach the place they asked for, take them somewhere it can
    for (let i = 0; i < 12 && !ego.setDestination(ride.toZone); i++) ride.toZone = pick(g.city.zones);
    this.tripStart = ego.odometer;
    this.tripT0 = g.time;
    yield 0.5;
    ego.depart();
  }

  *_trip(ride) {
    const g = this.game, ego = g.ego, audio = g.audio;
    this.state = 'toDropoff';
    this.arrived = false;
    yield () => ego.mode !== 'parked' || this.arrived;
    yield this._pause(rand(5, 8));
    // a word about the weather, now and then
    const kind = g.weather.kind;
    if (!this.arrived && ['rain', 'storm', 'fog', 'snow'].includes(kind) && Math.random() < (ride.quiet ? 0.8 : 0.3)) {
      yield this._car(kind);
    } else if (!this.arrived && ride.quiet && Math.random() < 0.5) {
      yield this._car('depart');
    }
    if (!ride.quiet) {
      // what the rider has to say: a few short things, with a good while between them. A call is the
      // same with shorter gaps, the other end talking, and a hand at the ear from its first word to its last
      const pass = this.seat;
      yield this._pause(rand(4, 8));
      for (let i = 0; i < ride.lines.length && !this.arrived; i++) {
        yield () => !audio.talking;
        if (ride.call && !pass.calling) {
          pass.calling = true;
          yield 1.2;
        }
        yield this._say(ride, String(i + 1), ride.lines[i]);
        if (i < ride.lines.length - 1) yield this._pause(ride.call ? rand(2.5, 4.5) : rand(9, 16));
      }
      if (pass.calling) {
        yield this._pause(0.9);
        pass.calling = false;
      }
    }
    yield () => this.arrived || ego.remaining() < 150;
    if (!this.arrived && !audio.talking && Math.random() < 0.55) yield this._car('near');
    yield () => this.arrived;
  }

  *_alighting(ride) {
    const g = this.game, ego = g.ego, cabin = g.cabin, audio = g.audio, peds = g.peds;
    const zt = ride.toZone, pass = this.seat;
    this.state = 'alighting';
    ego.hazard = true;
    pass.calling = false;
    audio.play('chime_arrive');
    this._setStatus({ label: 'Arrived', headline: zt.name, sub: zt.poi ? zt.address : '', rider: ride.name, riderColor: ride.color });
    yield 0.9;
    yield () => !audio.talking;
    if (ride.quiet) yield this._car('arrive');
    else yield this._say(ride, 'bye', ride.bye);

    audio.play('belt_off', { pan: 0.5 });
    yield 0.4;
    cabin.setDoor('R', true);
    audio.play('door_open', { pan: 0.5 });
    yield 0.85;
    let out = false;
    pass.leave(() => (out = true));
    yield () => out;
    pass.dispose();
    this.seat = null;

    // and there they are on the pavement
    const [dx, dz] = this._local(1.5, 0.15);
    const fig = peds.addRider(dx, dz, ego.yaw - Math.PI / 2, pass.look);
    fig.sink = 1;
    yield this._tween(0.4, (k) => (fig.sink = 1 - k));
    const away = () => {
      if (zt.block) peds.release(fig, zt.block);
      else {
        // the promenade: stroll off along the water
        const dir = Math.random() < 0.5 ? 1 : -1;
        peds.walkTo(fig, zt.cx + zt.nx * 4, zt.cz + dir * 70, 1.25, (p) => peds.remove(p));
      }
    };
    peds.walkTo(fig, ...peds.clear(zt.cx + zt.nx * 2.2, zt.cz + zt.nz * 2.2), 1.25, away);
    yield 0.5;
    cabin.setDoor('R', false);
    audio.play('door_close', { pan: 0.5 });
    yield 1.35;
    ego.hazard = false;

    // the fare
    const meters = Math.max(0, ego.odometer - this.tripStart);
    const seconds = g.time - this.tripT0;
    const fare = 2.75 + (meters / 1000) * 2.6 + (seconds / 60) * 0.45;
    const tip = Math.random() < 0.7 ? Math.round(fare * rand(0.1, 0.25) * 2) / 2 : 0;
    this.stats.trips++;
    this.stats.meters += meters;
    this.stats.earned += fare + tip;
    if (ride.id) this.stats.met[ride.id] = (this.stats.met[ride.id] || 0) + 1;
    this.save();
    this.onFare?.({ name: ride.name, fare, tip, color: ride.color });
    if (ride.id) this.onMet?.(ride, this.stats.met[ride.id] === 1);
    if (ride.quiet && Math.random() < 0.5) yield this._car('bye');
    yield 1;
  }

  // ------------------------------------------------------------ each frame

  update(dt) {
    const g = this.game, ego = g.ego, audio = g.audio;
    // run the script
    for (let guard = 0; guard < 12 && this.co; guard++) {
      if (this.wait > 0) {
        this.wait -= dt;
        break;
      }
      if (this.until) {
        // when fast-forwarding, nobody waits for a line to finish
        if (!(this.speech && g.audio.instant) && !this.until()) break;
        this.until = null;
        this.speech = false;
      }
      const r = this.co.next();
      if (r.done) {
        this.co = null;
        break;
      }
      const v = r.value;
      if (typeof v === 'number') this.wait = v;
      else if (typeof v === 'function') this.until = v;
      else if (v && typeof v.then === 'function') {
        if (g.audio.instant) continue; // fast-forwarding: nothing is being said
        let done = false;
        v.then(() => (done = true), () => (done = true));
        this.until = () => done;
        this.speech = true;
      }
    }

    // whoever is waiting flags the cab down as it comes up the street
    if (this.state === 'toPickup' && this.ride && this.figure) {
      const zf = this.ride.fromZone;
      const d = Math.hypot(ego.x - zf.cx, ego.z - zf.cz);
      this.figure.wave = d < 42 && d > 6 ? 1 : 0;
    }

    // the rider in their seat: looks out of the window now and then, and toward the screen when the car speaks
    const p = this.seat;
    if (p) {
      const lean = clamp(ego.latAcc * 0.022, -0.09, 0.09), pitch = clamp(-ego.acc * 0.012, -0.03, 0.05);
      const mine = audio.speaking === p.look.voice;
      const other = audio.speaking && !mine;
      const gaze = Math.sin(g.time * 0.11 + p.seed) > 0.55 ? -0.9 : 0;
      p.update(dt, g.time, mine ? Math.min(1, audio.voiceLevel) : 0, other ? 0.8 : gaze, lean, pitch);
    }

    // small talk from the car when it is held up
    if (this.state === 'toDropoff' && !audio.talking) {
      if (ego.v < 0.2 && ego.mode !== 'parked') this.stopT += dt;
      else this.stopT = 0;
      if (this.stopT > 2.5 && !this.said.held) {
        this.said.held = true;
        if (g.pedGap < 30 && Math.random() < 0.5) this._car('crossing');
        else if (ego.piece.isLane && ego.piece.to.sig[ego.piece.dir % 2] === 2 && Math.random() < 0.25) this._car('light');
      }
    }

    // keep the trip text current
    this.statusT -= dt;
    if (this.statusT <= 0 && this.ride) {
      this.statusT = 0.5;
      if (this.state === 'toPickup' || this.state === 'toDropoff') {
        const zone = this.state === 'toPickup' ? this.ride.fromZone : this.ride.toZone;
        const secs = ego.remaining() / 7 + 8;
        // the dashboard clock runs at the pace of the game's day, so the estimate does too
        const flow = g.timeFlow >= 2 ? g.timeFlow : 1;
        const mins = Math.max(1, Math.round((secs * flow) / 60));
        const at = clockText((g.hour + (secs * flow) / 3600) % 24);
        if (this.state === 'toPickup') this._setStatus({ label: `Picking up ${this.ride.name}`, headline: `${mins} min away`, sub: zone.name, rider: this.ride.name, riderColor: this.ride.color });
        else this._setStatus({ label: `Heading to ${zone.name}`, headline: `Arriving in ${mins} min`, sub: `at ${at}  ·  ${zone.address}`, rider: this.ride.name, riderColor: this.ride.color });
      }
    }
  }
}
