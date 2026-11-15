// Street furniture: lamps (with their pools, glows and shafts of light), signals
// that follow the traffic simulation, street-name signs, and the small things
// that make a pavement look used.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { env, makeCanvas, canvasTexture } from './shared.js';
import { DIRS, SIG, LANE_W, PARK_W, CURB_H } from './city.js';
import { Glows, Pools, Cones } from '../fx/lights.js';
import { mulberry32, hash2 } from '../core/utils.js';

function paint(geo, r, g, b) {
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute('uv');
  return geo;
}
const box = (w, h, d, x, y, z, c) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), ...c);
const cyl = (r0, r1, h, x, y, z, c, seg = 8) => paint(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), ...c);

const METAL = [0.05, 0.055, 0.06];
const SIG_ON = [[5.5, 0.22, 0.12], [5.0, 2.6, 0.15], [0.25, 4.6, 2.0]];
const SIG_OFF = [[0.035, 0.012, 0.01], [0.03, 0.022, 0.006], [0.006, 0.03, 0.018]];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

class Instances {
  constructor(geo, material, { shadow = true } = {}) {
    this.geo = geo;
    this.material = material;
    this.items = [];
    this.shadow = shadow;
  }

  add(x, y, z, yaw = 0, scale = 1, color = null) {
    this.items.push({ x, y, z, yaw, scale, color });
  }

  build() {
    const mesh = new THREE.InstancedMesh(this.geo, this.material, Math.max(1, this.items.length));
    this.items.forEach((it, i) => {
      _q.setFromAxisAngle(Y_AXIS, it.yaw);
      _m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.scale, it.scale, it.scale));
      mesh.setMatrixAt(i, _m);
      if (it.color) mesh.setColorAt(i, _c.setRGB(it.color[0], it.color[1], it.color[2]));
    });
    mesh.count = this.items.length;
    mesh.castShadow = this.shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }
}

export class Props {
  constructor(city, buildings) {
    this.city = city;
    this.group = new THREE.Group();
    this.lamps = [];
    const rnd = mulberry32(777);
    const mat = (this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }));

    // per-lane record of what already stands on the pavement, so things do not overlap
    const taken = new Map();
    const free = (lane, s, margin = 2.4) => {
      const arr = taken.get(lane) || [];
      return !arr.some((t) => Math.abs(t - s) < margin);
    };
    const take = (lane, s) => {
      if (!taken.has(lane)) taken.set(lane, []);
      taken.get(lane).push(s);
    };
    this.taken = taken;
    this.free = free;
    this.take = take;
    const kerbPoint = (lane, s, inFromKerb) => {
      const off = LANE_W / 2 + PARK_W + inFromKerb;
      return [lane.ax + lane.tx * s + lane.rx * off, lane.az + lane.tz * s + lane.rz * off];
    };
    this.kerbPoint = kerbPoint;
    for (const lane of city.lanes) if (lane.k === 0) for (const zn of lane.zones) take(lane, zn.s);

    this._lamps(mat, kerbPoint, free, take);
    this._signals(mat);
    this._furniture(mat, rnd, kerbPoint, free, take, buildings);
  }

  // ------------------------------------------------------------ lamps

  _lamps(mat, kerbPoint, free, take) {
    const city = this.city;
    const geo = mergeGeometries([
      cyl(0.065, 0.11, 8.7, 0, 4.35, 0, METAL),
      cyl(0.16, 0.2, 0.5, 0, 0.25, 0, METAL),
      paint(new THREE.CylinderGeometry(0.04, 0.05, 2.6, 6).rotateZ(-(Math.PI / 2 - 0.16)).translate(1.25, 8.78, 0), ...METAL),
      box(0.8, 0.11, 0.3, 2.6, 8.98, 0, METAL),
    ]);
    const poles = new Instances(geo, mat);
    const lensGeo = new THREE.BoxGeometry(0.56, 0.03, 0.22).translate(2.6, 8.915, 0);
    this.lensMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const lenses = new Instances(lensGeo, this.lensMat, { shadow: false });

    for (const lane of city.lanes) {
      if (lane.k !== 0) continue;
      const start = 15 + (lane.dir < 2 ? 0 : 17);
      for (let s = start; s < lane.len - 11; s += 34) {
        let ss = s;
        if (!free(lane, ss, 4)) ss += 5.2;
        take(lane, ss);
        const [x, z] = kerbPoint(lane, ss, 0.6);
        // local +x (the arm) points across the kerb at the road
        const yaw = Math.atan2(lane.rz, -lane.rx);
        poles.add(x, CURB_H, z, yaw);
        lenses.add(x, CURB_H, z, yaw);
        this.lamps.push({ x: x - lane.rx * 2.6, y: CURB_H + 8.9, z: z - lane.rz * 2.6, tx: lane.tx, tz: lane.tz, rx: lane.rx, rz: lane.rz });
      }
    }
    this.group.add(poles.build(), lenses.build());

    const lamps = this.lamps;
    this.lampGlows = new Glows(lamps.length, { reflect: true });
    this.pools = new Pools(lamps.length);
    for (const l of lamps) {
      this.lampGlows.add(l.x, l.y - 0.08, l.z, 2.4, 1.85, 1.2, 0.55, 0, 0, 0, 0, 0);
      // the patch sits a touch toward the middle of the road, stretched along it
      this.pools.add(l.x - l.rx * 1.2, CURB_H + 0.03, l.z - l.rz * 1.2, 10.5, 14.5, l.tx, l.tz, 0.2, 0.15, 0.085, 0);
    }
    this.lampGlows.commit();
    this.pools.commit();
    this.cones = new Cones(lamps);
    this.group.add(this.lampGlows.mesh, this.pools.mesh, this.cones.mesh);
  }

  // ------------------------------------------------------------ signals

  _signals(mat) {
    const city = this.city;
    const parts = [];
    const lensList = [];
    this.heads = []; // { node, axis, base } with three lenses each: red, amber, green
    const signQuads = [];
    const names = [...city.vRoads, ...city.hRoads];

    for (const node of city.nodeList) {
      if (node.free) continue;
      for (let t = 0; t < 4; t++) {
        const lanes = node.in[(t + 2) % 4];
        if (!lanes.length) continue;
        const T = DIRS[t], R = { x: -T.z, z: T.x };
        const own = t % 2 === 0 ? city.vRoads[node.i] : city.hRoads[node.j];
        const cross = t % 2 === 0 ? city.hRoads[node.j] : city.vRoads[node.i];
        const ownHalf = own.hw, crossHalf = cross.hw;
        const along = crossHalf + 1.9;
        const px = node.x + T.x * along + R.x * (ownHalf + 1.9), pz = node.z + T.z * along + R.z * (ownHalf + 1.9);
        const y0 = CURB_H;
        parts.push(cyl(0.1, 0.15, 6.7, px, y0 + 3.35, pz, METAL), cyl(0.2, 0.24, 0.45, px, y0 + 0.22, pz, METAL));
        // mast arm reaching out over our half of the far side
        const armLen = ownHalf + 1.9 - own.median / 2 - 0.4;
        const arm = new THREE.CylinderGeometry(0.06, 0.085, armLen, 6).rotateZ(Math.PI / 2);
        // lies along x; turn it to lie along R, then move it to hang off the pole toward the road centre
        arm.rotateY(Math.atan2(-R.z, R.x));
        arm.translate(px - R.x * armLen / 2, y0 + 6.45, pz - R.z * armLen / 2);
        parts.push(paint(arm, ...METAL));

        const faceYaw = Math.atan2(-T.x, -T.z); // lenses look back at the traffic they control
        const head = (hx, hy, hz) => {
          const body = new THREE.BoxGeometry(0.36, 1.1, 0.22).rotateY(faceYaw).translate(hx, hy, hz);
          const plate = new THREE.BoxGeometry(0.6, 1.36, 0.03).rotateY(faceYaw).translate(hx + T.x * 0.1, hy, hz + T.z * 0.1);
          parts.push(paint(body, 0.03, 0.03, 0.032), paint(plate, 0.012, 0.012, 0.013));
          const base = lensList.length;
          for (let k = 0; k < 3; k++) lensList.push({ x: hx - T.x * 0.118, y: hy + 0.34 - k * 0.34, z: hz - T.z * 0.118, yaw: faceYaw });
          this.heads.push({ node, axis: t % 2, base });
        };
        for (const lane of lanes) {
          const off = own.median / 2 + (own.lanes - 1 - lane.k) * LANE_W + LANE_W / 2;
          head(node.x + T.x * along + R.x * off, y0 + 5.8, node.z + T.z * along + R.z * off);
        }
        head(px - T.x * 0.28, y0 + 3.2, pz - T.z * 0.28);

        // the name of the street you are about to cross
        const idx = names.indexOf(cross);
        const sx = px - R.x * 2.1, sz = pz - R.z * 2.1;
        signQuads.push({ x: sx - T.x * 0.1, y: y0 + 6.95, z: sz - T.z * 0.1, tx: R.x, tz: R.z, idx });
      }
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);

    const lensGeo = new THREE.CircleGeometry(0.105, 14);
    this.lenses = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), lensList.length);
    lensList.forEach((l, i) => {
      _q.setFromAxisAngle(Y_AXIS, l.yaw);
      _m.compose(_p.set(l.x, l.y, l.z), _q, _s.set(1, 1, 1));
      this.lenses.setMatrixAt(i, _m);
      const off = SIG_OFF[i % 3];
      this.lenses.setColorAt(i, _c.setRGB(off[0], off[1], off[2]));
    });
    this.lenses.frustumCulled = false;
    this.group.add(this.lenses);

    // street-name blades, all from one small atlas
    const cols = 2, rows = Math.ceil(names.length / cols);
    const cv = makeCanvas(1024, rows * 64);
    const g = cv.getContext('2d');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    names.forEach((r, i) => {
      const x = (i % cols) * 512, y = Math.floor(i / cols) * 64;
      g.fillStyle = '#0b5132';
      g.fillRect(x, y, 512, 64);
      g.strokeStyle = '#e9efe9';
      g.lineWidth = 3;
      g.strokeRect(x + 4, y + 4, 504, 56);
      g.fillStyle = '#f2f5f1';
      g.font = '600 38px "Helvetica Neue", Arial, sans-serif';
      g.fillText(r.name, x + 256, y + 34);
    });
    const tex = canvasTexture(cv);
    tex.flipY = false;
    const pos = [], uv = [], nor = [], ind = [];
    signQuads.forEach((q, i) => {
      const w = 2.5, h = 0.42;
      // (tx,tz) runs left-to-right for someone driving toward the sign
      const nx = -q.tz, nz = q.tx; // facing the traffic
      const u0 = ((q.idx % cols) * 512) / 1024, v0 = (Math.floor(q.idx / cols) * 64) / (rows * 64), du = 0.5, dv = 64 / (rows * 64);
      const ax = q.x - q.tx * w / 2, az = q.z - q.tz * w / 2, bx = q.x + q.tx * w / 2, bz = q.z + q.tz * w / 2;
      pos.push(ax, q.y - h / 2, az, bx, q.y - h / 2, bz, bx, q.y + h / 2, bz, ax, q.y + h / 2, az);
      uv.push(u0, v0 + dv, u0 + du, v0 + dv, u0 + du, v0, u0, v0);
      for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
      ind.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    sg.setIndex(ind);
    this.nameMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.5, side: THREE.DoubleSide });
    const sm = new THREE.Mesh(sg, this.nameMat);
    sm.frustumCulled = false;
    this.group.add(sm);
  }

  // ------------------------------------------------------------ the small stuff

  _furniture(mat, rnd, kerbPoint, free, take, buildings) {
    const city = this.city;
    const kit = {
      bin: new Instances(mergeGeometries([cyl(0.27, 0.24, 0.9, 0, 0.45, 0, [0.03, 0.06, 0.045], 10), cyl(0.3, 0.3, 0.07, 0, 0.92, 0, [0.02, 0.02, 0.02], 10)]), mat),
      bench: new Instances(mergeGeometries([
        box(1.7, 0.06, 0.46, 0, 0.46, 0, [0.2, 0.11, 0.05]), box(1.7, 0.42, 0.05, 0, 0.78, -0.22, [0.2, 0.11, 0.05]),
        box(0.06, 0.46, 0.44, -0.72, 0.23, 0, METAL), box(0.06, 0.46, 0.44, 0.72, 0.23, 0, METAL),
      ]), mat),
      hydrant: new Instances(mergeGeometries([
        cyl(0.1, 0.12, 0.55, 0, 0.275, 0, [0.42, 0.04, 0.03]), cyl(0.02, 0.11, 0.12, 0, 0.61, 0, [0.42, 0.04, 0.03]),
        box(0.36, 0.1, 0.1, 0, 0.4, 0, [0.42, 0.04, 0.03]),
      ]), mat),
      bollard: new Instances(mergeGeometries([cyl(0.075, 0.085, 0.92, 0, 0.46, 0, [0.04, 0.04, 0.045]), cyl(0.08, 0.08, 0.07, 0, 0.8, 0, [0.6, 0.6, 0.58])]), mat),
      newsbox: new Instances(mergeGeometries([box(0.46, 1.0, 0.42, 0, 0.6, 0, [1, 1, 1]), box(0.1, 0.12, 0.1, 0, 0.06, 0, METAL), box(0.34, 0.3, 0.02, 0, 0.82, 0.215, [0.02, 0.02, 0.025])]), mat),
      mailbox: new Instances(mergeGeometries([box(0.52, 0.9, 0.5, 0, 0.65, 0, [0.03, 0.08, 0.28]), cyl(0.26, 0.26, 0.5, 0, 1.1, 0, [0.03, 0.08, 0.28], 12).rotateX(0), box(0.08, 0.2, 0.08, -0.18, 0.1, 0.17, METAL), box(0.08, 0.2, 0.08, 0.18, 0.1, -0.17, METAL)]), mat),
      planter: new Instances(mergeGeometries([
        box(1.3, 0.55, 1.3, 0, 0.275, 0, [0.34, 0.33, 0.31]),
        paint(new THREE.IcosahedronGeometry(0.62, 1).scale(1.1, 0.75, 1.1).translate(0, 0.86, 0), 0.05, 0.13, 0.04),
      ]), mat),
      meter: new Instances(mergeGeometries([box(0.3, 0.5, 0.2, 0, 1.25, 0, [0.16, 0.18, 0.2]), cyl(0.045, 0.045, 1.05, 0, 0.52, 0, METAL), box(0.2, 0.14, 0.02, 0, 1.33, 0.105, [0.01, 0.03, 0.02])]), mat),
      zone: new Instances(mergeGeometries([cyl(0.035, 0.035, 2.5, 0, 1.25, 0, [0.5, 0.5, 0.5], 6), box(0.5, 0.62, 0.03, 0, 2.2, 0, [0.03, 0.16, 0.5]), box(0.34, 0.12, 0.035, 0, 2.3, 0, [0.85, 0.85, 0.85])]), mat),
      shelter: new Instances(mergeGeometries([
        box(3.8, 0.08, 1.5, 0, 2.5, 0, [0.07, 0.075, 0.08]), box(0.08, 2.5, 0.08, -1.8, 1.25, -0.65, METAL), box(0.08, 2.5, 0.08, 1.8, 1.25, -0.65, METAL),
        box(3.6, 1.7, 0.03, 0, 1.3, -0.68, [0.05, 0.06, 0.07]), box(1.6, 0.06, 0.4, -0.6, 0.48, -0.4, [0.2, 0.11, 0.05]),
        box(0.14, 1.9, 1.24, 1.83, 1.15, 0.0, [0.03, 0.03, 0.035]),
      ]), mat),
      manhole: new Instances(paint(new THREE.CylinderGeometry(0.34, 0.34, 0.012, 16).translate(0, 0.008, 0), 0.035, 0.034, 0.033), mat, { shadow: false }),
    };
    const NEWS = [[0.05, 0.14, 0.5], [0.5, 0.05, 0.04], [0.55, 0.42, 0.03], [0.04, 0.3, 0.14], [0.5, 0.5, 0.48]];
    const adSpots = [];

    for (const lane of city.lanes) {
      if (lane.k !== 0) continue;
      const yawAlong = Math.atan2(-lane.tx, -lane.tz); // facing down the street
      const yawRoad = Math.atan2(-lane.rx, -lane.rz); // local +z toward the road
      for (const zn of lane.zones) {
        const [x, z] = kerbPoint(lane, zn.s - 5.2, 0.45);
        kit.zone.add(x, CURB_H, z, yawAlong + Math.PI);
      }
      const h = (n) => hash2(lane.id * 53 + n, 911);
      // a bus shelter on the wider roads
      if (lane.road.lanes > 1 && h(1) < 0.6) {
        const s = lane.len * (0.22 + 0.2 * h(2));
        if (free(lane, s, 5)) {
          take(lane, s - 2.2); take(lane, s); take(lane, s + 2.2);
          const [x, z] = kerbPoint(lane, s, 1.55);
          kit.shelter.add(x, CURB_H, z, yawRoad);
          const [ax, az] = kerbPoint(lane, s, 1.55);
          adSpots.push({ x: ax - lane.tx * 1.83, z: az - lane.tz * 1.83, tx: lane.tx, tz: lane.tz, rx: lane.rx, rz: lane.rz, h: h(3) });
        }
      }
      if (h(4) < 0.75) {
        const s = lane.len * (0.45 + 0.1 * h(5));
        if (free(lane, s, 1.6)) {
          take(lane, s);
          const [x, z] = kerbPoint(lane, s, 0.5);
          kit.meter.add(x, CURB_H, z, yawRoad + Math.PI);
        }
      }
      const count = 2 + Math.floor(h(6) * 4);
      for (let k = 0; k < count; k++) {
        const s = 9 + h(10 + k) * (lane.len - 18);
        const r = h(30 + k);
        const kerbSide = r < 0.62;
        if (!free(lane, s, kerbSide ? 2 : 0.1)) continue;
        if (kerbSide) take(lane, s);
        if (r < 0.2) { const [x, z] = kerbPoint(lane, s, 0.55); kit.bin.add(x, CURB_H, z, h(50 + k) * 6); }
        else if (r < 0.3) { const [x, z] = kerbPoint(lane, s, 0.5); kit.hydrant.add(x, CURB_H, z, yawRoad); }
        else if (r < 0.42) { const [x, z] = kerbPoint(lane, s, 0.6); kit.newsbox.add(x, CURB_H, z, yawRoad + Math.PI, 1, NEWS[Math.floor(h(70 + k) * NEWS.length)]); }
        else if (r < 0.5) { const [x, z] = kerbPoint(lane, s, 0.65); kit.mailbox.add(x, CURB_H, z, yawRoad); }
        else if (r < 0.62) { for (let b = -1; b <= 1; b++) { const [x, z] = kerbPoint(lane, s + b * 1.5, 0.4); kit.bollard.add(x, CURB_H, z, 0); } }
        else if (r < 0.82) { const [x, z] = kerbPoint(lane, s, 3.85); kit.bench.add(x, CURB_H, z, yawRoad); }
        else { const [x, z] = kerbPoint(lane, s, 3.6); kit.planter.add(x, CURB_H, z, 0); }
      }
      if (h(90) < 0.8) kit.manhole.add(lane.ax + lane.tx * lane.len * (0.2 + 0.6 * h(91)) - lane.rx * 0.5, 0, lane.az + lane.tz * lane.len * (0.2 + 0.6 * h(91)) - lane.rz * 0.5, 0);
    }
    for (const k of Object.values(kit)) this.group.add(k.build());

    // lit advert panels on the shelters, borrowing shop signs from the buildings' atlas
    if (adSpots.length) {
      const pos = [], uv = [], nor = [], col = [], ind = [];
      adSpots.forEach((a, i) => {
        // the tall "blade" cells of the sign atlas have the right proportions for a poster
        const ci = Math.floor(a.h * 16) % 16;
        const u0 = (ci * 128) / 2048, v0 = 1664 / 2048, du = 128 / 2048, dv = 192 / 2048;
        // the panel faces back down the street, toward approaching traffic
        const hw = 0.55, y0 = CURB_H + 0.3, y1 = CURB_H + 1.95;
        const cx = a.x - a.tx * 0.08, cz = a.z - a.tz * 0.08;
        const ax = cx - a.rx * hw, az = cz - a.rz * hw, bx = cx + a.rx * hw, bz = cz + a.rz * hw;
        pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
        uv.push(u0, v0 + dv, u0 + du, v0 + dv, u0 + du, v0, u0, v0);
        for (let k = 0; k < 4; k++) { nor.push(-a.tx, 0, -a.tz); col.push(1, 1, 1); }
        ind.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(ind);
      const ads = new THREE.Mesh(g, buildings.signMat);
      ads.frustumCulled = false;
      this.group.add(ads);
    }
  }

  // ------------------------------------------------------------ each frame

  update(haze) {
    // signal lenses follow the simulation
    let dirty = false;
    for (const h of this.heads) {
      const sig = h.node.sig[h.axis];
      if (h.shown === sig) continue;
      h.shown = sig;
      dirty = true;
      for (let k = 0; k < 3; k++) {
        const on = (sig === SIG.R && k === 0) || (sig === SIG.Y && k === 1) || (sig === SIG.G && k === 2);
        const c = on ? SIG_ON[k] : SIG_OFF[k];
        this.lenses.setColorAt(h.base + k, _c.setRGB(c[0], c[1], c[2]));
      }
    }
    if (dirty) this.lenses.instanceColor.needsUpdate = true;

    const lamp = env.uLamp.value;
    this.lensMat.color.setRGB(9 * lamp, 7 * lamp, 4.6 * lamp);
    this.lampGlows.uniforms.uGroup.value.set(lamp, 1, 1, 1);
    this.lampGlows.mesh.visible = lamp > 0.01;
    this.pools.uniforms.uGain.value = lamp;
    this.pools.mesh.visible = lamp > 0.01;
    this.cones.set(lamp * haze);
    this.nameMat.emissiveIntensity = 0.04 + 0.25 * lamp;
  }
}
