import * as THREE from 'three';
import { Dog } from './dog.js';
import { BREEDS } from './breeds.js';
import { clamp, damp, TAU, lerp } from '../core/utils.js';
import { WORLD, pondNorm, pondShorePoint } from '../world/terrain.js';
import { CELL } from '../fx/particles.js';

const rand = (a, b) => a + Math.random() * (b - a);
const _h = new THREE.Vector3();

function makeLabel(name, friend) {
  const cv = document.createElement('canvas');
  cv.width = 320;
  cv.height = 80;
  const g = cv.getContext('2d');
  g.font = '600 38px ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = friend ? `♥ ${name}` : name;
  const w = g.measureText(text).width + 44;
  g.fillStyle = 'rgba(22, 28, 24, 0.42)';
  g.beginPath();
  g.roundRect(160 - w / 2, 14, w, 52, 26);
  g.fill();
  g.fillStyle = friend ? '#ffe3ea' : '#ffffff';
  g.fillText(text, 160, 42);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** One of the park regulars. A small state machine with a personality. */
export class NpcDog {
  constructor(game, def) {
    this.game = game;
    this.name = def.name;
    this.traits = def.traits || {};
    const breed = BREEDS[def.breed];
    const dog = (this.dog = new Dog(breed, { name: def.name, scale: def.scale, collar: def.collar }));
    dog.npc = this;
    dog.onEvent = (type, data, d) => game.dogEvent(type, data, d);
    this.home = { x: def.home[0], z: def.home[1] };
    dog.place(this.home.x, this.home.z, Math.random() * TAU, game.terrain);
    game.scene.add(dog.root);

    const pace = breed.pace || 1;
    this.walkSpeed = 1.45 * pace;
    this.trotSpeed = 2.9 * pace;
    this.runSpeed = 5.7 * pace;
    this.state = 'idle';
    this.timer = rand(1, 5);
    this.target = { x: this.home.x, z: this.home.z };
    this.friend = false;
    this.trust = 0;
    this.cool = { greet: 0, bark: 0, mimic: 0, invite: rand(15, 40), tag: 0 };
    this.pending = [];
    this.wx = 0;
    this.wz = 1;
    this.ws = 0;
    this.pd = 99;
    this.allowWater = false;
    this.stuckT = 0;
    this.stuckX = dog.pos.x;
    this.stuckZ = dog.pos.z;
    this.path = [];
    this.partner = null;
    this.tagCount = 0;
    this.followT = 0;
    this.burst = 0;

    this.labelMat = new THREE.SpriteMaterial({ map: makeLabel(this.name, false), transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.label = new THREE.Sprite(this.labelMat);
    const d = dog.dims;
    this.label.position.set(0, d.standH + d.R + d.hr * 2.4 + 0.2, 0);
    this.label.scale.set(0.92 / dog.scale, 0.23 / dog.scale, 1);
    this.label.renderOrder = 30;
    dog.root.add(this.label);
  }

  setFriend(v, quiet = false) {
    if (this.friend === v) return;
    this.friend = v;
    this.labelMat.map.dispose();
    this.labelMat.map = makeLabel(this.name, v);
    if (v && !quiet) this.game.onFriend(this);
  }

  later(delay, fn) {
    this.pending.push({ t: delay, fn });
  }

  emote(cell, color = '#ffffff', n = 1) {
    const g = this.game;
    this.dog.headWorld(_h);
    for (let i = 0; i < n; i++) {
      g.fx.spawn({
        x: _h.x + rand(-0.12, 0.12), y: _h.y + 0.25 * this.dog.scale + rand(0, 0.1), z: _h.z + rand(-0.12, 0.12),
        vx: rand(-0.15, 0.15), vy: rand(0.35, 0.6), vz: rand(-0.15, 0.15), life: rand(1.1, 1.7), size: 0.15, sizeEnd: 0.22,
        color, cell, drag: 1.2, fadeIn: 0.1, fadeOut: 0.5, rot: rand(-0.3, 0.3),
      });
    }
  }

  get busy() {
    return ['greeting', 'tagChase', 'tagFlee', 'tagWait', 'fetchGo', 'fetchReturn', 'approach'].includes(this.state) || this.dog.locked;
  }

  // ----------------------------------------------------------- player hooks

  canGreet() {
    if (this.traits.shy && !this.friend && this.trust < 1) return false;
    return this.cool.greet <= 0 && !['tagChase', 'tagFlee', 'tagWait', 'fetchGo', 'fetchReturn', 'greeting'].includes(this.state) && !this.dog.locked;
  }

  greet(player) {
    const g = this.game, dog = this.dog, pdog = player.dog;
    const a = Math.atan2(pdog.pos.x - dog.pos.x, pdog.pos.z - dog.pos.z);
    dog.heading = a;
    dog.posture = 'stand';
    pdog.heading = a + Math.PI;
    dog.cancelAct();
    dog.doAct('greet');
    pdog.doAct('greet');
    this.state = 'greeting';
    this.timer = 1.75;
    this.cool.greet = 7;
    const first = !this.friend;
    this.setFriend(true);
    this.burst = 1;
    player.cheer(0.8);
    this.emote(CELL.HEART, '#ff7d9c', first ? 5 : 2);
    g.audio.sfx(first ? 'friend' : 'heart', { x: dog.pos.x, z: dog.pos.z });
    this.later(0.5, () => g.audio.bark(dog, 0.7, true));
    this.followT = rand(55, 95);
  }

  onPlayerTrick(name, pdog) {
    if (this.pd > 8.5 || this.busy || this.state === 'sleep') return;
    if (this.traits.shy && !this.friend) return;
    if (name === 'bow' && this.cool.tag <= 0 && this.pd < 7.5) {
      this.later(rand(0.35, 0.7), () => this.startTag());
      return;
    }
    if (!this.friend && Math.random() > 0.4) return;
    if (this.cool.mimic > 0) return;
    this.cool.mimic = 2.5;
    this.later(rand(0.4, 1.1), () => {
      if (this.busy) return;
      const dog = this.dog, g = this.game;
      this.state = 'idle';
      this.timer = 4.5;
      dog.heading = Math.atan2(pdog.pos.x - dog.pos.x, pdog.pos.z - dog.pos.z);
      let did = true;
      if (name === 'sit' || name === 'lie' || name === 'beg') dog.setPosture(name);
      else if (name === 'howl') {
        dog.doAct('howl');
        g.audio.howl(dog);
        g.onHowl(this);
      } else if (name === 'bark') did = false;
      else dog.doAct(name);
      if (did) {
        g.joys.unlock('copycat');
        this.emote(CELL.NOTE, '#ffe9a8');
        this.followT = Math.max(this.followT, 40);
      }
    });
  }

  onBark(src, x, z) {
    const d = Math.hypot(x - this.dog.pos.x, z - this.dog.pos.z);
    if (this.state === 'sleep' && d < 9) {
      this.state = 'idle';
      this.dog.posture = 'lie';
      this.timer = 3;
      this.emote(CELL.SPARK, '#ffffff');
      return;
    }
    if (src === this.dog || d > 13 || this.cool.bark > 0 || this.busy) return;
    if (this.traits.shy && !this.friend) return;
    if (Math.random() < 0.55) {
      this.cool.bark = rand(2.5, 5);
      this.later(rand(0.35, 0.9), () => {
        if (this.dog.doAct('bark')) this.game.audio.bark(this.dog);
      });
    }
  }

  onBall(ball, pdog) {
    if (this.busy || this.state === 'sleep' || (this.traits.shy && !this.friend)) return false;
    if (!this.friend && !this.traits.fetcher) return false;
    const d = Math.hypot(ball.pos.x - this.dog.pos.x, ball.pos.z - this.dog.pos.z);
    if (d > 26) return false;
    this.state = 'fetchGo';
    this.timer = 14;
    this.dog.posture = 'stand';
    this.ball = ball;
    this.emote(CELL.SPARK, '#fff3a6');
    return true;
  }

  startTag() {
    if (this.busy) return;
    const dog = this.dog, g = this.game, pdog = g.player.dog;
    dog.posture = 'stand';
    dog.heading = Math.atan2(pdog.pos.x - dog.pos.x, pdog.pos.z - dog.pos.z);
    dog.setPosture('bow');
    this.state = 'tagWait';
    this.timer = 1.1;
    this.next = 'tagFlee';
    this.tagCount = 0;
    this.tagTime = 0;
    this.grace = 0.6;
    this.emote(CELL.NOTE, '#ffe9a8', 2);
    g.audio.bark(dog, 0.85, true);
    g.ui.toast(`${this.name} wants to play! Catch them.`, 2600);
  }

  endTag(msg) {
    this.state = 'follow';
    this.followT = rand(40, 70);
    this.cool.tag = 6;
    this.dog.pant = 0.9;
    this.game.player.dog.pant = Math.max(this.game.player.dog.pant, 0.6);
    if (msg) this.game.ui.toast(msg, 2400);
  }

  // ------------------------------------------------------------------ steering

  steer(tx, tz, speed) {
    const dog = this.dog, g = this.game;
    let dx = tx - dog.pos.x, dz = tz - dog.pos.z;
    const d = Math.hypot(dx, dz) || 1e-5;
    dx /= d;
    dz /= d;
    if (!this.allowWater) {
      // skirt the pond instead of wading in
      const ax = dog.pos.x + dx * 1.3, az = dog.pos.z + dz * 1.3;
      if (g.terrain.waterDepthAt(ax, az) > 0.05) {
        let ox = dog.pos.x - WORLD.pond.x, oz = dog.pos.z - WORLD.pond.z;
        const ol = Math.hypot(ox, oz) || 1;
        ox /= ol;
        oz /= ol;
        let tx2 = -oz, tz2 = ox;
        if (tx2 * dx + tz2 * dz < 0) {
          tx2 = -tx2;
          tz2 = -tz2;
        }
        dx = tx2 * 0.85 + ox * 0.55;
        dz = tz2 * 0.85 + oz * 0.55;
        const l = Math.hypot(dx, dz);
        dx /= l;
        dz /= l;
      }
    }
    this.wx = dx;
    this.wz = dz;
    this.ws = speed;
    return d;
  }

  randomPoint(cx, cz, radius) {
    const g = this.game;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * radius;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (Math.hypot(x, z) > WORLD.parkRadius - 4) continue;
      if (pondNorm(x, z) < 1.12) continue;
      if (g.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.6)) continue;
      return { x, z };
    }
    return { x: this.home.x, z: this.home.z };
  }

  idleFor(seconds, posture) {
    this.state = 'idle';
    this.timer = seconds;
    this.allowWater = false;
    if (posture) this.dog.setPosture(posture);
  }

  pickActivity() {
    const g = this.game, tr = this.traits, dog = this.dog;
    const night = g.sky.night > 0.6;
    const opts = [['wander', 40]];
    opts.push(['zoomies', (tr.energy || 0.5) * (night ? 6 : 22)]);
    opts.push(['drink', 7]);
    opts.push(['sleep', tr.sleepy ? 34 : night ? 26 : 3]);
    opts.push(['sniff', 9]);
    if (tr.swimmer && !night) opts.push(['swim', 14]);
    if (tr.howler && night) opts.push(['howl', 22]);
    if (tr.hungry && g.items.nearestTreat(dog.pos, 34)) opts.push(['treat', 30]);
    if (this.friend && this.pd < 22 && this.followT > 0) opts.push(['follow', 60]);
    const mate = g.npcs.find((n) => n !== this && n.state === 'idle' && !n.traits.sleepy && !(n.traits.shy && !n.friend) &&
      Math.hypot(n.dog.pos.x - dog.pos.x, n.dog.pos.z - dog.pos.z) < 26);
    if (mate && !night && !(tr.shy && !this.friend)) opts.push(['pair', 16 * (tr.energy || 0.5)]);
    let total = 0;
    for (const o of opts) total += o[1];
    let r = Math.random() * total, choice = 'wander';
    for (const o of opts) {
      r -= o[1];
      if (r <= 0) {
        choice = o[0];
        break;
      }
    }
    dog.setPosture('stand');
    this.allowWater = false;
    switch (choice) {
      case 'wander':
        this.target = this.randomPoint(this.home.x, this.home.z, tr.energy > 0.8 ? 34 : 18);
        this.state = 'wander';
        this.gait = Math.random() < 0.3 ? this.trotSpeed : this.walkSpeed;
        this.timer = 22;
        break;
      case 'zoomies': {
        this.path = [];
        const n = 4 + Math.floor(Math.random() * 3), a0 = Math.random() * TAU, R = rand(7, 12);
        const c = this.randomPoint(dog.pos.x, dog.pos.z, 6);
        for (let i = 0; i < n; i++) {
          const a = a0 + (i / n) * TAU;
          const p = { x: c.x + Math.cos(a) * R, z: c.z + Math.sin(a) * R };
          if (Math.hypot(p.x, p.z) < WORLD.parkRadius - 4 && pondNorm(p.x, p.z) > 1.15) this.path.push(p);
        }
        this.state = this.path.length ? 'zoomies' : 'idle';
        this.timer = 16;
        break;
      }
      case 'drink': {
        const a = Math.atan2(dog.pos.z - WORLD.pond.z, dog.pos.x - WORLD.pond.x) + rand(-0.5, 0.5);
        this.target = pondShorePoint(a, 1.035);
        this.state = 'toDrink';
        this.timer = 40;
        break;
      }
      case 'swim':
        this.target = { x: WORLD.island.x + rand(-1, 1), z: WORLD.island.z + rand(-1, 1) };
        this.state = 'swimOut';
        this.allowWater = true;
        this.timer = 60;
        break;
      case 'sleep':
        this.state = 'sleep';
        this.timer = rand(22, 46);
        dog.setPosture('lie');
        this.later(2.5, () => {
          if (this.state === 'sleep') dog.setPosture('sleep');
        });
        break;
      case 'sniff':
        this.idleFor(3, 'stand');
        dog.doAct('sniff');
        break;
      case 'howl':
        this.idleFor(4, 'stand');
        if (dog.doAct('howl')) {
          g.audio.howl(dog);
          g.onHowl(this);
        }
        break;
      case 'treat': {
        const t = g.items.nearestTreat(dog.pos, 34);
        this.target = { x: t.x, z: t.z };
        this.state = 'treat';
        this.timer = 20;
        break;
      }
      case 'follow':
        this.state = 'follow';
        break;
      case 'pair':
        this.partner = mate;
        mate.partner = this;
        this.state = 'pairChase';
        mate.state = 'pairFlee';
        this.timer = mate.timer = rand(8, 14);
        mate.dog.setPosture('stand');
        this.emote(CELL.NOTE, '#ffe9a8');
        break;
    }
  }

  // -------------------------------------------------------------------- update

  update(dt, t) {
    const g = this.game, dog = this.dog, tr = this.traits;
    const pdog = g.player.dog;
    const px = pdog.pos.x - dog.pos.x, pz = pdog.pos.z - dog.pos.z;
    const pd = (this.pd = Math.hypot(px, pz));
    for (const k in this.cool) this.cool[k] = Math.max(0, this.cool[k] - dt);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) {
        this.pending.splice(i, 1);
        p.fn();
      }
    }
    this.timer -= dt;
    this.ws = 0;
    this.followT = Math.max(0, this.followT - dt);
    const playing = g.state === 'play';

    // the shy one keeps her distance until you are calm and still nearby
    if (tr.shy && !this.friend && playing && this.state !== 'approach') {
      const calm = pdog.posture !== 'stand' && pdog.speed < 0.2;
      if (pd < 13 && calm) this.trust += dt / 5.5;
      else if (pd < 7 && pdog.speed > 3) this.trust = Math.max(0, this.trust - dt * 0.5);
      if (this.trust >= 1) {
        this.state = 'approach';
        this.timer = 20;
        dog.setPosture('stand');
        this.emote(CELL.HEART, '#ffb3c4');
      } else if (pd < 6.5 && !calm && this.state !== 'shyFlee') {
        // skitter off, but not far: she is curious too
        const a = Math.atan2(-pz, -px) + rand(-0.6, 0.6);
        this.target = this.randomPoint(dog.pos.x + Math.cos(a) * 6.5, dog.pos.z + Math.sin(a) * 6.5, 2);
        this.state = 'shyFlee';
        this.timer = 4;
        dog.setPosture('stand');
        if (!this.hinted) {
          this.hinted = true;
          g.ui.toast(`${this.name} is shy. Try sitting down and letting her come to you.`, 5200);
        }
      }
    }

    switch (this.state) {
      case 'idle':
        if (this.timer <= 0) {
          if (this.afterIdle) {
            this.state = this.afterIdle;
            this.afterIdle = null;
            dog.setPosture('stand');
          } else if (Math.random() < 0.45 && dog.posture === 'stand') this.idleFor(rand(3, 8), Math.random() < 0.6 ? 'sit' : 'lie');
          else this.pickActivity();
        }
        // invite the player to play now and then
        if (this.friend && playing && pd < 6 && this.cool.invite <= 0 && this.cool.tag <= 0 && pdog.speed < 1 && !tr.sleepy) {
          this.cool.invite = rand(45, 90);
          this.startTag();
        }
        break;

      case 'wander': {
        const d = this.steer(this.target.x, this.target.z, this.gait);
        if (d < 0.9 || this.timer <= 0) this.idleFor(rand(2.5, 7), Math.random() < 0.5 ? 'sit' : 'stand');
        break;
      }

      case 'shyFlee': {
        const d = this.steer(this.target.x, this.target.z, this.trotSpeed * 1.15);
        if (d < 1 || this.timer <= 0) this.idleFor(rand(3, 6), 'sit');
        break;
      }

      case 'approach': {
        const d = this.steer(pdog.pos.x, pdog.pos.z, this.walkSpeed * 0.8);
        if (d < 1.25 + pdog.radius) {
          this.ws = 0;
          this.greet(g.player);
          g.joys.unlock('shy');
        } else if (this.timer <= 0 || pdog.speed > 2.5) {
          this.trust = 0.4;
          this.idleFor(2, 'sit');
        }
        break;
      }

      case 'zoomies': {
        const p = this.path[0];
        if (!p || this.timer <= 0) {
          dog.pant = 1;
          this.idleFor(rand(4, 8), 'lie');
          break;
        }
        if (this.steer(p.x, p.z, this.runSpeed) < 1.6) this.path.shift();
        break;
      }

      case 'toDrink': {
        const d = this.steer(this.target.x, this.target.z, this.walkSpeed * 1.2);
        const ahead = g.terrain.waterDepthAt(dog.pos.x + this.wx * 0.5 * dog.scale, dog.pos.z + this.wz * 0.5 * dog.scale);
        if (d < 0.8 || ahead > 0.02 || this.timer <= 0) {
          this.ws = 0;
          dog.heading = Math.atan2(WORLD.pond.x - dog.pos.x, WORLD.pond.z - dog.pos.z);
          dog.doAct('drink', { drop: 1 });
          this.idleFor(3.8, 'stand');
        }
        break;
      }

      case 'swimOut': {
        const d = this.steer(this.target.x, this.target.z, this.trotSpeed);
        if (d < 1.2 || this.timer <= 0) {
          this.state = 'swimRest';
          this.timer = rand(3, 6);
          dog.doAct('shake');
          g.audio.sfx('shake', { x: dog.pos.x, z: dog.pos.z });
        }
        break;
      }
      case 'swimRest':
        if (this.timer <= 0) {
          this.target = { x: 18.5, z: -15 };
          this.state = 'swimBack';
          this.timer = 60;
        }
        break;
      case 'swimBack': {
        const d = this.steer(this.target.x, this.target.z, this.trotSpeed);
        if (d < 1.4 || this.timer <= 0) {
          this.allowWater = false;
          dog.doAct('shake');
          g.audio.sfx('shake', { x: dog.pos.x, z: dog.pos.z });
          this.idleFor(rand(3, 6), 'stand');
        }
        break;
      }

      case 'sleep':
        if (this.timer <= 0) this.idleFor(rand(2, 4), 'lie');
        else if (Math.random() < dt * 0.55) {
          dog.headWorld(_h);
          g.fx.spawn({
            x: _h.x, y: _h.y + 0.16, z: _h.z, vx: 0.07, vy: 0.2, vz: 0.02, life: 2.6, size: 0.11, sizeEnd: 0.22,
            color: '#ffffff', alpha: 0.8, cell: CELL.ZZZ, sway: 0.12, fadeIn: 0.15, fadeOut: 0.5,
          });
        }
        break;

      case 'treat': {
        const tgt = g.items.nearestTreat(this.target, 1.5);
        if (!tgt || this.timer <= 0) {
          this.idleFor(rand(1, 3), 'stand');
          break;
        }
        this.steer(tgt.x, tgt.z, this.trotSpeed);
        break;
      }

      case 'greeting':
        if (this.timer <= 0) this.state = 'follow';
        break;

      case 'follow': {
        if (this.followT <= 0 || pd > 34 || !playing) {
          this.idleFor(rand(2, 5), 'sit');
          break;
        }
        // trot along beside the player, a little behind
        const side = (this.name.length % 2 ? 1 : -1) * (1.2 + (this.name.length % 3) * 0.5);
        const fx = Math.sin(pdog.heading), fz = Math.cos(pdog.heading);
        const tx = pdog.pos.x - fx * 1.5 + fz * side, tz = pdog.pos.z - fz * 1.5 - fx * side;
        const d = Math.hypot(tx - dog.pos.x, tz - dog.pos.z);
        if (pdog.swim > 0.5 && !tr.swimmer) {
          // wait at the water's edge
          this.allowWater = false;
          if (d > 5) this.steer(tx, tz, this.trotSpeed);
        } else {
          this.allowWater = !!tr.swimmer;
          if (d > 0.9) {
            const sp = d > 7 ? this.runSpeed : d > 2.6 ? Math.max(this.trotSpeed, Math.min(pdog.speed * 1.08, this.runSpeed)) : Math.max(pdog.speed, this.walkSpeed * 0.8);
            this.steer(tx, tz, sp);
            this.still = 0;
          } else {
            this.still = (this.still || 0) + dt;
            if (this.still > 2.5 && dog.posture === 'stand' && pdog.speed < 0.2) dog.setPosture(pdog.posture === 'lie' || pdog.posture === 'sleep' ? 'lie' : 'sit');
          }
        }
        if (pdog.speed > 0.5 && dog.posture !== 'stand' && d > 1.5) dog.setPosture('stand');
        break;
      }

      // ---- tag
      case 'tagWait':
        if (this.timer <= 0) {
          dog.setPosture('stand');
          this.state = this.next;
          this.grace = 0.7;
        }
        break;
      case 'tagFlee': {
        this.tagTime += dt;
        this.grace -= dt;
        // run from the player, weaving, and curve back in near the fence
        const away = Math.atan2(-px, -pz);
        let a = away + Math.sin(t * 1.7 + this.name.length) * 0.75;
        const r = Math.hypot(dog.pos.x, dog.pos.z);
        if (r > WORLD.parkRadius - 16) {
          const inward = Math.atan2(-dog.pos.x, -dog.pos.z);
          const k = clamp((r - (WORLD.parkRadius - 16)) / 12, 0, 1);
          a = a + Math.atan2(Math.sin(inward - a), Math.cos(inward - a)) * k * 0.85;
        }
        if (pd > 11 || (this.waiting && pd > 7.5)) {
          // far enough: turn round, bow, and wait to be chased
          this.waiting = true;
          dog.heading += Math.atan2(Math.sin(Math.atan2(px, pz) - dog.heading), Math.cos(Math.atan2(px, pz) - dog.heading)) * Math.min(1, dt * 6);
          if (dog.speed < 0.3 && dog.posture === 'stand') dog.setPosture('bow');
        } else {
          this.waiting = false;
          if (dog.posture !== 'stand') dog.setPosture('stand');
          this.steer(dog.pos.x + Math.sin(a) * 6, dog.pos.z + Math.cos(a) * 6, pd > 8 ? this.trotSpeed : this.runSpeed * 0.9);
        }
        if (pd < 0.75 + pdog.radius + dog.radius && this.grace <= 0) {
          this.tagged(true);
        } else if (this.tagTime > 50 || pd > 30) {
          this.endTag(pd > 30 ? null : `${this.name} is all tuckered out.`);
        }
        break;
      }
      case 'tagChase': {
        this.tagTime += dt;
        this.grace -= dt;
        this.allowWater = !!tr.swimmer;
        this.steer(pdog.pos.x, pdog.pos.z, Math.min(this.runSpeed, 6.3) * 0.93);
        if (pd < 0.75 + pdog.radius + dog.radius && this.grace <= 0) {
          this.tagged(false);
        } else if (this.tagTime > 50 || pd > 32 || (pdog.posture !== 'stand' && pdog.posture !== 'bow')) {
          this.endTag(pd > 32 ? null : 'Good game!');
        }
        break;
      }

      // ---- fetch
      case 'fetchGo': {
        const b = this.ball;
        if (!b || b.holder || this.timer <= 0) {
          this.state = 'follow';
          this.followT = Math.max(this.followT, 30);
          break;
        }
        this.allowWater = !!tr.swimmer;
        const d = this.steer(b.pos.x, b.pos.z, this.runSpeed);
        if (d < 0.55 + dog.radius && b.speed() < 5 && b.pos.y - dog.pos.y < 0.6) {
          if (b.pickUp(dog)) {
            dog.carry = b;
            this.state = 'fetchReturn';
            this.timer = 20;
            g.audio.sfx('pickup', { x: dog.pos.x, z: dog.pos.z });
          }
        }
        break;
      }
      case 'fetchReturn': {
        const d = this.steer(pdog.pos.x, pdog.pos.z, this.runSpeed * 0.85);
        if (d < 1.7 + pdog.radius || this.timer <= 0) {
          this.ws = 0;
          const b = this.ball;
          dog.carry = null;
          if (b && b.holder === dog) b.drop(dog, false);
          this.ball = null;
          dog.heading = Math.atan2(px, pz);
          dog.setPosture('bow');
          this.state = 'idle';
          this.timer = 2.2;
          this.afterIdle = 'follow'; // stay close, in case there is another throw
          this.followT = Math.max(this.followT, 60);
          this.emote(CELL.HEART, '#ff7d9c', 2);
          g.joys.unlock('fetch');
          g.player.cheer(0.6);
          g.audio.bark(dog, 0.7, true);
        }
        break;
      }

      // ---- two dogs chasing each other
      case 'pairChase':
      case 'pairFlee': {
        const o = this.partner;
        if (!o || this.timer <= 0 || (o.state !== 'pairChase' && o.state !== 'pairFlee')) {
          this.partner = null;
          dog.pant = 0.8;
          this.idleFor(rand(3, 7), Math.random() < 0.5 ? 'lie' : 'sit');
          break;
        }
        const ox = o.dog.pos.x - dog.pos.x, oz = o.dog.pos.z - dog.pos.z, od = Math.hypot(ox, oz);
        if (this.state === 'pairChase') {
          this.steer(o.dog.pos.x, o.dog.pos.z, this.runSpeed * 0.9);
          if (od < 0.8 && (this.swapCool || 0) <= 0) {
            this.state = 'pairFlee';
            o.state = 'pairChase';
            o.swapCool = this.swapCool = 1.2;
            g.audio.bark(dog, 0.6, true);
          }
        } else {
          let a = Math.atan2(-ox, -oz) + Math.sin(t * 1.5 + this.name.length) * 0.8;
          const r = Math.hypot(dog.pos.x, dog.pos.z);
          if (r > WORLD.parkRadius - 18) {
            const inward = Math.atan2(-dog.pos.x, -dog.pos.z);
            a = a + Math.atan2(Math.sin(inward - a), Math.cos(inward - a)) * 0.8;
          }
          this.steer(dog.pos.x + Math.sin(a) * 6, dog.pos.z + Math.cos(a) * 6, this.runSpeed * 0.84);
        }
        this.swapCool = (this.swapCool || 0) - dt;
        break;
      }
    }

    // stuck? give up and do something else
    if (this.ws > 0.5) {
      this.stuckT += dt;
      if (this.stuckT > 1.6) {
        const moved = Math.hypot(dog.pos.x - this.stuckX, dog.pos.z - this.stuckZ);
        this.stuckT = 0;
        this.stuckX = dog.pos.x;
        this.stuckZ = dog.pos.z;
        if (moved < 0.3 && ['wander', 'zoomies', 'toDrink', 'treat', 'shyFlee'].includes(this.state)) this.idleFor(rand(1, 3), 'stand');
      }
    } else {
      this.stuckT = 0;
      this.stuckX = dog.pos.x;
      this.stuckZ = dog.pos.z;
    }

    dog.move(dt, g, this.wx, this.wz, this.ws);

    // attention and mood
    const interested = pd < 7 && this.state !== 'sleep';
    if (interested) {
      pdog.headWorld(_h);
      dog.look = (this._look ||= new THREE.Vector3()).copy(_h);
    } else {
      dog.look = null;
    }
    this.burst = Math.max(0, this.burst - dt * 0.25);
    const base = this.state === 'sleep' ? 0.05 : 0.3 + (this.friend && pd < 8 ? 0.35 : 0) + (this.state.startsWith('tag') || this.state.startsWith('pair') || this.state.startsWith('fetch') ? 0.4 : 0);
    dog.happy = damp(dog.happy, clamp(base + this.burst, 0, 1), 3, dt);
    const sprint = dog.speed > 4.4;
    dog.pant = clamp(dog.pant + (sprint ? dt * 0.1 : -dt * 0.06), 0, 1);

    dog.update(dt, t);

    const show = playing && pd < 7.5 ? clamp((7.5 - pd) / 2.5, 0, 1) : 0;
    this.labelMat.opacity = damp(this.labelMat.opacity, show, 6, dt);
    this.label.visible = this.labelMat.opacity > 0.01;
  }

  /** Someone got tagged. `byPlayer`: the player caught this dog. */
  tagged(byPlayer) {
    const g = this.game, dog = this.dog;
    this.tagCount++;
    g.joys.unlock('tag');
    g.player.cheer(0.5);
    this.burst = 1;
    const mid = { x: (dog.pos.x + g.player.dog.pos.x) / 2, z: (dog.pos.z + g.player.dog.pos.z) / 2 };
    g.sparkle(mid.x, dog.pos.y + 0.45, mid.z, '#fff1a8', 10);
    g.audio.sfx('tag', mid);
    if (this.tagCount >= 6) {
      this.endTag('What a game! You both flop down, happy.');
      return;
    }
    this.ws = 0;
    this.state = 'tagWait';
    this.timer = byPlayer ? 0.9 : 1.3;
    this.next = byPlayer ? 'tagChase' : 'tagFlee';
    if (byPlayer) {
      dog.doAct('spin');
      g.ui.toast(`Got ${this.name}! Now run!`, 1800);
    } else {
      g.audio.bark(dog, 0.8, true);
      g.ui.toast(`${this.name} got you! Your turn to chase.`, 1800);
    }
  }
}
