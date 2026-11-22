import * as THREE from 'three';
import { World } from './world/world';
import { Pipeline } from './render/pipeline';
import { routeAt, type Route } from './world/route';
import { Interior, lightThroughAir } from './train/interior';
import { CAR, EYE } from './train/cabin';
import { SUN_E, MOON_E } from './world/atmosphere';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? parseFloat(params.get(k)!) : d);
const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;
const DEG = Math.PI / 180;

/** How fast the day passes when it is left to drift: a full day in three hours. */
export const DRIFT = 8;

export interface Listener {
  (what: 'hour' | 'view' | 'tunnel' | 'bridge', value: number): void;
}

export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly world: World;
  readonly interior: Interior;
  readonly pipeline: Pipeline;
  readonly camera = new THREE.PerspectiveCamera(60, 1, 1.2, 160000);
  readonly cabinCamera = new THREE.PerspectiveCamera(60, 1, 0.04, 60);

  /** where the train is along the line, world x in metres */
  x = num('x', 96) * 1000;
  speed = num('speed', 25);
  hour = num('t', 9.4);
  /** does the clock run by itself */
  drift = false;
  time = 0;
  travelled = 0;
  exposure = 0.2;
  private autoExposure = !params.has('ev');

  // where the passenger looks: degrees, yaw positive to the left of the way ahead
  yaw = num('yaw', 44);
  pitch = num('pitch', -2);
  private yawTo = this.yaw;
  private pitchTo = this.pitch;
  /** 0 seated .. 1 leaning to the window */
  lean = 0;
  windowView = false;
  /** 0..1 as last measured */
  tunnel = 0;
  bridge = 0;

  private debugOut = params.get('cam') === 'out';
  private up = num('up', 2.7);
  private side = num('side', 0);
  private route = {} as Route;
  private last = 0;
  ready = false;
  /** milliseconds from the page opening to the first frame */
  readyAt = 0;
  frames = 0;
  dtAvg = 1 / 60;
  private listeners: Listener[] = [];
  /** called once a frame, after the world has moved on */
  onFrame: (dt: number) => void = () => {};
  private shown = 0;
  readonly debug = { routeAt };

  // scratch
  private carPos = new THREE.Vector3();
  private carQuat = new THREE.Quaternion();
  private carInv = new THREE.Quaternion();
  private camWorld = new THREE.Vector3();
  private eye = new THREE.Vector3();
  private lookQuat = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private m3 = new THREE.Matrix3();
  private m4 = new THREE.Matrix4();
  private lightCar = new THREE.Vector3();
  private lightCol = new THREE.Vector3();
  private reach = 1;
  private trees = 0;
  private travelVec = new THREE.Vector3();
  /** 0 no motion blur .. 1 a full shutter */
  blur = num('blur', 1);

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, depth: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.world = new World(this.renderer, num('tile', 1024), num('blocks', 8));
    this.interior = new Interior(this.renderer, this.world.noise, this.world.atmos.ambient.sh);
    this.pipeline = new Pipeline(this.renderer);
    if (params.has('ev')) this.exposure = num('ev', 0.2);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindLook();
  }

  on(fn: Listener) {
    this.listeners.push(fn);
  }
  private emit(what: Parameters<Listener>[0], value: number) {
    for (const fn of this.listeners) fn(what, value);
  }

  /** share of the full picture size being drawn: comes down if the machine cannot keep up */
  scale = 1;
  private slowFor = 0;
  private fastFor = 0;
  private retryAfter = 25;

  /** Keep to sixty frames a second by drawing fewer pixels when that is what it takes. */
  private pace(dt: number) {
    if (params.has('dpr') || this.time < 4 || document.visibilityState !== 'visible' || dt > 0.1) return;
    if (dt > 0.0195) this.slowFor += dt;
    else this.slowFor = Math.max(0, this.slowFor - dt * 2);
    if (dt < 0.0178) this.fastFor += dt;
    else this.fastFor = 0;
    if (this.slowFor > 1.2 && this.scale > 0.5) {
      this.scale = Math.max(0.5, this.scale * 0.86);
      this.slowFor = this.fastFor = 0;
      this.resize();
    } else if (this.fastFor > this.retryAfter && this.scale < 1) {
      // it has run easily for a while: try a little more, and wait longer before trying again
      this.scale = Math.min(1, this.scale / 0.92);
      this.fastFor = 0;
      this.retryAfter = Math.min(240, this.retryAfter * 1.7);
      this.resize();
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, num('dpr', 1.5)) * this.scale;
    const w = Math.max(2, Math.floor(window.innerWidth * dpr)), h = Math.max(2, Math.floor(window.innerHeight * dpr));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h);
    this.interior.setSize(w, h);
    for (const c of [this.camera, this.cabinCamera]) {
      c.aspect = w / h;
      c.updateProjectionMatrix();
    }
  }

  private bindLook() {
    const el = this.canvas;
    let id = -1, px = 0, py = 0, moved = 0, downAt = 0;
    el.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      px = e.clientX;
      py = e.clientY;
      moved = 0;
      downAt = performance.now();
      el.setPointerCapture(id);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const k = (this.cabinCamera.fov / Math.max(320, window.innerHeight)) * 1.15;
      this.yawTo += (e.clientX - px) * k;
      this.pitchTo += (e.clientY - py) * k;
      moved += Math.abs(e.clientX - px) + Math.abs(e.clientY - py);
      px = e.clientX;
      py = e.clientY;
      this.limitLook();
    });
    el.addEventListener('pointerup', (e) => {
      if (e.pointerId !== id) return;
      id = -1;
      // a click, not a drag: on the window beside the seat it means "lean over and look out"
      if (moved < 6 && performance.now() - downAt < 400 && !this.windowView && this.overWindow(e.clientX, e.clientY)) this.setWindowView(true);
    });
    el.addEventListener('pointercancel', (e) => {
      if (e.pointerId === id) id = -1;
    });
  }

  /** Is this point of the screen on the glass of the left-hand windows? */
  private overWindow(cx: number, cy: number): boolean {
    const c = this.cabinCamera;
    const d = this.v.set((cx / window.innerWidth) * 2 - 1, 1 - (cy / window.innerHeight) * 2, 0.5).unproject(c).sub(c.position).normalize();
    if (d.z > -0.05) return false;
    const t = (-CAR.glassZ - c.position.z) / d.z;
    const x = c.position.x + d.x * t, y = c.position.y + d.y * t;
    if (y < CAR.sill || y > CAR.head || Math.abs(x) > CAR.halfLength) return false;
    const inBay = (((x + CAR.halfLength) % CAR.pitch) + CAR.pitch) % CAR.pitch;
    return Math.abs(inBay - CAR.pitch / 2) < CAR.winHalf;
  }

  private limitLook() {
    if (this.windowView) {
      this.yawTo = clamp(this.yawTo, 28, 152);
      this.pitchTo = clamp(this.pitchTo, -40, 40);
    } else {
      this.yawTo = clamp(this.yawTo, -150, 165);
      this.pitchTo = clamp(this.pitchTo, -58, 62);
    }
  }

  setWindowView(on: boolean) {
    if (on === this.windowView) return;
    this.windowView = on;
    if (on) {
      this.yawTo = clamp(this.yawTo, 60, 120);
      this.pitchTo = clamp(this.pitchTo, -12, 12);
    }
    this.limitLook();
    this.emit('view', on ? 1 : 0);
  }

  setHour(h: number) {
    this.hour = ((h % 24) + 24) % 24;
    this.emit('hour', this.hour);
  }

  /** Where the car is and which way it faces, in the landscape's local coordinates. */
  private poseCar() {
    const r = routeAt(this.x, this.route);
    const flatLen = Math.sqrt(1 + r.dzp * r.dzp);
    const heading = Math.atan2(r.dzp, 1), grade = Math.atan2(r.dty, flatLen);
    // lean into curves a little, as the track is canted
    const a = routeAt(this.x - 6), za = a.dzp;
    const b = routeAt(this.x + 6, this.route), zb = b.dzp;
    routeAt(this.x, this.route);
    const curv = (zb - za) / 12 / flatLen ** 3;
    const s = this.speed / 25, t = this.time;
    const cant = clamp(curv * this.speed * this.speed * 0.06, -0.07, 0.07) + (Math.sin(t * 1.7) * 0.0016 + Math.sin(t * 2.9 + 1.3) * 0.0012) * s;
    this.carQuat.setFromEuler(this.e.set(cant, -heading, grade + Math.sin(t * 2.3 + 0.4) * 0.0008 * s, 'YZX'));
    this.carInv.copy(this.carQuat).invert();
    const bob = (Math.sin(t * 11.3) * 0.0012 + Math.sin(t * 7.1 + 2.0) * 0.0018 + Math.sin(t * 3.3) * 0.002) * s;
    const swayZ = (Math.sin(t * 1.9 + 0.7) * 0.004 + Math.sin(t * 4.3) * 0.0015) * s;
    this.carPos.set(this.x, r.ty + CAR.floorAboveRail + bob, r.zp + swayZ);
  }

  private poseCameras() {
    const w = this.lean * this.lean * (3 - 2 * this.lean);
    const y = this.yaw * DEG, p = this.pitch * DEG;
    // the head turns about the neck, so the eyes move a little as it does
    this.eye.set(EYE.x - 0.08 + 0.08 * Math.cos(y), EYE.y, EYE.z - 0.08 * Math.sin(y));
    this.v.set(CAR.bayX - 0.12, 1.26, -(CAR.glassZ - 0.2));
    this.eye.lerp(this.v, w);
    // the body lags the car's small motions
    const t = this.time, s = this.speed / 25;
    this.eye.y += (Math.sin(t * 5.7 + 1.1) * 0.0012 + Math.sin(t * 9.1) * 0.0007) * s;
    this.eye.z += Math.sin(t * 2.1) * 0.0018 * s;

    // local forward is +x: yaw turns to the left (towards -z), pitch looks up
    this.lookQuat.setFromEuler(this.e.set(0, y - Math.PI / 2, 0, 'YXZ'));
    this.v.set(1, 0, 0);
    this.lookQuat.setFromEuler(this.e.set(p, y - Math.PI / 2, 0, 'YXZ'));
    const fov = THREE.MathUtils.lerp(num('fov', 62), 56, w);
    for (const c of [this.camera, this.cabinCamera]) {
      if (c.fov !== fov) {
        c.fov = fov;
        c.updateProjectionMatrix();
      }
    }
    this.cabinCamera.position.copy(this.eye);
    this.cabinCamera.quaternion.copy(this.lookQuat);
    this.cabinCamera.updateMatrixWorld(true);

    if (this.debugOut) {
      const r = this.route;
      this.camWorld.set(this.x, r.ty + this.up, r.zp - this.side);
      this.camera.quaternion.setFromEuler(this.e.set(p, y - Math.PI / 2 - Math.atan2(r.dzp, 1), 0, 'YXZ'));
    } else {
      this.camWorld.copy(this.eye).applyQuaternion(this.carQuat).add(this.carPos);
      this.camera.quaternion.copy(this.carQuat).multiply(this.lookQuat);
    }
    this.world.prepare(this.camWorld.x, this.camWorld.z);
    this.camera.position.set(this.camWorld.x - this.world.originX, this.camWorld.y, this.camWorld.z - this.world.originZ);
    this.camera.updateMatrixWorld(true);
  }

  async start() {
    this.poseCar();
    this.poseCameras();
    await this.world.init(this.camWorld.x, this.camWorld.y, this.camWorld.z, this.hour);
    this.poseCameras();
    this.ready = true;
    this.readyAt = performance.now();
    this.last = this.readyAt;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Move the world on by dt seconds. */
  step(dt: number) {
    this.time += dt;
    // the driver eases off and picks up again, slowly
    const cruise = num('speed', 25) * (1 + 0.1 * Math.sin(this.time * 0.021) + 0.05 * Math.sin(this.time * 0.0073 + 2));
    this.speed += (cruise - this.speed) * Math.min(1, dt * 0.3);
    const r = routeAt(this.x, this.route);
    const d = this.speed * dt;
    this.x += d / Math.sqrt(1 + r.dzp * r.dzp + r.dty * r.dty);
    this.travelled += d;
    if (this.drift) this.setHour(this.hour + (dt * DRIFT) / 3600);

    const k = 1 - Math.exp(-dt * 9);
    this.yaw += (this.yawTo - this.yaw) * k;
    this.pitch += (this.pitchTo - this.pitch) * k;
    const lt = this.windowView ? 1 : 0;
    this.lean += clamp(lt - this.lean, -dt / 0.7, dt / 0.7);
  }

  private pf = { dh: 0, tunnel: 0, viaduct: 0, ground: 0 };
  draw(dt: number) {
    this.poseCar();
    this.poseCameras();
    const W = this.world;
    W.atmos.uniforms().uExposure.value = this.exposure;
    W.update(this.camWorld.x, this.camWorld.y, this.camWorld.z, this.camera, this.hour, this.time, this.pipeline.height);

    // what the line is doing here: over the length of the car
    let tun = 0, via = 0;
    for (let i = -2; i <= 2; i++) {
      const s = W.bake.profileAt(this.x + i * 4.5, this.pf);
      tun += s.tunnel / 5;
      via += s.viaduct / 5;
    }
    if (Math.abs(tun - this.tunnel) > 0.001) this.emit('tunnel', tun);
    if (Math.abs(via - this.bridge) > 0.001) this.emit('bridge', via);
    this.tunnel = tun;
    this.bridge = via;

    // light for the cabin
    const sunUp = W.shared.uSunPrimary.value === 1;
    const haze = W.atmos.haze.value;
    lightThroughAir(W.lightDir.y, this.camWorld.y / 1000, haze, this.lightCol).multiplyScalar(sunUp ? SUN_E : MOON_E);
    this.lightCar.copy(W.lightDir).applyQuaternion(this.carInv);
    const hx = W.lightDir.x, hz = W.lightDir.z, hl = Math.hypot(hx, hz) || 1;
    W.bake.probe(this.carPos.x, this.carPos.z, this.carPos.x + (hx / hl) * 18, this.carPos.z + (hz / hl) * 18);
    const kk = 1 - Math.exp(-dt * 10);
    this.reach += (W.bake.probed.reach * W.cloudShade(this.carPos.x, this.carPos.y, this.carPos.z) - this.reach) * kk;
    this.trees += (W.bake.probed.forest - this.trees) * (1 - Math.exp(-dt * 4));
    const sunElev = Math.asin(clamp(W.sunDir.y, -1, 1)) / DEG;
    const lamps = Math.max(1 - smooth(sunElev, -3, 7), smooth(tun, 0.05, 0.6));
    this.m3.setFromMatrix4(this.m4.makeRotationFromQuaternion(this.carQuat));
    this.interior.update(
      { dir: this.lightCar, colour: this.lightCol, reach: this.reach, trees: this.trees, tunnel: tun, lamps, exposure: this.exposure, travelled: this.travelled, speed: this.speed },
      this.m3,
      dt,
    );

    // what spills from the windows on to a tunnel's wall
    W.trackside.trainLight.set((0.006 + 0.02 * lamps) * this.exposure, this.travelled, lamps, 0);

    this.renderer.shadowMap.needsUpdate = true;
    const fz = this.v2.set(0, 0, -1).applyQuaternion(this.cabinCamera.quaternion).z;
    // the shutter stays open a fiftieth of a second
    const r = this.route, fl = Math.sqrt(1 + r.dzp * r.dzp + r.dty * r.dty);
    this.travelVec.set(1 / fl, r.dty / fl, r.dzp / fl).multiplyScalar(this.speed * 0.02 * this.blur);
    this.pipeline.render({
      land: W.scene,
      landCamera: this.camera,
      travel: this.travelVec,
      cabin: this.debugOut ? null : this.interior.scene,
      cabinCamera: this.cabinCamera,
      time: this.time,
      exposure: this.exposure,
      beforeCabin: this.debugOut
        ? undefined
        : () => {
            const k = 1 - 0.92 * this.lean;
            if (fz < 0.45) this.interior.renderMirror(0, this.cabinCamera, k);
            if (fz > -0.45) this.interior.renderMirror(1, this.cabinCamera, k);
          },
    });

    // and so does its sense of white: half-way towards whatever lights the scene, as a camera would
    const sh = W.atmos.ambient.sh;
    const sunW = Math.max(W.lightDir.y, 0) * this.reach * (1 - tun);
    let ir = sh[0] * 0.886 + this.lightCol.x * sunW, ig = sh[1] * 0.886 + this.lightCol.y * sunW, ib = sh[2] * 0.886 + this.lightCol.z * sunW;
    // the cabin's own lamps, when they are what there is
    const lampW = (0.02 + 0.3 * lamps) * (0.15 + 0.85 * tun);
    ir += 1.0 * lampW; ig += 0.86 * lampW; ib += 0.66 * lampW;
    const mean = (ir + ig + ib) / 3 || 1;
    const half = (v: number) => clamp(Math.pow(mean / Math.max(v, 1e-6), 0.5), 0.7, 1.45);
    const bal = this.pipeline.balance, kb = 1 - Math.exp(-dt * 2);
    bal.x += (half(ir) - bal.x) * kb;
    bal.y += (half(ig) - bal.y) * kb;
    bal.z += (half(ib) - bal.z) * kb;

    // the eye adjusts
    if (this.autoExposure) {
      const seen = Math.exp(this.pipeline.logLum) / this.pipeline.meteredAt;
      const key = THREE.MathUtils.lerp(0.03, 0.17, smooth(Math.log10(Math.max(seen, 1e-7)), -4.3, -0.8));
      const target = clamp(key / Math.max(seen, 1e-7), 0.02, 300);
      const rate = target < this.exposure ? 2.6 : 1.5;
      this.exposure = Math.exp(Math.log(this.exposure) + (Math.log(target) - Math.log(this.exposure)) * (1 - Math.exp(-dt * rate)));
    }
    this.frames++;
  }

  frame(dt: number) {
    this.dtAvg += (dt - this.dtAvg) * 0.05;
    this.pace(dt);
    this.step(dt);
    // the picture comes up out of black
    this.shown = Math.min(1, this.shown + dt / 1.4);
    this.pipeline.fade = this.shown * this.shown * (3 - 2 * this.shown);
    this.draw(dt);
    this.onFrame(dt);
  }

  /** Run the ride forward without drawing (for tests). */
  skip(seconds: number) {
    for (let t = 0; t < seconds; t += 0.05) this.step(0.05);
  }
}
