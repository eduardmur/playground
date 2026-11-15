import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { clamp, TAU } from './core/utils.js';
import { Input } from './core/input.js';
import { CameraRig } from './core/camera.js';
import { shared, makeNoiseTexture } from './world/shared.js';
import { Terrain, WORLD, pondNorm } from './world/terrain.js';
import { Sky } from './world/sky.js';
import { Grass, MAX_PUSHERS } from './world/grass.js';
import { Trees } from './world/trees.js';
import { Flora } from './world/flora.js';
import { Water } from './world/water.js';
import { Props } from './world/props.js';
import { Particles, Fireflies, Motes, setPointScale, CELL } from './fx/particles.js';
import { BREEDS, PLAYER_BREEDS, NPC_CAST } from './entities/breeds.js';
import { Player } from './entities/player.js';
import { NpcDog } from './entities/npc.js';
import { Birds, Butterflies } from './entities/critters.js';
import { Items } from './entities/items.js';
import { Audio } from './audio/audio.js';
import { UI } from './ui/ui.js';
import { Joys, Save } from './ui/joys.js';

const rand = (a, b) => a + Math.random() * (b - a);
const START = { x: 2.4, z: 15.6 };
const TITLE_YAW = -1.15;

export class Game {
  constructor(canvas, resume = null) {
    this.canvas = canvas;
    const params = new URLSearchParams(location.search);
    this.params = params;

    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, params.get('q') === 'low' ? 1 : 2);
    this.adaptRatio = this.maxPixelRatio;
    this.pixelRatio = this.maxPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.12, 1400);

    this.store = new Save();
    this.save = this.store.data;
    this.joys = new Joys(this.store, (joy) => this.onJoy(joy));
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.audio.musicOn = this.save.music;
    this.audio.muted = !this.save.sound;

    // ---- the park
    shared.uNoise.value = makeNoiseTexture(256);
    this.terrain = new Terrain();
    this.scene.add(this.terrain.mesh);
    this.sky = new Sky(this.scene, { shadowMapSize: 2048 });
    const startHour = parseFloat(params.get('t'));
    if (Number.isFinite(startHour) && startHour >= 0 && startHour <= 24) this.sky.setHour(startHour);
    this.grass = new Grass({ count: 235000, patch: 58, bladeW: 0.04, bladeH: 0.2, fade: [-2, -1, 19, 28] });
    this.scene.add(this.grass.mesh);
    this.trees = new Trees(this.terrain);
    this.scene.add(this.trees.group);
    this.flora = new Flora(this.terrain, this.trees.colliders);
    this.scene.add(this.flora.group);
    this.water = new Water();
    this.scene.add(this.water.mesh);
    this.props = new Props(this.terrain);
    this.scene.add(this.props.group);
    this.colliders = [...this.trees.colliders, ...this.flora.colliders, ...this.props.colliders];

    this.fx = new Particles(2600, false);
    this.glow = new Particles(900, true);
    this.fireflies = new Fireflies(this.terrain, this.trees.bushes);
    this.motes = new Motes();
    this.scene.add(this.fx.points, this.glow.points, this.fireflies.points, this.motes.points);

    // ---- its residents
    this.state = 'title';
    this.cam = new CameraRig(this.camera, this.terrain);
    this.items = new Items(this);
    this.scene.add(this.items.group);
    this.npcs = [];
    this.player = new Player(this, PLAYER_BREEDS.includes(this.save.breed) ? this.save.breed : 'shiba');
    this.player.dog.place(START.x, START.z, TITLE_YAW + 0.5, this.terrain);
    this.player.dog.posture = 'sit';
    this.npcs = NPC_CAST.map((def) => new NpcDog(this, def));
    for (const n of this.npcs) if (this.save.friends.includes(n.name)) n.setFriend(true, true);
    this._dogs = null;
    this.items.populate();
    this.birds = new Birds(this);
    this.scene.add(this.birds.group);
    this.butterflies = new Butterflies(this, this.flora.patches);
    this.scene.add(this.butterflies.mesh);

    this.cam.snapTo(this.player.dog);
    this.cam.yaw = TITLE_YAW - 0.5;

    // after dark a faint moonlit glow keeps your own dog readable
    this.fill = new THREE.PointLight('#a9bcff', 0, 7, 1.4);
    this.scene.add(this.fill);

    // ---- post: MSAA'd HDR target -> bloom -> tone mapping -> grade
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.75, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.ui = new UI(this);
    this.ui.setBreed(this.player.dog.breed);
    this.ui.setToggle('musicBtn', this.save.music);
    this.ui.setToggle('soundBtn', this.save.sound);

    this.time = 0;
    this.frames = 0;
    this.frameMs = 16;
    this.slowT = 0;
    this.howls = [];
    this.timers = { petal: 0, jet: 0, drip: 0, wake: 0 };
    this.pushers = [];

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();

    this.debug = {
      hour: (h) => this.sky.setHour(h),
      tp: (x, z) => this.player.dog.place(x, z, this.player.dog.heading, this.terrain),
      pose: (p) => (this.player.dog.posture = p),
      act: (a) => this.player.dog.doAct(a),
    };
    if (params.has('autostart')) this.begin();

    // carried over from a previous run of this page (see main.js)
    if (resume && typeof resume === 'object') {
      const { hour, x, z, heading, playing } = resume;
      if (Number.isFinite(hour)) this.sky.setHour(hour);
      if (Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x, z) < WORLD.parkRadius) {
        this.player.dog.place(x, z, Number.isFinite(heading) ? heading : 0, this.terrain);
        this.cam.snapTo(this.player.dog);
      }
      if (playing) this.begin();
    }

    // browsers only let sound start from a gesture: (re)start it on the first one
    const wake = () => {
      if (this.state === 'play') this.audio.init();
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
  }

  /** What to carry across when the page is swapped for a newer version while it is open. */
  snapshot() {
    const d = this.player.dog;
    return { hour: this.sky.hour, x: d.pos.x, z: d.pos.z, heading: d.heading, playing: this.state === 'play' };
  }

  get dogs() {
    if (!this._dogs) this._dogs = [this.player.dog, ...this.npcs.map((n) => n.dog)];
    return this._dogs;
  }

  // ================================================================= lifecycle

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // keep the drawing buffer within a sane pixel budget on very large displays
    this.pixelRatio = Math.max(0.75, Math.min(this.maxPixelRatio, this.adaptRatio, Math.sqrt(4.4e6 / Math.max(w * h, 1))));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._pointScale();
  }

  _pointScale() {
    setPointScale((window.innerHeight * this.pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)));
  }

  start() {
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(raw, 0.05);
    this.update(dt);
    this.composer.render();
    this.frames++;
    if (this.frames === 8) this.ui.ready();
    this._adapt(raw);
  }

  /** If the frame rate sags, quietly trade resolution and grass density for smoothness. */
  _adapt(raw) {
    if (this.frames < 90 || raw > 0.25) return;
    this.frameMs = this.frameMs * 0.95 + raw * 1000 * 0.05;
    if (this.frameMs > 24) this.slowT += raw;
    else this.slowT = Math.max(0, this.slowT - raw * 0.5);
    if (this.slowT > 2.5) {
      this.slowT = 0;
      if (this.pixelRatio > 1) {
        this.adaptRatio = Math.max(1, this.pixelRatio - 0.25);
        this.resize();
      } else if ((this.grassDensity ?? 1) > 0.45) {
        this.grassDensity = (this.grassDensity ?? 1) - 0.18;
        this.grass.setDensity(this.grassDensity);
      } else if (this.sky.sun.shadow.mapSize.x > 1024) {
        this.sky.sun.shadow.mapSize.set(1024, 1024);
        this.sky.sun.shadow.map?.dispose();
        this.sky.sun.shadow.map = null;
      }
    }
  }

  begin() {
    if (this.state !== 'title') return;
    this.state = 'play';
    this.audio.init();
    this.ui.startGame();
    this.cam.mode = 'follow';
    this.cam.userPitch = 0.3;
    this.player.dog.posture = 'stand';
    this.input.lastInputAt = performance.now();
    setTimeout(() => {
      if (!this.joys.count) this.ui.toast('Wander wherever you like. Other dogs love a hello.', 5200);
    }, 2600);
  }

  cycleBreed(dir) {
    const i = PLAYER_BREEDS.indexOf(this.player.breedId);
    const id = PLAYER_BREEDS[(i + dir + PLAYER_BREEDS.length) % PLAYER_BREEDS.length];
    this.player.setBreed(id);
    this._dogs = null;
    this.save.breed = id;
    this.store.write();
    this.ui.setBreed(BREEDS[id]);
    this.audio.init();
    this.audio.sfx('click');
  }

  skipTime() {
    const next = this.sky.nextPhase();
    this.ui.toast(`Time drifts on… ${next.name.toLowerCase()}`, 2400);
    this.audio.sfx('whoosh');
  }

  toggleHold() {
    this.sky.paused = !this.sky.paused;
    this.ui.toast(this.sky.paused ? 'Holding this moment' : 'Time flows again', 2000);
  }

  toggleMusic() {
    this.save.music = !this.save.music;
    this.audio.setMusic(this.save.music);
    this.ui.setToggle('musicBtn', this.save.music);
    this.store.write();
  }

  toggleSound() {
    this.save.sound = !this.save.sound;
    this.audio.init();
    this.audio.setMuted(!this.save.sound);
    this.ui.setToggle('soundBtn', this.save.sound);
    this.store.write();
  }

  togglePhoto() {
    this.ui.setPhoto(!this.ui.photo);
  }

  resetSave() {
    this.store.reset();
    let framed = true;
    try {
      framed = window.self !== window.top;
    } catch {
      /* cross-origin frame */
    }
    if (!framed) {
      location.reload();
      return;
    }
    // embedded pages cannot always reload themselves, so start the day over in place
    this.joys.found.clear();
    for (const n of this.npcs) {
      n.setFriend(false, true);
      n.trust = 0;
    }
    this.ui.closePanel();
    this.ui.setJoyCount();
    this.ui.toast('A fresh day begins.', 3200);
  }

  // ==================================================================== events

  onJoy(joy) {
    this.ui.joyToast(joy);
    this.audio.sfx('chime');
    this.player?.cheer(0.5);
  }

  onTrick(name, dog) {
    const map = { sit: 'Digit1', lie: 'Digit2', roll: 'Digit3', spin: 'Digit4', paw: 'Digit5', beg: 'Digit6', bow: 'Digit7', bark: 'KeyF', howl: 'KeyH', shake: 'KeyR' };
    this.ui.flashKey(map[name]);
    if (name === 'bark') {
      this.audio.bark(dog);
      this.birds.startle(dog.pos.x, dog.pos.z, 11, true);
      dog.headWorld(_v);
      for (let i = 0; i < 3; i++) {
        this.fx.spawn({ x: _v.x, y: _v.y + 0.05, z: _v.z, life: 0.5, size: 0.12, sizeEnd: 0.55 + i * 0.22, color: '#ffffff', alpha: 0.5, cell: CELL.RING, fadeIn: 0.05, fadeOut: 0.7 });
      }
      for (const n of this.npcs) n.onBark(dog, dog.pos.x, dog.pos.z);
      return;
    }
    if (name === 'howl') {
      this.audio.howl(dog);
      this.onHowl(this.player);
      if (this.sky.night > 0.5) this.joys.unlock('howl');
    }
    if (name === 'shake') {
      this.audio.sfx('shake', { x: dog.pos.x, z: dog.pos.z });
      if (dog.wet > 0.3) this.joys.unlock('shake');
    }
    for (const n of this.npcs) n.onPlayerTrick(name, dog);
  }

  onHowl(who) {
    this.howls = this.howls.filter((h) => this.time - h.t < 7);
    this.howls.push({ who, t: this.time });
    const others = new Set(this.howls.filter((h) => h.who !== this.player).map((h) => h.who));
    if (others.size >= 2 && this.howls.some((h) => h.who === this.player)) this.joys.unlock('choir');
  }

  onFriend(npc) {
    if (!this.save.friends.includes(npc.name)) this.save.friends.push(npc.name);
    this.store.write();
    const first = this.joys.unlock('friend');
    if (this.npcs.every((n) => n.friend)) this.joys.unlock('allFriends');
    else if (!first) this.ui.toast(`${npc.name} is your friend now.`, 2600);
  }

  onTreat(dog, treat) {
    const pos = { x: treat.x, z: treat.z };
    if (dog.isPlayer) {
      this.audio.sfx('crunch');
      this.sparkle(treat.x, treat.y, treat.z, treat.gold ? '#ffe27a' : '#ffdca8', treat.gold ? 18 : 8);
      this.player.cheer(0.6);
      this.save.treats++;
      if (treat.gold) {
        if (!this.save.gold.includes(treat.gold)) this.save.gold.push(treat.gold);
        this.audio.sfx('friend');
        if (this.save.gold.length >= 5) this.joys.unlock('gold');
        else this.ui.toast(`A golden bone! ${this.save.gold.length} of 5 found.`, 3200);
      }
      this.store.write();
      this.joys.unlock('treat');
      if (this.save.treats >= 10) this.joys.unlock('treats10');
    } else {
      this.audio.sfx('crunch', { ...pos, vol: 0.7 });
      dog.npc?.emote(CELL.HEART, '#ff9db4');
    }
  }

  onBallThrown(ball, dog) {
    if (!dog.isPlayer || this.time - (this._lastThrow || -9) < 1.2) return;
    this._lastThrow = this.time;
    const order = [...this.npcs].sort((a, b) => a.pd - b.pd);
    for (const n of order) if (n.onBall(ball, dog)) break;
  }

  onBirds() {
    this.joys.unlock('birds');
    this.player.cheer(0.35);
  }

  /** Footfalls, landings and the like, from any dog. */
  dogEvent(type, data, dog) {
    const p = dog.pos;
    const near = Math.hypot(p.x - this.camera.position.x, p.z - this.camera.position.z) < 16;
    if (type === 'step') {
      if (dog.inWater && dog.swim < 0.5) {
        if (Math.random() < 0.6) {
          this.water.addRipple(p.x + rand(-0.1, 0.1), p.z + rand(-0.1, 0.1), 0.16 + data * 0.2);
          this._droplets(p.x, WORLD.waterLevel + 0.02, p.z, 2 + Math.round(data * 4), 0.8 + data);
          if (near) this.audio.sfx('paddle', { x: p.x, z: p.z, vol: 0.6 + data * 0.5 });
        }
      } else if (near && dog.swim < 0.5) {
        const m = this.terrain.maskAt(p.x, p.z, _mask);
        const hard = m.path > 0.5 || m.paved > 0.5;
        this.audio.sfx(hard ? 'stepHard' : 'step', { x: p.x, z: p.z, vol: (dog.isPlayer ? 1 : 0.7) * (0.6 + data * 0.6) });
        if (hard && data > 0.5 && m.path > 0.5 && Math.random() < 0.5) {
          this.fx.spawn({
            x: p.x, y: p.y + 0.05, z: p.z, vx: rand(-0.3, 0.3), vy: rand(0.2, 0.5), vz: rand(-0.3, 0.3), life: 0.9,
            size: 0.18, sizeEnd: 0.5, color: '#cdb38a', alpha: 0.28, cell: CELL.SOFT, drag: 2, fadeIn: 0.15, fadeOut: 0.7,
          });
        }
      }
    } else if (type === 'land') {
      if (dog.inWater) this.splash(p.x, p.z, 0.9);
      else if (near) this.audio.sfx('land', { x: p.x, z: p.z, vol: clamp(data / 4, 0.3, 1) });
    }
  }

  splash(x, z, strength = 1) {
    this.water.addRipple(x, z, 0.5 + strength * 0.5);
    this._droplets(x, WORLD.waterLevel + 0.03, z, Math.round(10 + strength * 14), 1.4 + strength * 1.4);
    this.audio.sfx('splash', { x, z, vol: clamp(strength, 0.3, 1) });
    this.birds.startle(x, z, 6, false);
  }

  _droplets(x, y, z, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = rand(0.3, 1) * power;
      this.fx.spawn({
        x: x + Math.cos(a) * 0.1, y, z: z + Math.sin(a) * 0.1, vx: Math.cos(a) * s * 0.7, vy: rand(1.2, 2.6) * Math.sqrt(power), vz: Math.sin(a) * s * 0.7,
        life: rand(0.45, 0.85), size: rand(0.03, 0.07), color: '#e8f7ff', alpha: 0.9, gravity: 9.5, cell: CELL.DROP, fadeIn: 0, fadeOut: 0.3,
      });
    }
  }

  sparkle(x, y, z, color = '#fff1a8', n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, e = rand(-0.4, 1), s = rand(0.5, 1.6);
      this.glow.spawn({
        x, y, z, vx: Math.cos(a) * s * Math.cos(e), vy: Math.sin(e) * s + 0.6, vz: Math.sin(a) * s * Math.cos(e),
        life: rand(0.6, 1.1), size: rand(0.07, 0.14), sizeEnd: 0.01, color, cell: CELL.SPARK, drag: 2.4, gravity: 0.6, rotv: rand(-3, 3), fadeIn: 0.05, fadeOut: 0.6,
      });
    }
  }

  // ==================================================================== update

  update(dt) {
    this.time += dt;
    const t = this.time;
    shared.uTime.value = t;
    const inp = this.input;
    inp.enabled = this.state === 'play' && !this.ui.panel;
    inp.update();
    this._keys();

    // the wind breathes
    shared.uWindStr.value = 0.85 + 0.4 * Math.sin(t * 0.13) * Math.sin(t * 0.071 + 1.3) + 0.15 * Math.sin(t * 0.37 + 0.4);

    const pdog = this.player.dog;
    this.player.update(dt, t);
    for (const n of this.npcs) n.update(dt, t);
    this._separate();
    this.items.update(dt, t);
    this.birds.update(dt, t);
    this.butterflies.update(dt, t);
    this._dogFx(dt);

    const resting = pdog.posture !== 'stand' && pdog.posture !== 'bow' && pdog.posture !== 'beg';
    this.restT = resting ? (this.restT || 0) + dt : 0;
    this.cam.update(dt, inp, pdog, { restful: this.restT > 5 });
    this.sky.update(dt, pdog.pos, this.camera);

    this._dress(dt, t);
    this.fx.update(dt);
    this.glow.update(dt);

    // sound
    const cp = this.camera.position;
    this.cam.basis(_f, _r);
    this.audio.setListener(cp.x, cp.z, _r.x, _r.z);
    const pn = pondNorm(cp.x, cp.z);
    this.audio.update(dt, {
      night: this.sky.night,
      mist: this.sky.mist || 0,
      pond: clamp(1 - (pn - 0.9) / 1.4, 0, 1),
      fountain: clamp(1 - Math.hypot(cp.x - WORLD.plaza.x, cp.z - WORLD.plaza.z) / 20, 0, 1),
      gust: clamp(shared.uWindStr.value - 0.5, 0, 1),
      pondPos: WORLD.pond,
      phase: this.sky.phase().name,
    });

    this.ui.setPrompt(this.player.ctx && !this.ui.panel ? this.player.ctx.label : null);
    this.ui.setTime(this.sky.phase().name, this.sky.night, this.sky.paused);

    this.renderer.toneMappingExposure = this.sky.cur.exposure;
    this.bloom.strength = this.sky.cur.bloom;
    inp.endFrame();
  }

  _keys() {
    const inp = this.input, ui = this.ui;
    if (this.state === 'title') {
      if (inp.hit('Enter') || inp.hit('Space')) this.begin();
      if (inp.hit('ArrowLeft') || inp.hit('KeyA')) this.cycleBreed(-1);
      if (inp.hit('ArrowRight') || inp.hit('KeyD')) this.cycleBreed(1);
      return;
    }
    if (inp.hit('Escape')) {
      if (ui.panel) ui.closePanel();
      else if (ui.photo) this.togglePhoto();
    }
    if (inp.hit('KeyJ') || inp.hit('Tab')) ui.togglePanel('journal');
    if (inp.hit('Slash')) ui.togglePanel('help');
    if (ui.panel) {
      // keys do nothing else while a panel is open
      inp.pressed.clear();
      return;
    }
    if (inp.hit('KeyT')) this.skipTime();
    if (inp.hit('KeyM')) this.toggleMusic();
    if (inp.hit('KeyP')) this.togglePhoto();
  }

  /** Dogs don't walk through each other. */
  _separate() {
    const dogs = this.dogs;
    for (let i = 0; i < dogs.length; i++) {
      for (let j = i + 1; j < dogs.length; j++) {
        const a = dogs[i], b = dogs[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const rr = (a.radius + b.radius) * 1.05;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (rr - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push;
          a.pos.z -= nz * push;
          b.pos.x += nx * push;
          b.pos.z += nz * push;
        }
      }
    }
  }

  /** Water, wetness and shaking: everything a damp dog does to the world around it. */
  _dogFx(dt) {
    const tm = this.timers;
    tm.wake -= dt;
    tm.drip -= dt;
    const wake = tm.wake <= 0, drip = tm.drip <= 0;
    if (wake) tm.wake = 0.36;
    if (drip) tm.drip = 0.13;
    for (const dog of this.dogs) {
      const p = dog.pos;
      // plunging in
      const was = dog._wasWater || false;
      if (dog.inWater && !was && dog.speed > 2.5) this.splash(p.x + Math.sin(dog.heading) * 0.3, p.z + Math.cos(dog.heading) * 0.3, clamp(dog.speed / 6, 0.4, 1));
      dog._wasWater = dog.inWater;
      if (dog.swim > 0.5 && wake) {
        this.water.addRipple(p.x, p.z, 0.22 + dog.speed * 0.14);
        if (dog.speed > 0.5 && (dog.isPlayer || Math.random() < 0.5)) this.audio.sfx('paddle', { x: p.x, z: p.z, vol: 0.8 });
      }
      // shaking sends water everywhere
      if (dog.actName === 'shake' && dog.wet > 0.08) {
        const n = Math.round(dog.wet * 7);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU, s = rand(1.4, 3.4);
          this.fx.spawn({
            x: p.x + Math.cos(a) * 0.15, y: p.y + rand(0.25, 0.5) * dog.scale, z: p.z + Math.sin(a) * 0.15,
            vx: Math.cos(a) * s, vy: rand(0.5, 2.2), vz: Math.sin(a) * s, life: rand(0.4, 0.75), size: rand(0.025, 0.055),
            color: '#e8f7ff', alpha: 0.9, gravity: 9, cell: CELL.DROP, fadeIn: 0, fadeOut: 0.3,
          });
        }
        dog.wet = Math.max(0, dog.wet - dt * 0.75);
      } else if (drip && dog.wet > 0.45 && dog.swim < 0.3 && Math.random() < dog.wet) {
        this.fx.spawn({
          x: p.x + rand(-0.15, 0.15), y: p.y + 0.28 * dog.scale, z: p.z + rand(-0.15, 0.15), vy: -0.2, life: 0.5, size: 0.03,
          color: '#dff3ff', alpha: 0.8, gravity: 8, cell: CELL.DROP, fadeIn: 0, fadeOut: 0.2, floor: p.y,
        });
      }
    }
  }

  /** Keep the scenery in step: lamps, fireflies, grass, petals, the fountain. */
  _dress(dt, t) {
    const sky = this.sky, cam = this.camera;
    this.props.setNight(sky.night);
    this.fireflies.setAmount(sky.night);
    const pd = this.player.dog;
    this.fill.intensity = sky.night * 2.6;
    this.fill.position.set(
      pd.pos.x + (cam.position.x - pd.pos.x) * 0.3,
      pd.pos.y + 1.5,
      pd.pos.z + (cam.position.z - pd.pos.z) * 0.3
    );
    this.motes.uniforms.uCenter.value.copy(cam.position);
    this.motes.uniforms.uAmount.value = 0.55 * (1 - sky.night) * clamp(sky.cur.sunI / 2.5, 0.2, 1);
    this.motes.uniforms.uColor.value.copy(sky.cur.sun);
    const day = clamp(sky.cur.sunI / 3, 0, 1) * (1 - sky.night);
    this.trees.materials.blossom.mat.emissiveIntensity = 0.02 + 0.1 * day;

    // grass: centred a little ahead of the camera, parted by every dog and the ball
    cam.getWorldDirection(_f);
    _f.y = 0;
    _f.normalize();
    const gx = cam.position.x + _f.x * 13, gz = cam.position.z + _f.z * 13;
    this.grass.setCenter(gx, gz);
    this.terrain.groundUniforms.uGrassCenter.value.set(gx, gz);
    const list = this.pushers;
    list.length = 0;
    for (const dog of this.dogs) {
      if (list.length >= MAX_PUSHERS - 1) break;
      const low = dog.posture === 'lie' || dog.posture === 'sleep' || dog.actName === 'roll';
      list.push({ x: dog.pos.x, z: dog.pos.z, r: (low ? 0.8 : 0.55) * Math.max(dog.scale, 0.8), s: dog.swim > 0.5 ? 0 : clamp(1 - dog.air * 1.6, 0, 1) });
    }
    const ball = this.items.ball;
    if (ball && !ball.holder) list.push({ x: ball.pos.x, z: ball.pos.z, r: 0.28, s: clamp(1 - (ball.pos.y - this.terrain.heightAt(ball.pos.x, ball.pos.z)) * 2, 0, 1) });
    this.grass.setPushers(list);

    // blossom drifting down from the cherry trees
    const tm = this.timers;
    tm.petal -= dt;
    if (tm.petal <= 0) {
      tm.petal = 0.05;
      const gust = shared.uWindStr.value;
      for (const c of this.trees.sakura) {
        const d = Math.hypot(c.x - cam.position.x, c.z - cam.position.z);
        if (d > 46 || Math.random() > 0.09 * gust * (1 - sky.night * 0.6)) continue;
        const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * c.r * 0.85;
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        this.fx.spawn({
          x, y: c.y + rand(-0.8, 0.6), z, vx: rand(-0.2, 0.2), vy: rand(-0.55, -0.3), vz: rand(-0.2, 0.2),
          life: rand(6, 10), size: rand(0.06, 0.1), color: Math.random() < 0.5 ? '#ffd3e2' : '#fff0f5', alpha: 0.95, cell: CELL.PETAL,
          wind: 0.55 * gust, sway: 0.5, rot: rand(0, TAU), rotv: rand(-2.5, 2.5), fadeIn: 0.05, fadeOut: 0.15,
          floor: Math.max(this.terrain.heightAt(x + 1.5, z + 1), WORLD.waterLevel) + 0.03,
        });
      }
    }

    // the fountain plays
    const f = this.props.fountain;
    tm.jet -= dt;
    if (tm.jet <= 0 && Math.hypot(f.x - cam.position.x, f.z - cam.position.z) < 50) {
      tm.jet = 0.03;
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * TAU, s = rand(0.35, 0.75);
        this.fx.spawn({
          x: f.x, y: f.top, z: f.z, vx: Math.cos(a) * s, vy: rand(2.0, 2.7), vz: Math.sin(a) * s, life: 0.75, size: rand(0.035, 0.06),
          color: '#f0fbff', alpha: 0.85, gravity: 9, cell: CELL.DROP, fadeIn: 0, fadeOut: 0.25, floor: f.rim - 0.05,
        });
      }
      const a = Math.random() * TAU;
      this.fx.spawn({
        x: f.x + Math.cos(a) * 0.8, y: f.rim - 0.02, z: f.z + Math.sin(a) * 0.8, vx: Math.cos(a) * 0.25, vy: 0.1, vz: Math.sin(a) * 0.25,
        life: 0.5, size: 0.045, color: '#f0fbff', alpha: 0.8, gravity: 9, cell: CELL.DROP, fadeIn: 0, fadeOut: 0.2, floor: f.pool,
      });
    }
  }
}

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
const _mask = {};

/** Final look: a touch more saturation and contrast, a soft vignette, faint grain. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.16 },
    uContrast: { value: 1.05 },
    uVignette: { value: 0.34 },
    uTime: shared.uTime,
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSat;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      vec2 q = vUv - 0.5;
      float v = 1.0 - smoothstep(0.32, 0.92, length(q * vec2(1.0, 0.88)));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      float n = fract(sin(dot(vUv * vec2(1913.7, 1071.3) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) * 0.012;
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
    }`,
};
