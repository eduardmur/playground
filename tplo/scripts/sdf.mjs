// The stifle as signed distance fields.
//
// Every bone is a smooth blend of a few rounded solids, written as a function that returns the
// distance from a point to its surface (negative inside). build-model.mjs turns these into meshes.
//
// Units are millimetres. Frame: +X cranial, +Y proximal, +Z medial, so this is a left stifle.
// The origin is the centre of the osteotomy: on the tibial long axis, just under the intercondylar
// eminence. The tibial long axis is the Y axis, so the plateau angle is the tilt of the plateau
// about Z and nothing else.
//
// Proportions are those of a dog of about 30 kg. The shapes are stylised, not taken from a scan.

export const TPA = 26; // tibial plateau angle of the model, degrees
export const TARGET = 5; // what the surgery aims for
export const ROTATION = TPA - TARGET;
export const RADIUS = 24; // radius of the saw blade
export const KERF = 0.7; // what the blade removes
export const STIFLE = 135; // standing angle between femur and tibia
export const TALUS = [0, -213, 0]; // centre of the talus, the far end of the tibial long axis
export const EMINENCE = [0, 5, 0]; // top of the intercondylar eminence

const D = Math.PI / 180;
const { sqrt, abs, min, max, cos, sin, hypot } = Math;
const cT = cos(TPA * D);
const sT = sin(TPA * D);

// ---- primitives

function sph(x, y, z, cx, cy, cz, r) {
  const dx = x - cx, dy = y - cy, dz = z - cz;
  return sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/** Ellipsoid, given the offset from its centre. A good approximation of the distance near the surface. */
function ell(dx, dy, dz, rx, ry, rz) {
  const ax = dx / rx, ay = dy / ry, az = dz / rz;
  const k0 = sqrt(ax * ax + ay * ay + az * az);
  if (k0 < 1e-6) return -min(rx, ry, rz);
  const bx = ax / rx, by = ay / ry, bz = az / rz;
  return (k0 * (k0 - 1)) / sqrt(bx * bx + by * by + bz * bz);
}

/** A capsule whose radius runs from ra at A to rb at B. */
function cone(x, y, z, ax, ay, az, ra, bx, by, bz, rb) {
  const px = x - ax, py = y - ay, pz = z - az;
  const ex = bx - ax, ey = by - ay, ez = bz - az;
  let h = (px * ex + py * ey + pz * ez) / (ex * ex + ey * ey + ez * ez);
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = px - ex * h, dy = py - ey * h, dz = pz - ez * h;
  return sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
}

export function smin(a, b, k) {
  const h = max(k - abs(a - b), 0) / k;
  return min(a, b) - h * h * k * 0.25;
}
export function smax(a, b, k) {
  const h = max(k - abs(a - b), 0) / k;
  return max(a, b) + h * h * k * 0.25;
}
const smoothstep = (a, b, x) => {
  const t = min(1, max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- the plateau frame: u runs up the slope (cranially), v is the plateau's normal

const toU = (x, y) => cT * x + sT * y;
const toV = (x, y) => -sT * x + cT * y;
export const plateauPoint = (u, v, z = 0) => [cT * u - sT * v, sT * u + cT * v, z];

// tibial condyles: flattened ellipsoids lying in the plateau frame
const MC = { u: -3, v: -8, z: 11, ru: 19, rv: 9.5, rz: 11.5 };
const LC = { u: -2.5, v: -8.2, z: -11, ru: 17.5, rv: 9.5, rz: 11.5 };

/** Height of the top of a tibial condyle over the plateau plane, in the plateau frame. */
function condyleTop(c, u, z) {
  const a = (u - c.u) / c.ru, b = (z - c.z) / c.rz;
  return c.v + c.rv * sqrt(max(0, 1 - a * a - b * b));
}

/** Where the medial plateau begins and ends: the two points the plateau line is drawn through. */
export function plateauMargins() {
  const half = 15.5;
  const v = condyleTop(MC, MC.u + half, MC.z);
  return { cranial: plateauPoint(MC.u + half, v, MC.z), caudal: plateauPoint(MC.u - half, v, MC.z) };
}

// ---- tibia

export function tibia(x, y, z) {
  const u = toU(x, y), v = toV(x, y);
  // the two condyles and the bone between them
  let d = ell(u - MC.u, v - MC.v, z - MC.z, MC.ru, MC.rv, MC.rz);
  d = smin(d, ell(u - LC.u, v - LC.v, z - LC.z, LC.ru, LC.rv, LC.rz), 6);
  d = smin(d, ell(u + 1, v + 9.5, z, 15, 8, 12), 6);
  // intercondylar eminence: two small tubercles
  d = smin(d, sph(x, y, z, 0, 2.4, 2.8, 3.2), 4);
  d = smin(d, sph(x, y, z, -0.6, 2.0, -2.8, 3.1), 4);
  // metaphysis, narrower from side to side than from front to back
  d = smin(d, cone(x, y, z * 1.12, 1.5, -12, 0, 17.5, 3, -50, 0.5, 11.6) / 1.06, 10);
  // shaft, with its slight S
  let s = cone(x, y, z, 3, -50, 0.5, 11.6, 2.6, -105, 1, 8.3);
  s = min(s, cone(x, y, z, 2.6, -105, 1, 8.3, 0, -165, 0.5, 8.0));
  s = min(s, cone(x, y, z, 0, -165, 0.5, 8.0, 0, -193, 0, 10.6));
  d = smin(d, s, 8);
  // tuberosity and the crest that runs down from it
  let c = ell(x - 26.6, y + 9, z + 1, 6.4, 10, 6.4);
  c = smin(c, cone(x, y, z, 26, -14, -1, 6.0, 21.5, -34, -0.3, 5.2), 5);
  c = min(c, cone(x, y, z, 21.5, -34, -0.3, 5.2, 13.5, -62, 0.6, 5.0));
  c = min(c, cone(x, y, z, 13.5, -62, 0.6, 5.0, 6.5, -98, 1, 5.4));
  c = min(c, cone(x, y, z, 6.5, -98, 1, 5.4, 3, -132, 1, 4));
  d = smin(d, c, 9);
  // distal end and the medial malleolus
  d = smin(d, ell(x, y + 198, z, 11.5, 9, 12.5), 7);
  d = smin(d, ell(x - 1.5, y + 206, z - 9.6, 6, 8, 4.4), 5);
  // hollows: popliteal notch, the seat for the talus
  d = smax(d, -cone(x, y, z, -21.5, 5, -1, 6.5, -17, -24, -1, 6), 4);
  d = smax(d, -sph(x, y, z, TALUS[0], TALUS[1], TALUS[2], 12), 2.5);
  return d;
}

/** Distance to the blade's cylinder: negative inside the circle the saw describes. */
export const blade = (x, y) => hypot(x, y) - RADIUS;

/** The plateau segment: what lies inside the cut. */
export const fragment = (x, y, z) => max(tibia(x, y, z), blade(x, y) + KERF / 2);
/** The rest of the tibia: shaft, crest and tuberosity. */
export const shaft = (x, y, z) => max(tibia(x, y, z), -blade(x, y) + KERF / 2);

const cR = cos(ROTATION * D);
const sR = sin(ROTATION * D);
/** The plateau segment after it has been turned to its new place (clockwise seen from the medial side). */
export function fragmentTurned(x, y, z) {
  return fragment(cR * x - sR * y, sR * x + cR * y, z);
}
/** The tibia as it is after surgery. */
export const tibiaAfter = (x, y, z) => min(fragmentTurned(x, y, z), shaft(x, y, z));

// ---- talus (only its trochlea matters here: its centre is the far end of the long axis)

export function talus(x, y, z) {
  const [cx, cy] = TALUS;
  let d = ell(x - cx, y - cy, z - 4.7, 10.9, 10.9, 3.9);
  d = smin(d, ell(x - cx, y - cy, z + 4.7, 10.9, 10.9, 3.9), 3);
  d = smin(d, ell(x - cx - 0.5, y - cy + 1, z, 9.4, 9.4, 7.6), 3);
  d = smin(d, ell(x - cx - 5, y - cy + 10, z, 13, 8, 10), 6);
  return d;
}

// ---- fibula

export function fibula(x, y, z) {
  let d = ell(x + 13, y + 16, z + 21.5, 6, 7.5, 3.6);
  let s = cone(x, y, z, -12.5, -22, -21, 3.0, -9, -100, -14.5, 2.4);
  s = min(s, cone(x, y, z, -9, -100, -14.5, 2.4, -4.5, -185, -13, 2.6));
  d = smin(d, s, 5);
  d = smin(d, ell(x + 3, y + 205, z + 14, 5.5, 10, 4.2), 5);
  return d;
}

// ---- femur, written in its own frame (shaft along +Y, condyles at the bottom) and then placed

const FA = (180 - STIFLE) * D;
const cF = cos(FA);
const sF = sin(FA);
export const FEMUR_ORIGIN = [-2.1, 19.4, 0];
export const FEMUR_LENGTH = 172;

/** A point of the femur's own frame, in the world. */
export const femurPoint = (x, y, z = 0) => [cF * x - sF * y + FEMUR_ORIGIN[0], sF * x + cF * y + FEMUR_ORIGIN[1], z];

function femurLocal(x, y, z) {
  // condyles
  let d = ell(x + 9, y, z - 10.6, 12.5, 12.5, 9.4);
  d = smin(d, ell(x + 9, y + 0.4, z + 10.6, 12.3, 12.3, 9.4), 5);
  // the block of bone above them
  d = smin(d, ell(x - 0.5, y - 10, z, 13.5, 15, 19.3), 7);
  // epicondyles
  d = smin(d, ell(x + 2, y - 7, z - 17.6, 7, 8, 3.2), 6);
  d = smin(d, ell(x + 2, y - 7, z + 17.6, 7, 8, 3.2), 6);
  // trochlear ridges
  let t = cone(x, y, z, 10.5, -5, 8.6, 5.4, 13.8, 15, 8.2, 5.4);
  t = min(t, cone(x, y, z, 13.8, 15, 8.2, 5.4, 11.5, 33, 7, 4.6));
  t = min(t, cone(x, y, z, 10.5, -5, -8.6, 5.0, 13.6, 15, -8.2, 5.0));
  t = min(t, cone(x, y, z, 13.6, 15, -8.2, 5.0, 11.5, 33, -7, 4.4));
  d = smin(d, t, 8);
  // shaft, bowed a little cranially
  let s = cone(x, y, z, 1, 18, 0, 12.6, 3.5, 56, 0, 8.9);
  s = min(s, cone(x, y, z, 3.5, 56, 0, 8.9, 7, 125, 0, 8.6));
  s = min(s, cone(x, y, z, 7, 125, 0, 8.6, 7.5, 190, 0, 8.8));
  d = smin(d, s, 9);
  // trochlear groove and the notch between the condyles
  let g = cone(x, y, z, 18.2, -8, 0, 6.2, 20.2, 15, 0, 6.2);
  g = min(g, cone(x, y, z, 20.2, 15, 0, 6.2, 16.2, 37, 0, 5.6));
  d = smax(d, -g, 3.5);
  d = smax(d, -cone(x, y, z, -6, -11, 0, 6.3, -23, 7, 0, 6.6), 3.5);
  // fabellae: the two small sesamoid bones behind the condyles
  d = min(d, ell(x + 23.6, y - 9.5, z - 10.2, 4.0, 5.0, 3.5));
  d = min(d, ell(x + 23.4, y - 9.0, z + 10.4, 3.8, 4.8, 3.4));
  // the shaft is shown cut off
  return smax(d, y - FEMUR_LENGTH, 0.8);
}

function patellaLocal(x, y, z) {
  let d = ell(x - 19.6, y - 17, z, 4.7, 10.5, 7.6);
  d = smin(d, sph(x, y, z, 18.6, 7.2, 0, 3.4), 4);
  return max(d, -(femurLocal(x, y, z) - 0.7));
}

const toFemur = (f) => (x, y, z) => {
  const dx = x - FEMUR_ORIGIN[0], dy = y - FEMUR_ORIGIN[1];
  return f(cF * dx + sF * dy, -sF * dx + cF * dy, z);
};
export const femur = toFemur(femurLocal);
export const patella = toFemur(patellaLocal);

// ---- menisci: C-shaped wedges that fill the gap between the round femur and the flatter tibia

function meniscus(c, open) {
  const a = c.ru * 0.82, b = c.rz * 0.86;
  return (x, y, z) => {
    const u = toU(x, y), v = toV(x, y);
    const pu = (u - c.u) / a, pz = (z - c.z) / b;
    const rho = sqrt(pu * pu + pz * pz);
    const floor = condyleTop(c, u, z);
    const top = floor + 0.3 + 3.0 * smoothstep(0.5, 1.0, rho);
    let d = max((rho - 1) * b, (0.46 - rho) * b); // a ring, seen from above
    d = smax(d, v - top, 1.8);
    d = max(d, floor - 1.2 - v);
    // the C opens towards the middle of the joint
    d = max(d, 2.6 - hypot((u - c.u) * 0.7, z - c.z - open * b * 0.62));
    d = smax(d, -(tibia(x, y, z) - 0.15), 0.6);
    d = smax(d, -(femur(x, y, z) - 0.25), 0.6);
    return d;
  };
}
export const meniscusMedial = meniscus(MC, -1);
export const meniscusLateral = meniscus(LC, 1);

// ---- helpers for the build

/** Gradient of a field by central differences, normalised. */
export function normal(f, x, y, z, e = 0.2) {
  const nx = f(x + e, y, z) - f(x - e, y, z);
  const ny = f(x, y + e, z) - f(x, y - e, z);
  const nz = f(x, y, z + e) - f(x, y, z - e);
  const l = hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** March from a point along a direction until the surface is met. Returns the hit point or null. */
export function trace(f, from, dir, far = 200) {
  const l = hypot(dir[0], dir[1], dir[2]);
  const d = [dir[0] / l, dir[1] / l, dir[2] / l];
  let t = 0;
  for (let i = 0; i < 400 && t < far; i++) {
    const p = [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t];
    const v = f(p[0], p[1], p[2]);
    if (v < 0.005) return p;
    t += v * 0.6;
  }
  return null;
}
