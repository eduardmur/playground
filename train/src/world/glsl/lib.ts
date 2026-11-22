// GLSL shared by everything that needs to know the shape of the land.
//
// Positions in shaders are "local": metres from an origin that is itself a whole number of 64 m
// cells from the world's zero (uOrigin64). Noise is looked up on integer lattices whose cells are
// 64 * 2^level metres, so the lattice index of any point is exact however far the train has gone:
// nothing repeats and nothing loses precision.

export const HASH = /* glsl */ `
uniform ivec2 uOrigin64;

uint hash32(uint x) { x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }
uint hash2(ivec2 c, uint seed) { return hash32(uint(c.x) * 0x9E3779B1u + hash32(uint(c.y) + seed * 0x85EBCA77u)); }
float u01(uint h) { return float(h >> 8) * (1.0 / 16777216.0); }

// where the origin sits on the lattice of the given level: whole cells, and the fraction of a cell
void lat(int o, int L, out int cell, out float fr) {
  if (L >= 0) { cell = o >> L; fr = float(o & ((1 << L) - 1)) * exp2(-float(L)); }
  else { cell = o << (-L); fr = 0.0; }
}
`;

/** Twin of src/world/route.ts. */
export const ROUTE = /* glsl */ `
const float TERRACE = 50.0;
const float WALL_K = 60.0;
const float WATER_DROP = 1.6;

float h1(int i, uint seed) { return float(hash32(uint(i) + seed * 0x9E3779B1u) >> 8) * (2.0 / 16777216.0) - 1.0; }

// cubic B-spline noise of local x, wavelength 64 * 2^L metres: (value, derivative per metre)
vec2 bs(float xl, int L, uint seed) {
  int cell; float fr; lat(uOrigin64.x, L, cell, fr);
  float inv = exp2(-float(L)) / 64.0;
  float p = xl * inv + fr;
  float ip = floor(p); float f = p - ip; int i = cell + int(ip);
  float v0 = h1(i - 1, seed), v1 = h1(i, seed), v2 = h1(i + 1, seed), v3 = h1(i + 2, seed);
  float f2 = f * f, f3 = f2 * f;
  float w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  float w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
  float w2 = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0;
  float w3 = f3 / 6.0;
  float d = (v0 * -(1.0 - f) * (1.0 - f) + v1 * (3.0 * f2 - 4.0 * f) + v2 * (-3.0 * f2 + 2.0 * f + 1.0) + v3 * f2) * 0.5 * inv;
  return vec2(v0 * w0 + v1 * w1 + v2 * w2 + v3 * w3, d);
}

struct Route {
  float zp, dzp;      // track: local z and slope dz/dx
  float flr;          // valley floor
  float ty, dty;      // rail level and slope
  float c, w, s, at;  // valley centre relative to the track, floor half-width, wall slope, track's reach up the wall
  float lake, riverU, riverHW;
};

Route routeAt(float xl) {
  Route r;
  vec2 n = bs(xl, 10, 11u);
  float zp = 2400.0 * n.x, dzp = 2400.0 * n.y;
  n = bs(xl, 8, 12u); zp += 800.0 * n.x; dzp += 800.0 * n.y;
  n = bs(xl, 6, 13u); zp += 260.0 * n.x; dzp += 260.0 * n.y;
  n = bs(xl, 4, 14u); zp += 150.0 * n.x; dzp += 150.0 * n.y;

  n = bs(xl, 11, 21u);
  float fraw = 1050.0 + 380.0 * n.x, dfraw = 380.0 * n.y;
  n = bs(xl, 8, 22u); fraw += 70.0 * n.x; dfraw += 70.0 * n.y;

  float t = fraw / TERRACE, fl = floor(t), f = t - fl;
  float flr = TERRACE * (fl + smoothstep(0.6, 1.0, f));
  float plateau = smoothstep(0.02, 0.12, f) * (1.0 - smoothstep(0.42, 0.56, f));

  n = bs(xl, 7, 31u);
  float qr = 0.67 - 1.6 * n.x;
  float q = clamp(qr, -1.0, 1.0);
  float dq = abs(qr) < 1.0 ? -1.6 * n.y : 0.0;
  float sg = clamp(q / 0.012, -1.0, 1.0);
  float sigma = sg * (1.5 - 0.5 * sg * sg);

  n = bs(xl, 8, 32u);
  float hn = 0.5 + 0.7 * n.x, dhn = 0.7 * n.y;
  float nearK = min(1.0, abs(q) / 0.9);
  float nearP = nearK * sqrt(nearK);
  float dnearP = nearK < 1.0 ? 1.5 * sqrt(nearK) * (sign(q) * dq) / 0.9 : 0.0;
  float hh = 14.0 + 190.0 * hn * hn;
  float dhh = 380.0 * hn * dhn;
  float D = 7.0 + hh * nearP;
  float dD = dhh * nearP + hh * dnearP;
  float ty = fraw + D;

  n = bs(xl, 8, 33u);
  float wn = 0.5 + 0.6 * n.x;
  float w = (110.0 + 420.0 * wn * wn) * (0.45 + 0.55 * sigma * sigma);
  n = bs(xl, 8, 34u);
  float s = 0.45 + 0.2 * n.x;

  float dp = ty - flr;
  float at = (dp + sqrt(dp * dp + 4.0 * WALL_K * s * dp)) / (2.0 * s);

  n = bs(xl, 7, 35u);
  float s4 = sigma * sigma; s4 *= s4;
  r.lake = smoothstep(0.0, 0.25, 1.4 * n.x + 0.12) * plateau * s4;
  n = bs(xl, 4, 36u);
  r.riverU = 0.62 * w * 1.3 * n.x;
  n = bs(xl, 3, 37u);
  r.riverHW = 15.0 + 8.0 * n.x;

  r.zp = zp - float(uOrigin64.y) * 64.0; r.dzp = dzp; r.flr = flr; r.ty = ty; r.dty = dfraw + dD;
  r.c = -sigma * (w + at); r.w = w; r.s = s; r.at = at;
  return r;
}

// the floor and the water alone: for the water surface, which needs nothing else
float valleyFloorAt(float xl) {
  vec2 n = bs(xl, 11, 21u);
  float fraw = 1050.0 + 380.0 * n.x;
  n = bs(xl, 8, 22u); fraw += 70.0 * n.x;
  float t = fraw / TERRACE, fl = floor(t);
  return TERRACE * (fl + smoothstep(0.6, 1.0, t - fl));
}
`;

export const NOISE = /* glsl */ `
vec2 grad2(ivec2 c, uint seed) {
  float a = float(hash2(c, seed) >> 8) * (6.28318530718 / 16777216.0);
  return vec2(cos(a), sin(a));
}

// gradient noise on a lattice: p in cells, c the cell the origin is in. (value, d/dp), about -1..1
vec3 gnCore(vec2 p, ivec2 cell, uint seed) {
  vec2 ip = floor(p), f = p - ip;
  ivec2 c = cell + ivec2(ip);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = grad2(c, seed), gb = grad2(c + ivec2(1, 0), seed), gc = grad2(c + ivec2(0, 1), seed), gd = grad2(c + ivec2(1, 1), seed);
  float va = dot(ga, f), vb = dot(gb, f - vec2(1.0, 0.0)), vc = dot(gc, f - vec2(0.0, 1.0)), vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  float val = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  vec2 der = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * k + vec2(vb, vc) - va);
  return vec3(val, der) * 1.4142;
}

// wavelength 64 * 2^L metres, pl local metres. (value, d/dx, d/dz per metre)
vec3 gn(vec2 pl, int L, uint seed) {
  ivec2 cell; vec2 fr;
  lat(uOrigin64.x, L, cell.x, fr.x); lat(uOrigin64.y, L, cell.y, fr.y);
  float inv = exp2(-float(L)) / 64.0;
  vec3 n = gnCore(pl * inv + fr, cell, seed);
  return vec3(n.x, n.yz * inv);
}

// the same along the line: x is local, v is metres to the side of the track, so only x has an origin
float gnTrack(float xl, float v, int Lx, int Lv, uint seed) {
  int cell; float fr; lat(uOrigin64.x, Lx, cell, fr);
  vec2 p = vec2(xl * exp2(-float(Lx)) / 64.0 + fr, v * exp2(-float(Lv)) / 64.0);
  return gnCore(p, ivec2(cell, 0), seed).x;
}

// Gullies that run down the fall line (after Clay John and Fewes): a sum of little wave packets
// whose stripes follow dir. p in cells. (value, a pseudo-derivative used to make them branch)
vec3 erosionCore(vec2 p, ivec2 cell, vec2 dir, uint seed) {
  vec2 ip = floor(p), fp = p - ip;
  ivec2 c = cell + ivec2(ip);
  vec3 va = vec3(0.0); float wt = 0.0;
  for (int i = -2; i <= 1; i++) for (int j = -2; j <= 1; j++) {
    ivec2 o = ivec2(i, j);
    uint h = hash2(c - o, seed);
    vec2 jit = vec2(float(h & 0xFFFFu), float(h >> 16)) * (1.0 / 65536.0) - 0.5;
    vec2 pp = fp + vec2(o) - jit;
    float w = exp(-dot(pp, pp) * 2.0);
    wt += w;
    float mag = dot(pp, dir) * 6.28318530718;
    va += vec3(cos(mag), -sin(mag) * dir) * w;
  }
  return va / wt;
}

vec3 erosion(vec2 pl, int L, vec2 dir, uint seed) {
  ivec2 cell; vec2 fr;
  lat(uOrigin64.x, L, cell.x, fr.x); lat(uOrigin64.y, L, cell.y, fr.y);
  return erosionCore(pl * (exp2(-float(L)) / 64.0) + fr, cell, dir, seed);
}
`;

/**
 * The land itself. Needs HASH, ROUTE and NOISE first, a `uTexel` uniform (metres per sample of whatever
 * is being drawn: octaves too fine to show at that spacing are left out), and a function
 * `Route routeFor(float xl)` that the includer defines after it (analytic, or read from a baked strip).
 */
export const TERRAIN = /* glsl */ `
uniform float uTexel;
Route routeFor(float xl);

float octave(float lambda) { return smoothstep(2.5 * uTexel, 5.0 * uTexel, lambda); }

float mountains(vec2 p) {
  vec2 q = p + vec2(gn(p, 7, 101u).x, gn(p, 7, 102u).x) * 1500.0;
  float sum = 0.0, amp = 0.5, wgt = 1.0;
  for (int o = 0; o < 5; o++) {
    float n = gn(q, 8 - o, 110u + uint(o)).x;
    float r = 1.0 - abs(n); r *= r;
    sum += r * amp * wgt;
    wgt = clamp(r * 1.7, 0.0, 1.0);
    amp *= 0.5;
  }
  return sum;
}

struct Land {
  float h;       // height
  float a;       // metres outside the flat valley floor (negative on it)
  float v;       // metres to the side of the track (z)
  float mnt;     // 0..1 how much of the high-mountain field applies here
  float inFloor; // 1 well inside the floor
};

// the big shapes: valley, walls, massifs. No gullies yet.
Land landBase(vec2 p, Route r) {
  Land L;
  float v = p.y - r.zp;
  float u = v - r.c;
  float au = abs(u);
  float a = au - r.w;
  float ap = max(a, 0.0);
  float wl = r.s * ap * ap / (ap + WALL_K);

  // how high the wall goes before it gives way to the mountains behind: low where a side valley opens
  float sv = gn(p, 7, 120u).x;
  float cap = mix(110.0, 900.0, smoothstep(-0.45, 0.45, sv));
  float wall = wl < 300.0 ? wl : 300.0 + cap * (1.0 - exp(-(wl - 300.0) / cap));

  // mountains: none between the track and the valley, and none right over the line
  float same = step(0.0, -u * r.c);
  float m = mix(smoothstep(120.0, 3800.0, a), smoothstep(r.at + 60.0, r.at + 3800.0, a), same);
  float mh = mountains(p);
  float peaks = 2700.0 * mh * sqrt(mh);

  // spurs and side gullies across the line: what the tunnels and viaducts are for
  float ramp = 0.35 + 0.65 * ap / (ap + 180.0);
  float spn = gnTrack(p.x, v, 4, 7, 140u);
  float gun = gnTrack(p.x, v, 4, 7, 141u);
  float spur = (smoothstep(0.27, 0.68, spn) * 70.0 - smoothstep(0.4, 0.8, gun) * 42.0) * ramp * smoothstep(-30.0, 40.0, a);

  // the floor: a river, here and there a lake, gentle ground
  float inF = 1.0 - smoothstep(-40.0, 20.0, a);
  float fl = 0.0;
  if (a < 60.0) {
    float dr = abs(u - r.riverU);
    float river = 1.0 - smoothstep(r.riverHW * 0.55, r.riverHW * 1.7, dr);
    float basin = 1.0 - smoothstep(r.w * 0.55, r.w * 0.98, au);
    fl = -3.6 * river * (1.0 - r.lake) - 19.0 * r.lake * basin;
    fl += gn(p, 1, 130u).x * 1.3 * inF * octave(128.0);
  }

  L.h = r.flr + wall + m * peaks + spur + fl;
  L.a = a; L.v = v; L.mnt = m; L.inFloor = inF;
  return L;
}

struct Ground {
  float h;
  float a, v;
  float gully;   // 0 in the bottom of a gully .. 1 on a rib
  float slope;   // of the big shapes
  float mnt, inFloor;
};

Ground groundAt(vec2 p) {
  Route r = routeFor(p.x);
  Land b = landBase(p, r);
  float e = max(24.0, uTexel);
  float hx = landBase(p + vec2(e, 0.0), routeFor(p.x + e)).h;
  float hz = landBase(p + vec2(0.0, e), r).h;
  vec2 g = vec2(hx - b.h, hz - b.h) / e;
  float slope = length(g);

  vec2 dir = vec2(g.y, -g.x) * 2.0;
  float dl = length(dir);
  if (dl > 3.6) dir *= 3.6 / dl;

  // strong in the high mountains, slight near the line and gone on the floor
  float away = smoothstep(60.0, 700.0, abs(b.v));
  float amt = smoothstep(-20.0, 250.0, b.a) * mix(0.15, 1.0, max(away * 0.6, b.mnt)) * smoothstep(0.04, 0.45, slope);

  vec3 h = vec3(0.0); float amp = 0.5, f = 1.0;
  for (int i = 0; i < 6; i++) {
    float lambda = 1024.0 / f;
    float wo = octave(lambda * 0.5);
    if (wo > 0.0) h += erosion(p, 4 - i, dir + h.zy * vec2(1.0, -1.0) * 2.4, 200u + uint(i)) * amp * wo * vec3(1.0, f, f);
    amp *= 0.5; f *= 2.0;
  }

  Ground G;
  G.h = b.h + (h.x - 0.22) * 80.0 * amt;
  G.gully = clamp(h.x * 0.5 + 0.5, 0.0, 1.0);
  G.a = b.a; G.v = b.v; G.slope = slope; G.mnt = b.mnt; G.inFloor = b.inFloor;
  return G;
}
`;
