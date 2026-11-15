// Cars are lofted from a handful of numbers: a side profile (bonnet, windscreen,
// roof, tail), a plan taper and a tumblehome. One geometry and one material per
// body style; colour, lights and snow come from per-instance attributes.
import * as THREE from 'three';
import { env, patchMaterial } from '../world/shared.js';
import { lerp, smoothstep } from '../core/utils.js';

// vertex "kinds" the car shader understands
const K = { PAINT: 0, GLASS: 1, TIRE: 2, RIM: 3, HEAD: 4, TAIL: 5, TRIM: 6, PLATE: 7 };
const KCOL = {
  [K.PAINT]: [1, 1, 1], [K.GLASS]: [0.016, 0.02, 0.024], [K.TIRE]: [0.012, 0.012, 0.013], [K.RIM]: [0.5, 0.51, 0.53],
  [K.HEAD]: [0.85, 0.85, 0.8], [K.TAIL]: [0.3, 0.015, 0.012], [K.TRIM]: [0.025, 0.025, 0.027], [K.PLATE]: [0.75, 0.75, 0.7],
};

export const CAR_SPECS = {
  sedan: { L: 4.72, W: 1.84, H: 1.44, clear: 0.17, wheelR: 0.33, hood: 1.22, hoodH0: 0.7, hoodH1: 0.94, ws: 0.78, roof: 1.42, rear: 0.66, belt: 0.92, deckH: 0.98, tumble: 0.17 },
  hatch: { L: 4.15, W: 1.78, H: 1.5, clear: 0.17, wheelR: 0.32, hood: 1.0, hoodH0: 0.72, hoodH1: 0.98, ws: 0.72, roof: 1.72, rear: 0.45, belt: 0.96, deckH: 0.98, tumble: 0.15 },
  suv: { L: 4.78, W: 1.93, H: 1.7, clear: 0.23, wheelR: 0.37, hood: 1.12, hoodH0: 0.9, hoodH1: 1.1, ws: 0.66, roof: 2.24, rear: 0.44, belt: 1.08, deckH: 1.1, tumble: 0.14, cladding: true },
  van: { L: 5.5, W: 2.02, H: 2.3, clear: 0.2, wheelR: 0.36, hood: 0.72, hoodH0: 0.94, hoodH1: 1.2, ws: 0.62, roof: 3.86, rear: 0.14, belt: 1.22, deckH: 1.24, tumble: 0.07, cargo: true },
  // the cab itself: a low two-seat coupe with no rear window
  cab: { L: 4.42, W: 1.9, H: 1.42, clear: 0.16, wheelR: 0.36, hood: 0.74, hoodH0: 0.62, hoodH1: 0.87, ws: 1.15, roof: 1.05, rear: 1.28, belt: 0.9, deckH: 0.93, tumble: 0.2, fastback: true, bars: true },
};
export const CAR_TYPES = ['sedan', 'hatch', 'suv', 'van'];

export const PAINTS = [
  [0.78, 0.78, 0.77], [0.78, 0.78, 0.77], [0.02, 0.02, 0.022], [0.02, 0.02, 0.022], [0.47, 0.48, 0.5], [0.17, 0.18, 0.19],
  [0.17, 0.18, 0.19], [0.03, 0.08, 0.27], [0.38, 0.02, 0.02], [0.03, 0.11, 0.07], [0.46, 0.39, 0.28], [0.02, 0.035, 0.1],
  [0.19, 0.02, 0.035], [0.62, 0.63, 0.64], [0.74, 0.47, 0.02], [0.3, 0.33, 0.36],
];

class Mesher {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.kind = [];
  }

  quad(a, b, c, d, na, nb, nc, nd, kind) {
    for (const [p, n] of [[a, na], [b, nb], [c, nc], [a, na], [c, nc], [d, nd]]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      const k = KCOL[kind];
      this.col.push(k[0], k[1], k[2]);
      this.kind.push(kind);
    }
  }

  flatQuad(a, b, c, d, kind) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const n = [nx, ny, nz];
    this.quad(a, b, c, d, n, n, n, n, kind);
  }

  /** Axis-aligned box given its centre and half sizes. */
  box(cx, cy, cz, hx, hy, hz, kind) {
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    this.flatQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], kind); // +z
    this.flatQuad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], kind); // -z
    this.flatQuad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], kind); // +x
    this.flatQuad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], kind); // -x
    this.flatQuad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], kind); // +y
  }

  /** A wheel: a tyre with a bright disc on its outer face. `side` is +1 (right) or -1. */
  wheel(x, y, z, r, w, side) {
    const N = 18;
    const xo = x + (side * w) / 2, xi = x - (side * w) / 2;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p0o = [xo, y + s0 * r, z + c0 * r], p1o = [xo, y + s1 * r, z + c1 * r];
      const p0i = [xi, y + s0 * r, z + c0 * r], p1i = [xi, y + s1 * r, z + c1 * r];
      const n0 = [0, s0, c0], n1 = [0, s1, c1];
      if (side > 0) this.quad(p0o, p1o, p1i, p0i, n0, n1, n1, n0, K.TIRE);
      else this.quad(p0i, p1i, p1o, p0o, n0, n1, n1, n0, K.TIRE);
      // side wall and rim as rings on the outer face
      const fn = [side, 0, 0];
      const ring = (ra, rb, kind, xo2) => {
        const a = [xo2, y + s0 * ra, z + c0 * ra], b = [xo2, y + s1 * ra, z + c1 * ra];
        const c = [xo2, y + s1 * rb, z + c1 * rb], d = [xo2, y + s0 * rb, z + c0 * rb];
        if (side > 0) this.quad(a, b, c, d, fn, fn, fn, fn, kind);
        else this.quad(a, d, c, b, fn, fn, fn, fn, kind);
      };
      ring(r * 0.66, r, K.TIRE, xo);
      ring(r * 0.2, r * 0.66, K.RIM, xo - side * 0.02);
      ring(0.001, r * 0.2, K.TRIM, xo - side * 0.01);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export function buildCarGeometry(spec) {
  const { L, W, H, clear, wheelR, belt } = spec;
  const hw = W / 2;
  const zCowl = spec.hood, zRoof0 = zCowl + spec.ws, zRoof1 = zRoof0 + spec.roof, zDeck = zRoof1 + spec.rear;
  const deckH = spec.deckH;

  const top = (z) => {
    if (z < 0.14) return lerp(spec.hoodH0 - 0.2, spec.hoodH0, smoothstep(0, 0.14, z));
    if (z < zCowl) return lerp(spec.hoodH0, spec.hoodH1, Math.pow((z - 0.14) / (zCowl - 0.14), 0.8));
    if (z < zRoof0) return lerp(spec.hoodH1, H, Math.pow((z - zCowl) / spec.ws, 0.85));
    if (z < zRoof1) return H + 0.018 * Math.sin(((z - zRoof0) / spec.roof) * Math.PI) - 0.02 * ((z - zRoof0) / spec.roof);
    if (z < zDeck) return lerp(H - 0.02, deckH, Math.pow((z - zRoof1) / spec.rear, spec.fastback ? 1.25 : 1.1));
    if (z < L - 0.12) return lerp(deckH, deckH - 0.04, (z - zDeck) / Math.max(0.01, L - 0.12 - zDeck));
    return lerp(deckH - 0.04, deckH - 0.24, smoothstep(L - 0.12, L, z));
  };
  const plan = (z) => {
    const f = smoothstep(0, 0.75, z), r = smoothstep(L, L - 0.6, z);
    return hw * (0.8 + 0.2 * Math.min(f, 1)) * (0.86 + 0.14 * r);
  };
  const bottom = (z) => clear + 0.14 * (1 - smoothstep(0, 0.45, z)) + 0.16 * (1 - smoothstep(L, L - 0.4, z));

  // stations along the body, with a narrow one at the B pillar
  const bp = zRoof0 + spec.roof * (spec.cargo ? 0.3 : 0.5);
  const zs = [0, 0.05, 0.14, 0.45, zCowl * 0.6, zCowl, zCowl + spec.ws * 0.5, zRoof0, bp - 0.06, bp + 0.06, zRoof1,
    zRoof1 + spec.rear * 0.5, zDeck, (zDeck + L - 0.12) / 2, L - 0.12, L - 0.04, L];
  const uniq = [...new Set(zs.map((z) => Math.round(Math.min(L, Math.max(0, z)) * 1000) / 1000))].sort((a, b) => a - b);

  const HALF = 11, RING = 20;
  const ringAt = (z) => {
    const w = plan(z), yb = bottom(z), yt = top(z);
    const green = yt > belt + 0.07;
    const yBelt = Math.min(belt, yt - 0.02);
    const hb = Math.max(0.05, yBelt - yb); // height of the body side here; short at the nose and tail
    const pts = [
      [0, yb], [w * 0.72, yb], [w * 0.97, yb + Math.min(0.08, hb * 0.2)], [w, yb + Math.min(0.3, hb * 0.5)],
      [w, yb + Math.min(hb * 0.92, Math.max(hb * 0.62, hb - 0.12))], [w * 0.985, yBelt],
    ];
    if (green) {
      const t = spec.tumble * smoothstep(belt, H, yt);
      const wg0 = w - 0.035, wg1 = w - t - 0.03;
      pts.push([wg0, yBelt + 0.02], [wg1, yt - 0.07], [wg1 - 0.07, yt - 0.012], [wg1 * 0.45, yt + 0.012], [0, yt + 0.02]);
    } else {
      pts.push([w * 0.93, yt - 0.03], [w * 0.82, yt - 0.008], [w * 0.6, yt], [w * 0.3, yt + 0.004], [0, yt + 0.006]);
    }
    const ring = [];
    for (let i = 0; i < HALF; i++) ring.push([pts[i][0], pts[i][1], z - L / 2]);
    for (let i = HALF - 2; i >= 1; i--) ring.push([-pts[i][0], pts[i][1], z - L / 2]);
    return { ring, green };
  };
  const st = uniq.map((z) => ({ z, ...ringAt(z) }));
  // pinch the ends so the nose and tail are rounded rather than sliced
  for (const idx of [0, st.length - 1]) {
    const cy = (top(st[idx].z) + bottom(st[idx].z)) / 2;
    for (const p of st[idx].ring) {
      p[0] *= 0.9;
      p[1] = cy + (p[1] - cy) * 0.84;
    }
  }

  // smooth normals over the grid
  const NS = st.length;
  const nrm = st.map(() => Array.from({ length: RING }, () => [0, 0, 0]));
  const faceN = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  for (let i = 0; i < NS - 1; i++) {
    for (let r = 0; r < RING; r++) {
      const r2 = (r + 1) % RING;
      const a = st[i].ring[r], b = st[i].ring[r2], c = st[i + 1].ring[r2], d = st[i + 1].ring[r];
      const n = faceN(a, b, c);
      for (const [ii, rr] of [[i, r], [i, r2], [i + 1, r2], [i + 1, r]]) {
        nrm[ii][rr][0] += n[0];
        nrm[ii][rr][1] += n[1];
        nrm[ii][rr][2] += n[2];
      }
    }
  }
  for (const row of nrm) for (const n of row) {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= l; n[1] /= l; n[2] /= l;
  }

  const m = new Mesher();
  for (let i = 0; i < NS - 1; i++) {
    const z0 = st[i].z, z1 = st[i + 1].z, zm = (z0 + z1) / 2;
    const both = st[i].green && st[i + 1].green;
    const inWs = zm > zCowl && zm < zRoof0, inRoof = zm > zRoof0 && zm < zRoof1, inRear = zm > zRoof1 && zm < zDeck;
    const pillar = Math.abs(zm - bp) < 0.07;
    for (let r = 0; r < RING; r++) {
      const r2 = (r + 1) % RING;
      const band = r < 10 ? r : 19 - r;
      let kind = K.PAINT;
      if (band <= 1) kind = K.TRIM;
      else if (band === 2 && spec.cladding) kind = K.TRIM;
      else if (band === 6) {
        const sideGlass = both && (inRoof || inWs || (inRear && !spec.fastback && !spec.cargo));
        const cargoBlank = spec.cargo && zm > bp;
        if (pillar && both) kind = K.TRIM;
        else if (sideGlass && !cargoBlank) kind = K.GLASS;
      } else if (band >= 8) {
        if (inWs) kind = K.GLASS;
        else if (inRear && !spec.fastback && !spec.cargo) kind = K.GLASS;
      }
      m.quad(st[i].ring[r], st[i].ring[r2], st[i + 1].ring[r2], st[i + 1].ring[r], nrm[i][r], nrm[i][r2], nrm[i + 1][r2], nrm[i + 1][r], kind);
    }
  }
  // close the ends
  for (const [idx, sign] of [[0, -1], [NS - 1, 1]]) {
    const ring = st[idx].ring;
    const cy = (top(st[idx].z) + bottom(st[idx].z)) / 2;
    const c = [0, cy, ring[0][2]];
    const n = [0, 0, sign];
    for (let r = 0; r < RING; r++) {
      const a = ring[r], b = ring[(r + 1) % RING];
      if (sign < 0) m.quad(c, b, a, c, n, n, n, n, K.PAINT);
      else m.quad(c, a, b, c, n, n, n, n, K.PAINT);
    }
  }

  const zf = -L / 2, zr = L / 2;
  const hy = spec.hoodH0 - 0.17, ty = deckH - 0.2;
  if (spec.bars) {
    m.box(0, hy + 0.06, zf - 0.005, hw * 0.74, 0.022, 0.02, K.HEAD);
    m.box(0, ty + 0.05, zr + 0.005, hw * 0.78, 0.022, 0.02, K.TAIL);
  } else {
    for (const s of [-1, 1]) {
      m.box(s * hw * 0.6, hy, zf + 0.02, hw * 0.2, 0.055, 0.05, K.HEAD);
      if (spec.cargo || spec.cladding) m.box(s * hw * 0.8, ty - 0.05, zr - 0.02, hw * 0.075, 0.2, 0.05, K.TAIL);
      else m.box(s * hw * 0.6, ty, zr - 0.02, hw * 0.22, 0.06, 0.05, K.TAIL);
    }
    m.box(0, hy - 0.22, zf + 0.03, hw * 0.52, 0.09, 0.03, K.TRIM); // grille
  }
  m.box(0, ty - 0.24, zr - 0.012, 0.26, 0.065, 0.02, K.PLATE);
  // mirrors
  for (const s of [-1, 1]) m.box(s * (hw + 0.07), belt + 0.07, zCowl + 0.32 - L / 2, 0.075, 0.05, 0.04, K.PAINT);
  // wheels and the dark arches behind them
  const fz = 0.86 - L / 2, rz = L / 2 - 0.92;
  for (const s of [-1, 1]) {
    for (const wz of [fz, rz]) {
      m.wheel(s * (hw - 0.115), wheelR, wz, wheelR, 0.23, s);
      // arch liner: a dark disc just proud of the door skin
      const N = 14, ar = wheelR + 0.075, ax = s * (plan(wz + L / 2) + 0.006);
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI, a1 = ((i + 1) / N) * Math.PI;
        const p0 = [ax, wheelR + Math.sin(a0) * ar, wz + Math.cos(a0) * ar], p1 = [ax, wheelR + Math.sin(a1) * ar, wz + Math.cos(a1) * ar];
        const c = [ax, wheelR, wz];
        const n = [s, 0, 0];
        if (s > 0) m.quad(c, p1, p0, c, n, n, n, n, K.TRIM);
        else m.quad(c, p0, p1, c, n, n, n, n, K.TRIM);
      }
    }
  }
  return m.build();
}

export function makeCarMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5, vertexColors: true });
  patchMaterial(
    mat,
    {
      vertexPars: /* glsl */ `
        attribute float aKind; attribute vec4 aPaint; attribute vec2 aState;
        varying float vKind; varying vec4 vPaint; varying vec2 vState;
      `,
      vertex: 'vKind = aKind; vPaint = aPaint; vState = aState;',
      fragPars: /* glsl */ `
        uniform float uWet, uSnow;
        varying float vKind; varying vec4 vPaint; varying vec2 vState;
        float gRough; float gMetal; vec3 gEmis;
      `,
      fragColor: /* glsl */ `
        float kd = floor(vKind + 0.5);
        gEmis = vec3(0.0);
        if (kd < 0.5) {
          diffuseColor.rgb = vPaint.rgb;
          float lum = dot(vPaint.rgb, vec3(0.3, 0.6, 0.1));
          gMetal = mix(0.75, 0.25, smoothstep(0.3, 0.75, lum));
          gRough = mix(0.34, 0.24, uWet);
          // road grime along the sills
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.085, 0.08), (1.0 - smoothstep(0.2, 0.62, vWPos.y)) * 0.45);
        } else if (kd < 1.5) { gMetal = 0.92; gRough = 0.05; }
        else if (kd < 2.5) { gMetal = 0.0; gRough = 0.9; }
        else if (kd < 3.5) { gMetal = 0.95; gRough = 0.32; }
        else if (kd < 4.5) { gMetal = 0.3; gRough = 0.15; gEmis = vec3(1.0, 0.94, 0.82) * vState.x * 7.0; }
        else if (kd < 5.5) { gMetal = 0.2; gRough = 0.2; gEmis = vec3(1.0, 0.04, 0.02) * (vState.x * 1.3 + vState.y * 6.0); }
        else if (kd < 6.5) { gMetal = 0.0; gRough = 0.75; }
        else { gMetal = 0.0; gRough = 0.5; }
        // snow settles on whatever faces the sky
        float sn = uSnow * vPaint.a * smoothstep(0.55, 0.85, vWNormal.y) * step(kd, 1.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.82, 0.88), sn);
        gMetal *= 1.0 - sn;
        gRough = mix(gRough, 0.85, sn);
      `,
      fragSurface: 'roughnessFactor = gRough; metalnessFactor = gMetal;',
      fragEmissive: 'totalEmissiveRadiance += gEmis;',
    },
    { uWet: env.uWet, uSnow: env.uSnow },
  );
  return mat;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

/** Draws every car in the city with a few instanced meshes. */
export class Fleet {
  constructor({ moving = 80, parked = 260 } = {}) {
    this.group = new THREE.Group();
    this.material = makeCarMaterial();
    this.base = CAR_TYPES.map((name) => buildCarGeometry(CAR_SPECS[name]));
    this.pools = {
      moving: this._pool(moving),
      parked: this._pool(parked),
    };
  }

  _pool(cap) {
    return this.base.map((base) => {
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'color', 'aKind']) g.setAttribute(name, base.getAttribute(name));
      g.boundingSphere = base.boundingSphere;
      const paint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      const state = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
      paint.setUsage(THREE.DynamicDrawUsage);
      state.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aPaint', paint);
      g.setAttribute('aState', state);
      const mesh = new THREE.InstancedMesh(g, this.material, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { mesh, paint, state, cap, n: 0 };
    });
  }

  begin(pool) {
    for (const p of this.pools[pool]) p.n = 0;
  }

  add(pool, type, x, z, yaw, paint, lights, brake, snow = 1, pitch = 0, roll = 0) {
    const p = this.pools[pool][type];
    if (p.n >= p.cap) return;
    const i = p.n++;
    _e.set(pitch, yaw, roll);
    _q.setFromEuler(_e);
    _p.set(x, 0, z);
    _m.compose(_p, _q, _s);
    p.mesh.setMatrixAt(i, _m);
    p.paint.setXYZW(i, paint[0], paint[1], paint[2], snow);
    p.state.setXY(i, lights, brake);
  }

  end(pool) {
    for (const p of this.pools[pool]) {
      p.mesh.count = p.n;
      p.mesh.instanceMatrix.needsUpdate = true;
      p.paint.needsUpdate = true;
      p.state.needsUpdate = true;
    }
  }
}

export { K as CAR_KIND };
