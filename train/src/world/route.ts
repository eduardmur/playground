// The line the train follows, and the valley it runs through: a handful of one-dimensional functions
// of the distance east... or rather "along the map": x. The terrain shader (glsl/route.ts) has a twin
// of every function here, built on the same integer hash, so the track the CPU puts the train on is
// the track the GPU carves into the mountains. Keep the two files in step.
//
// Axes: +x is the way the train heads (north), +z is to its right (east), +y is up.

export function hash32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Lattice value in [-1, 1): only the top 24 bits are used, so a float32 holds it exactly. */
function h1(i: number, seed: number): number {
  const h = hash32(((i | 0) + Math.imul(seed, 0x9e3779b1)) >>> 0);
  return (h >>> 8) * (2 / 16777216) - 1;
}

const _bs = { v: 0, d: 0 };
/** Cubic B-spline noise with wavelength 64 * 2^level metres: value and derivative per metre. C2-smooth. */
function bs(x: number, level: number, seed: number): { v: number; d: number } {
  const lambda = 64 * 2 ** level;
  const p = x / lambda;
  const ip = Math.floor(p);
  const f = p - ip;
  const v0 = h1(ip - 1, seed), v1 = h1(ip, seed), v2 = h1(ip + 1, seed), v3 = h1(ip + 2, seed);
  const f2 = f * f, f3 = f2 * f;
  const w0 = (1 - 3 * f + 3 * f2 - f3) / 6;
  const w1 = (3 * f3 - 6 * f2 + 4) / 6;
  const w2 = (-3 * f3 + 3 * f2 + 3 * f + 1) / 6;
  const w3 = f3 / 6;
  _bs.v = v0 * w0 + v1 * w1 + v2 * w2 + v3 * w3;
  _bs.d = ((v0 * -(1 - f) * (1 - f) + v1 * (3 * f2 - 4 * f) + v2 * (-3 * f2 + 2 * f + 1) + v3 * f2) * 0.5) / lambda;
  return _bs;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export const TERRACE = 50; // metres between the levels the valley floor steps through
export const WALL_K = 60; // how far out the foot of the valley wall stays gentle
export const WATER_DROP = 1.6; // the river runs this far under the valley floor

export interface Route {
  /** lateral position of the track, and its slope dz/dx */
  zp: number; dzp: number;
  /** valley floor (stepped) */
  floor: number;
  /** rail level and its slope dy/dx */
  ty: number; dty: number;
  /** valley centre relative to the track (z), half-width of the flat floor, slope of the lower wall */
  c: number; w: number; s: number;
  /** how far up the wall (horizontally) the track sits */
  at: number;
  /** 0..1 there is a lake on the floor here */
  lake: number;
  /** river centre relative to the valley centre, and its half-width */
  riverU: number; riverHW: number;
  /** -1..1: which side the valley is on (+1: to the left) */
  sigma: number;
}

/** Everything about the line at world x. Twin of `routeAt` in glsl/route.ts. */
export function routeAt(x: number, out: Route = {} as Route): Route {
  let n = bs(x, 10, 11);
  let zp = 2400 * n.v, dzp = 2400 * n.d;
  n = bs(x, 8, 12); zp += 800 * n.v; dzp += 800 * n.d;
  n = bs(x, 6, 13); zp += 260 * n.v; dzp += 260 * n.d;
  n = bs(x, 4, 14); zp += 150 * n.v; dzp += 150 * n.d;

  n = bs(x, 11, 21);
  let fraw = 1050 + 380 * n.v, dfraw = 380 * n.d;
  n = bs(x, 8, 22); fraw += 70 * n.v; dfraw += 70 * n.d;

  const t = fraw / TERRACE, fl = Math.floor(t), f = t - fl;
  const floor = TERRACE * (fl + smoothstep(0.6, 1, f));
  const plateau = smoothstep(0.02, 0.12, f) * (1 - smoothstep(0.42, 0.56, f));

  // the valley keeps to the left of the line, and now and then swings over to the right for a few kilometres
  n = bs(x, 7, 31);
  const q = clamp(0.67 - 1.6 * n.v, -1, 1);
  const dq = Math.abs(0.67 - 1.6 * n.v) < 1 ? -1.6 * n.d : 0;
  const sg = clamp(q / 0.012, -1, 1);
  const sigma = sg * (1.5 - 0.5 * sg * sg);

  // height of the rails over the smooth floor line: low where the line crosses the valley
  n = bs(x, 8, 32);
  const hn = 0.5 + 0.7 * n.v, dhn = 0.7 * n.d;
  const near = Math.min(1, Math.abs(q) / 0.9);
  const nearP = near * Math.sqrt(near);
  const dnearP = near < 1 ? 1.5 * Math.sqrt(near) * (Math.sign(q) * dq) / 0.9 : 0;
  const hh = 14 + 190 * hn * hn;
  const dhh = 380 * hn * dhn;
  const D = 7 + hh * nearP;
  const dD = dhh * nearP + hh * dnearP;
  const ty = fraw + D, dty = dfraw + dD;

  n = bs(x, 8, 33);
  const wn = 0.5 + 0.6 * n.v;
  const w = (110 + 420 * wn * wn) * (0.45 + 0.55 * sigma * sigma);
  n = bs(x, 8, 34);
  const s = 0.45 + 0.2 * n.v;

  const dp = ty - floor; // rails over the real floor
  const at = (dp + Math.sqrt(dp * dp + 4 * WALL_K * s * dp)) / (2 * s);
  const c = -sigma * (w + at);

  n = bs(x, 7, 35);
  const s4 = sigma * sigma * sigma * sigma;
  const lake = smoothstep(0.0, 0.25, 1.4 * n.v + 0.12) * plateau * s4;
  n = bs(x, 4, 36);
  const riverU = 0.62 * w * 1.3 * n.v;
  n = bs(x, 3, 37);
  const riverHW = 15 + 8 * n.v;

  out.zp = zp; out.dzp = dzp; out.floor = floor; out.ty = ty; out.dty = dty;
  out.c = c; out.w = w; out.s = s; out.at = at; out.lake = lake;
  out.riverU = riverU; out.riverHW = riverHW; out.sigma = sigma;
  return out;
}

const _r = {} as Route;
/** Just the rail position at x: [z, y, dz/dx, dy/dx]. */
export function railAt(x: number): [number, number, number, number] {
  routeAt(x, _r);
  return [_r.zp, _r.ty, _r.dzp, _r.dty];
}

/** Metres of track per metre of x at this point. */
export function stretchAt(x: number): number {
  routeAt(x, _r);
  return Math.sqrt(1 + _r.dzp * _r.dzp + _r.dty * _r.dty);
}
