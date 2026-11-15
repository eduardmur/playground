// Street trees. Each crown is a dark core wrapped in a couple of dozen cards
// that turn to face whoever is looking (the camera, the sun for shadows, the
// mirror for puddles), each printed with a clump of leaves.
import * as THREE from 'three';
import { env, patchMaterial, makeCanvas, canvasTexture } from './shared.js';
import { CURB_H, SIDEWALK_W } from './city.js';
import { mulberry32, randRange } from '../core/utils.js';

function leafTexture() {
  const S = 512, C = 256;
  const cv = makeCanvas(S, S);
  const g = cv.getContext('2d');
  const rnd = mulberry32(31337);
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * C + C / 2, oy = Math.floor(q / 2) * C + C / 2;
    // an opaque heart so trunks and cores can borrow a solid texel
    g.fillStyle = '#8a8a8a';
    g.beginPath();
    g.arc(ox, oy, 26, 0, 7);
    g.fill();
    const n = 300;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 0.6) * 108;
      const x = ox + Math.cos(a) * r, y = oy + Math.sin(a) * r * 0.92;
      const l = 30 + Math.floor(rnd() * 50);
      g.fillStyle = `hsl(0 0% ${l + 22}%)`;
      g.save();
      g.translate(x, y);
      g.rotate(rnd() * Math.PI);
      g.beginPath();
      g.ellipse(0, 0, 5 + rnd() * 5, 2.6 + rnd() * 2.6, 0, 0, 7);
      g.fill();
      g.strokeStyle = `hsl(0 0% ${l}%)`;
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(-6, 0);
      g.lineTo(6, 0);
      g.stroke();
      g.restore();
    }
  }
  const tex = canvasTexture(cv, { aniso: 4 });
  return tex;
}

const VERT_PARS = /* glsl */ `
  attribute vec3 aCard; attribute float aSway;
  uniform float uTime, uWind;
`;
const VERT = /* glsl */ `
  {
    vec3 c = position;
    float ph = c.x * 0.31 + c.z * 0.27;
    float sw = (sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.4) * (0.025 + uWind * 0.24) * aSway;
    c.x += sw;
    c.z += sw * 0.6;
    if (abs(aCard.x) + abs(aCard.y) > 0.0) {
      vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 cu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      float ca = cos(aCard.z), sa = sin(aCard.z);
      vec2 q = vec2(aCard.x * ca - aCard.y * sa, aCard.x * sa + aCard.y * ca);
      q *= 1.0 + 0.05 * sin(uTime * 3.1 + ph * 5.0) * uWind;
      c += cr * q.x + cu * q.y;
    }
    transformed = c;
  }
`;

class TreeBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.card = [];
    this.sway = [];
    this.idx = [];
    this.n = 0;
  }

  v(x, y, z, nx, ny, nz, u, v, c, cx, cy, rot, sway) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    this.card.push(cx, cy, rot);
    this.sway.push(sway);
    return this.n++;
  }

  tree(rnd, x, y0, z, h, r, tone) {
    const SOLID_U = 0.25, SOLID_V = 0.25;
    // trunk
    const bark = [0.075, 0.06, 0.048];
    const top = y0 + h + r * 0.45;
    const lean = (rnd() - 0.5) * 0.35, leanZ = (rnd() - 0.5) * 0.35;
    const N = 6;
    const ring0 = [], ring1 = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      ring0.push(this.v(x + cx * 0.17, y0, z + cz * 0.17, cx, 0, cz, SOLID_U, SOLID_V, bark, 0, 0, 0, 0));
      ring1.push(this.v(x + lean + cx * 0.085, top, z + leanZ + cz * 0.085, cx, 0, cz, SOLID_U, SOLID_V, bark, 0, 0, 0, 0.35));
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      this.idx.push(ring0[i], ring1[i], ring1[j], ring0[i], ring1[j], ring0[j]);
    }
    const cx0 = x + lean, cy0 = y0 + h + r * 0.78, cz0 = z + leanZ;
    // core: an octahedron-ish blob, dark, so the crown is never see-through
    const core = [tone[0] * 0.34, tone[1] * 0.34, tone[2] * 0.34];
    const cr = r * 0.6;
    const dirs = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, -1, 0], [0.7, 0.55, 0.7], [-0.7, 0.55, 0.7], [-0.7, 0.55, -0.7], [0.7, 0.55, -0.7]];
    const cv = dirs.map(([dx, dy, dz]) => {
      const l = Math.hypot(dx, dy, dz);
      const k = cr * (0.85 + rnd() * 0.3);
      return this.v(cx0 + (dx / l) * k, cy0 + (dy / l) * k * 0.8, cz0 + (dz / l) * k, dx / l, dy / l, dz / l, SOLID_U, SOLID_V, core, 0, 0, 0, 1);
    });
    const F = [[0, 6, 9], [0, 7, 6], [0, 8, 7], [0, 9, 8], [1, 9, 6], [2, 6, 7], [3, 7, 8], [4, 8, 9], [1, 6, 2], [2, 7, 3], [3, 8, 4], [4, 9, 1], [5, 1, 2], [5, 2, 3], [5, 3, 4], [5, 4, 1]];
    for (const [a, b, c] of F) this.idx.push(cv[a], cv[b], cv[c]);
    // leaf cards
    const cards = 30;
    for (let i = 0; i < cards; i++) {
      let dy = rnd() * 1.35 - 0.35;
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(Math.max(0, 1 - Math.min(1, dy * dy)));
      const dx = Math.cos(a) * rr, dz = Math.sin(a) * rr;
      dy = Math.min(1, dy);
      const k = r * (0.6 + rnd() * 0.32);
      const px = cx0 + dx * k, py = cy0 + dy * k * 0.82, pz = cz0 + dz * k;
      const size = r * (0.44 + rnd() * 0.22);
      const lit = 0.55 + 0.55 * (dy * 0.5 + 0.5) + (rnd() - 0.5) * 0.25;
      const c = [tone[0] * lit, tone[1] * lit, tone[2] * lit];
      let nx = dx, ny = dy + 0.4, nz = dz;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl; ny /= nl; nz /= nl;
      const rot = rnd() * Math.PI * 2;
      const q = Math.floor(rnd() * 4);
      const u0 = (q % 2) * 0.5, v0 = Math.floor(q / 2) * 0.5;
      const sway = 0.8 + rnd() * 0.5;
      const a0 = this.v(px, py, pz, nx, ny, nz, u0, v0, c, -size, -size, rot, sway);
      const a1 = this.v(px, py, pz, nx, ny, nz, u0 + 0.5, v0, c, size, -size, rot, sway);
      const a2 = this.v(px, py, pz, nx, ny, nz, u0 + 0.5, v0 + 0.5, c, size, size, rot, sway);
      const a3 = this.v(px, py, pz, nx, ny, nz, u0, v0 + 0.5, c, -size, size, rot, sway);
      this.idx.push(a0, a1, a2, a0, a2, a3);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aCard', new THREE.Float32BufferAttribute(this.card, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.boundingSphere.radius += 5;
    return g;
  }
}

export class Trees {
  constructor(city, props, ground) {
    this.group = new THREE.Group();
    this.spots = []; // {x, z, r} for dappled shade on the cab
    const tex = leafTexture();
    const uniforms = { uTime: env.uTime, uWind: env.uWind, uSnow: env.uSnow, uWet: env.uWet };
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, vertexColors: true, roughness: 0.9, metalness: 0, alphaToCoverage: true });
    patchMaterial(
      mat,
      {
        vertexPars: VERT_PARS,
        vertex: VERT,
        fragPars: 'uniform float uSnow, uWet;',
        fragColor: /* glsl */ `
          diffuseColor.a = clamp(diffuseColor.a * (1.0 + length(vViewPosition) * 0.02), 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.78, 0.85), uSnow * smoothstep(0.05, 0.7, vWNormal.y) * 0.88);
          diffuseColor.rgb *= mix(1.0, 0.82, uWet);
        `,
      },
      uniforms,
    );
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.42 });
    depth.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', `${VERT_PARS}\nvoid main() {`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT}`);
    };

    const GX = 4, GZ = 4;
    const builders = Array.from({ length: GX * GZ }, () => new TreeBuilder());
    const at = (x, z) => {
      const i = Math.min(GX - 1, Math.max(0, Math.floor(((x - city.minX) / (city.maxX - city.minX)) * GX)));
      const j = Math.min(GZ - 1, Math.max(0, Math.floor(((z - city.minZ) / (city.maxZ - city.minZ)) * GZ)));
      return builders[j * GX + i];
    };
    const rnd = mulberry32(2026);
    const tone = () => {
      const r = rnd();
      if (r < 0.07) return [0.3, 0.19, 0.035];
      if (r < 0.12) return [0.27, 0.09, 0.03];
      return [0.085 + rnd() * 0.06, 0.17 + rnd() * 0.09, 0.04 + rnd() * 0.035];
    };
    const plant = (x, y, z, h, r) => {
      at(x, z).tree(rnd, x, y, z, h, r, tone());
      this.spots.push({ x, z, r });
    };

    // along the pavements
    for (const lane of city.lanes) {
      if (lane.k !== 0) continue;
      const downtown = lane.road.lanes > 1;
      for (let s = 9 + rnd() * 4; s < lane.len - 8; s += 10.5 + rnd() * 4) {
        if (rnd() < 0.13 || !props.free(lane, s, 2.7)) continue;
        props.take(lane, s);
        const [x, z] = props.kerbPoint(lane, s, 1.15);
        const r = downtown ? randRange(rnd, 2.2, 2.9) : randRange(rnd, 2.3, 3.3);
        plant(x, CURB_H, z, randRange(rnd, 3.3, 4.4), r);
      }
    }
    // the park
    for (const b of ground.parks) {
      const ins = SIDEWALK_W + 2.5;
      let placed = 0, guard = 0;
      const pts = [];
      while (placed < 44 && guard++ < 600) {
        const x = randRange(rnd, b.x0 + ins, b.x1 - ins), z = randRange(rnd, b.z0 + ins, b.z1 - ins);
        if (pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < 6.5)) continue;
        pts.push([x, z]);
        plant(x, CURB_H + 0.04, z, randRange(rnd, 4, 6.2), randRange(rnd, 3, 4.6));
        placed++;
      }
    }
    // the boulevard's median
    for (const m of ground.medians) {
      for (let z = m.z0 + 4; z < m.z1 - 3; z += 9 + rnd() * 3) plant(m.x, CURB_H + 0.03, z, randRange(rnd, 3.2, 3.9), randRange(rnd, 2, 2.6));
    }
    // the promenade, on the sea side
    const p = city.promenade;
    for (let z = p.z0 + 10; z < p.z1 - 8; z += 13 + rnd() * 4) plant(p.x0 + 2.4, CURB_H, z, randRange(rnd, 3.6, 4.6), randRange(rnd, 2.4, 3.2));

    for (const b of builders) {
      if (!b.n) continue;
      const mesh = new THREE.Mesh(b.build(), mat);
      mesh.customDepthMaterial = depth;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }
}
