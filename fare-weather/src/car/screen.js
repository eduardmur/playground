// The cab's centre display. Two layers: a small 3D scene showing what the car
// "sees" (lanes, kerbs, other cars, people, its planned path), rendered to a
// texture; and a 2D canvas drawn over it with the trip, a map, speed and the radio.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeCanvas, canvasTexture } from '../world/shared.js';
import { SIG } from '../world/city.js';
import { buildCarGeometry, CAR_SPECS } from './models.js';
import { clockText, dampAngle, clamp } from '../core/utils.js';

const W = 1024, H = 600;
const FONT = '"SF Pro Display", "Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif';
const BG = 0x0a0c0f;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class Screen {
  constructor(renderer, city, ground) {
    this.renderer = renderer;
    this.city = city;
    this.canvas = makeCanvas(W, H);
    this.ctx = this.canvas.getContext('2d');
    this.tex = canvasTexture(this.canvas, { aniso: 8 });
    this.rt = new THREE.WebGLRenderTarget(768, 450, { samples: 4 });
    this.uniforms = { tUI: { value: this.tex }, tViz: { value: this.rt.texture }, uBright: { value: 1 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tUI, tViz; uniform float uBright; varying vec2 vUv;
        void main() {
          vec4 ui = texture2D(tUI, vUv);
          vec3 viz = texture2D(tViz, vUv).rgb;
          vec3 c = mix(viz, ui.rgb, ui.a);
          // a little of the cabin shows in the glass
          float sheen = 0.006 + 0.012 * smoothstep(0.2, 1.0, vUv.y) * vUv.x;
          gl_FragColor = vec4(c * uBright + sheen, 1.0);
        }
      `,
    });

    // ---- what the car sees
    const sc = (this.scene = new THREE.Scene());
    sc.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 2.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6);
    dl.position.set(0.4, 1, 0.3);
    sc.add(dl);
    const paintViz = new THREE.Mesh(ground.paint.geometry, new THREE.MeshBasicMaterial({ color: 0x4a515a }));
    const walksViz = new THREE.Mesh(ground.walks.geometry, new THREE.MeshBasicMaterial({ color: 0x15181c }));
    paintViz.frustumCulled = walksViz.frustumCulled = false;
    sc.add(paintViz, walksViz);
    this.cars = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.14), new THREE.MeshLambertMaterial({ color: 0xffffff }), 64);
    this.cars.frustumCulled = false;
    this.people = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.24, 1.2, 3, 8), new THREE.MeshLambertMaterial({ color: 0xd4dae1 }), 64);
    this.people.frustumCulled = false;
    this.signals = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 12);
    this.signals.frustumCulled = false;
    sc.add(this.cars, this.people, this.signals);
    this.egoMesh = new THREE.Mesh(buildCarGeometry(CAR_SPECS.cab), new THREE.MeshLambertMaterial({ color: 0xeef1f4 }));
    sc.add(this.egoMesh);
    // the planned path: a ribbon rebuilt each frame
    this.RIB = 48;
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.RIB * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < this.RIB - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
    rg.setIndex(idx);
    this.ribbon = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x2d7bf4, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }));
    this.ribbon.frustumCulled = false;
    sc.add(this.ribbon);
    this.pin = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.4, 14).rotateX(Math.PI).translate(0, 2.2, 0), new THREE.MeshBasicMaterial({ color: 0x2d7bf4 }));
    sc.add(this.pin);
    this.cam = new THREE.PerspectiveCamera(36, 768 / 450, 1, 400);
    this.camYaw = 0;
    this.vizT = 0;
    this.uiT = 0;
    this.mapPath = null;
    this.mapKey = null;
    this.banner = { text: '', t: 0 };
  }

  say(text, seconds = 4) {
    this.banner.text = text;
    this.banner.t = seconds;
  }

  // ------------------------------------------------------------ the 3D layer

  /** The route ahead as [x, z, dirX, dirZ, ...] samples. */
  _path(ego, max = 70) {
    const out = [];
    const city = this.city;
    const pose = { x: 0, z: 0, dx: 0, dz: 0 };
    const step = max / (this.RIB - 1);
    let piece = ego.piece, s = ego.s, legIdx = ego.legIdx, next = ego.next, travelled = 0;
    const stopOn = (p, i) => {
      const leg = ego.legs && ego.legs[i];
      return ego.stop && leg && leg.exit === 'stop' && leg.lane === p ? ego.stop.s : null;
    };
    let stopS = piece.isLane ? stopOn(piece, legIdx) : null;
    for (let i = 0; i < this.RIB; i++) {
      city.pose(piece, s, pose);
      let l = 0;
      if (piece.isLane) {
        // drawn from where the car really is, easing back to the lane centre, or over to the kerb at the stop
        l = ego.lat * Math.max(0, 1 - travelled / 12);
        if (stopS !== null) l = Math.max(l, piece.curbOff * clamp((s - (stopS - 14)) / 12.5, 0, 1));
      }
      out.push(pose.x - pose.dz * l, pose.z + pose.dx * l, pose.dx, pose.dz);
      let adv = step;
      if (stopS !== null) adv = Math.max(0, Math.min(adv, stopS - s));
      s += adv;
      travelled += adv;
      let guard = 0;
      while (s > piece.len && guard++ < 4) {
        if (piece.isLane) {
          if (!next) {
            s = piece.len;
            break;
          }
          s -= piece.len;
          piece = next;
          next = null;
        } else {
          s -= piece.len;
          piece = piece.to;
          legIdx++;
          const leg = ego.legs && ego.legs[legIdx];
          next = leg && leg.lane === piece && leg.exit && leg.exit.isConn ? leg.exit : null;
          stopS = stopOn(piece, legIdx);
        }
      }
    }
    return out;
  }

  _renderViz(st) {
    const { ego, traffic } = st;
    this.egoMesh.position.set(ego.x, 0, ego.z);
    this.egoMesh.rotation.y = ego.yaw;

    let n = 0;
    for (const car of traffic.cars) {
      const dx = car.x - ego.x, dz = car.z - ego.z;
      if (dx * dx + dz * dz > 85 * 85 || n >= 64) continue;
      _q.setFromAxisAngle(UP, Math.atan2(-car.dx, -car.dz));
      _m.compose(_p.set(car.x, 0.75, car.z), _q, _s.set(car.wid, car.typeName === 'van' ? 2.0 : 1.35, car.len));
      this.cars.setMatrixAt(n, _m);
      this.cars.setColorAt(n, car.brake ? _c.setRGB(0.75, 0.4, 0.38) : _c.setRGB(0.5, 0.53, 0.57));
      n++;
    }
    if (st.parked) {
      for (const pk of st.parked) {
        if (n >= 64) break;
        _q.setFromAxisAngle(UP, pk.yaw);
        _m.compose(_p.set(pk.x, 0.7, pk.z), _q, _s.set(1.85, 1.3, 4.5));
        this.cars.setMatrixAt(n, _m);
        this.cars.setColorAt(n, _c.setRGB(0.26, 0.28, 0.31));
        n++;
      }
    }
    this.cars.count = n;
    this.cars.instanceMatrix.needsUpdate = true;
    if (this.cars.instanceColor) this.cars.instanceColor.needsUpdate = true;

    let pn = 0;
    if (st.people) {
      for (const p of st.people) {
        if (pn >= 64) break;
        const dx = p.x - ego.x, dz = p.z - ego.z;
        if (dx * dx + dz * dz > 60 * 60) continue;
        _m.makeTranslation(p.x, 1.0, p.z);
        this.people.setMatrixAt(pn++, _m);
      }
    }
    this.people.count = pn;
    this.people.instanceMatrix.needsUpdate = true;

    // the lights at the junction ahead
    let sn = 0;
    const lane = ego.piece.isLane ? ego.piece : null;
    if (lane && !lane.to.free) {
      const node = lane.to;
      const sig = node.sig[lane.dir % 2];
      const col = sig === SIG.R ? [1, 0.16, 0.12] : sig === SIG.Y ? [1, 0.72, 0.1] : [0.2, 0.95, 0.5];
      for (const l of lane.siblings) {
        _m.makeTranslation(l.bx + l.tx * 1.2, 3.4, l.bz + l.tz * 1.2);
        this.signals.setMatrixAt(sn, _m);
        this.signals.setColorAt(sn, _c.setRGB(col[0], col[1], col[2]));
        sn++;
      }
    }
    this.signals.count = sn;
    this.signals.instanceMatrix.needsUpdate = true;
    if (this.signals.instanceColor) this.signals.instanceColor.needsUpdate = true;

    // path ribbon
    const pts = this._path(ego);
    const pos = this.ribbon.geometry.getAttribute('position');
    for (let i = 0; i < this.RIB; i++) {
      const x = pts[i * 4], z = pts[i * 4 + 1], dx = pts[i * 4 + 2], dz = pts[i * 4 + 3];
      const hw = 1.05;
      pos.setXYZ(i * 2, x + dz * hw, 0.06, z - dx * hw);
      pos.setXYZ(i * 2 + 1, x - dz * hw, 0.06, z + dx * hw);
    }
    pos.needsUpdate = true;
    this.ribbon.visible = ego.mode !== 'parked';

    if (ego.stop) {
      this.pin.visible = true;
      const zn = ego.stop;
      this.pin.position.set(zn.cx - zn.nx * 1.3, 0, zn.cz - zn.nz * 1.3);
    } else this.pin.visible = false;

    // camera: above and behind, turning with the car a little lazily
    this.camYaw = dampAngle(this.camYaw, ego.yaw, 5, st.dt);
    const bx = -Math.sin(this.camYaw), bz = -Math.cos(this.camYaw);
    this.cam.position.set(ego.x - bx * 17, 15.5, ego.z - bz * 17);
    this.cam.lookAt(ego.x + bx * 13, 0, ego.z + bz * 13);

    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    r.getClearColor(_c);
    const prevA = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(BG, 1);
    r.clear();
    r.render(this.scene, this.cam);
    r.setClearColor(_c, prevA);
    r.setRenderTarget(prevRT);
  }

  // ------------------------------------------------------------ the 2D layer

  _mapPath(ego) {
    const key = `${ego.legs ? ego.legs.length : 0}|${ego.legIdx}|${ego.stop ? ego.stop.id : ''}|${ego.piece.id}|${ego.piece.isLane ? 1 : 0}`;
    if (key === this.mapKey) return this.mapPath;
    this.mapKey = key;
    const pts = [];
    if (ego.legs && ego.stop) {
      for (let i = Math.max(0, ego.legIdx); i < ego.legs.length; i++) {
        const leg = ego.legs[i];
        if (leg.exit === 'switch') continue;
        const l = leg.lane;
        if (i > ego.legIdx) pts.push([l.ax, l.az]);
        if (leg.exit === 'stop') pts.push([l.ax + l.tx * ego.stop.s, l.az + l.tz * ego.stop.s]);
        else {
          pts.push([l.bx, l.bz]);
          const c = leg.exit;
          for (let k = 2; k < c.pts.length; k += 6) pts.push([c.pts[k], c.pts[k + 1]]);
        }
      }
    }
    this.mapPath = pts;
    return pts;
  }

  _drawUI(st) {
    const g = this.ctx;
    const { ego } = st;
    g.clearRect(0, 0, W, H);

    // soft frame so the 3D layer melts into the bezel
    let grad = g.createLinearGradient(0, 0, 0, 190);
    grad.addColorStop(0, 'rgba(8,10,13,0.94)');
    grad.addColorStop(1, 'rgba(8,10,13,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, 190);
    grad = g.createLinearGradient(0, H - 150, 0, H);
    grad.addColorStop(0, 'rgba(8,10,13,0)');
    grad.addColorStop(0.55, 'rgba(8,10,13,0.92)');
    grad.addColorStop(1, 'rgba(8,10,13,1)');
    g.fillStyle = grad;
    g.fillRect(0, H - 150, W, 150);

    // trip
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = '#8f98a3';
    g.font = `500 21px ${FONT}`;
    g.fillText(st.label || '', 40, 56);
    g.fillStyle = '#ffffff';
    g.font = `600 46px ${FONT}`;
    g.fillText(st.headline || '', 38, 106);
    g.fillStyle = '#c3cad2';
    g.font = `400 24px ${FONT}`;
    g.fillText(st.sub || '', 40, 142);
    if (st.rider) {
      const y = 176;
      g.fillStyle = st.riderColor || '#3b82f6';
      g.beginPath();
      g.arc(56, y, 16, 0, 7);
      g.fill();
      g.fillStyle = '#fff';
      g.font = `600 17px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(st.rider.replace(/^(Mr|Mrs|Ms|Dr)\.?\s+/, '')[0], 56, y + 6);
      g.textAlign = 'left';
      g.fillStyle = '#e7ebef';
      g.font = `500 21px ${FONT}`;
      g.fillText(st.rider, 82, y + 7);
    }

    // map, heading up
    const MS = 214, mx = W - 40 - MS, my = 34;
    g.save();
    g.beginPath();
    g.roundRect(mx, my, MS, MS, 22);
    g.clip();
    g.fillStyle = '#12161b';
    g.fillRect(mx, my, MS, MS);
    g.translate(mx + MS / 2, my + MS * 0.62);
    g.rotate(ego.yaw);
    const k = 0.36;
    g.scale(k, k);
    g.translate(-ego.x, -ego.z);
    const c = this.city;
    g.lineCap = 'butt';
    g.strokeStyle = '#2a313a';
    for (const r of c.vRoads) {
      g.lineWidth = r.hw * 2;
      g.beginPath();
      g.moveTo(r.pos, c.minZ);
      g.lineTo(r.pos, c.maxZ);
      g.stroke();
    }
    for (const r of c.hRoads) {
      g.lineWidth = r.hw * 2;
      g.beginPath();
      g.moveTo(c.minX, r.pos);
      g.lineTo(c.maxX, r.pos);
      g.stroke();
    }
    g.fillStyle = '#0d2233';
    g.fillRect(c.shoreX - 900, c.minZ - 300, 900, c.maxZ - c.minZ + 600);
    g.fillStyle = '#16261b';
    for (const b of c.blocks) if (b.kind === 'park') g.fillRect(b.x0 + 4, b.z0 + 4, b.x1 - b.x0 - 8, b.z1 - b.z0 - 8);
    const path = this._mapPath(ego);
    if (path.length) {
      g.strokeStyle = '#3b82f6';
      g.lineWidth = 15;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(ego.x, ego.z);
      for (const p of path) g.lineTo(p[0], p[1]);
      g.stroke();
      const end = path[path.length - 1];
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(end[0], end[1], 17, 0, 7);
      g.fill();
      g.fillStyle = '#3b82f6';
      g.beginPath();
      g.arc(end[0], end[1], 10, 0, 7);
      g.fill();
    }
    g.restore();
    // the cab's arrow
    g.save();
    g.translate(mx + MS / 2, my + MS * 0.62);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -12);
    g.lineTo(9, 10);
    g.lineTo(0, 5);
    g.lineTo(-9, 10);
    g.closePath();
    g.fill();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(mx, my, MS, MS, 22);
    g.stroke();

    // indicators
    if (st.blinkOn && (ego.blinker !== 0 || ego.hazard)) {
      g.fillStyle = '#35d07f';
      const arrow = (x, dir) => {
        g.beginPath();
        g.moveTo(x + dir * 20, 232);
        g.lineTo(x, 216);
        g.lineTo(x, 226);
        g.lineTo(x - dir * 18, 226);
        g.lineTo(x - dir * 18, 238);
        g.lineTo(x, 238);
        g.lineTo(x, 248);
        g.closePath();
        g.fill();
      };
      if (ego.blinker < 0 || ego.hazard) arrow(64, -1);
      if (ego.blinker > 0 || ego.hazard) arrow(120, 1);
    }

    // bottom bar
    const by = H - 34;
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.font = `600 58px ${FONT}`;
    const mph = String(Math.round(st.mph));
    g.fillText(mph, 40, by);
    const mw = g.measureText(mph).width;
    g.fillStyle = '#8f98a3';
    g.font = `500 20px ${FONT}`;
    g.fillText('mph', 48 + mw, by - 2);
    g.fillStyle = ego.mode === 'parked' ? '#f2b84b' : '#35d07f';
    g.font = `700 22px ${FONT}`;
    g.fillText(ego.mode === 'parked' ? 'P' : 'D', 48 + mw, by - 30);

    g.textAlign = 'center';
    g.fillStyle = '#35d07f';
    g.font = `600 17px ${FONT}`;
    g.fillText('●  SELF-DRIVING', W / 2, by - 36);
    g.fillStyle = '#dfe4ea';
    g.font = `500 21px ${FONT}`;
    g.fillText(st.track ? `♪  ${st.track}` : '', W / 2, by - 4);

    g.textAlign = 'right';
    g.fillStyle = '#ffffff';
    g.font = `500 26px ${FONT}`;
    g.fillText(clockText(st.hour), W - 40, by - 30);
    g.fillStyle = '#aeb6bf';
    g.font = `400 21px ${FONT}`;
    g.fillText(`${st.tempF}°F  ·  ${st.sky}`, W - 40, by - 2);

    if (this.banner.t > 0) {
      const a = Math.min(1, this.banner.t / 0.5);
      g.globalAlpha = a;
      g.font = `600 30px ${FONT}`;
      g.textAlign = 'center';
      const tw = g.measureText(this.banner.text).width + 56;
      g.fillStyle = 'rgba(20,24,30,0.92)';
      g.beginPath();
      g.roundRect(W / 2 - tw / 2, 284, tw, 58, 29);
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillText(this.banner.text, W / 2, 323);
      g.globalAlpha = 1;
    }
    this.tex.needsUpdate = true;
  }

  /** st: { dt, ego, traffic, people, parked, hour, mph, tempF, sky, label, headline, sub, rider, riderColor, track, blinkOn, bright } */
  update(st) {
    this.uniforms.uBright.value = st.bright;
    if (this.banner.t > 0) this.banner.t -= st.dt;
    this.vizT -= st.dt;
    if (this.vizT <= 0) {
      this.vizT = 1 / 30;
      this._renderViz(st);
    }
    this.uiT -= st.dt;
    if (this.uiT <= 0) {
      this.uiT = 1 / 12;
      this._drawUI(st);
    }
  }
}

