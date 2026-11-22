// What stands along the line: two tracks on their ballast, the masts and wires over them, tunnels
// where the profile says the line goes underground and viaducts where the ground falls away.
// Built on the CPU from the route, a stretch at a time, as the train comes to it.
import * as THREE from 'three';
import { CLIPMAP, type TerrainBake } from './bake';
import { ATMOS, type Atmosphere } from './atmosphere';
import { LANDLIGHT } from './terrain';
import { routeAt, type Route } from './route';
import { CLOUDS } from './clouds';

const CHUNK = 48; // metres of x to a piece
const AHEAD = 620, BEHIND = 330;
const STEP = 2;
const MAST_EVERY = 54;
const PIER_EVERY = 30;
export const TRACK2 = -4; // the second track, metres to the left of ours

const VERT = /* glsl */ `
attribute vec3 aInfo;   // material, sun reachable 0..1, variation
varying vec3 vPos;
varying vec3 vN;
varying vec3 vInfo;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPos = w.xyz;
  vN = normal;
  vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
${ATMOS}
${CLIPMAP}
${LANDLIGHT}
uniform sampler2D tNoise;
${CLOUDS}
uniform vec3 uCam;
uniform vec4 uTrainLight;   // x: spill from the train's windows (exposed units), y: travelled metres, z: lamps on
varying vec3 vPos;
varying vec3 vN;
varying vec3 vInfo;

void main() {
  vec3 toP = vPos - uCam;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  int mat = int(vInfo.x + 0.5);
  float open = vInfo.y;

  vec4 n3 = texture(tNoise, vPos.xz / 3.0), n1 = texture(tNoise, vPos.xz / 0.7 + vPos.y * 0.3);
  vec3 albedo; float gloss = 0.0;
  if (mat == 0) {           // ballast
    albedo = vec3(0.25, 0.225, 0.2) * (0.55 + 0.9 * n1.b) * (0.85 + 0.3 * n3.a);
    albedo = mix(albedo, vec3(0.1, 0.075, 0.055), smoothstep(0.55, 0.8, n3.b) * 0.5);   // rust and oil between the rails
  } else if (mat == 1) {    // sleepers
    albedo = vec3(0.27, 0.26, 0.24) * (0.75 + 0.35 * n1.a) * (0.8 + 0.3 * n3.b);
  } else if (mat == 2) {    // rail
    float top = smoothstep(0.7, 0.95, n.y);
    albedo = mix(vec3(0.09, 0.055, 0.04), vec3(0.35, 0.35, 0.36), top);
    gloss = top;
  } else if (mat == 3) {    // galvanised steel
    albedo = vec3(0.3, 0.31, 0.32) * (0.85 + 0.25 * n3.b);
    gloss = 0.15;
  } else if (mat == 4) {    // wire
    albedo = vec3(0.12, 0.1, 0.085);
  } else if (mat == 5) {    // concrete in the open
    float streak = texture(tNoise, vec2(vPos.x * 0.05 + vPos.z * 0.05, vPos.y * 0.35)).b;
    albedo = vec3(0.4, 0.39, 0.37) * (0.72 + 0.4 * streak) * (0.9 + 0.2 * n1.b);
  } else {                  // tunnel lining
    float streak = texture(tNoise, vec2((vPos.x + vPos.z) * 0.02, vPos.y * 0.5)).b;
    albedo = vec3(0.2, 0.195, 0.185) * (0.6 + 0.6 * streak) * (0.8 + 0.35 * n1.b);
  }

  vec4 Lt = clipSample(tL, vPos.xz);
  float shadow = Lt.r * open * cloudShadow(vPos, mix(uMoonDir, uSunDir, uSunPrimary)), sky = mix(0.25, 1.0, Lt.g) * open;
  vec3 direct = directLight(n, vPos.y, shadow, 0.0);
  vec3 amb = skyIrradiance(n) * sky;
  amb += (sunLightAt(vPos.y * 0.001) * max(uSunDir.y, 0.0)) * 0.1 * vec3(0.5, 0.5, 0.42) * (1.0 - 0.5 * n.y) * open;
  vec3 col = albedo / PI * (direct + amb);
  // a polished rail head throws the sky and the sun back
  if (gloss > 0.0) {
    vec3 R = reflect(V, n);
    col += gloss * (skyRadiance(normalize(vec3(R.x, abs(R.y) + 0.05, R.z))) * 0.5 * sky + sunLightAt(vPos.y * 0.001) * shadow * pow(max(dot(normalize(uSunDir - V), n), 0.0), 220.0) * 6.0);
  }
  col *= uExposure;

  // underground the only light is the train's own, and a lamp on the wall now and then
  if (open < 0.999) {
    float lampX = abs(fract((vPos.x) / 46.0) - 0.5) * 46.0;
    vec3 lamp = vec3(1.0, 0.72, 0.42) * 0.0025 / (0.6 + lampX * lampX * 0.35) * uExposure * smoothstep(1.5, 4.5, vPos.y - (uCam.y - 2.4));
    float near = exp(-max(dist - 3.0, 0.0) * 0.14);
    vec3 spill = vec3(1.0, 0.93, 0.82) * uTrainLight.x * near * (0.35 + 0.65 * max(dot(n, -V), 0.0));
    col += albedo * (spill + lamp) * (1.0 - open);
  }

  vec3 tr, ins;
  aerial(V, dist, tr, ins);
  gl_FragColor = vec4(col * tr + ins * uExposure * open, 1.0);
}`;

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  info: number[] = [];
  idx: number[] = [];
  private v(p: THREE.Vector3, n: THREE.Vector3, mat: number, open: number, vary: number) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.info.push(mat, open, vary);
    return this.pos.length / 3 - 1;
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, mat: number, open: number, n?: THREE.Vector3, vary = 0.5) {
    const nn = n ?? new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const i = this.v(a, nn, mat, open, vary);
    this.v(b, nn, mat, open, vary);
    this.v(c, nn, mat, open, vary);
    this.v(d, nn, mat, open, vary);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  /** A square bar from a to b. */
  bar(a: THREE.Vector3, b: THREE.Vector3, w: number, mat: number, open: number, h = w) {
    const ax = new THREE.Vector3().subVectors(b, a);
    const side = new THREE.Vector3().crossVectors(ax, Math.abs(ax.y) > 0.9 * ax.length() ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, ax).normalize();
    const c = (p: THREE.Vector3, s: number, u: number) => p.clone().addScaledVector(side, (s * w) / 2).addScaledVector(up, (u * h) / 2);
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [s0, u0] = corners[i], [s1, u1] = corners[(i + 1) % 4];
      this.quad(c(a, s0, u0), c(a, s1, u1), c(b, s1, u1), c(b, s0, u0), mat, open);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 3));
    g.setIndex(this.idx);
    return g;
  }
}

interface Chunk {
  k: number;
  mesh: THREE.Mesh;
  x0: number;
  z0: number;
}

export class Trackside {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private chunks = new Map<number, Chunk>();
  private r = {} as Route;
  private pf = { dh: 0, tunnel: 0, viaduct: 0, ground: 0 };
  readonly trainLight = new THREE.Vector4();

  constructor(private bake: TerrainBake, atmos: Atmosphere, extra: Record<string, THREE.IUniform>) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: bake.defines(),
      side: THREE.DoubleSide,
      uniforms: { ...bake.uniforms(), ...atmos.uniforms(), ...extra, uTrainLight: { value: this.trainLight } },
    });
  }

  /** A point given along the line: x, metres to the right of our track, metres over the rails. Relative to (ox, oz). */
  private at(x: number, n: number, y: number, ox: number, oz: number, out = new THREE.Vector3()): THREE.Vector3 {
    const r = routeAt(x, this.r);
    const cs = 1 / Math.sqrt(1 + r.dzp * r.dzp);
    return out.set(x - n * r.dzp * cs - ox, r.ty + y, r.zp + n * cs - oz);
  }

  /** Builds one piece of the line, stopping for breath (a yield) between its parts. */
  private *build(k: number): Generator<undefined, Chunk> {
    const x0 = k * CHUNK, x1 = x0 + CHUNK;
    const z0 = routeAt(x0, this.r).zp;
    const B = new Builder();
    const P = (x: number, n: number, y: number) => this.at(x, n, y, x0, z0);
    const prof = (x: number) => this.bake.profileAt(x, this.pf);

    // sweep a cross-section (n, y pairs) between consecutive samples
    const sweep = (profile: [number, number][], mat: number, opts: { when?: (tun: number, via: number) => boolean; inside?: boolean } = {}) => {
      for (let x = x0; x < x1 - 1e-6; x += STEP) {
        const a = prof(x), ta = a.tunnel, va = a.viaduct;
        const b = prof(x + STEP), tb = b.tunnel, vb = b.viaduct;
        if (opts.when && !(opts.when(ta, va) && opts.when(tb, vb))) continue;
        const openA = 1 - ta, openB = 1 - tb;
        for (let i = 0; i < profile.length - 1; i++) {
          const [n0, y0] = profile[i], [n1, y1] = profile[i + 1];
          const p00 = P(x, n0, y0), p01 = P(x, n1, y1), p10 = P(x + STEP, n0, y0), p11 = P(x + STEP, n1, y1);
          // the section is listed left to right over the top: its outward side is up
          const nn = new THREE.Vector3().subVectors(p01, p00).cross(new THREE.Vector3().subVectors(p10, p00)).normalize();
          if (opts.inside) nn.negate();
          const i0 = B.pos.length / 3;
          for (const [p, o] of [[p00, openA], [p01, openA], [p11, openB], [p10, openB]] as const) {
            B.pos.push(p.x, p.y, p.z);
            B.nor.push(nn.x, nn.y, nn.z);
            B.info.push(mat, mat === 6 ? 0 : o, 0.5);
          }
          B.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
        }
      }
    };

    // ballast and rails
    sweep([[-6.7, -0.78], [-5.75, -0.2], [1.75, -0.2], [2.7, -0.78]], 0);
    yield;
    for (const t of [0, TRACK2]) {
      for (const s of [-0.7175, 0.7175]) {
        const c = t + s;
        sweep([[c - 0.036, -0.17], [c - 0.036, 0], [c + 0.036, 0], [c + 0.036, -0.17]], 2);
        yield;
      }
    }
    // sleepers: only their tops show above the stones
    const up = new THREE.Vector3(0, 1, 0);
    let count = 0;
    for (let x = Math.ceil(x0 / 0.6) * 0.6; x < x1; x += 0.6) {
      const open = 1 - prof(x).tunnel;
      for (const t of [0, TRACK2]) B.quad(P(x - 0.13, t - 1.2, -0.168), P(x - 0.13, t + 1.2, -0.168), P(x + 0.13, t + 1.2, -0.168), P(x + 0.13, t - 1.2, -0.168), 1, open, up);
      if (++count % 16 === 0) yield;
    }

    // masts and wires, out in the open
    for (let x = Math.ceil(x0 / MAST_EVERY) * MAST_EVERY; x < x1; x += MAST_EVERY) {
      const here = prof(x).tunnel, next = prof(x + MAST_EVERY).tunnel;
      const zig = Math.round(x / MAST_EVERY) % 2 === 0 ? 0.2 : -0.2;
      for (const [track, mastN] of [[0, 3.0], [TRACK2, TRACK2 - 3.0]] as const) {
        const dir = Math.sign(track - mastN);
        if (here < 0.5) {
          B.bar(P(x, mastN, -0.9), P(x, mastN, 7.7), 0.2, 3, 1, 0.24);
          B.bar(P(x, mastN, 7.0), P(x, track + dir * 0.25, 6.62), 0.07, 3, 1);
          B.bar(P(x, mastN, 5.75), P(x, track + dir * 0.25, 6.58), 0.05, 3, 1);
          B.bar(P(x, mastN, 5.62), P(x, track + zig, 5.42), 0.045, 3, 1);
          B.bar(P(x, track + zig, 5.42), P(x, track + zig, 5.3), 0.03, 3, 1);
        }
        if (here < 0.5 && next < 0.5) {
          // contact wire, straight from support to support, and the catenary sagging above it
          const a = P(x, track + zig, 5.3), b = P(x + MAST_EVERY, track - zig, 5.3);
          B.bar(a, b, 0.022, 4, 1);
          const ca = P(x, track, 6.6), cb = P(x + MAST_EVERY, track, 6.6);
          const N = 9;
          let prev = ca;
          for (let i = 1; i <= N; i++) {
            const t = i / N;
            const p = ca.clone().lerp(cb, t);
            p.y -= 0.95 * 4 * t * (1 - t);
            B.bar(prev, p, 0.018, 4, 1);
            if (i < N && i % 2 === 0) B.bar(p, a.clone().lerp(b, t), 0.01, 4, 1);
            prev = p;
          }
        }
      }
    }

    yield;
    // tunnel: a lining round both tracks, and a wall at each mouth
    const arch: [number, number][] = [[-7.2, -0.8], [-7.2, 4.2]];
    for (let i = 1; i < 12; i++) {
      const a = Math.PI - (i / 12) * Math.PI;
      arch.push([-2 + 5.2 * Math.cos(a), 4.2 + 3.4 * Math.sin(a)]);
    }
    arch.push([3.2, 4.2], [3.2, -0.8]);
    sweep(arch, 6, { when: (tun) => tun > 0.5, inside: true });
    yield;
    for (let x = x0; x < x1 - 1e-6; x += STEP) {
      const ta = prof(x).tunnel > 0.5, tb = prof(x + STEP).tunnel > 0.5;
      if (ta === tb) continue;
      const xm = ta ? x : x + STEP; // the last section that is underground
      const outer = (n: number, y: number): [number, number] => {
        if (y <= 4.2) return [n < -2 ? -15 : 11, y];
        const dx = n + 2, dy = y - 4.2, s = Math.min(13 / Math.max(Math.abs(dx), 1e-3), 9.8 / Math.max(dy, 1e-3));
        return [-2 + dx * s, 4.2 + dy * s];
      };
      for (let i = 0; i < arch.length - 1; i++) {
        const [n0, y0] = arch[i], [n1, y1] = arch[i + 1];
        const [on0, oy0] = outer(n0, y0), [on1, oy1] = outer(n1, y1);
        B.quad(P(xm, n0, y0), P(xm, n1, y1), P(xm, on1, oy1), P(xm, on0, oy0), 5, 1);
      }
    }

    yield;
    // viaduct: a deck under the ballast, a rail along each edge, piers down to the ground
    const onVia = (_t: number, via: number) => via > 0.5;
    sweep([[-7.3, -0.8], [-7.3, -2.3], [3.3, -2.3], [3.3, -0.8], [-7.3, -0.8]], 5, { when: onVia });
    yield;
    for (const n of [-7.25, 3.25]) {
      sweep([[n - 0.03, 0.3], [n + 0.03, 0.3], [n + 0.03, 0.24], [n - 0.03, 0.24], [n - 0.03, 0.3]], 3, { when: onVia });
      sweep([[n - 0.02, -0.22], [n + 0.02, -0.22], [n + 0.02, -0.27], [n - 0.02, -0.27], [n - 0.02, -0.22]], 3, { when: onVia });
      for (let x = Math.ceil(x0 / 4) * 4; x < x1; x += 4) if (prof(x).viaduct > 0.5) B.bar(P(x, n, -0.8), P(x, n, 0.3), 0.06, 3, 1);
    }
    for (let x = Math.ceil(x0 / PIER_EVERY) * PIER_EVERY; x < x1; x += PIER_EVERY) {
      const s = prof(x);
      if (s.viaduct < 0.5) continue;
      const ty = routeAt(x, this.r).ty;
      const depth = ty - 2.3 - (s.ground - 4);
      if (depth < 3) continue;
      const top = P(x, -2, -2.3), bottom = P(x, -2, -2.3 - depth);
      // a slab across the line, a little wider at the foot
      const tA = P(x - 1.1, -6.2, -2.3), tB = P(x + 1.1, -6.2, -2.3), tC = P(x + 1.1, 2.2, -2.3), tD = P(x - 1.1, 2.2, -2.3);
      const spread = 1 + Math.min(0.5, depth * 0.012);
      const foot = (p: THREE.Vector3) => new THREE.Vector3(bottom.x + (p.x - top.x) * spread, bottom.y, bottom.z + (p.z - top.z) * spread);
      const ring = [tA, tB, tC, tD];
      for (let i = 0; i < 4; i++) {
        const a = ring[i], b = ring[(i + 1) % 4];
        B.quad(a, foot(a), foot(b), b, 5, 1);
      }
    }

    yield;
    const mesh = new THREE.Mesh(B.geometry(), this.material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { k, mesh, x0, z0 };
  }
  private pending: { k: number; gen: Generator<undefined, Chunk> } | null = null;

  /** Keep the stretch around the train built, and everything placed against the current origin. */
  update(camX: number) {
    const from = Math.floor((camX - BEHIND) / CHUNK), to = Math.floor((camX + AHEAD) / CHUNK);
    for (const [k, c] of this.chunks) {
      if (k < from || k > to) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        this.chunks.delete(k);
      }
    }
    // a piece is built over several frames, a millisecond or so at a time: the train is never close to
    // the end of what is built. Only the very first frame builds everything at once.
    const first = this.chunks.size === 0;
    const until = performance.now() + (first ? 1e9 : 1.2);
    for (;;) {
      if (!this.pending) {
        let next = -1;
        for (let k = Math.floor(camX / CHUNK); k <= to; k++) if (!this.chunks.has(k)) { next = k; break; }
        if (next < 0) for (let k = from; k <= to; k++) if (!this.chunks.has(k)) { next = k; break; }
        if (next < 0) break;
        this.pending = { k: next, gen: this.build(next) };
      }
      const step = this.pending.gen.next();
      if (step.done) {
        this.chunks.set(this.pending.k, step.value);
        this.pending = null;
      }
      if (performance.now() > until) break;
    }
    for (const c of this.chunks.values()) {
      c.mesh.position.set(c.x0 - this.bake.originX, 0, c.z0 - this.bake.originZ);
      c.mesh.updateMatrixWorld();
    }
  }
}
