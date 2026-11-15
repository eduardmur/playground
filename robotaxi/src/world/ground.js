// Everything you drive and walk on: asphalt, kerbs and pavements, road paint,
// the park lawn. One shader patch gives all of it weather: it darkens and goes
// glossy when wet, pools into puddles that mirror the street, and whitens under snow.
import * as THREE from 'three';
import { env, LAYER, patchMaterial, GLSL_HASH, GeoBuilder } from './shared.js';
import {
  LANE_W, PARK_W, SIDEWALK_W, CURB_H, CORNER_R, XW_SETBACK, XW_LEN, STRIP_D, ZONE_HALF,
} from './city.js';

const WHITE = [0.74, 0.74, 0.72];
const YELLOW = [0.72, 0.52, 0.07];
const CURB_COL = [0.5, 0.49, 0.47];

/**
 * kind 0 asphalt, 1 concrete, 2 road paint, 3 lawn.
 */
export function makeGroundMaterial(kind, { reflect = true, taps = 7 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    vertexColors: kind !== 0,
  });
  if (kind === 2) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
  }
  const defines = { KIND: kind, REFLECT_TAPS: taps };
  if (reflect && kind !== 3) defines.USE_REFLECT = '';
  patchMaterial(
    mat,
    {
      vertexPars: kind === 2 ? 'attribute float wear;\nvarying float vWear;' : '',
      vertex: kind === 2 ? 'vWear = wear;' : '',
      fragPars: /* glsl */ `
        uniform sampler2D uNoise, uNormalNoise, uReflect;
        uniform mat4 uReflectMatrix;
        uniform float uWet, uPuddle, uSnow, uRain, uTime, uReflectOn;
        ${kind === 2 ? 'varying float vWear;' : ''}
        ${GLSL_HASH}
        vec3 gNn; vec2 gRip; float gPud; float gSnow; float gUp;
        vec2 rainRipples(vec2 p, float t) {
          vec2 acc = vec2(0.0);
          for (int l = 0; l < 2; l++) {
            vec2 q = p * (l == 0 ? 2.3 : 3.7) + float(l) * 17.7;
            vec2 cell = floor(q);
            vec2 f = fract(q) - 0.5;
            vec2 h = hash22(cell);
            float ph = fract(t * (0.9 + h.x * 0.8) + h.y);
            vec2 d = f - (h - 0.5) * 0.5;
            float r = length(d);
            float ring = ph * 0.42;
            float w = smoothstep(0.07, 0.0, abs(r - ring)) * (1.0 - ph);
            acc += normalize(d + 1e-5) * w * sin((r - ring) * 80.0);
          }
          return acc;
        }
      `,
      fragColor: /* glsl */ `
        vec2 wuv = vWPos.xz;
        gUp = step(0.5, vWNormal.y);
        float nLow = texture2D(uNoise, wuv * 0.011).r;
        float nMid = texture2D(uNoise, wuv * 0.063).g;
        float nFine = texture2D(uNoise, wuv * 1.7).b;
        float nA = texture2D(uNoise, wuv * 0.027).a;
        #if KIND == 0
          vec3 alb = vec3(0.088, 0.09, 0.094) * (0.72 + 0.56 * nMid) * (0.8 + 0.4 * nFine) * mix(0.84, 1.14, nLow);
          // hairline cracks, and only in the older patches of road
          float crack = smoothstep(0.007, 0.0, abs(texture2D(uNoise, wuv * 0.05).a - 0.5));
          float old = smoothstep(0.5, 0.72, texture2D(uNoise, wuv * 0.0031 + 0.61).r);
          alb *= 1.0 - 0.3 * crack * old;
          float patchy = smoothstep(0.6, 0.63, texture2D(uNoise, wuv * 0.0057 + 0.37).g);
          alb *= 1.0 - 0.24 * patchy;
          diffuseColor.rgb = alb;
          float wetDark = 0.38, snowAmt = 0.72, pudBias = 0.0;
        #elif KIND == 1
          vec3 alb = diffuseColor.rgb * (0.84 + 0.32 * nMid) * (0.9 + 0.2 * nFine) * mix(0.9, 1.08, nLow);
          vec2 tg = abs(fract(wuv / 1.52) - 0.5);
          float jw = fwidth(wuv.x) / 1.52 + fwidth(wuv.y) / 1.52;
          float joint = smoothstep(0.487 - jw, 0.5 - jw * 0.3, max(tg.x, tg.y)) * (1.0 - smoothstep(0.06, 0.25, jw)) * gUp;
          alb *= 1.0 - 0.4 * joint;
          diffuseColor.rgb = alb;
          float wetDark = 0.68, snowAmt = 1.0, pudBias = 0.13;
        #elif KIND == 2
          float wearN = texture2D(uNoise, wuv * 0.83).g * 0.55 + nFine * 0.45;
          if (wearN < 0.17 + 0.3 * vWear) discard;
          diffuseColor.rgb *= 0.7 + 0.4 * wearN;
          float wetDark = 0.74, snowAmt = 0.6, pudBias = 0.06;
        #else
          vec3 alb = diffuseColor.rgb * (0.7 + 0.6 * nMid) * (0.8 + 0.4 * nFine);
          alb = mix(alb, alb * vec3(1.25, 1.1, 0.7), smoothstep(0.55, 0.8, nA) * 0.5);
          diffuseColor.rgb = alb;
          float wetDark = 0.8, snowAmt = 1.0, pudBias = 9.0;
        #endif
        float pn = nMid * 0.55 + nA * 0.45;
        float pth = mix(1.0, 0.42, uPuddle) + pudBias;
        gPud = smoothstep(pth, pth + 0.09, pn) * gUp * step(0.001, uWet);
        float sn = nMid * 0.6 + nLow * 0.4;
        gSnow = smoothstep(0.62 - uSnow * snowAmt * 0.9, 0.86 - uSnow * snowAmt * 0.75, sn) * step(0.002, uSnow) * mix(0.25, 1.0, gUp);
        diffuseColor.rgb *= mix(1.0, wetDark, uWet);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.78, 0.84), gSnow);
      `,
      fragSurface: /* glsl */ `
        #if KIND == 0
          roughnessFactor = mix(0.93, 0.36, uWet);
        #elif KIND == 1
          roughnessFactor = mix(0.9, 0.5, uWet);
        #elif KIND == 2
          roughnessFactor = mix(0.7, 0.3, uWet);
        #else
          roughnessFactor = 0.95;
        #endif
        roughnessFactor = mix(roughnessFactor, 0.05, gPud * uWet);
        roughnessFactor = mix(roughnessFactor, 0.88, gSnow);
      `,
      fragNormal: /* glsl */ `
        {
          vec3 n1 = texture2D(uNormalNoise, wuv * 0.55).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormalNoise, wuv * 2.3).xyz * 2.0 - 1.0;
          gNn = vec3(n1.xy * 0.6 + n2.xy * 0.4, 1.0);
          gRip = vec2(0.0);
          if (uRain > 0.01 && uWet > 0.2) gRip = rainRipples(wuv, uTime) * uRain * (0.2 + 0.8 * gPud);
          #if KIND == 3
            float str = 0.9;
          #else
            float str = mix(0.5, 0.26, uWet) * (1.0 - gPud * uWet) * (1.0 - 0.6 * gSnow);
          #endif
          if (gUp > 0.5) {
            vec3 wn = normalize(vec3(gNn.x * str + gRip.x * 0.3, 1.0, gNn.y * str + gRip.y * 0.3));
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          }
        }
      `,
      fragFinal: /* glsl */ `
        #ifdef USE_REFLECT
        if (uReflectOn > 0.001 && gUp > 0.5) {
          vec3 Vw = normalize(cameraPosition - vWPos);
          float fres = 0.03 + 0.97 * pow(1.0 - clamp(Vw.y, 0.0, 1.0), 5.0);
          vec4 rc = uReflectMatrix * vec4(vWPos.x, 0.0, vWPos.z, 1.0);
          vec2 ruv = rc.xy / rc.w;
          float sharp = gPud;
          vec2 dist = gNn.xy * mix(0.045, 0.003, sharp) + gRip * 0.03;
          float streak = mix(0.12, 0.012, sharp);
          float lod = mix(1.9, 0.0, sharp);
          float jit = hash21(gl_FragCoord.xy + fract(uTime) * 61.0);
          vec3 acc = vec3(0.0);
          float ws = 0.0;
          for (int i = 0; i < REFLECT_TAPS; i++) {
            float f = (float(i) + jit) / float(REFLECT_TAPS) - 0.5;
            float w = 1.0 - abs(f) * 1.5;
            vec2 uv = clamp(ruv + dist + vec2(0.0, f * streak), 0.002, 0.998);
            acc += texture2D(uReflect, uv, lod).rgb * w;
            ws += w;
          }
          vec3 refl = acc / ws;
          #if KIND == 0
            float base = 0.5;
          #else
            float base = 0.3;
          #endif
          float amt = uReflectOn * uWet * mix(base, 1.0, sharp) * fres * (1.0 - gSnow);
          outgoingLight = outgoingLight * (1.0 - amt * 0.9) + refl * amt;
        }
        #endif
      `,
    },
    {
      uNoise: env.uNoise, uNormalNoise: env.uNormalNoise, uReflect: env.uReflect, uReflectMatrix: env.uReflectMatrix,
      uWet: env.uWet, uPuddle: env.uPuddle, uSnow: env.uSnow, uRain: env.uRain, uTime: env.uTime, uReflectOn: env.uReflectOn,
    },
    defines,
  );
  return mat;
}

/** Points around a rounded rectangle, counter-clockwise on a north-up map, so a fan from the centre faces up. */
function roundedRing(x0, z0, x1, z1, r, inset = 0, segs = 5) {
  const rr = Math.max(0.01, r - inset);
  const a = x0 + inset, b = x1 - inset, c = z0 + inset, d = z1 - inset;
  const corners = [
    [b - rr, d - rr, Math.PI / 2], // SE
    [b - rr, c + rr, 0], // NE
    [a + rr, c + rr, -Math.PI / 2], // NW
    [a + rr, d - rr, -Math.PI], // SW
  ];
  const pts = [];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= segs; i++) {
      const ang = a0 - (i / segs) * (Math.PI / 2);
      pts.push([cx + Math.cos(ang) * rr, cz + Math.sin(ang) * rr]);
    }
  }
  return pts;
}

/** A raised slab with a kerbstone edge. `top` colours the middle. */
function addSlab(gb, x0, z0, x1, z1, r, h, top, kerb = CURB_COL, kerbW = 0.32) {
  const outer = roundedRing(x0, z0, x1, z1, r, 0);
  const inner = roundedRing(x0, z0, x1, z1, r, kerbW);
  const n = outer.length;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // top: centre fan
  const c = gb.vert(cx, h, cz, 0, 1, 0, { color: top });
  const innerIdx = inner.map(([x, z]) => gb.vert(x, h, z, 0, 1, 0, { color: top }));
  for (let i = 0; i < n; i++) gb.tri(c, innerIdx[i], innerIdx[(i + 1) % n]);
  // kerbstone ring
  const k0 = inner.map(([x, z]) => gb.vert(x, h, z, 0, 1, 0, { color: kerb }));
  const k1 = outer.map(([x, z]) => gb.vert(x, h, z, 0, 1, 0, { color: kerb }));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    gb.quadIdx(k0[i], k1[i], k1[j], k0[j]);
  }
  // kerb face
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, az] = outer[i], [bx, bz] = outer[j];
    const dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    const v0 = gb.vert(ax, 0, az, nx, 0, nz, { color: kerb });
    const v1 = gb.vert(bx, 0, bz, nx, 0, nz, { color: kerb });
    const v2 = gb.vert(bx, h, bz, nx, 0, nz, { color: kerb });
    const v3 = gb.vert(ax, h, az, nx, 0, nz, { color: kerb });
    gb.quadIdx(v0, v1, v2, v3);
  }
}

export class Ground {
  constructor(city, quality) {
    this.city = city;
    this.group = new THREE.Group();
    const reflect = quality.reflect;
    this.materials = [];

    // ---- asphalt
    const FAR = 2800;
    const gx0 = city.shoreX, gx1 = FAR, gz0 = -FAR, gz1 = FAR;
    const plane = new THREE.PlaneGeometry(gx1 - gx0, gz1 - gz0, 48, 64);
    plane.rotateX(-Math.PI / 2);
    plane.translate((gx0 + gx1) / 2, 0, 0);
    this.asphaltMat = makeGroundMaterial(0, { reflect, taps: quality.reflectTaps });
    this.asphalt = new THREE.Mesh(plane, this.asphaltMat);
    this.asphalt.receiveShadow = true;

    // ---- pavements, kerbs, the promenade and the median
    const gb = new GeoBuilder({ color: 3 });
    const walk = (seed) => {
      const t = 0.36 + ((seed % 7) / 7) * 0.08;
      return [t, t * 0.985, t * 0.95];
    };
    for (const b of city.blocks) addSlab(gb, b.x0, b.z0, b.x1, b.z1, CORNER_R, CURB_H, walk(b.seed));
    for (const s of city.strips) addSlab(gb, s.x0, s.z0, s.x1, s.z1, 0.02, CURB_H, walk(3));
    const p = city.promenade;
    addSlab(gb, p.x0, p.z0, p.x1, p.z1, 0.02, CURB_H, [0.46, 0.44, 0.41]);
    this.medians = [];
    for (const road of city.vRoads) {
      if (!road.median) continue;
      for (let j = 0; j < city.NZ; j++) {
        const a = city.nodes[road.index][j], b2 = city.nodes[road.index][j + 1];
        const z0 = a.z + city.stopDist(a, 2) + 2.2, z1 = b2.z - city.stopDist(b2, 0) - 2.2;
        const hw = road.median / 2 - 0.3;
        addSlab(gb, road.pos - hw, z0, road.pos + hw, z1, hw - 0.02, CURB_H + 0.03, [0.2, 0.17, 0.12], CURB_COL, 0.28);
        this.medians.push({ x: road.pos, z0, z1 });
      }
    }
    this.walkMat = makeGroundMaterial(1, { reflect, taps: Math.max(4, quality.reflectTaps - 2) });
    this.walks = new THREE.Mesh(gb.build(), this.walkMat);
    this.walks.receiveShadow = true;
    this.walks.castShadow = false;

    // ---- park lawn
    const lg = new GeoBuilder({ color: 3 });
    this.parks = city.blocks.filter((b) => b.kind === 'park');
    for (const b of this.parks) {
      const ins = SIDEWALK_W;
      const ring = roundedRing(b.x0 + ins, b.z0 + ins, b.x1 - ins, b.z1 - ins, 2.5, 0, 4);
      const col = [0.1, 0.19, 0.06];
      const c = lg.vert((b.x0 + b.x1) / 2, CURB_H + 0.04, (b.z0 + b.z1) / 2, 0, 1, 0, { color: col });
      const idx = ring.map(([x, z]) => lg.vert(x, CURB_H + 0.04, z, 0, 1, 0, { color: col }));
      for (let i = 0; i < idx.length; i++) lg.tri(c, idx[i], idx[(i + 1) % idx.length]);
    }
    this.lawnMat = makeGroundMaterial(3, { reflect: false });
    this.lawn = new THREE.Mesh(lg.build(), this.lawnMat);
    this.lawn.receiveShadow = true;

    // ---- paint
    this.paintMat = makeGroundMaterial(2, { reflect, taps: Math.max(4, quality.reflectTaps - 2) });
    this.paint = new THREE.Mesh(this._buildPaint(), this.paintMat);
    this.paint.receiveShadow = true;

    for (const m of [this.asphalt, this.walks, this.paint]) m.layers.set(LAYER.WET);
    this.lawn.layers.set(LAYER.WET);
    this.group.add(this.asphalt, this.walks, this.lawn, this.paint);
    this.materials.push(this.asphaltMat, this.walkMat, this.paintMat);
  }

  _buildPaint() {
    const city = this.city;
    const gb = new GeoBuilder({ color: 3, wear: 1 });
    const Y = 0.014;
    const rect = (x0, z0, x1, z1, col, wear = 0.3) => {
      const a = gb.vert(Math.min(x0, x1), Y, Math.min(z0, z1), 0, 1, 0, { color: col, wear });
      const b = gb.vert(Math.min(x0, x1), Y, Math.max(z0, z1), 0, 1, 0, { color: col, wear });
      const c = gb.vert(Math.max(x0, x1), Y, Math.max(z0, z1), 0, 1, 0, { color: col, wear });
      const d = gb.vert(Math.max(x0, x1), Y, Math.min(z0, z1), 0, 1, 0, { color: col, wear });
      gb.quadIdx(a, b, c, d);
    };

    const segment = (road, A, B) => {
      const vert = road.axis === 'v';
      const L = vert ? B.z - A.z : B.x - A.x;
      // (u along the road from A, w across it) -> a world rectangle
      const R = (u0, w0, u1, w1, col, wear) => {
        if (vert) rect(road.pos + w0, A.z + u0, road.pos + w1, A.z + u1, col, wear);
        else rect(A.x + u0, road.pos + w0, A.x + u1, road.pos + w1, col, wear);
      };
      const sign = vert ? -1 : 1; // which side of the centre line traffic heading +u keeps to
      const legA = vert ? 2 : 1, legB = vert ? 0 : 3;
      const sdA = city.stopDist(A, legA), sdB = city.stopDist(B, legB);
      const hw = road.hw, med = road.median / 2;
      const u0 = A.free ? city.crossHalf(A, legA) : sdA + 0.45;
      const u1 = B.free ? L - city.crossHalf(B, legB) : L - sdB - 0.45;
      const wear = 0.2 + ((road.index * 37 + A.id) % 10) / 14;

      // centre
      if (med === 0) {
        R(u0, -0.2, u1, -0.08, YELLOW, wear);
        R(u0, 0.08, u1, 0.2, YELLOW, wear);
      } else {
        R(u0, -med + 0.02, u1, -med + 0.14, YELLOW, wear);
        R(u0, med - 0.14, u1, med - 0.02, YELLOW, wear);
      }
      // lane lines
      if (road.lanes === 2) {
        for (const s of [-1, 1]) {
          const w = s * (med + LANE_W);
          const towardB = s === sign;
          const dashFrom = towardB ? u0 + 2 : u0 + 20, dashTo = towardB ? u1 - 20 : u1 - 2;
          for (let u = dashFrom; u + 3 < dashTo; u += 9) R(u, w - 0.06, u + 3, w + 0.06, WHITE, wear);
          if (towardB) R(u1 - 20, w - 0.06, u1, w + 0.06, WHITE, wear);
          else R(u0, w - 0.06, u0 + 20, w + 0.06, WHITE, wear);
        }
      }
      // parking lane edge
      const pe = med + road.lanes * LANE_W;
      for (const s of [-1, 1]) R(u0 + 7, s * pe - 0.05, u1 - 7, s * pe + 0.05, WHITE, wear + 0.25);
      // stop bars and crosswalks
      if (!A.free) {
        R(sdA, -sign * med, sdA + 0.45, -sign * hw, WHITE, 0.15);
        const c0 = city.crossHalf(A, legA) + XW_SETBACK;
        for (let w = -hw + 0.45; w < hw - 0.5; w += 1.15) R(c0, w, c0 + XW_LEN, w + 0.55, WHITE, 0.2);
      }
      if (!B.free) {
        R(L - sdB - 0.45, sign * med, L - sdB, sign * hw, WHITE, 0.15);
        const c0 = L - city.crossHalf(B, legB) - XW_SETBACK;
        for (let w = -hw + 0.45; w < hw - 0.5; w += 1.15) R(c0 - XW_LEN, w, c0, w + 0.55, WHITE, 0.2);
      }
    };

    for (const road of city.vRoads) for (let j = 0; j < city.NZ; j++) segment(road, city.nodes[road.index][j], city.nodes[road.index][j + 1]);
    for (const road of city.hRoads) for (let i = 0; i < city.NX; i++) segment(road, city.nodes[i][road.index], city.nodes[i + 1][road.index]);

    // pick-up zones and parking bays, along each kerbside lane
    for (const lane of city.lanes) {
      if (lane.k !== 0) continue;
      const at = (s, lat) => [lane.ax + lane.tx * s + lane.rx * lat, lane.az + lane.tz * s + lane.rz * lat];
      const inner = LANE_W / 2 + 0.12, outer = LANE_W / 2 + PARK_W - 0.22;
      const R2 = (s0, l0, s1, l1, col, wear) => {
        const [xa, za] = at(s0, l0), [xb, zb] = at(s1, l1);
        rect(xa, za, xb, zb, col, wear);
      };
      for (const zn of lane.zones) {
        const s0 = zn.s - ZONE_HALF + 1.4, s1 = zn.s + ZONE_HALF - 1.4;
        R2(s0, inner, s1, inner + 0.12, WHITE, 0.1);
        R2(s0, outer - 0.12, s1, outer, WHITE, 0.1);
        R2(s0, inner, s0 + 0.12, outer, WHITE, 0.1);
        R2(s1 - 0.12, inner, s1, outer, WHITE, 0.1);
        // chevron bars at both ends
        for (let k = 0; k < 3; k++) {
          R2(s0 + 0.5 + k * 0.55, inner + 0.3, s0 + 0.7 + k * 0.55, outer - 0.3, WHITE, 0.25);
          R2(s1 - 0.7 - k * 0.55, inner + 0.3, s1 - 0.5 - k * 0.55, outer - 0.3, WHITE, 0.25);
        }
      }
      const slots = city.slots(lane);
      const ticks = new Set();
      for (const sl of slots) {
        ticks.add(Math.round((sl.s - 3.15) * 10));
        ticks.add(Math.round((sl.s + 3.15) * 10));
      }
      for (const t of ticks) R2(t / 10 - 0.05, inner - 0.1, t / 10 + 0.05, inner + 1.1, WHITE, 0.5);
    }
    return gb.build();
  }

  setWetness(reflectOn) {
    const k = 1 - 0.85 * reflectOn * env.uWet.value;
    for (const m of this.materials) m.envMapIntensity = k;
  }
}

export { roundedRing, STRIP_D };
