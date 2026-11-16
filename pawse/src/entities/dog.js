import * as THREE from 'three';
import { buildDogRig } from './dogRig.js';
import { clamp, lerp, damp, angleDiff, smoothstep, TAU, easeInOut } from '../core/utils.js';
import { WORLD } from '../world/terrain.js';

const POSE_KEYS = [
  'bodyY', 'bodyZ', 'pitch', 'roll', 'yaw', 'neckPitch', 'neckYaw', 'headPitch', 'headYaw', 'headRoll',
  'jaw', 'tongue', 'eye', 'earBack', 'tailLift', 'tailWag', 'tailSpeed',
];
// how quickly each channel settles (1/s)
const POSE_RATE = {
  bodyY: 9, bodyZ: 9, pitch: 9, roll: 10, yaw: 10, neckPitch: 11, neckYaw: 9, headPitch: 11, headYaw: 9, headRoll: 8,
  jaw: 26, tongue: 16, eye: 22, earBack: 9, tailLift: 6, tailWag: 5, tailSpeed: 5,
};

// leg order: front-left, front-right, rear-left, rear-right
const GAIT_WALK = [0.25, 0.75, 0.0, 0.5];
const GAIT_TROT = [0.0, 0.5, 0.5, 0.0];
const GAIT_GALLOP = [0.0, 0.14, 0.52, 0.66];

/** Acts are one-shot animations layered over the current posture. */
const ACTS = {
  bark: { dur: 0.36 },
  howl: { dur: 3.0, lock: true, sit: true },
  eat: { dur: 1.05 },
  drink: { dur: 3.4, cancelOnMove: true },
  sniff: { dur: 2.4, cancelOnMove: true },
  shake: { dur: 1.5, lock: true },
  roll: { dur: 1.9, lock: true },
  spin: { dur: 0.95, lock: true },
  greet: { dur: 1.7, lock: true },
  dig: { dur: 2.4, lock: true },
  paw: { dur: 2.2, cancelOnMove: true, sit: true },
  nuzzle: { dur: 1.0 },
};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _qi = new THREE.Quaternion();

export class Dog {
  constructor(breed, opts = {}) {
    this.breed = breed;
    this.rig = buildDogRig(breed, opts);
    this.root = this.rig.root;
    this.pos = this.root.position;
    this.dims = this.rig.dims;
    this.scale = this.dims.scale;
    this.radius = 0.24 * this.scale;
    this.name = opts.name || breed.name;

    this.heading = 0;
    this.speed = 0;
    this.turnRate = 0;
    this.vy = 0;
    this.air = 0;
    this.grounded = true;
    this.swim = 0;
    this.wading = 0;
    this.wet = 0;
    this.groundY = 0;
    this.tiltPitch = 0;
    this.tiltRoll = 0;

    this.posture = 'stand';
    this.act = null;
    this.spin = 0;
    this.rollAngle = 0;

    this.happy = 0.35; // 0..1, drives the tail
    this.pant = 0; // 0..1, tongue out and quick breaths
    this.look = null; // world-space point of interest
    this.carry = null;
    this.onEvent = null;

    this.gaitPhase = Math.random();
    this.gaitAmt = 0;
    this.wagPhase = Math.random() * TAU;
    this.breath = Math.random() * TAU;
    this.blinkIn = 1 + Math.random() * 4;
    this.blink = 0;
    this.fidgetIn = 2 + Math.random() * 4;
    this.fidget = { yaw: 0, roll: 0, t: 0 };
    this.earFlick = 0;
    this.lastStance = [true, true, true, true];
    this.idleTime = 0;

    this.pose = {};
    this.target = {};
    for (const k of POSE_KEYS) this.pose[k] = this.target[k] = 0;
    this.pose.bodyY = this.dims.standH;
    this.pose.eye = 1;
    this.feet = this.rig.legs.map((leg) => ({
      root: leg.rest.clone(), // damped root-space target
      local: new THREE.Vector3(), // damped body-space target
      w: 0, // 0 = planted on the ground, 1 = held relative to the body
      tRoot: leg.rest.clone(),
      tLocal: new THREE.Vector3(),
      tW: 0,
      out: new THREE.Vector3(),
    }));
    this._defaultLocals();
    this.feet.forEach((f) => f.local.copy(f.tLocal));
  }

  // ------------------------------------------------------------------ control

  emit(type, data) {
    if (this.onEvent) this.onEvent(type, data, this);
  }

  /** Toggle a held posture: 'stand' | 'sit' | 'lie' | 'sleep' | 'beg' | 'bow'. */
  setPosture(p) {
    if (this.act && ACTS[this.act.name].lock) return false;
    if (this.swim > 0.5 || !this.grounded) return false;
    this.posture = p;
    return true;
  }

  doAct(name, data = {}) {
    const def = ACTS[name];
    if (!def) return false;
    if (this.act && ACTS[this.act.name].lock) return false;
    if ((this.swim > 0.5 || !this.grounded) && name !== 'bark' && name !== 'eat') return false;
    this.act = { name, t: 0, dur: data.dur ?? def.dur, data, fired: {} };
    if (def.sit && this.posture !== 'sit') {
      this.act.restore = this.posture;
      this.posture = 'sit';
    }
    if (name === 'roll' || name === 'spin') this.act.dir = data.dir ?? (Math.random() < 0.5 ? -1 : 1);
    return true;
  }

  cancelAct() {
    if (this.act && !ACTS[this.act.name].lock) this._endAct();
  }

  _endAct() {
    const a = this.act;
    if (!a) return;
    if (a.restore) this.posture = a.restore;
    this.act = null;
    this.spin = 0;
    this.rollAngle = 0;
    this.emit('actEnd', a.name);
  }

  get locked() {
    return !!(this.act && ACTS[this.act.name].lock);
  }

  get actName() {
    return this.act ? this.act.name : null;
  }

  jump(power = 1) {
    if (!this.grounded || this.swim > 0.4 || this.locked) return false;
    if (this.posture !== 'stand') this.posture = 'stand';
    this.vy = 3.7 * power * Math.sqrt(Math.max(this.scale, 0.7));
    this.grounded = false;
    this.emit('jump');
    return true;
  }

  // ------------------------------------------------------------------ movement

  /**
   * Steer toward a world-space direction at the wished speed, slide around
   * obstacles, follow the ground, and float in deep water.
   */
  move(dt, world, wx, wz, wishSpeed) {
    const sc = this.scale;
    const pos = this.pos;
    if (this.locked) wishSpeed = 0;
    const wants = wishSpeed > 0.02;
    if (wants) {
      if (this.posture !== 'stand') this.posture = 'stand';
      if (this.act && ACTS[this.act.name].cancelOnMove) this._endAct();
    }

    let turn = 0;
    if (wants) {
      const diff = angleDiff(this.heading, Math.atan2(wx, wz));
      const rate = lerp(10, 4.6, clamp(this.speed / 6, 0, 1));
      const maxStep = (this.swim > 0.5 ? 2.4 : 8.5) * dt;
      turn = clamp(diff * (1 - Math.exp(-rate * dt)), -maxStep, maxStep);
      this.heading += turn;
      wishSpeed *= clamp(1.2 - Math.abs(diff) / 2.0, 0.2, 1);
    }
    this.turnRate = damp(this.turnRate, turn / Math.max(dt, 1e-4), 12, dt);

    if (this.swim > 0.5) wishSpeed = Math.min(wishSpeed, 1.75 * Math.sqrt(sc));
    else if (this.wading > 0.3) wishSpeed *= lerp(1, 0.72, this.wading);
    this.speed = damp(this.speed, wishSpeed, wishSpeed > this.speed ? 6.5 : 9, dt);
    if (!wants && this.speed < 0.02) this.speed = 0;

    let nx = pos.x + Math.sin(this.heading) * this.speed * dt;
    let nz = pos.z + Math.cos(this.heading) * this.speed * dt;

    const cols = world.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const dx = nx - c.x, dz = nz - c.z;
      const rr = c.r + this.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (rr - d) * (c.soft ? 0.35 : 1);
        nx += (dx / d) * push;
        nz += (dz / d) * push;
        if (c.soft) this.speed *= 1 - 0.9 * dt;
      }
    }
    const r = Math.hypot(nx, nz);
    const lim = WORLD.parkRadius + 0.6 - this.radius;
    if (r > lim) {
      nx *= lim / r;
      nz *= lim / r;
    }
    pos.x = nx;
    pos.z = nz;

    // ground, water
    const terrain = world.terrain;
    const gy = terrain.heightAt(nx, nz);
    const d = this.dims;
    const floatY = WORLD.waterLevel - (d.standH + d.R * 0.2) * sc;
    const depth = terrain.waterDepthAt(nx, nz);
    const inWater = depth > 0.02;
    const swimming = inWater && floatY > gy + 0.03;
    this.swim = damp(this.swim, swimming ? 1 : 0, 7, dt);
    this.wading = damp(this.wading, inWater ? clamp(depth / (d.legLen * sc), 0, 1) : 0, 8, dt);
    this.inWater = inWater;
    if (swimming) {
      this.wet = 1;
      if (this.posture !== 'stand') this.posture = 'stand';
    } else if (inWater) {
      this.wet = Math.max(this.wet, clamp(depth / (d.legLen * sc), 0, 0.6));
    } else {
      this.wet = Math.max(0, this.wet - dt / 28);
    }
    const base = swimming ? Math.max(gy, floatY + Math.sin(this.breath * 1.3) * 0.012) : gy;
    this.groundY = gy;

    // jumping
    if (!this.grounded) {
      this.air += this.vy * dt;
      this.vy -= 12.5 * dt;
      if (this.air <= 0) {
        this.air = 0;
        this.grounded = true;
        this.emit('land', Math.abs(this.vy));
        this.vy = 0;
        this.landSquash = 1;
      }
    }
    const targetY = base + this.air;
    pos.y = this.grounded ? damp(pos.y, targetY, swimming ? 6 : 30, dt) : targetY;

    // lean with the slope
    const s = 0.24 * sc;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const hF = terrain.heightAt(nx + fx * s, nz + fz * s), hB = terrain.heightAt(nx - fx * s, nz - fz * s);
    const hL = terrain.heightAt(nx + fz * s, nz - fx * s), hR = terrain.heightAt(nx - fz * s, nz + fx * s);
    const flat = this.swim > 0.3 || !this.grounded ? 0 : 1;
    this.tiltPitch = damp(this.tiltPitch, Math.atan2(hB - hF, 2 * s) * flat, 8, dt);
    this.tiltRoll = damp(this.tiltRoll, Math.atan2(hL - hR, 2 * s) * flat * 0.7, 8, dt);
  }

  /** Place the dog directly (used when spawning). */
  place(x, z, heading, terrain) {
    this.pos.set(x, terrain.heightAt(x, z), z);
    this.heading = heading;
    this.speed = 0;
  }

  // ---------------------------------------------------------------- animation

  _defaultLocals() {
    const d = this.dims;
    this.rig.legs.forEach((leg, i) => {
      this.feet[i].tLocal.set(leg.joint.x, leg.joint.y - d.legLen * 0.6, leg.joint.z + d.legLen * 0.2);
    });
  }

  _targets(dt, t) {
    const d = this.dims, T = this.target, legs = this.rig.legs, F = this.feet;
    const cfg = this.rig.tailCfg;
    const v = this.speed / this.scale;
    const run = smoothstep(2.6, 4.8, v);

    T.bodyY = d.standH;
    T.bodyZ = 0;
    T.pitch = 0;
    T.roll = 0;
    T.yaw = 0;
    T.neckPitch = 0;
    T.neckYaw = 0;
    T.headPitch = 0;
    T.headYaw = 0;
    T.headRoll = 0;
    T.jaw = 0;
    T.tongue = 0;
    T.eye = 1;
    T.earBack = run * 0.8;
    T.tailLift = -cfg.lift * 0.35 * run;
    T.tailWag = 0.18 + this.happy * 0.75;
    T.tailSpeed = 4 + this.happy * 11;
    for (let i = 0; i < 4; i++) {
      F[i].tRoot.copy(legs[i].rest);
      F[i].tW = 0;
    }
    this._defaultLocals();

    const posture = this.posture;
    if (posture === 'sit') {
      const hr = d.R * 0.64, hf = d.legLen * 0.97;
      const sinT = clamp((hf - hr) / (2 * d.Lh), 0.08, 0.72), th = Math.asin(sinT);
      T.pitch = -th;
      T.bodyY = hr + d.J * Math.cos(th) + d.Lh * sinT;
      T.bodyZ = -d.Lh * 0.1;
      T.neckPitch = th * 0.42;
      T.headPitch = th * 0.5;
      T.tailLift = -cfg.lift * 0.6 - 0.25;
      for (let i = 2; i < 4; i++) F[i].tRoot.set(legs[i].side * (d.hx + d.R * 0.45), 0, -d.Lh * 0.38);
      for (let i = 0; i < 2; i++) F[i].tRoot.z -= d.Lh * 0.12;
    } else if (posture === 'lie' || posture === 'sleep') {
      const sleep = posture === 'sleep';
      T.bodyY = d.belly + 0.012;
      T.pitch = -0.03;
      T.roll = sleep ? 0.16 : 0;
      T.tailLift = -cfg.lift * 0.7 - 0.35;
      T.neckPitch = sleep ? 1.05 : 0.12;
      T.headPitch = sleep ? 0.12 : 0.02;
      T.headRoll = sleep ? 0.22 : 0;
      T.eye = sleep ? 0 : 1;
      T.tailWag = sleep ? 0.02 : T.tailWag * 0.7;
      for (let i = 0; i < 2; i++) F[i].tRoot.set(legs[i].side * d.hx * 0.95, 0, d.Lh + d.legLen * 0.82);
      for (let i = 2; i < 4; i++) F[i].tRoot.set(legs[i].side * (d.hx + d.R * 0.55), 0, -d.Lh + d.legLen * 0.62);
    } else if (posture === 'beg') {
      const th = 1.1, hr = d.legLen * 0.62;
      T.pitch = -th;
      T.bodyY = hr + d.J * Math.cos(th) + d.Lh * Math.sin(th) + Math.max(0, Math.sin(t * 5.5)) * 0.012;
      T.bodyZ = -d.Lh * 0.72 - d.J * Math.sin(th) + d.Lh * Math.cos(th);
      T.neckPitch = 0.5;
      T.headPitch = 0.42;
      T.tailWag = 0.8;
      T.tailSpeed = 13;
      for (let i = 2; i < 4; i++) F[i].tRoot.set(legs[i].side * d.hx * 1.25, 0, -d.Lh * 0.62);
      for (let i = 0; i < 2; i++) {
        F[i].tW = 1;
        const bob = Math.sin(t * 5.5 + i * 2.2) * d.legLen * 0.04;
        F[i].tLocal.set(legs[i].joint.x * 0.75, legs[i].joint.y - d.legLen * 0.64 + bob, legs[i].joint.z - d.legLen * 0.05);
      }
    } else if (posture === 'bow') {
      const th = 0.42, hf = d.R * 0.78;
      T.pitch = th;
      T.bodyY = hf + d.J * Math.cos(th) + d.Lh * Math.sin(th);
      T.bodyZ = -d.Lh * 0.18;
      T.neckPitch = -0.62;
      T.headPitch = -0.22;
      T.tailLift = 0.45;
      T.tailWag = 0.95;
      T.tailSpeed = 17;
      T.yaw = Math.sin(t * 9) * 0.05;
      for (let i = 0; i < 2; i++) F[i].tRoot.set(legs[i].side * d.hx * 1.55, 0, d.Lh + d.legLen * 0.72);
    }

    // ---- acts
    const a = this.act;
    if (a) {
      const k = clamp(a.t / a.dur, 0, 1);
      switch (a.name) {
        case 'bark': {
          const p = Math.sin(Math.PI * Math.min(1, a.t / 0.2));
          T.jaw = 0.85 * p;
          T.neckPitch -= 0.34 * p;
          T.headPitch -= 0.1 * p;
          T.pitch -= 0.05 * p;
          T.bodyY += 0.012 * p;
          T.tailWag *= 0.4;
          break;
        }
        case 'howl': {
          const env = smoothstep(0, 0.45, a.t) * smoothstep(a.dur, a.dur - 0.5, a.t);
          T.neckPitch -= 0.72 * env;
          T.headPitch -= 0.62 * env;
          T.jaw = 0.3 * env + Math.sin(t * 31) * 0.02 * env;
          T.eye = 1 - 0.75 * env;
          T.earBack = 0.7 * env;
          T.tailWag = 0.06;
          break;
        }
        case 'eat': {
          const moving = clamp(v / 2, 0, 1);
          const down = smoothstep(0, 0.14, a.t) * smoothstep(0.5, 0.3, a.t);
          T.neckPitch += (1.0 - 0.45 * moving) * down;
          T.headPitch += 0.4 * down;
          T.pitch += 0.14 * down * (1 - moving);
          const chew = smoothstep(0.22, 0.3, a.t) * smoothstep(a.dur, a.dur - 0.12, a.t);
          T.jaw = Math.abs(Math.sin(a.t * 19)) * 0.5 * chew;
          T.tailWag = 0.9;
          T.tailSpeed = 14;
          break;
        }
        case 'drink': {
          const drop = a.data.drop ?? 1;
          const env = smoothstep(0, 0.35, a.t) * smoothstep(a.dur, a.dur - 0.3, a.t);
          T.pitch += 0.2 * drop * env;
          T.bodyY -= 0.035 * drop * env * (d.legLen / 0.27);
          T.neckPitch += lerp(0.25, 1.02, drop) * env;
          T.headPitch += lerp(0.25, 0.5, drop) * env;
          T.jaw = 0.2 * env;
          T.tongue = (0.5 + 0.5 * Math.sin(a.t * 15)) * env;
          T.tailWag *= 0.6;
          for (let i = 0; i < 2; i++) F[i].tRoot.x *= 1 + 0.35 * env;
          break;
        }
        case 'sniff': {
          const env = smoothstep(0, 0.3, a.t) * smoothstep(a.dur, a.dur - 0.3, a.t);
          T.pitch += 0.16 * env;
          T.neckPitch += 0.98 * env;
          T.headPitch += (0.5 + Math.sin(a.t * 17) * 0.06) * env;
          T.neckYaw += Math.sin(a.t * 2.6) * 0.3 * env;
          T.tailWag = 0.5;
          T.tailSpeed = 7;
          break;
        }
        case 'shake': {
          const env = Math.sin(Math.PI * k);
          const w = Math.sin(a.t * 38);
          T.roll += w * 0.2 * env;
          T.headRoll -= Math.sin(a.t * 38 + 1.0) * 0.55 * env;
          T.yaw += Math.sin(a.t * 38 + 0.5) * 0.07 * env;
          T.eye = 1 - 0.75 * env;
          T.earBack = 0.4 * env;
          T.tailWag = 1;
          T.tailSpeed = 38;
          break;
        }
        case 'roll': {
          const down = smoothstep(0, 0.3, a.t) * smoothstep(a.dur, a.dur - 0.32, a.t);
          const rk = clamp((a.t - 0.32) / (a.dur - 0.7), 0, 1);
          this.rollAngle = a.dir * TAU * easeInOut(rk);
          T.bodyY = lerp(T.bodyY, d.belly + 0.02 + Math.sin(Math.PI * rk) * d.R * 0.12, down);
          T.pitch = lerp(T.pitch, 0, down);
          const tuck = smoothstep(0.02, 0.2, rk) * smoothstep(1, 0.85, rk);
          for (let i = 0; i < 4; i++) {
            F[i].tW = tuck;
            F[i].tLocal.set(legs[i].joint.x * 1.1, legs[i].joint.y - d.legLen * 0.55, legs[i].joint.z + (legs[i].front ? 0.25 : 0.3) * d.legLen);
            // while down on the ground the paws stretch out as in a lie-down
            if (legs[i].front) _v.set(legs[i].side * d.hx * 0.95, 0, d.Lh + d.legLen * 0.8);
            else _v.set(legs[i].side * (d.hx + d.R * 0.5), 0, -d.Lh + d.legLen * 0.6);
            F[i].tRoot.lerp(_v, down);
          }
          T.jaw = 0.25 * tuck;
          T.tongue = 0.7 * tuck;
          T.tailWag = 1;
          T.tailSpeed = 15;
          break;
        }
        case 'spin': {
          this.spin = a.dir * TAU * easeInOut(k);
          const env = Math.sin(Math.PI * k);
          T.roll -= a.dir * 0.22 * env;
          T.headYaw += a.dir * 0.55 * env;
          T.neckYaw += a.dir * 0.4 * env;
          T.bodyY += Math.abs(Math.sin(k * Math.PI * 3)) * 0.02;
          T.tailWag = 1;
          T.tailSpeed = 16;
          break;
        }
        case 'greet': {
          const env = smoothstep(0, 0.25, a.t) * smoothstep(a.dur, a.dur - 0.25, a.t);
          T.neckPitch += 0.3 * env;
          T.headPitch += 0.12 * env;
          T.headRoll += Math.sin(a.t * 5.2) * 0.22 * env;
          T.bodyY += Math.max(0, Math.sin((a.t - 0.9) * 11)) * 0.03 * smoothstep(0.9, 1.0, a.t);
          T.tailWag = 1;
          T.tailSpeed = 18;
          T.yaw += Math.sin(a.t * 14) * 0.05 * env;
          break;
        }
        case 'dig': {
          const env = smoothstep(0, 0.3, a.t) * smoothstep(a.dur, a.dur - 0.3, a.t);
          T.pitch += 0.3 * env;
          T.bodyY -= 0.03 * env;
          T.neckPitch += 0.7 * env;
          T.headPitch += 0.3 * env;
          for (let i = 0; i < 2; i++) {
            const ph = a.t * 21 + i * Math.PI;
            F[i].tRoot.z += (0.1 + Math.sin(ph) * 0.09) * env * (d.legLen / 0.27);
            F[i].tRoot.y = Math.max(0, Math.cos(ph)) * 0.05 * env;
          }
          T.tailWag = 0.9;
          T.tailSpeed = 15;
          break;
        }
        case 'paw': {
          const env = smoothstep(0, 0.3, a.t) * smoothstep(a.dur, a.dur - 0.3, a.t);
          const i = 1;
          F[i].tW = env;
          F[i].tLocal.set(legs[i].joint.x * 0.8, legs[i].joint.y - d.legLen * 0.2 + Math.sin(a.t * 9) * d.legLen * 0.07, legs[i].joint.z + d.legLen * 0.78);
          T.headRoll += 0.2 * env;
          T.roll += 0.04 * env;
          T.tailWag = 0.9;
          T.tailSpeed = 13;
          break;
        }
        case 'nuzzle': {
          const env = Math.sin(Math.PI * k);
          T.neckPitch += 0.25 * env;
          T.headRoll += 0.3 * env;
          break;
        }
      }
    }

    // ---- in the air
    if (!this.grounded) {
      T.pitch = clamp(-this.vy * 0.07, -0.32, 0.3);
      T.earBack = 0.6;
      for (let i = 0; i < 4; i++) {
        F[i].tW = 1;
        const f = legs[i].front;
        const up = clamp(this.vy / 3.5, -1, 1);
        F[i].tLocal.set(
          legs[i].joint.x,
          legs[i].joint.y - d.legLen * (f ? 0.62 : 0.7),
          legs[i].joint.z + d.legLen * (f ? 0.5 + 0.15 * up : -0.45 - 0.15 * up)
        );
      }
    }

    // ---- swimming: paddle
    if (this.swim > 0.3) {
      const w = smoothstep(0.3, 0.8, this.swim);
      T.pitch = lerp(T.pitch, -0.14, w);
      T.neckPitch -= 0.3 * w;
      T.headPitch -= 0.05 * w;
      T.tailLift = lerp(T.tailLift, 0.3 - cfg.lift * 0.5, w);
      T.earBack = 0.3;
      const rate = 6 + v * 5;
      for (let i = 0; i < 4; i++) {
        const ph = t * rate + GAIT_TROT[i] * TAU;
        F[i].tW = Math.max(F[i].tW, w);
        F[i].tLocal.set(
          legs[i].joint.x,
          legs[i].joint.y - d.legLen * (0.66 + Math.sin(ph) * 0.14),
          legs[i].joint.z + d.legLen * (0.12 + Math.cos(ph) * 0.3)
        );
      }
    }
  }

  update(dt, t) {
    const rig = this.rig, d = this.dims, P = this.pose, T = this.target;
    const legs = rig.legs, F = this.feet;

    if (this.act) {
      this.act.t += dt;
      if (this.act.t >= this.act.dur) this._endAct();
    }
    this._targets(dt, t);

    // settle the pose toward its targets
    for (const k of POSE_KEYS) P[k] = damp(P[k], T[k], POSE_RATE[k], dt);
    const airborne = !this.grounded;
    for (let i = 0; i < 4; i++) {
      const f = F[i];
      const rate = airborne ? 22 : 13;
      f.root.x = damp(f.root.x, f.tRoot.x, rate, dt);
      f.root.y = damp(f.root.y, f.tRoot.y, rate, dt);
      f.root.z = damp(f.root.z, f.tRoot.z, rate, dt);
      f.local.x = damp(f.local.x, f.tLocal.x, 16, dt);
      f.local.y = damp(f.local.y, f.tLocal.y, 16, dt);
      f.local.z = damp(f.local.z, f.tLocal.z, 16, dt);
      f.w = damp(f.w, f.tW, 14, dt);
    }

    // ---- gait
    const v = this.speed / this.scale;
    const turning = Math.abs(this.turnRate) * 0.11 + (this.act && this.act.name === 'spin' ? 1.2 : 0);
    const gv = Math.max(v, Math.min(turning, 0.8));
    const upright = this.posture === 'stand' && this.grounded ? 1 : 0;
    this.gaitAmt = damp(this.gaitAmt, smoothstep(0.03, 0.4, gv) * upright, 10, dt);
    const run = smoothstep(2.6, 4.8, v);
    const trot = smoothstep(0.7, 1.9, v);
    const duty = lerp(lerp(0.64, 0.5, trot), 0.36, run);
    const stride = Math.min(d.legLen * lerp(1.45, 1.95, run), 0.1 + gv * 0.2) * (v < 0.05 ? 0.5 : 1);
    const freq = gv > 0.02 ? clamp((gv * duty) / Math.max(stride, 0.02), 0.6, 5.2) : 0;
    this.gaitPhase += freq * dt;
    const gp = this.gaitPhase;
    const lift = d.legLen * lerp(lerp(0.16, 0.26, trot), 0.36, run);
    let anyStep = false;
    for (let i = 0; i < 4; i++) {
      const off = lerp(lerp(GAIT_WALK[i], GAIT_TROT[i], trot), GAIT_GALLOP[i], run);
      let ph = gp + off;
      ph -= Math.floor(ph);
      let dz, dy;
      const stance = ph < duty;
      if (stance) {
        dz = stride * (0.5 - ph / duty);
        dy = 0;
      } else {
        const s = (ph - duty) / (1 - duty);
        dz = stride * (-0.5 + (s * s * (3 - 2 * s)));
        dy = Math.sin(Math.PI * s) * lift;
      }
      const f = F[i];
      f.gz = dz * this.gaitAmt;
      f.gy = dy * this.gaitAmt;
      if (stance && !this.lastStance[i] && this.gaitAmt > 0.5 && this.grounded) anyStep = true;
      this.lastStance[i] = stance;
    }
    if (anyStep) this.emit('step', run);

    // body rides the gait
    const g2 = Math.sin(gp * TAU * 2), g1 = Math.sin(gp * TAU);
    let bodyY = P.bodyY + (-0.012 * (1 - run) * trot * (0.5 - 0.5 * g2) + run * Math.sin(gp * TAU + 0.9) * 0.028) * this.gaitAmt * (d.legLen / 0.27);
    let pitch = P.pitch + run * Math.sin(gp * TAU + 2.2) * 0.1 * this.gaitAmt;
    let roll = P.roll + g1 * 0.03 * (1 - run) * this.gaitAmt - clamp(this.turnRate * v * 0.028, -0.3, 0.3) * this.gaitAmt;
    let yaw = P.yaw + g1 * 0.035 * (1 - run) * this.gaitAmt;

    // ---- breathing, panting, wagging
    this.breath += dt * (1.5 + this.pant * 7.5 + (this.posture === 'sleep' ? -0.6 : 0));
    const br = Math.sin(this.breath);
    this.landSquash = damp(this.landSquash || 0, 0, 9, dt);
    bodyY -= this.landSquash * d.legLen * 0.22;
    this.wagPhase += dt * P.tailSpeed;
    const wag = Math.sin(this.wagPhase);
    const waggle = wag * P.tailWag * 0.045 * (this.posture === 'stand' ? 1 : 0.6);
    yaw += waggle * 0.6;

    rig.body.position.set(0, bodyY, P.bodyZ);
    rig.body.rotation.set(pitch, yaw, roll + this.rollAngle);
    rig.body.scale.set(1 + br * 0.012 * (1 + this.pant), 1 + br * 0.018 * (1 + this.pant * 1.5), 1);
    rig.body.updateMatrix();

    // ---- legs (two-bone IK toward each foot target)
    _qi.copy(rig.body.quaternion).invert();
    for (let i = 0; i < 4; i++) {
      const f = F[i], leg = legs[i];
      // planted target in root space, with gait
      _v.set(f.root.x, f.root.y + f.gy + d.pawH, f.root.z + f.gz);
      if (f.w > 0.002) {
        _v2.copy(f.local).applyQuaternion(rig.body.quaternion).add(rig.body.position);
        _v.lerp(_v2, f.w);
      }
      // into body space, relative to the hip
      _v.sub(rig.body.position).applyQuaternion(_qi);
      // (compensate the breathing scale so paws don't pump)
      const dx = _v.x / rig.body.scale.x - leg.joint.x;
      const dy = _v.y / rig.body.scale.y - leg.joint.y;
      const dz = _v.z - leg.joint.z;
      const phi = clamp(Math.atan2(dx, Math.max(-dy, 0.02)), -1.25, 1.25);
      const dn = -dy * Math.cos(phi) + dx * Math.sin(phi);
      const L1 = leg.L1, L2 = leg.L2;
      const D = clamp(Math.hypot(dz, dn), Math.abs(L1 - L2) + 0.004, L1 + L2 - 0.0015);
      const alpha = Math.atan2(dz, dn);
      const beta = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
      const knee = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
      leg.hip.rotation.set(-(alpha + beta), 0, phi);
      leg.knee.rotation.x = knee;
    }

    // ---- head: look at things, fidget, blink
    let lookYaw = 0, lookPitch = 0, hasLook = false;
    if (this.look && this.posture !== 'sleep' && !(this.act && (this.act.name === 'drink' || this.act.name === 'sniff' || this.act.name === 'howl' || this.act.name === 'eat'))) {
      const hx = this.look.x - this.pos.x, hz = this.look.z - this.pos.z;
      const dist = Math.hypot(hx, hz);
      if (dist > 0.25) {
        const rel = angleDiff(this.heading + this.spin, Math.atan2(hx, hz));
        if (Math.abs(rel) < 2.2) {
          lookYaw = clamp(rel, -1.2, 1.2);
          const headH = this.pos.y + (bodyY + d.R + d.nLen) * this.scale;
          lookPitch = clamp(Math.atan2(headH - this.look.y, dist), -0.6, 0.7);
          hasLook = true;
        }
      }
    }
    this.idleTime = v < 0.1 ? this.idleTime + dt : 0;
    this.fidgetIn -= dt;
    if (this.fidgetIn <= 0) {
      this.fidgetIn = 2.5 + Math.random() * 5;
      const still = v < 0.1 && !this.act && this.posture !== 'sleep';
      this.fidget.t = still ? 0.9 + Math.random() * 1.6 : 0;
      this.fidget.yaw = hasLook ? 0 : (Math.random() - 0.5) * 1.5;
      this.fidget.roll = Math.random() < 0.4 ? (Math.random() < 0.5 ? -0.32 : 0.32) : 0;
      if (Math.random() < 0.5) this.earFlick = 1;
    }
    if (this.fidget.t > 0) {
      this.fidget.t -= dt;
      lookYaw += this.fidget.yaw;
      P.headRoll = damp(P.headRoll, T.headRoll + this.fidget.roll, 6, dt);
    }
    this.lookYaw = damp(this.lookYaw || 0, lookYaw, 7, dt);
    this.lookPitch = damp(this.lookPitch || 0, lookPitch, 7, dt);
    this.earFlick = damp(this.earFlick, 0, 9, dt);

    const pantBob = Math.sin(this.breath * 2) * 0.018 * this.pant;
    const happyOpen = this.happy > 0.55 && this.posture !== 'sleep' ? 0.12 : 0;
    const jaw = Math.max(P.jaw, this.pant * 0.3 + happyOpen * (1 - this.pant), this.carry ? 0.3 : 0);
    const tongue = this.carry ? 0 : Math.max(P.tongue, this.pant * 0.85, happyOpen * 3.2);

    rig.neck.rotation.set(d.neckBase + P.neckPitch + this.lookPitch * 0.45 - pitch * 0.35, P.neckYaw + this.lookYaw * 0.55, 0);
    rig.head.rotation.set(
      -d.neckBase * 0.92 + P.headPitch - P.neckPitch * 0.35 + this.lookPitch * 0.55 + pantBob - (pitch - P.pitch) * 0.5,
      P.headYaw + this.lookYaw * 0.45,
      P.headRoll
    );
    rig.jaw.rotation.x = jaw * 0.95;
    rig.tongue.position.set(rig.tongueRest.x, rig.tongueRest.y - tongue * d.sR * 0.25, rig.tongueRest.z + tongue * Math.max(d.sL, 0.05) * 0.5);
    rig.tongue.rotation.x = tongue * 0.6;

    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkIn = 1.8 + Math.random() * 4.5;
      this.blink = 1;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const open = clamp(P.eye * (1 - Math.sin(Math.min(this.blink, 1) * Math.PI)), 0.1, 1);
    for (const eye of rig.eyes) eye.scale.set(1, open, 1);

    // ears
    const bounce = Math.abs(g1) * run * this.gaitAmt + Math.abs(g2) * trot * (1 - run) * this.gaitAmt * 0.4;
    for (const ear of rig.ears) {
      const r = ear.userData.rest, s = ear.userData.side;
      if (this.breed.ears.type === 'pointy') {
        ear.rotation.set(r.x - P.earBack * 0.75 + this.earFlick * 0.25 + (hasLook ? 0.08 : 0), r.y, r.z - s * P.earBack * 0.25 + s * this.earFlick * 0.2);
      } else {
        ear.rotation.set(r.x + P.earBack * 0.85 + bounce * 0.5, r.y, r.z + s * (P.earBack * 0.5 + bounce * 0.55 + this.earFlick * 0.3));
      }
    }

    // tail
    const cfg = rig.tailCfg;
    const tailLift = cfg.lift + P.tailLift + (this.happy - 0.35) * 0.25;
    rig.tailBase.rotation.x = -(Math.PI / 2 - tailLift);
    rig.tail.forEach((seg, i) => {
      seg.rotation.x = i === 0 ? 0 : cfg.curl * (1 - 0.35 * run) + bounce * 0.12;
      seg.rotation.z = Math.sin(this.wagPhase - i * 0.6) * P.tailWag * cfg.wag * (0.42 + 0.3 * i);
    });

    // wet fur is darker and glossier
    const wet = this.wet;
    if (Math.abs(wet - (this._wetShown ?? -1)) > 0.01) {
      this._wetShown = wet;
      rig.setWet(wet);
    }

    // root
    this.root.rotation.y = this.heading + this.spin;
    rig.tilt.rotation.set(this.tiltPitch, 0, this.tiltRoll);
  }

  /** World position of the mouth (for carrying, crumbs, drinking ripples). */
  mouthWorld(out) {
    return this.rig.mouth.getWorldPosition(out);
  }

  headWorld(out) {
    return this.rig.head.getWorldPosition(out);
  }

  /** A point a little in front of the nose on the ground plane. */
  nosePoint(out, ahead = 0.42) {
    const s = this.scale * (this.dims.Lh + this.dims.hr + ahead * 0.3);
    return out.set(this.pos.x + Math.sin(this.heading) * (s + ahead * 0.3), this.pos.y, this.pos.z + Math.cos(this.heading) * (s + ahead * 0.3));
  }
}
