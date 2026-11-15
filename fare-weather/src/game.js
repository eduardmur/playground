import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, smoothstep } from './core/utils.js';
import { Input } from './core/input.js';
import { Pipeline } from './core/pipeline.js';
import { env, initShared } from './world/shared.js';
import { City } from './world/city.js';
import { Ground } from './world/ground.js';
import { Buildings } from './world/buildings.js';
import { Sky } from './world/sky.js';
import { Props } from './world/props.js';
import { Trees } from './world/trees.js';
import { Weather, WEATHER_ORDER } from './world/weather.js';
import { Fleet } from './car/models.js';
import { Cabin } from './car/cabin.js';
import { Screen } from './car/screen.js';
import { Traffic } from './sim/traffic.js';
import { Ego } from './sim/ego.js';
import { Pedestrians } from './sim/pedestrians.js';
import { Rides } from './sim/rides.js';
import { Glows, Pools } from './fx/lights.js';
import { AudioEngine } from './audio/engine.js';
import { Hud } from './ui/hud.js';

const QUALITY = {
  low: { pixelRatio: 1, msaa: 0, shadow: 1024, reflect: true, reflectScale: 0.4, reflectTaps: 5, parked: 170 },
  med: { pixelRatio: 1.5, msaa: 4, shadow: 2048, reflect: true, reflectScale: 0.5, reflectTaps: 7, parked: 260 },
  high: { pixelRatio: 2, msaa: 4, shadow: 4096, reflect: true, reflectScale: 0.6, reflectTaps: 9, parked: 300 },
};
const FLOWS = [0, 1, 20, 120];
const VIEWS = ['front', 'rear', 'riders'];

const _v = new THREE.Vector3();

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    const params = (this.params = new URLSearchParams(location.search));
    const quality = (this.quality = { ...(QUALITY[params.get('q')] || QUALITY.med) });

    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatio);

    initShared();
    this.world = new THREE.Scene();
    this.cabinScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 6000);
    this.camera.layers.enable(1);
    this.camera.layers.enable(2);
    this.camera.rotation.order = 'YXZ';

    // ---- the city
    this.city = new City();
    this.ground = new Ground(this.city, quality);
    this.world.add(this.ground.group);
    this.buildings = new Buildings(this.city);
    this.world.add(this.buildings.group);
    this.sky = new Sky(this.world, renderer, { shadowMapSize: quality.shadow });
    this.props = new Props(this.city, this.buildings);
    this.world.add(this.props.group);
    this.trees = new Trees(this.city, this.props, this.ground);
    this.world.add(this.trees.group);
    this.weather = new Weather(this.world);
    if (params.get('w')) this.weather.set(params.get('w'), true);

    // ---- traffic, people and the cab
    this.fleet = new Fleet();
    this.world.add(this.fleet.group);
    this.traffic = new Traffic(this.city);
    this.ego = new Ego(this.city, this.traffic);
    const startLane = this.city.lanes.find((l) => l.road.name === 'Grand Blvd' && l.dir === 0 && l.k === 0 && l.from.j === 5);
    this.ego.spawn(startLane, 18);
    this.traffic.populate(this.ego.x, this.ego.z);
    this.peds = new Pedestrians(this.city);
    this.world.add(this.peds.group);
    this.peds.populate(this.ego.x, this.ego.z);
    this.pedGap = Infinity;
    this.carGlows = new Glows(480, { dynamic: true });
    this.carPools = new Pools(120, { dynamic: true });
    this.world.add(this.carGlows.mesh, this.carPools.mesh);
    this.parkedT = 0;
    // our own body, present in the world only as a shadow
    this.egoShadow = new THREE.Mesh(new THREE.BoxGeometry(1.86, 1.1, 4.3), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    this.egoShadow.castShadow = true;
    this.egoShadow.frustumCulled = false;
    this.world.add(this.egoShadow);
    this.headRig = new THREE.Group();
    this.heads = [-1, 1].map((s) => {
      const l = new THREE.SpotLight(0xfff0dc, 0, 70, 0.5, 0.7, 1.6);
      l.position.set(s * 0.62, 0.62, -2.15);
      l.target.position.set(s * 1.4, -0.25, -32);
      this.headRig.add(l, l.target);
      return l;
    });
    this.world.add(this.headRig);

    // ---- the cabin
    this.pipeline = new Pipeline(renderer, this.world, this.cabinScene, this.camera, quality);
    this.screen = new Screen(renderer, this.city, this.ground);
    this.cabin = new Cabin(this.pipeline, this.screen.material);
    this.cabin.addTo(this.cabinScene);
    this.cabin.group.add(this.camera);
    this.view = VIEWS.includes(params.get('cam')) ? params.get('cam') : 'front';
    this.look = { yaw: 0, pitch: 0, tyaw: 0, tpitch: 0, fov: this.cabin.views[this.view].fov, tfov: this.cabin.views[this.view].fov };
    this.sway = new THREE.Vector3();
    this.camWorld = new THREE.Vector3();
    this.camVel = new THREE.Vector3();
    this.viewDir = new THREE.Vector3(0, 0, -1);

    // ---- time
    const t = parseFloat(params.get('t'));
    this.hour = Number.isFinite(t) ? ((t % 24) + 24) % 24 : 17.6;
    const f = parseFloat(params.get('flow'));
    this.timeFlow = FLOWS.includes(f) ? f : 20; // game minutes per real minute
    this.time = 0;
    this.frames = 0;
    this.focus = new THREE.Vector3();
    this.sunVis = 1;
    this.moving = false;
    this.wasParked = false;

    // ---- sound, rides, interface
    this.audio = new AudioEngine();
    this.rides = new Rides(this);
    this.hud = new Hud(this);
    this.audio.onSubtitle = (line) => this.hud.setSubtitle(line);
    this.audio.onTrack = (title) => this.hud.setTrack(title);
    this.rides.onFare = (f2) => this.hud.fare(f2);
    this.rides.onMet = (ride, first) => this.hud.met(ride, first);
    this.rides._setStatus({ label: 'Online', headline: 'Fare Weather', sub: '' });
    this.ego.onBlink = (on) => this.audio.play('blinker', { rate: on ? 1 : 0.82, gain: this.ego.hazard ? 0.45 : 1 });
    this.cabin.onWipe = (dir) => this.audio.play('wiper', { rate: dir > 0 ? 1 : 0.9, gain: 0.8 });
    this.traffic.onPass = (car, rel) => {
      if (rel < 6) return;
      this.audio.play(this.weather.wet > 0.4 ? 'pass_wet' : 'pass_dry', { pan: -0.55, gain: clamp(rel / 22, 0.35, 1), rate: 0.9 + Math.random() * 0.2 });
    };
    this.weather.onThunder = (seconds, amp) => this.audio.thunder(seconds, amp);
    this.weather.onAuto = () => this.hud.sync();

    this.input = new Input(canvas);
    this.input.onKey = (code) => this._key(code);

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.hud.sync();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(w, h, this.pixelRatio);
  }

  /** Straight into the shift: no title, a fare already on board. */
  start() {
    this.last = performance.now();
    requestAnimationFrame(this.frame);
    this._mood();
    this.rides.start();
    // a browser will not let a page make a sound until it has been touched
    this.hud.setSilent();
    this.soundAt = Infinity;
    const once = () => {
      window.removeEventListener('pointerdown', once);
      window.removeEventListener('keydown', once);
      this.audio.init();
      this.soundAt = performance.now();
      this.hud.setTrack(this.audio.musicOn ? this.audio.trackTitle || 'Radio' : '');
    };
    window.addEventListener('pointerdown', once);
    window.addEventListener('keydown', once);
  }

  // ------------------------------------------------------------ controls

  setWeather(kind) {
    if (kind === 'auto') {
      this.weather.auto = true;
      this.weather.autoT = 4;
    } else {
      this.weather.auto = false;
      this.weather.set(kind);
    }
    this.audio.play('ui_tap');
    this._mood();
    this.hud.sync();
  }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
    this._mood();
    this.hud.sync();
  }

  setFlow(f) {
    this.timeFlow = f;
    this.audio.play('ui_tap');
    this.hud.sync();
  }

  toggleMusic() {
    // the touch that woke the sound up is not also a request to turn the radio off
    if (performance.now() - this.soundAt < 600) return;
    this.audio.setMusic(!this.audio.musicOn);
    this.hud.setTrack(this.audio.musicOn ? this.audio.trackTitle : '');
  }

  setView(view) {
    if (!VIEWS.includes(view)) return;
    this.view = view;
    const L = this.look;
    L.tyaw = L.tpitch = L.yaw = L.pitch = 0;
    L.tfov = L.fov = this.cabin.views[view].fov;
    this.audio.play('ui_tap');
    this.hud.sync();
  }

  cycleView() {
    this.setView(VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length]);
  }

  /** What the radio should lean toward right now. */
  _mood() {
    const h = this.hour, k = this.weather.kind;
    const m = [k === 'storm' ? 'rain' : k];
    if (h >= 20 || h < 5) m.push('night');
    else if (h < 10) m.push('morning');
    else if (h >= 17) m.push('evening');
    this.audio.mood = m;
  }

  _key(code) {
    const m = /^Digit([1-6])$/.exec(code);
    if (m) {
      this.setWeather(WEATHER_ORDER[Number(m[1]) - 1]);
      return true;
    }
    switch (code) {
      case 'Digit0': this.setWeather('auto'); return true;
      case 'BracketLeft': this.setHour(this.hour - 1); return true;
      case 'BracketRight': this.setHour(this.hour + 1); return true;
      case 'KeyT': this.setFlow(FLOWS[(FLOWS.indexOf(this.timeFlow) + 1) % FLOWS.length]); return true;
      case 'KeyM': this.toggleMusic(); return true;
      case 'KeyN': this.audio.nextTrack(); return true;
      case 'KeyC': this.cycleView(); return true;
      case 'KeyH': this.hud.setBare(!this.hud.bare); return true;
      case 'KeyJ': this.hud.toggleRiders(); return true;
      case 'Tab': this.hud.togglePanel(); return true;
      case 'Escape':
        if (this.hud.ridersOpen) this.hud.toggleRiders(false);
        else if (this.hud.bare) this.hud.setBare(false);
        else this.hud.togglePanel(false);
        return true;
      default: return false;
    }
  }

  // ------------------------------------------------------------ per frame

  /** Is the cab in direct sun, or in the shade of a building or a tree? */
  _sunVisibility() {
    const sky = this.sky;
    if (sky.lightIntensity < 0.02) return 1;
    const d = sky.lightDir;
    const ex = this.camWorld.x, ey = this.camWorld.y, ez = this.camWorld.z;
    for (const b of this.buildings.boxes) {
      if (b.h < ey + 1) continue;
      // where does the ray pass over this footprint?
      let t0 = 0, t1 = 1e9;
      if (Math.abs(d.x) > 1e-5) {
        const a = (b.x0 - ex) / d.x, c = (b.x1 - ex) / d.x;
        t0 = Math.max(t0, Math.min(a, c));
        t1 = Math.min(t1, Math.max(a, c));
      } else if (ex < b.x0 || ex > b.x1) continue;
      if (Math.abs(d.z) > 1e-5) {
        const a = (b.z0 - ez) / d.z, c = (b.z1 - ez) / d.z;
        t0 = Math.max(t0, Math.min(a, c));
        t1 = Math.min(t1, Math.max(a, c));
      } else if (ez < b.z0 || ez > b.z1) continue;
      if (t0 > t1) continue;
      if (ey + d.y * t0 < b.h) return 0;
    }
    // leaves: flickering shade
    let vis = 1;
    for (const s of this.trees.spots) {
      const dx = s.x - ex, dz = s.z - ez;
      if (dx * dx + dz * dz > 900) continue;
      const cy = 6.2 - ey;
      const t = dx * d.x + cy * d.y + dz * d.z;
      if (t < 0) continue;
      const px = dx - d.x * t, py = cy - d.y * t, pz = dz - d.z * t;
      const dist = Math.sqrt(px * px + py * py + pz * pz);
      if (dist < s.r * 0.95) vis = Math.min(vis, 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(this.ego.odometer * 2.1 + s.x * 3.7 + this.time * 0.8)) * (dist / s.r));
    }
    return vis;
  }

  _camera(dt) {
    const inp = this.input.consume();
    const V = this.cabin.views[this.view];
    const L = this.look;
    // the view follows the hand, as if you had hold of the scene: drag left to look right
    const k = 0.0032 * (L.fov / 62);
    L.tyaw = clamp(L.tyaw + inp.dx * k, -V.yawMax, V.yawMax);
    L.tpitch = clamp(L.tpitch + inp.dy * k * 0.9, V.pitchMin, V.pitchMax);
    if (inp.recenter) L.tyaw = L.tpitch = 0;
    L.tfov = clamp(L.tfov + inp.wheel * 0.03, 34, 80);
    L.yaw = damp(L.yaw, L.tyaw, 14, dt);
    L.pitch = damp(L.pitch, L.tpitch, 14, dt);
    L.fov = damp(L.fov, L.tfov, 10, dt);
    const ego = this.ego;
    // the head lags behind what the car does
    this.sway.x = damp(this.sway.x, clamp(ego.latAcc * 0.012, -0.05, 0.05), 3, dt);
    this.sway.z = damp(this.sway.z, clamp(ego.acc * 0.011, -0.045, 0.03), 3, dt);
    const rough = Math.min(1, ego.v / 9);
    const t = this.time;
    const bob = (Math.sin(t * 11.3) * 0.5 + Math.sin(t * 17.9 + 1.3) * 0.3 + Math.sin(t * 29.1 + 0.4) * 0.2) * 0.0016 * rough;
    const cam = this.camera;
    // a head sways with the car; a camera bolted to it does not
    const sx = V.fixed ? 0 : this.sway.x, sz = V.fixed ? 0 : this.sway.z;
    cam.position.set(V.pos.x + sx, V.pos.y + bob, V.pos.z + sz);
    cam.rotation.set(V.pitch + L.pitch + sz * 0.25, (V.yaw || 0) + L.yaw, -sx * 0.5);
    if (Math.abs(cam.fov - L.fov) > 0.01) {
      cam.fov = L.fov;
      cam.updateProjectionMatrix();
    }
  }

  _cars(lights) {
    const ego = this.ego;
    this.traffic.fillMoving(this.fleet, lights);
    this.parkedT -= 1;
    if (this.parkedT <= 0) {
      this.parkedT = 45; // frames
      this.traffic.fillParked(this.fleet, ego.x, ego.z, this.quality.parked);
    }
    this.carGlows.clear();
    this.carPools.clear();
    const beam = Math.max(env.uLamp.value, lights > 0.9 ? 0.5 : 0);
    for (const car of this.traffic.cars) {
      const dx = car.x - ego.x, dz = car.z - ego.z;
      if (dx * dx + dz * dz > 270 * 270) continue;
      const fx = car.dx, fz = car.dz, rx = -fz, rz = fx;
      const hl = car.len / 2 - 0.05, w = car.wid * 0.33;
      for (const s of [-1, 1]) {
        this.carGlows.add(car.x + fx * hl + rx * w * s, 0.66, car.z + fz * hl + rz * w * s, 2.6 * lights, 2.5 * lights, 2.2 * lights, 0.42, fx, 0, fz);
        const tb = 0.35 * lights + 1.5 * car.brake;
        this.carGlows.add(car.x - fx * hl + rx * w * s, 0.8, car.z - fz * hl + rz * w * s, 1.8 * tb, 0.07 * tb, 0.04 * tb, 0.3, -fx, 0, -fz);
      }
      if (beam > 0.05) this.carPools.add(car.x + fx * (hl + 9), 0.04, car.z + fz * (hl + 9), 3.6, 9, fx, fz, 0.42 * beam, 0.4 * beam, 0.34 * beam, 1);
    }
    const efx = -Math.sin(ego.yaw), efz = -Math.cos(ego.yaw);
    if (beam > 0.05) this.carPools.add(ego.x + efx * 17.2, 0.04, ego.z + efz * 17.2, 5.5, 15, efx, efz, 0.34 * beam, 0.32 * beam, 0.28 * beam, 1);
    this.carGlows.commit();
    this.carPools.commit();
    this.egoShadow.position.set(ego.x, 0.72, ego.z);
    this.egoShadow.rotation.y = ego.yaw;
    this.headRig.position.set(ego.x, 0, ego.z);
    this.headRig.rotation.y = ego.yaw;
    for (const l of this.heads) l.intensity = 75 * lights;
    env.uCar.value.set(ego.x, 0.9, ego.z);
    env.uCarFwd.value.set(efx, 0, efz);
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.step(dt);
    this.pipeline.render(dt, this.time);
    this.frames++;
    if (this.frames === 3) this.hud.clearFade();
  }

  /** For tinkering: run the simulation ahead without drawing it. */
  skip(seconds) {
    const was = this.audio.instant;
    this.audio.stopSpeech();
    this.audio.instant = true;
    for (let i = 0, n = Math.round(seconds / 0.033); i < n; i++) this.step(0.033);
    this.audio.instant = was;
  }

  step(dt) {
    this.time += dt;
    env.uTime.value = this.time;
    const ego = this.ego, sky = this.sky, weather = this.weather;
    this.hour = (this.hour + (dt * this.timeFlow) / 3600) % 24;

    // ---- simulate
    this.traffic.speedK = 1 - 0.14 * weather.cur.rain - 0.22 * weather.snowCover - 0.2 * weather.cur.fog;
    this.traffic.update(dt, ego);
    this.pedGap = this.peds.obstacleAhead(ego);
    ego.update(dt, this.pedGap);
    this.peds.update(dt, ego, Math.max(weather.cur.rain, weather.cur.snow * 0.8));
    this.rides.update(dt);

    // ---- light levels
    const el = sky.elevation;
    const dark = clamp01(weather.cur.overcast * 0.35 + weather.cur.storm * 0.5 + weather.cur.fog * 0.3);
    env.uNight.value = clamp01(1 - smoothstep(-7, 2, el) + dark * 0.5);
    env.uLamp.value = clamp01(1 - smoothstep(-3, 1.5, el) + smoothstep(0.45, 0.8, dark));
    env.uLate.value = this.hour > 21 || this.hour < 5.5 ? clamp01(this.hour > 21 ? (this.hour - 21) / 3.5 : 1 - (this.hour - 4) / 1.5) : 0;
    const open = this.hour > 6.5 && this.hour < 23.5 ? 1 : 0.25;
    env.uShop.value = clamp01(1 - smoothstep(-2, 5, el) + dark * 0.6) * open;
    const lights = clamp01(Math.max(0.22, env.uLamp.value, weather.cur.rain > 0.05 || weather.cur.snow > 0.05 || weather.cur.fog > 0.3 ? 1 : 0));
    env.uHead.value = lights;
    this._cars(lights);
    const efx = -Math.sin(ego.yaw), efz = -Math.cos(ego.yaw);

    // ---- cabin and camera
    this._camera(dt);
    this.sunVis = this._sunVisibility();
    const bright = lerp(0.62, 1.5, sky.day);
    this.cabin.update(dt, {
      time: this.time, ego, sky,
      rain: weather.cur.rain, snow: weather.cur.snow,
      lampList: this.props.lamps, lampOn: env.uLamp.value,
      sunVis: this.sunVis, screenBright: bright, flash: weather.flash, viewDir: this.viewDir,
    });
    this.cabin.group.updateMatrixWorld(true);
    _v.copy(this.camWorld);
    this.camera.getWorldPosition(this.camWorld);
    this.camera.getWorldDirection(this.viewDir);
    if (dt > 0) this.camVel.copy(this.camWorld).sub(_v).divideScalar(dt);
    if (this.camVel.lengthSq() > 2500) this.camVel.set(0, 0, 0);
    this.focus.set(ego.x + efx * 38, 0, ego.z + efz * 38);

    // ---- sky, weather
    weather.update(dt, this.time, this.camWorld, this.camVel, sky.ambient);
    sky.update(dt, this.hour, weather.sky, this.focus);
    this.cabinScene.environment = sky.envMap;
    this.cabinScene.environmentIntensity = 0.22;
    this.renderer.toneMappingExposure = sky.exposure;
    this.buildings.update();
    this.props.update(clamp01(weather.cur.fog * 1.2 + weather.cur.rain * 0.6 + weather.cur.snow * 0.5));
    const reflect = this.quality.reflect && weather.wet > 0.02;
    this.pipeline.reflectOn = reflect;
    env.uReflectOn.value = reflect ? 1 : 0;
    this.ground.setWetness(reflect ? 1 : 0);

    // ---- the display
    const st = this.rides.status;
    this.screen.update({
      dt, ego, traffic: this.traffic, people: this.peds.list, parked: null,
      hour: this.hour, mph: ego.v * 2.237, tempF: weather.tempF(this.hour), sky: weather.label,
      label: st.label, headline: st.headline, sub: st.sub, rider: st.rider, riderColor: st.riderColor,
      track: this.audio.musicOn && this.audio.trackTitle ? `${this.audio.trackTitle}  ·  Nimbus Radio` : '',
      blinkOn: ego.blinkOn, bright,
    });

    // ---- sound
    if (ego.v > 1.5) this.moving = true;
    else if (this.moving && ego.v < 0.08) {
      this.moving = false;
      this.audio.play('stop');
    }
    const parked = ego.mode === 'parked';
    if (this.wasParked && !parked) this.audio.play('pull_away');
    this.wasParked = parked;
    this.audio.update(dt, {
      speed: ego.v, wet: weather.wet, rain: weather.cur.rain, snow: weather.cur.snow, snowCover: weather.snowCover,
      wind: weather.cur.wind, storm: weather.cur.storm, night: clamp01(1 - sky.day), hour: this.hour,
      door: Math.max(this.cabin.doors.L.open, this.cabin.doors.R.open),
    });
    this.hud.update(dt);
  }
}
