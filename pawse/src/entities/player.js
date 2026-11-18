import * as THREE from 'three';
import { Dog } from './dog.js';
import { BREEDS } from './breeds.js';
import { clamp, damp, angleDiff, dampAngle } from '../core/utils.js';
import { WORLD } from '../world/terrain.js';
import { CELL } from '../fx/particles.js';

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Vector3();

const TRICK_KEYS = {
  Digit1: 'sit', Digit2: 'lie', Digit3: 'roll', Digit4: 'spin', Digit5: 'paw', Digit6: 'beg', Digit7: 'bow',
  KeyF: 'bark', KeyH: 'howl', KeyR: 'shake',
};

/** The dog you are. Reads input, decides what "E" means right now, and tracks little joys. */
export class Player {
  constructor(game, breedId) {
    this.game = game;
    this.walkSpeed = 2.7;
    this.runSpeed = 6.3;
    this.carry = null;
    this.ctx = null;
    this.stats = {
      sprint: 0, swim: 0, tricks: new Set(), stick: 0, still: 0, lie: 0, night: 0, sunset: 0, drink: 0, lap: 0, zzz: 0,
    };
    this.burst = 0;
    this.leavers = []; // dogs running off the title screen after you picked another
    this.arrive = null; // the new pick, running in
    this.spot = null; // where the dog stands on the title screen
    this.setBreed(breedId, true);
  }

  /** Take a dog that has left the scene away and free its geometry. */
  _dispose(dog) {
    this.game.scene.remove(dog.root);
    dog.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
  }

  /**
   * Become another breed. On the title screen the old dog runs off to one side and the new one runs
   * in from the other (`dir`: 1 = the next breed, coming in from the right).
   */
  setBreed(id, first = false, dir = 1) {
    const g = this.game;
    const old = this.dog;
    const breed = BREEDS[id] || BREEDS.shiba;
    this.breedId = breed.id;
    const dog = new Dog(breed, { name: 'you' });
    dog.isPlayer = true;
    dog.onEvent = (type, data, d) => g.dogEvent(type, data, d);
    if (old) {
      this.spot ||= { x: old.pos.x, y: old.pos.y, z: old.pos.z, posture: old.posture };
      const S = this.spot;
      g.cam.anchor = S; // the camera keeps to the spot while they run
      g.cam.basis(_f, _r);
      // off it goes, the way the old one was not coming from
      this.leavers.push({ dog: old, dx: -_r.x * dir, dz: -_r.z * dir, t: 0 });
      // and in comes the new one, from just outside the frame
      const from = 4.5;
      dog.place(S.x + _r.x * dir * from, S.z + _r.z * dir * from, Math.atan2(-_r.x * dir, -_r.z * dir), g.terrain);
      dog.posture = 'stand';
      this.arrive = { turning: false };
    }
    g.scene.add(dog.root);
    this.dog = dog;
  }

  /** The title screen's comings and goings. */
  _titleRun(dt, t) {
    const g = this.game;
    for (let i = this.leavers.length - 1; i >= 0; i--) {
      const l = this.leavers[i];
      l.t += dt;
      l.dog.move(dt, g, l.dx, l.dz, Math.min(this.runSpeed * 0.8, 1.5 + l.t * 6));
      l.dog.update(dt, t);
      if (l.t > 3 || Math.hypot(l.dog.pos.x - this.spot.x, l.dog.pos.z - this.spot.z) > 8) {
        this._dispose(l.dog);
        this.leavers.splice(i, 1);
      }
    }
  }

  /** Run the new pick in to the spot, turn it round, sit it down. True while it is still arriving. */
  _arriving(dt) {
    const g = this.game, dog = this.dog, S = this.spot, a = this.arrive;
    if (!a || g.state !== 'title') {
      this.arrive = null;
      return false;
    }
    const dx = S.x - dog.pos.x, dz = S.z - dog.pos.z, d = Math.hypot(dx, dz);
    if (!a.turning && d > 0.18) {
      // slow down over the last metre or so
      dog.move(dt, g, dx / d, dz / d, clamp(d * 2.6, 0.9, this.runSpeed * 0.75));
      return true;
    }
    a.turning = true;
    dog.move(dt, g, 0, 0, 0);
    // three-quarters on to the camera, as the title screen first shows the dog (it keeps circling)
    const face = g.cam.yaw + 1.0;
    dog.heading = dampAngle(dog.heading, face, 6, dt);
    if (Math.abs(angleDiff(dog.heading, face)) < 0.08 && dog.speed < 0.05) {
      dog.setPosture(S.posture);
      this.arrive = null;
    }
    return true;
  }

  // ------------------------------------------------------------------ tricks

  trick(name) {
    const dog = this.dog, g = this.game;
    let ok = false;
    switch (name) {
      case 'sit':
      case 'lie':
      case 'beg':
      case 'bow':
        ok = dog.setPosture(dog.posture === name ? 'stand' : name);
        if (dog.posture !== name) name = null;
        break;
      case 'bark':
        ok = dog.doAct('bark');
        break;
      default:
        ok = dog.doAct(name);
    }
    if (!ok || !name) return;
    if (name !== 'bark') this.stats.tricks.add(name);
    if (this.stats.tricks.size >= 5) g.joys.unlock('tricks');
    g.onTrick(name, dog);
  }

  // ---------------------------------------------------------------- carrying

  pickUp(item) {
    if (this.carry || !item.pickUp(this.dog)) return;
    this.carry = item;
    this.dog.carry = item;
    this.game.audio.sfx('pickup');
  }

  drop() {
    const item = this.carry;
    if (!item) return;
    this.carry = null;
    this.dog.carry = null;
    item.drop(this.dog, true);
    this.game.audio.sfx('toss');
  }

  // ---------------------------------------------------------------- context

  _drinkSpot() {
    const g = this.game, dog = this.dog;
    if (dog.swim > 0.3) return null;
    for (const s of g.props.drinkSpots) {
      if (Math.hypot(s.x - dog.pos.x, s.z - dog.pos.z) < s.r + dog.radius) return s;
    }
    dog.nosePoint(_n, 0.5);
    const ahead = g.terrain.waterDepthAt(_n.x, _n.z);
    const here = g.terrain.waterDepthAt(dog.pos.x, dog.pos.z);
    if (ahead > 0.015 && here < dog.dims.legLen * dog.scale * 0.6) return { kind: 'pond', x: _n.x, z: _n.z };
    return null;
  }

  _context() {
    const g = this.game, dog = this.dog;
    if (dog.locked || !dog.grounded) return null;
    if (this.carry) {
      const k = this.carry.kind;
      return { label: k === 'ball' ? 'Toss the ball' : 'Drop the stick', run: () => this.drop() };
    }
    let best = null, bd = 2.2;
    for (const n of g.npcs) {
      const d = Math.hypot(n.dog.pos.x - dog.pos.x, n.dog.pos.z - dog.pos.z) - n.dog.radius;
      if (d < bd && n.canGreet()) {
        best = n;
        bd = d;
      }
    }
    if (best) return { label: best.friend ? `Nuzzle ${best.name}` : `Say hello to ${best.name}`, run: () => best.greet(this) };

    dog.nosePoint(_n, 0.1);
    const item = g.items.nearestCarryable(_n, 0.95 * Math.max(dog.scale, 0.9));
    if (item) return { label: `Pick up the ${item.kind}`, run: () => this.pickUp(item) };

    const dig = g.items.nearestDig(dog.pos, 1.25);
    if (dig) return { label: 'Dig here', run: () => g.items.dig(dig, this) };

    const spot = this._drinkSpot();
    if (spot) return { label: 'Have a drink', run: () => this.drink(spot) };

    const patch = g.flora.patches.find((p) => Math.hypot(p.x - dog.pos.x, p.z - dog.pos.z) < p.r * 0.7);
    if (patch && dog.swim < 0.2) {
      return {
        label: 'Smell the flowers',
        run: () => {
          if (dog.doAct('sniff')) {
            g.audio.sfx('sniff');
            g.joys.unlock('flowers');
            this.cheer(0.5);
          }
        },
      };
    }
    return null;
  }

  drink(spot) {
    const dog = this.dog;
    if (spot.kind !== 'pond') dog.heading = Math.atan2(spot.x - dog.pos.x, spot.z - dog.pos.z);
    const drop = spot.kind === 'fountain' ? 0.25 : spot.kind === 'bowl' ? 0.92 : 1;
    if (dog.doAct('drink', { drop, spot })) this.stats.lap = 0;
  }

  interact() {
    if (this.ctx) this.ctx.run();
    else if (this.dog.doAct('sniff')) this.game.audio.sfx('sniff');
  }

  /** A little rush of happiness: faster tail, bright eyes. */
  cheer(amount = 1) {
    this.burst = Math.min(1.2, this.burst + amount);
  }

  // ------------------------------------------------------------------ update

  update(dt, t) {
    const g = this.game, inp = g.input, dog = this.dog, st = this.stats;
    const playing = g.state === 'play';

    if (playing) {
      for (const code in TRICK_KEYS) if (inp.hit(code)) this.trick(TRICK_KEYS[code]);
      if (inp.hit('Space') && dog.jump()) g.audio.sfx('jump');
      if (inp.hit('KeyE')) this.interact();
    }

    if (this.leavers.length) this._titleRun(dt, t);

    g.cam.basis(_f, _r);
    const mx = playing ? inp.move.x : 0, my = playing ? inp.move.y : 0;
    const mag = Math.min(1, Math.hypot(mx, my));
    const wx = _f.x * my + _r.x * mx, wz = _f.z * my + _r.z * mx;
    const speed = mag > 0.05 ? (inp.run ? this.runSpeed : this.walkSpeed) * (inp.run ? 1 : Math.max(mag, 0.45)) : 0;
    const px = dog.pos.x, pz = dog.pos.z;
    if (!this._arriving(dt)) dog.move(dt, g, wx, wz, speed);
    const stepDist = Math.hypot(dog.pos.x - px, dog.pos.z - pz);

    // mood
    this.burst = Math.max(0, this.burst - dt * 0.22);
    let near = 0;
    let look = null, ld = 6;
    for (const n of g.npcs) {
      const d = Math.hypot(n.dog.pos.x - dog.pos.x, n.dog.pos.z - dog.pos.z);
      if (d < 5) near = Math.max(near, n.friend ? 0.35 : 0.15);
      if (d < ld) {
        ld = d;
        look = n.dog.headWorld(_m);
      }
    }
    if (!look) {
      const tr = g.items.nearestTreat(dog.pos, 4.5);
      if (tr) look = _m.set(tr.x, tr.y, tr.z);
    }
    dog.look = look ? (this._look ||= new THREE.Vector3()).copy(look) : null;
    dog.happy = damp(dog.happy, clamp(0.4 + near + this.burst, 0, 1), 3, dt);
    const sprinting = dog.speed > 4.6;
    dog.pant = clamp(dog.pant + (sprinting ? dt * 0.085 : -dt * 0.05), 0, 1);

    // drinking: lapping sounds and ripples
    if (dog.actName === 'drink') {
      st.lap += dt;
      st.drink += dt;
      if (st.lap > 0.2 && dog.act.t > 0.45 && dog.act.t < dog.act.dur - 0.4) {
        st.lap = 0;
        g.audio.sfx('lap', { x: dog.pos.x, z: dog.pos.z });
        const spot = dog.act.data.spot;
        if (spot && spot.kind === 'pond') g.water.addRipple(spot.x, spot.z, 0.22);
      }
      if (st.drink > 1.6) {
        g.joys.unlock('drink');
        dog.pant = Math.max(0, dog.pant - dt * 0.6);
      }
    } else {
      st.drink = 0;
    }

    // a long lie-down turns into a nap
    if (dog.posture === 'lie' && !dog.act) {
      st.lie += dt;
      if (st.lie > 6.5 && dog.setPosture('sleep')) {
        g.joys.unlock('nap');
        g.audio.sfx('yawn');
      }
    } else if (dog.posture !== 'sleep') {
      st.lie = 0;
    }
    if (dog.posture === 'sleep') {
      st.zzz -= dt;
      if (st.zzz <= 0) {
        st.zzz = 1.5;
        dog.headWorld(_m);
        g.fx.spawn({
          x: _m.x, y: _m.y + 0.18, z: _m.z, vx: 0.08, vy: 0.22, vz: 0.02, life: 2.6, size: 0.12, sizeEnd: 0.24,
          color: '#ffffff', alpha: 0.85, cell: CELL.ZZZ, sway: 0.12, fadeIn: 0.15, fadeOut: 0.5,
        });
      }
    }

    // little joys that come from just being there
    if (playing) {
      st.sprint = sprinting ? st.sprint + dt : 0;
      if (st.sprint > 12) g.joys.unlock('zoomies');
      st.swim = dog.swim > 0.7 ? st.swim + dt : 0;
      if (st.swim > 1.2) g.joys.unlock('swim');
      if (Math.hypot(dog.pos.x - WORLD.hill.x, dog.pos.z - WORLD.hill.z) < 6.5) g.joys.unlock('hill');
      if (Math.hypot(dog.pos.x - WORLD.island.x, dog.pos.z - WORLD.island.z) < 2.3 && dog.swim < 0.2) g.joys.unlock('island');
      const resting = dog.posture === 'sit' || dog.posture === 'lie' || dog.posture === 'sleep';
      const phase = g.sky.phase().name;
      st.sunset = resting && phase === 'Sunset' ? st.sunset + dt : 0;
      if (st.sunset > 3) g.joys.unlock('sunset');
      st.night = g.sky.night > 0.85 ? st.night + dt : 0;
      if (st.night > 8) g.joys.unlock('fireflies');
      if (phase === 'Dawn' && g.sky.elevation > -0.02) g.joys.unlock('dawn');
      if (this.carry && this.carry.kind === 'stick') {
        st.stick += stepDist;
        if (st.stick > 40) g.joys.unlock('stick');
      }
    }

    this.ctx = playing ? this._context() : null;
    dog.update(dt, t);
  }
}
