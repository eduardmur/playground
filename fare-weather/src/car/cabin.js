// The inside of the cab: dashboard, screen, pillars, doors, two seats, and the
// light that falls into it. Everything is in car space (origin on the road
// under the middle of the car, -Z forward) and built from a few dozen boxes,
// beams and swept profiles.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeGlassMaterial, WIPE_BINS, WIPE_MAX } from './glass.js';
import { clamp, clamp01, lerp, damp, smoothstep, easeInOut } from '../core/utils.js';

const TRIM = [0.026, 0.027, 0.03];
const TRIM2 = [0.042, 0.043, 0.047];
const LINER = [0.06, 0.06, 0.065];
const SEAT = [0.34, 0.325, 0.3];
const CARPET = [0.014, 0.014, 0.016];
const GLOSS = [0.008, 0.008, 0.01];
const SKIN = [0.02, 0.02, 0.022];

// windscreen: from the cowl up to the header
const WS = { z0: -1.44, y0: 0.875, z1: -0.36, y1: 1.385, wb: 0.8, wt: 0.63, len: 1.2 };
export const HINGE_Y = 1.4, HINGE_X = 0.66;

function paint(geo, c) {
  if (geo.index) geo = geo.toNonIndexed();
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}
const box = (w, h, d, x, y, z, c, rx = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  return paint(g.translate(x, y, z), c);
};
const rbox = (w, h, d, r, x, y, z, c, rx = 0) => {
  const g = new RoundedBoxGeometry(w, h, d, 3, r);
  if (rx) g.rotateX(rx);
  return paint(g.translate(x, y, z), c);
};
const _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1), _d = new THREE.Vector3();
function beam(p0, p1, w, h, c) {
  _d.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const len = _d.length();
  _q.setFromUnitVectors(_z, _d.normalize());
  const g = new THREE.BoxGeometry(w, h, len).applyQuaternion(_q);
  return paint(g.translate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2), c);
}
/** Extrude a side-view outline [[z, y], ...] across the car from x0 to x1. */
function sweep(profile, x0, x1, c) {
  const pos = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [za, ya] = profile[i], [zb, yb] = profile[i + 1];
    pos.push(x0, ya, za, x1, ya, za, x1, yb, zb, x0, ya, za, x1, yb, zb, x0, yb, zb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return paint(g, c);
}
/** A sheet from a function of (u, v) in [0,1]². */
function sheet(fn, nu, nv, c, flip = false) {
  const pos = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = fn(i / nu, j / nv), b = fn((i + 1) / nu, j / nv), cc = fn((i + 1) / nu, (j + 1) / nv), d = fn(i / nu, (j + 1) / nv);
      if (flip) pos.push(...a, ...cc, ...b, ...a, ...d, ...cc);
      else pos.push(...a, ...b, ...cc, ...a, ...cc, ...d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return paint(g, c);
}
const finish = (list) => toCreasedNormals(mergeGeometries(list), 0.7);

function wsPoint(u, v) {
  const hw = lerp(WS.wb, WS.wt, v);
  const bulge = 1 - u * u;
  return [u * hw, lerp(WS.y0, WS.y1, v) + 0.03 * Math.sin(Math.PI * v), lerp(WS.z0, WS.z1, v) - 0.085 * bulge * (1 - 0.45 * v)];
}

export class Cabin {
  constructor(pipeline, screenMaterial) {
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.onWipe = null;

    const mTrim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    const mSeat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0 });
    const mGloss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 0.1 });
    const mLiner = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    this.stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const add = (geo, mat, parent = this.group, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      m.frustumCulled = false;
      parent.add(m);
      return m;
    };

    // ---- fixed shell
    const trim = [];
    trim.push(sweep([
      [-0.86, 0.3], [-0.86, 0.5], [-0.64, 0.7], [-0.48, 0.752], [-0.455, 0.775], [-0.475, 0.8], [-0.455, 0.825], [-0.468, 0.872],
      [-0.5, 0.892], [-0.62, 0.9], [-1.0, 0.895], [-1.46, 0.874], [-1.6, 0.855],
    ], -0.845, 0.845, TRIM));
    for (const s of [-1, 1]) {
      trim.push(beam([s * 0.818, 0.865, -1.445], [s * 0.647, 1.392, -0.35], 0.095, 0.115, TRIM)); // A pillar
      trim.push(beam([s * 0.647, 1.397, -0.36], [s * 0.662, 1.402, 1.1], 0.075, 0.06, TRIM)); // roof rail
      trim.push(box(0.06, 0.13, 2.25, s * 0.825, 0.355, -0.27, TRIM)); // sill
      trim.push(box(0.07, 1.14, 0.36, s * 0.825, 0.86, 0.97, TRIM)); // rear quarter
    }
    trim.push(beam([-0.66, 1.397, -0.352], [0.66, 1.397, -0.352], 0.07, 0.1, TRIM)); // header
    trim.push(box(1.72, 1.16, 0.08, 0, 0.86, 1.13, TRIM)); // rear bulkhead
    trim.push(box(1.66, 0.04, 0.22, 0, 1.03, 1.0, TRIM2)); // parcel shelf
    trim.push(box(1.72, 0.02, 2.6, 0, 0.3, -0.15, CARPET)); // floor
    trim.push(rbox(0.21, 0.17, 0.8, 0.04, 0, 0.555, 0.43, TRIM2)); // armrest between the seats
    trim.push(box(0.2, 0.05, 0.52, 0, 0.345, -0.16, TRIM2)); // tray
    trim.push(box(0.1, 0.11, 0.035, 0, 0.84, -0.468, TRIM)); // screen stalk
    // things only the light sees: roof skin, nose, tail
    trim.push(box(1.52, 0.04, 1.62, 0, 1.47, 0.37, SKIN), box(1.74, 0.5, 0.8, 0, 0.55, -1.98, SKIN), box(1.74, 1.1, 0.6, 0, 0.85, 1.48, SKIN));
    add(finish(trim), mTrim);

    add(finish([
      sheet((u, v) => {
        const x = lerp(-0.665, 0.665, u);
        return [x, 1.402 + 0.036 * (1 - (x / 0.665) ** 2), lerp(-0.37, 1.1, v)];
      }, 8, 6, LINER),
    ]), mLiner);

    add(finish([
      rbox(0.23, 0.07, 0.13, 0.02, 0, 1.352, -0.43, GLOSS), // the cab's forward camera pod
      box(0.06, 0.03, 0.03, 0, 1.318, -0.385, GLOSS),
      paint(new THREE.CylinderGeometry(0.041, 0.041, 0.012, 20).translate(-0.045, 0.642, 0.13), GLOSS), // cup holders
      paint(new THREE.CylinderGeometry(0.041, 0.041, 0.012, 20).translate(0.045, 0.642, 0.13), GLOSS),
    ]), mGloss);

    const seats = [];
    for (const s of [-1, 1]) {
      seats.push(rbox(0.52, 0.15, 0.54, 0.05, s * 0.37, 0.475, 0.15, SEAT, 0.1));
      seats.push(rbox(0.5, 0.68, 0.14, 0.05, s * 0.37, 0.87, 0.565, SEAT, 0.36));
      seats.push(rbox(0.27, 0.2, 0.11, 0.04, s * 0.37, 1.245, 0.725, SEAT, 0.3));
    }
    add(finish(seats), mSeat);

    // ---- the screen
    this.screen = new THREE.Group();
    this.screen.position.set(0, 0.952, -0.452);
    this.screen.rotation.x = -0.16;
    add(finish([rbox(0.487, 0.297, 0.016, 0.007, 0, 0, 0, GLOSS)]), mGloss, this.screen);
    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.464, 0.274), screenMaterial);
    display.position.z = 0.0086;
    this.screen.add(display);
    this.display = display;
    this.group.add(this.screen);

    // ---- ambient strip
    const stripGeo = [new THREE.PlaneGeometry(1.62, 0.013).translate(0, 0.8, -0.466)];
    add(mergeGeometries(stripGeo), this.stripMat, this.group, false);

    // ---- glass
    this.glassWS = makeGlassMaterial(pipeline, { wiper: true, fan: new THREE.Vector2(0, -1.5), lanes: 46, span: new THREE.Vector2(0.0, 0.55) });
    this.glassL = makeGlassMaterial(pipeline, { fan: new THREE.Vector2(-42, 13.4), lanes: 1040, span: new THREE.Vector2(-1, -0.5) });
    this.glassR = makeGlassMaterial(pipeline, { fan: new THREE.Vector2(-42, 13.4), lanes: 1040, span: new THREE.Vector2(-1, -0.5) });
    this.glasses = [this.glassWS, this.glassL, this.glassR];
    {
      const NU = 14, NV = 9;
      const pos = [], gl = [], idx = [];
      for (let j = 0; j <= NV; j++) {
        for (let i = 0; i <= NU; i++) {
          const u = (i / NU) * 2 - 1, v = j / NV;
          const p = wsPoint(u, v);
          pos.push(p[0], p[1], p[2]);
          gl.push(p[0], v * WS.len);
        }
      }
      for (let j = 0; j < NV; j++) {
        for (let i = 0; i < NU; i++) {
          const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 2, d = a + NU + 1;
          idx.push(a, b, c, a, c, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aGlass', new THREE.Float32BufferAttribute(gl, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.glassWS);
      m.frustumCulled = false;
      m.renderOrder = 2;
      this.group.add(m);
    }

    // ---- doors: everything that swings up with them
    this.doors = {};
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * HINGE_X, HINGE_Y, 0);
      const parts = [
        box(0.045, 0.51, 2.18, s * 0.822, 0.675, -0.29, TRIM),
        rbox(0.03, 0.14, 2.1, 0.012, s * 0.797, 0.855, -0.29, TRIM2),
        rbox(0.14, 0.075, 1.15, 0.03, s * 0.735, 0.7, 0.12, TRIM2),
        box(0.02, 0.18, 0.9, s * 0.797, 0.52, -0.2, CARPET),
        rbox(0.06, 0.04, 2.2, 0.015, s * 0.826, 0.946, -0.29, TRIM, -0.032),
        box(0.03, 0.56, 2.22, s * 0.872, 0.66, -0.29, SKIN),
      ];
      const geo = finish(parts).translate(-s * HINGE_X, -HINGE_Y, 0);
      add(geo, mTrim, pivot);
      // its strip of light
      const sg = new THREE.PlaneGeometry(1.9, 0.011).rotateY((-s * Math.PI) / 2).translate(s * 0.7805 - s * HINGE_X, 0.8 - HINGE_Y, -0.25);
      add(sg, this.stripMat, pivot, false);
      // its window
      const A = [s * 0.812, 0.905, -1.4], B = [s * 0.83, 0.975, 0.8], C = [s * 0.655, 1.378, 0.72], D = [s * 0.637, 1.383, -0.37];
      const g = new THREE.BufferGeometry();
      const pts = [A, B, C, D];
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p[0] - s * HINGE_X, p[1] - HINGE_Y, p[2]]), 3));
      g.setAttribute('aGlass', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p[2] + 1.4, p[1] - 0.9]), 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      const gm = new THREE.Mesh(g, s < 0 ? this.glassL : this.glassR);
      gm.frustumCulled = false;
      gm.renderOrder = 2;
      pivot.add(gm);
      this.group.add(pivot);
      this.doors[s < 0 ? 'L' : 'R'] = { pivot, open: 0, target: 0, sign: s };
    }

    // seats: where passengers get attached
    this.seatAnchor = { L: new THREE.Group(), R: new THREE.Group() };
    this.seatAnchor.L.position.set(-0.37, 0, 0);
    this.seatAnchor.R.position.set(0.37, 0, 0);
    this.group.add(this.seatAnchor.L, this.seatAnchor.R);

    // ---- light
    this.sun = new THREE.DirectionalLight(0xffffff, 0);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(2048, 2048);
    sh.camera.left = sh.camera.bottom = -1.9;
    sh.camera.right = sh.camera.top = 1.9;
    sh.camera.near = 1;
    sh.camera.far = 13;
    sh.bias = -0.0006;
    sh.normalBias = 0.012;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 1);
    this.fill = new THREE.AmbientLight(0x8090b0, 0.02);
    this.lamps = [0, 1].map(() => {
      const l = new THREE.SpotLight(0xffd6ab, 0, 0, 0.4, 1, 0);
      l.castShadow = true;
      l.shadow.mapSize.set(1024, 1024);
      l.shadow.camera.near = 2;
      l.shadow.camera.far = 45;
      l.shadow.bias = -0.0006;
      l.shadow.normalBias = 0.015;
      return { light: l, lamp: null };
    });
    this.screenGlow = new THREE.PointLight(0xbcd4ff, 0, 2.6, 2);
    this.screenGlow.position.set(0, 0.96, -0.36);
    this.dome = new THREE.PointLight(0xffdcb4, 0, 3, 2);
    this.dome.position.set(0, 1.34, 0.25);
    this.flash = new THREE.AmbientLight(0xbfd0ff, 0);
    this.group.add(this.screenGlow, this.dome);
    this.lights = [this.sun, this.sun.target, this.hemi, this.fill, this.flash, ...this.lamps.flatMap((l) => [l.light, l.light.target])];

    this.wiper = { ang: -WIPE_MAX, t: 0, dur: 1, moving: false, half: false, rest: 0, last: -100 };
    this.flowWS = 0;
    this.flowSide = 0;
    this.wetGlass = 0;
    this.sunVis = 1;

    this.views = {
      front: { pos: new THREE.Vector3(0, 1.13, 0.28), pitch: -0.03, yawMax: 1.22, pitchMin: -0.56, pitchMax: 0.45, fov: 62 },
      rear: { pos: new THREE.Vector3(0, 1.31, 1.0), pitch: -0.2, yawMax: 0.7, pitchMin: -0.3, pitchMax: 0.25, fov: 60 },
      // the cab's own eye on its riders, up by the header, looking back at the seats
      riders: { pos: new THREE.Vector3(0, 1.3, -0.3), yaw: Math.PI, fixed: true, pitch: -0.27, yawMax: 0.55, pitchMin: -0.3, pitchMax: 0.22, fov: 76 },
    };
  }

  addTo(scene) {
    scene.add(this.group);
    for (const l of this.lights) scene.add(l);
  }

  setDoor(side, open) {
    this.doors[side].target = open ? 1 : 0;
  }

  // ------------------------------------------------------------ wiper

  _wiper(dt, time, rain) {
    const w = this.wiper;
    const wet = this.wetGlass;
    if (!w.moving) {
      w.rest -= dt;
      const want = rain > 0.03 || (wet > 0.25 && time - w.last > 7);
      if (want && w.rest <= 0) {
        w.moving = true;
        w.half = false;
        w.t = 0;
        w.dur = rain > 0.7 ? 0.6 : rain > 0.3 ? 0.9 : 1.05;
        this.onWipe?.(1);
      }
      return;
    }
    w.t += dt / w.dur;
    const ph = w.t < 1 ? easeInOut(clamp01(w.t)) : 1 - easeInOut(clamp01(w.t - 1));
    const prev = w.ang;
    w.ang = -WIPE_MAX + ph * 2 * WIPE_MAX;
    const wipe = this.glassWS.userData.wipe;
    const bin = (a) => ((a / WIPE_MAX) * 0.5 + 0.5) * (WIPE_BINS - 1);
    const b0 = Math.max(0, Math.floor(Math.min(bin(prev), bin(w.ang))));
    const b1 = Math.min(WIPE_BINS - 1, Math.ceil(Math.max(bin(prev), bin(w.ang))));
    for (let i = b0; i <= b1; i++) wipe[i] = time;
    if (w.t >= 1 && !w.half) {
      w.half = true;
      this.onWipe?.(-1);
    }
    if (w.t >= 2) {
      w.moving = false;
      w.ang = -WIPE_MAX;
      w.last = time;
      w.rest = rain > 0.7 ? 0.05 : rain > 0.3 ? 0.55 : rain > 0.03 ? 3.2 : 1.5;
    }
    this.glassWS.uniforms.uWiperAng.value = w.ang;
  }

  // ------------------------------------------------------------ light

  /**
   * s: { ego, sky, lampList, lampOn, sunVis, screenBright, flash, envMap }
   */
  _light(dt, s) {
    const { ego, sky } = s;
    const cx = ego.x, cz = ego.z;
    // sun (or moon), dimmed when a building or a tree is in the way
    this.sunVis = damp(this.sunVis, s.sunVis, 10, dt);
    this.sun.color.copy(sky.lightColor);
    this.sun.intensity = sky.lightIntensity * this.sunVis * 0.85;
    this.sun.castShadow = this.sun.intensity > 0.01;
    this.sun.position.set(cx, 0.9, cz).addScaledVector(sky.lightDir, 6.5);
    this.sun.target.position.set(cx, 0.9, cz);
    this.sun.target.updateMatrixWorld();

    this.hemi.color.copy(sky.ambient);
    this.hemi.groundColor.copy(sky.ambient).multiplyScalar(0.3);
    this.hemi.intensity = 2.3;
    this.flash.intensity = s.flash * 3;

    // the two nearest street lamps sweep their light through the cabin
    const list = s.lampList;
    let n0 = null, n1 = null, d0 = 1e9, d1 = 1e9;
    if (s.lampOn > 0.02) {
      for (const l of list) {
        const dx = l.x - cx, dz = l.z - cz;
        if (Math.abs(dx) > 40 || Math.abs(dz) > 40) continue;
        const d = dx * dx + dz * dz;
        if (d < d0) { n1 = n0; d1 = d0; n0 = l; d0 = d; }
        else if (d < d1) { n1 = l; d1 = d; }
      }
    }
    const near = [n0, n1];
    for (const slot of this.lamps) if (slot.lamp && !near.includes(slot.lamp)) slot.lamp = null;
    for (const l of near) {
      if (!l || this.lamps.some((sl) => sl.lamp === l)) continue;
      const freeSlot = this.lamps.find((sl) => !sl.lamp);
      if (freeSlot) freeSlot.lamp = l;
    }
    for (const slot of this.lamps) {
      const L = slot.light;
      if (!slot.lamp) {
        L.intensity = 0;
        L.castShadow = false;
        continue;
      }
      const l = slot.lamp;
      const d = Math.hypot(l.x - cx, l.z - cz);
      L.position.set(l.x, l.y, l.z);
      L.target.position.set(cx, 0.85, cz);
      L.target.updateMatrixWorld();
      const reach = Math.hypot(d, l.y - 0.85);
      L.angle = clamp(Math.atan(2.4 / Math.max(3, reach)), 0.1, 0.62);
      // keep the shadow's depth range tight around the car, or the roof's shadow leaks at this distance
      L.shadow.camera.near = Math.max(1, reach - 3.2);
      L.shadow.camera.far = reach + 3.2;
      L.shadow.camera.updateProjectionMatrix();
      L.intensity = 1.9 * s.lampOn * smoothstep(27, 9, d);
      L.castShadow = L.intensity > 0.02;
    }

    this.screenGlow.intensity = 0.1 * s.screenBright + 0.05;
    const doorOpen = Math.max(this.doors.L.open, this.doors.R.open);
    this.dome.intensity = damp(this.dome.intensity, doorOpen > 0.05 ? 0.55 * (0.3 + 0.7 * sky.night) : 0, 4, dt);
    this.fill.intensity = 0.03 + 0.1 * s.lampOn; // enough at night to tell a shoulder from a seat
    // the strip: a line of white by day, softer after dark
    const k = lerp(1.25, 2.6, sky.day);
    this.stripMat.color.setRGB(k, k * 0.96, k * 0.88);
  }

  // ------------------------------------------------------------ each frame

  /**
   * s: { time, ego, sky, rain (0..1 on the glass), snow, lampList, lampOn, sunVis, screenBright, flash, viewDir }
   */
  update(dt, s) {
    const { ego, sky, time } = s;
    const g = this.group;
    g.position.set(ego.x, 0, ego.z);
    g.rotation.set(clamp(ego.acc * 0.0045, -0.02, 0.014), ego.yaw, clamp(-ego.latAcc * 0.007, -0.025, 0.025));

    for (const d of Object.values(this.doors)) {
      d.open = damp(d.open, d.target, d.target > d.open ? 2.4 : 3.2, dt);
      if (Math.abs(d.open - d.target) < 0.002) d.open = d.target;
      d.pivot.rotation.z = d.sign * easeInOut(d.open) * 1.28;
    }

    // water on the glass builds quickly and clears slowly
    const precip = Math.max(s.rain, s.snow * 0.4);
    this.wetGlass = precip > this.wetGlass ? damp(this.wetGlass, precip, 0.9, dt) : damp(this.wetGlass, precip, 0.07, dt);
    if (this.wetGlass < 0.004) this.wetGlass = 0;
    this._wiper(dt, time, precip);
    const v = ego.v;
    const vWS = lerp(-0.03, 0.5, smoothstep(2, 11, v));
    const vSide = lerp(0.035, 0.85, smoothstep(1, 11, v));
    this.flowWS += vWS * dt;
    this.flowSide += vSide * dt;
    const sunAhead = s.viewDir ? Math.max(0, s.viewDir.dot(sky.sunDir)) : 0;
    const veil = sky.lightIntensity * this.sunVis * sky.sunUp * Math.pow(sunAhead, 5) * 0.022;
    const dash = sky.lightIntensity * this.sunVis * Math.max(0, sky.lightDir.y) * 0.004 + (sky.ambient.r + sky.ambient.g + sky.ambient.b) * 0.0035;
    for (const m of this.glasses) {
      const u = m.uniforms;
      u.uTime.value = time;
      u.uWetGlass.value = this.wetGlass;
      u.uRainRate.value = precip;
      u.uSnow.value = s.snow > s.rain ? clamp01(s.snow) : 0;
      u.uSky.value.copy(sky.ambient).multiplyScalar(1.6).addScalar(0.02);
      u.uVeil.value.copy(sky.lightColor).multiplyScalar(m === this.glassWS ? veil : veil * 0.4);
    }
    this.glassWS.uniforms.uFlow.value = this.flowWS;
    this.glassWS.uniforms.uFlowSign.value = vWS >= 0 ? 1 : -1;
    this.glassWS.uniforms.uTrailAmt.value = clamp01(Math.abs(vWS) / 0.03);
    this.glassWS.uniforms.uDash.value.copy(sky.lightColor).multiplyScalar(dash);
    for (const m of [this.glassL, this.glassR]) {
      m.uniforms.uFlow.value = this.flowSide;
      m.uniforms.uFlowSign.value = 1;
      m.uniforms.uTrailAmt.value = 1;
    }
    this._light(dt, s);
  }
}

export { WS, wsPoint };
