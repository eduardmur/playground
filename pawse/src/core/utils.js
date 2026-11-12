// Small math + noise helpers shared by everything.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Works with reversed edges too (a > b), unlike GLSL. */
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach. */
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

export const angleDiff = (from, to) => {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
};

export const dampAngle = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));

export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Deterministic PRNG so the park is the same park every visit. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rnd, a, b) => a + (b - a) * rnd();
export const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

/** 2D gradient noise, optionally periodic (for tiling textures). */
export class Noise2D {
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  _grad(h, x, y) {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return x - y;
      case 2: return -x + y;
      case 3: return -x - y;
      case 4: return x * 1.4142;
      case 5: return -x * 1.4142;
      case 6: return y * 1.4142;
      default: return -y * 1.4142;
    }
  }

  /** Returns roughly [-1, 1]. `period` (in lattice cells) makes it tile. */
  noise(x, y, period = 0) {
    const perm = this.perm;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    let X0, X1, Y0, Y1;
    if (period > 0) {
      X0 = ((xi % period) + period) % period;
      Y0 = ((yi % period) + period) % period;
      X1 = (X0 + 1) % period;
      Y1 = (Y0 + 1) % period;
    } else {
      X0 = xi & 255;
      Y0 = yi & 255;
      X1 = (X0 + 1) & 255;
      Y1 = (Y0 + 1) & 255;
    }
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = perm[perm[X0] + Y0], ba = perm[perm[X1] + Y0];
    const ab = perm[perm[X0] + Y1], bb = perm[perm[X1] + Y1];
    const x1 = lerp(this._grad(aa, xf, yf), this._grad(ba, xf - 1, yf), u);
    const x2 = lerp(this._grad(ab, xf, yf - 1), this._grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  }

  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5, period = 0) {
    let amp = 1, sum = 0, norm = 0, f = 1;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * f, y * f, period ? period * f : 0) * amp;
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }
}

/** Poisson-ish rejection sampler: accepts a point only if it is far enough from all accepted ones. */
export function scatter(rnd, count, tries, gen, minDist, accept) {
  const pts = [];
  for (let i = 0; i < tries && pts.length < count; i++) {
    const p = gen(rnd);
    if (!p) continue;
    if (accept && !accept(p)) continue;
    let ok = true;
    const md = typeof minDist === 'function' ? minDist(p) : minDist;
    for (let j = 0; j < pts.length; j++) {
      const q = pts[j];
      const dx = p.x - q.x, dz = p.z - q.z;
      if (dx * dx + dz * dz < md * md) {
        ok = false;
        break;
      }
    }
    if (ok) pts.push(p);
  }
  return pts;
}
