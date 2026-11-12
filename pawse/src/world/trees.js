import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, randRange, scatter, smoothstep, lerp, TAU, pick } from '../core/utils.js';
import { shared, GLSL_WIND, GLSL_WIND_UNIFORMS } from './shared.js';
import { WORLD, pondNorm, pondShorePoint } from './terrain.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------ leaf textures

/** A clump of leaves (or blossoms / needles) on a transparent card. */
function makeLeafTexture(kind, seed) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rnd = mulberry32(seed);
  const grey = (lo, hi) => {
    const l = Math.round(randRange(rnd, lo, hi));
    return `rgb(${l},${l},${l})`;
  };
  if (kind === 'leaf') {
    for (let i = 0; i < 19; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * S * 0.32;
      const L = S * randRange(rnd, 0.17, 0.25), W = L * randRange(rnd, 0.4, 0.52);
      g.save();
      g.translate(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d);
      g.rotate(a + randRange(rnd, -0.9, 0.9));
      g.fillStyle = grey(180, 255);
      g.beginPath();
      g.moveTo(-L / 2, 0);
      g.quadraticCurveTo(0, -W, L / 2, 0);
      g.quadraticCurveTo(0, W, -L / 2, 0);
      g.fill();
      g.restore();
    }
  } else if (kind === 'blossom') {
    for (let i = 0; i < 30; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * S * 0.36;
      const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
      const pr = S * randRange(rnd, 0.024, 0.034);
      const rot = rnd() * TAU;
      g.fillStyle = grey(222, 255);
      for (let k = 0; k < 5; k++) {
        const pa = rot + (k / 5) * TAU;
        g.beginPath();
        g.arc(x + Math.cos(pa) * pr * 0.95, y + Math.sin(pa) * pr * 0.95, pr, 0, TAU);
        g.fill();
      }
      g.fillStyle = 'rgb(205,190,190)';
      g.beginPath();
      g.arc(x, y, pr * 0.42, 0, TAU);
      g.fill();
    }
  } else {
    // needles: several fans of thin strokes
    g.lineCap = 'round';
    for (let c = 0; c < 9; c++) {
      const ca = rnd() * TAU, cd = Math.sqrt(rnd()) * S * 0.24;
      const cx = S / 2 + Math.cos(ca) * cd, cy = S / 2 + Math.sin(ca) * cd;
      const dir = ca + randRange(rnd, -0.6, 0.6);
      for (let i = 0; i < 12; i++) {
        const a = dir + randRange(rnd, -1.15, 1.15);
        const len = S * randRange(rnd, 0.12, 0.2);
        g.strokeStyle = grey(165, 255);
        g.lineWidth = S * 0.02;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        g.stroke();
      }
    }
  }
  const img = g.getImageData(0, 0, S, S);
  const d = new Uint8Array(img.data.buffer.slice(0));
  // give fully transparent texels a leaf-like colour so mipmaps don't fringe dark
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) d[i] = d[i + 1] = d[i + 2] = 215;
  }
  const tex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------- foliage material

/**
 * Leaf cards are camera-facing quads that share one centre vertex position and
 * are expanded in view space, but are lit with the normal of the crown they
 * belong to. That gives soft, painterly volumes instead of flat cards. In the
 * shadow pass the same quads face the light, so they cast leafy shadows.
 */
export function makeFoliageMaterial(tex) {
  const patch = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWindDir = shared.uWindDir;
    shader.uniforms.uWindStr = shared.uWindStr;
    shader.uniforms.uNoise = shared.uNoise;
    shader.uniforms.uSunDir = shared.uSunDir;
    shader.uniforms.uBacklight = shared.uBacklight;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aCorner;
        attribute float aRot;
        uniform vec3 uSunDir;
        uniform float uBacklight;
        ${GLSL_WIND_UNIFORMS}
        ${GLSL_WIND}`
      )
      .replace(
        '#include <project_vertex>',
        `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          float fScale = length(instanceMatrix[0].xyz);
        #else
          float fScale = 1.0;
        #endif
        vec4 fWorld = modelMatrix * mvPosition;
        float fG = gustAt(fWorld.xz);
        float fPh = fWorld.x * 0.35 + fWorld.z * 0.27 + fWorld.y * 0.5;
        float fHigh = smoothstep(0.3, 5.0, transformed.y);
        vec3 fSway = vec3(uWindDir.x, 0.0, uWindDir.y) * (0.04 + fG * 0.26) * uWindStr * (0.6 + 0.4 * sin(uTime * 1.3 + fPh));
        fSway.y += sin(uTime * 2.1 + fPh * 1.7) * 0.035 * (0.5 + fG);
        fWorld.xyz += fSway * fHigh * fScale;
        #ifdef USE_COLOR
          vec3 fV = normalize(cameraPosition - fWorld.xyz);
          float fBack = pow(max(dot(-fV, uSunDir), 0.0), 3.0);
          vColor.rgb *= 1.0 + fBack * uBacklight * 0.75;
          // leaves are thin: the side facing away from the sun still glows a little
          vec3 fNw = inverseTransformDirection(transformedNormal, viewMatrix);
          vColor.rgb *= 1.0 + max(dot(-fNw, uSunDir), 0.0) * 1.15;
        #endif
        mvPosition = viewMatrix * fWorld;
        float fR = aRot + sin(uTime * 1.7 + fPh * 2.0) * 0.13 * (0.4 + fG);
        vec2 fC = vec2(aCorner.x * cos(fR) - aCorner.y * sin(fR), aCorner.x * sin(fR) + aCorner.y * cos(fR));
        mvPosition.xy += fC * fScale;
        gl_Position = projectionMatrix * mvPosition;
        `
      );
  };
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.4, vertexColors: true, alphaToCoverage: true });
  mat.shadowSide = THREE.DoubleSide;
  mat.onBeforeCompile = patch;
  mat.customProgramCacheKey = () => 'foliage';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = patch;
  depth.customProgramCacheKey = () => 'foliage-depth';
  return { mat, depth };
}

// ------------------------------------------------------------ tree builders

function limb(p0, p1, r0, r1, radial = 7) {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(p0.x, p0.y, p0.z);
  return g;
}

function paint(geo, hex, fn) {
  const c = new THREE.Color(hex);
  const p = geo.attributes.position;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = fn ? fn(p.getX(i), p.getY(i), p.getZ(i)) : 1;
    arr[i * 3] = c.r * k;
    arr[i * 3 + 1] = c.g * k;
    arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

class LeafBuilder {
  constructor(shadeMin = 0.46) {
    this.shadeMin = shadeMin;
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
    this.corner = [];
    this.rot = [];
    this.idx = [];
    this.n = 0;
  }

  quad(p, n, size, shade, rnd) {
    const r = rnd() * TAU;
    const j1 = 1 + (rnd() - 0.5) * 0.14, j2 = 1 + (rnd() - 0.5) * 0.14;
    for (let k = 0; k < 4; k++) {
      const cx = k === 1 || k === 2 ? 1 : -1, cy = k >= 2 ? 1 : -1;
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(shade * j1, shade, shade * j2);
      this.corner.push(cx * size, cy * size);
      this.uv.push((cx + 1) / 2, (cy + 1) / 2);
      this.rot.push(r);
    }
    const b = this.n * 4;
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n++;
  }

  /** An ellipsoidal puff of leaf cards. */
  blob(center, radii, count, size, crownCenter, crownH, rnd) {
    const p = new THREE.Vector3(), n = new THREE.Vector3(), d = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1, a = rnd() * TAU, s = Math.sqrt(1 - u * u);
      d.set(Math.cos(a) * s, u, Math.sin(a) * s);
      if (d.y < -0.25 && rnd() < 0.7) d.y = -d.y; // few leaves underneath
      const k = 0.7 + 0.36 * rnd();
      p.set(center.x + d.x * radii.x * k, center.y + d.y * radii.y * k, center.z + d.z * radii.z * k);
      o.subVectors(p, crownCenter).normalize();
      n.copy(o).multiplyScalar(0.6).addScaledVector(d, 0.4);
      n.y += 0.28;
      n.normalize();
      const relY = (p.y - crownCenter.y) / crownH;
      const shade = lerp(this.shadeMin, 1.0, smoothstep(-0.9, 0.75, relY)) * randRange(rnd, 0.86, 1.1);
      this.quad(p, n, size * randRange(rnd, 0.75, 1.3), shade, rnd);
    }
  }

  /** One drooping tier of a conifer. */
  cone(baseY, topY, baseR, topR, count, size, rnd) {
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const t = Math.pow(rnd(), 0.8), a = rnd() * TAU;
      const r = lerp(baseR, topR, t) * (0.72 + 0.34 * rnd());
      p.set(Math.cos(a) * r, lerp(baseY, topY, t), Math.sin(a) * r);
      n.set(Math.cos(a), 0.55, Math.sin(a)).normalize();
      const shade = lerp(0.5, 1.0, t) * randRange(rnd, 0.84, 1.1) * lerp(0.75, 1, r / Math.max(baseR, 0.01));
      this.quad(p, n, size * randRange(rnd, 0.75, 1.25), shade, rnd);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute(this.corner, 2));
    g.setAttribute('aRot', new THREE.Float32BufferAttribute(this.rot, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const jitter = (rnd, a) => randRange(rnd, -a, a);

function makeOak(rnd) {
  const limbs = [];
  const lb = new LeafBuilder();
  const H = randRange(rnd, 2.9, 3.6);
  const lean = V(jitter(rnd, 0.3), 0, jitter(rnd, 0.3));
  const p0 = V(0, -0.6, 0), p1 = V(lean.x * 0.5, H * 0.55, lean.z * 0.5), p2 = V(lean.x, H, lean.z);
  limbs.push(limb(p0, p1, 0.44, 0.28, 9), limb(p1, p2, 0.28, 0.22, 8));
  const top = p2.clone().add(V(jitter(rnd, 0.3), randRange(rnd, 2.2, 2.8), jitter(rnd, 0.3)));
  limbs.push(limb(p2, top, 0.21, 0.07, 6));
  const crownC = p2.clone().add(V(0, 1.5, 0));
  const crownH = 3.3;
  lb.blob(top, V(2.3, 1.8, 2.3), 150, 0.62, crownC, crownH, rnd);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + jitter(rnd, 0.3);
    const reach = randRange(rnd, 1.9, 2.6), rise = randRange(rnd, 0.6, 1.6);
    const end = p2.clone().add(V(Math.cos(a) * reach, rise, Math.sin(a) * reach));
    const mid = p2.clone().lerp(end, 0.5).add(V(0, 0.28, 0));
    limbs.push(limb(p2, mid, 0.17, 0.11, 6), limb(mid, end, 0.11, 0.05, 5));
    const s = randRange(rnd, 0.85, 1.12);
    lb.blob(end, V(1.75 * s, 1.35 * s, 1.75 * s), 86, 0.56, crownC, crownH, rnd);
  }
  const trunk = paint(mergeGeometries(limbs), '#6e4b33', (x, y) => lerp(0.7, 1.05, smoothstep(-0.5, 3, y)));
  return { trunk, leaves: lb.build(), trunkR: 0.42, crownR: 4.2, height: top.y + 1.8 };
}

function makeRound(rnd) {
  const limbs = [];
  const lb = new LeafBuilder();
  const H = randRange(rnd, 2.4, 3.0);
  const p0 = V(0, -0.5, 0), p2 = V(jitter(rnd, 0.2), H, jitter(rnd, 0.2));
  const top = p2.clone().add(V(0, 2.6, 0));
  limbs.push(limb(p0, p2, 0.3, 0.19, 8), limb(p2, top, 0.19, 0.06, 6));
  const crownC = p2.clone().add(V(0, 1.7, 0));
  lb.blob(crownC, V(2.0, 2.5, 2.0), 210, 0.58, crownC, 2.6, rnd);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + jitter(rnd, 0.5);
    const c = crownC.clone().add(V(Math.cos(a) * 1.3, jitter(rnd, 0.9), Math.sin(a) * 1.3));
    limbs.push(limb(p2, c, 0.1, 0.04, 5));
    lb.blob(c, V(1.15, 1.15, 1.15), 46, 0.5, crownC, 2.6, rnd);
  }
  const trunk = paint(mergeGeometries(limbs), '#7a5a3e', (x, y) => lerp(0.72, 1.05, smoothstep(-0.5, 3, y)));
  return { trunk, leaves: lb.build(), trunkR: 0.3, crownR: 2.7, height: top.y + 1.4 };
}

function makeBirch(rnd) {
  const limbs = [];
  const lb = new LeafBuilder();
  const H = randRange(rnd, 5.4, 6.6);
  const sway = V(jitter(rnd, 0.5), 0, jitter(rnd, 0.5));
  const pts = [V(0, -0.5, 0)];
  for (let i = 1; i <= 4; i++) pts.push(V(sway.x * (i / 4) ** 2, (H * i) / 4, sway.z * (i / 4) ** 2));
  for (let i = 0; i < 4; i++) limbs.push(limb(pts[i], pts[i + 1], lerp(0.16, 0.05, i / 4), lerp(0.16, 0.05, (i + 1) / 4), 7));
  const crownC = V(sway.x * 0.6, H * 0.72, sway.z * 0.6);
  for (let i = 0; i < 6; i++) {
    const t = 0.48 + (i / 5) * 0.52;
    const a = i * 2.4 + jitter(rnd, 0.4);
    const reach = lerp(1.25, 0.25, (i / 5) ** 1.5);
    const base = V(sway.x * t * t, H * t, sway.z * t * t);
    const c = base.clone().add(V(Math.cos(a) * reach, randRange(rnd, 0.1, 0.5), Math.sin(a) * reach));
    limbs.push(limb(base, c, 0.045, 0.02, 4));
    const s = lerp(1.15, 0.8, i / 5);
    lb.blob(c, V(1.0 * s, 0.95 * s, 1.0 * s), 44, 0.4, crownC, H * 0.36, rnd);
  }
  const trunk = paint(mergeGeometries(limbs), '#ece7dc', (x, y, z) => {
    const fleck = Math.sin(y * 7.3 + x * 31 + z * 17) * Math.sin(y * 2.9 + 1.3);
    return fleck > 0.62 ? 0.28 : lerp(0.85, 1.0, smoothstep(0, 2, y));
  });
  return { trunk, leaves: lb.build(), trunkR: 0.2, crownR: 1.9, height: H + 1.0 };
}

function makeSakura(rnd) {
  const limbs = [];
  const lb = new LeafBuilder(0.76);
  const H = randRange(rnd, 1.7, 2.2);
  const lean = V(jitter(rnd, 0.35), 0, jitter(rnd, 0.35));
  const p0 = V(0, -0.5, 0), p2 = V(lean.x, H, lean.z);
  limbs.push(limb(p0, p2, 0.34, 0.22, 8));
  const crownC = p2.clone().add(V(0, 1.6, 0));
  const crownH = 2.4;
  const top = p2.clone().add(V(jitter(rnd, 0.3), 2.1, jitter(rnd, 0.3)));
  limbs.push(limb(p2, top, 0.16, 0.05, 6));
  lb.blob(top, V(2.0, 1.3, 2.0), 110, 0.52, crownC, crownH, rnd);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + jitter(rnd, 0.35);
    const reach = randRange(rnd, 2.2, 3.1), rise = randRange(rnd, 0.9, 1.7);
    const end = p2.clone().add(V(Math.cos(a) * reach, rise, Math.sin(a) * reach));
    const mid = p2.clone().lerp(end, 0.55).add(V(0, 0.45, 0));
    limbs.push(limb(p2, mid, 0.15, 0.09, 6), limb(mid, end, 0.09, 0.04, 5));
    lb.blob(end, V(1.8, 1.05, 1.8), 84, 0.5, crownC, crownH, rnd);
    lb.blob(mid.clone().add(V(0, 0.5, 0)), V(1.2, 0.8, 1.2), 34, 0.46, crownC, crownH, rnd);
  }
  const trunk = paint(mergeGeometries(limbs), '#4d3631', (x, y) => lerp(0.75, 1.1, smoothstep(-0.5, 3, y)));
  return { trunk, leaves: lb.build(), trunkR: 0.34, crownR: 4.4, height: top.y + 1.3 };
}

function makePine(rnd) {
  const lb = new LeafBuilder();
  const H = randRange(rnd, 8.0, 10.5);
  const trunkG = limb(V(0, -0.5, 0), V(0, H, 0), 0.3, 0.04, 7);
  const tiers = 6;
  const bare = 1.5;
  for (let i = 0; i < tiers; i++) {
    const t0 = i / tiers, t1 = (i + 1.35) / tiers;
    const y0 = lerp(bare, H, t0), y1 = Math.min(lerp(bare, H, t1), H + 0.5);
    const r0 = lerp(2.5, 0.75, t0);
    lb.cone(y0, y1, r0, r0 * 0.2, Math.round(lerp(78, 30, t0)), lerp(0.62, 0.4, t0), rnd);
  }
  const trunk = paint(trunkG, '#5b3e2c', (x, y) => lerp(0.75, 1.0, smoothstep(0, 3, y)));
  return { trunk, leaves: lb.build(), trunkR: 0.3, crownR: 2.5, height: H + 0.5 };
}

function makeBush(rnd, flowering) {
  const lb = new LeafBuilder();
  const c = V(0, 0.5, 0);
  lb.blob(c, V(0.95, 0.62, 0.95), flowering ? 54 : 62, 0.3, V(0, 0.2, 0), 1.0, rnd);
  lb.blob(V(jitter(rnd, 0.5), 0.42, jitter(rnd, 0.5)), V(0.62, 0.48, 0.62), 26, 0.27, V(0, 0.2, 0), 1.0, rnd);
  return lb.build();
}

// ------------------------------------------------------------------ placement

const SPECIES = {
  oak: { make: makeOak, variants: 3, tex: 'leaf', colors: ['#4f8f2f', '#5a9a36', '#467f2c', '#679f3b'] },
  round: { make: makeRound, variants: 2, tex: 'leaf', colors: ['#74b043', '#86bd4b', '#6aa53e'] },
  birch: { make: makeBirch, variants: 2, tex: 'leaf', colors: ['#a9c85a', '#b9d268', '#9cbd52'] },
  sakura: { make: makeSakura, variants: 3, tex: 'blossom', colors: ['#ffc6da', '#ffd5e3', '#fbb5ce', '#ffe2ec'] },
  pine: { make: makePine, variants: 2, tex: 'needle', colors: ['#2f6b40', '#285d39', '#377247'] },
};

export class Trees {
  constructor(terrain) {
    this.group = new THREE.Group();
    this.group.name = 'trees';
    this.colliders = [];
    this.sakura = []; // {x, y, z, r} crowns that shed petals
    this.crowns = []; // every park tree crown, for birds to circle
    this.bushes = [];

    const rnd = mulberry32(4242);
    const tex = {
      leaf: makeLeafTexture('leaf', 1),
      blossom: makeLeafTexture('blossom', 2),
      needle: makeLeafTexture('needle', 3),
    };
    this.materials = {
      leaf: makeFoliageMaterial(tex.leaf),
      blossom: makeFoliageMaterial(tex.blossom),
      needle: makeFoliageMaterial(tex.needle),
      bushBloom: makeFoliageMaterial(tex.blossom),
    };
    // blossom is pale and airy: lift its shadows (scaled by daylight each frame)
    this.materials.blossom.mat.emissive = new THREE.Color('#ff9dbd');
    this.materials.blossom.mat.emissiveIntensity = 0.1;
    const bark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });

    const W = WORLD;
    const pathFree = (x, z, rad) => {
      for (let k = 0; k < 5; k++) {
        const ox = k === 0 ? 0 : Math.cos(k * 1.57) * rad, oz = k === 0 ? 0 : Math.sin(k * 1.57) * rad;
        const m = terrain.maskAt(x + ox, z + oz);
        if (m.path > 0.04 || m.paved > 0.04) return false;
      }
      return true;
    };
    const openAreas = [
      { x: W.lawn.x, z: W.lawn.z, r: W.lawn.r },
      { x: W.meadow.x, z: W.meadow.z, r: W.meadow.r - 3 },
      { x: W.plaza.x, z: W.plaza.z, r: W.plaza.r + 3.5 },
      { x: 2, z: 16, r: 7 }, // where the day begins
    ];
    const inOpen = (x, z) => openAreas.some((o) => Math.hypot(x - o.x, z - o.z) < o.r);

    const list = []; // {sp, x, z, s, park}
    const add = (sp, x, z, s, park = true) => list.push({ sp, x, z, s, park });

    // the old oak on the hill
    add('oak', W.hill.x - 1.6, W.hill.z - 1.2, 1.8);

    // cherry trees ring the pond, one on the island
    for (const deg of [18, 58, 96, 128, 202, 236, 272, 312, 346]) {
      const p = pondShorePoint((deg / 180) * Math.PI, randRange(rnd, 1.24, 1.48));
      if (pathFree(p.x, p.z, 1.5)) add('sakura', p.x, p.z, randRange(rnd, 0.95, 1.25));
    }
    add('sakura', W.island.x + 0.2, W.island.z - 0.1, 0.9);
    add('sakura', -9.5, 9.5, 1.05);
    add('sakura', 10.5, -9, 1.0);

    // linden trees at the plaza
    for (const [x, z] of [[-10, -9.5], [9.5, 10.5]]) add('round', x, z, 1.15);

    // birch grove in the north-west
    scatter(rnd, 11, 300, (r) => {
      const a = r() * TAU, d = Math.sqrt(r()) * 15;
      return { x: -37 + Math.cos(a) * d, z: -30 + Math.sin(a) * d };
    }, 4.2, (p) => pathFree(p.x, p.z, 1.2)).forEach((p) => add('birch', p.x, p.z, randRange(rnd, 0.9, 1.25)));

    // scattered oaks and lindens
    const taken = () => list.map((t) => ({ x: t.x, z: t.z }));
    const far = (p, d) => taken().every((q) => Math.hypot(p.x - q.x, p.z - q.z) > d);
    scatter(rnd, 26, 4000, (r) => {
      const a = r() * TAU, d = Math.sqrt(r()) * (W.parkRadius - 6);
      return { x: Math.cos(a) * d, z: Math.sin(a) * d };
    }, 10.5, (p) =>
      !inOpen(p.x, p.z) && pondNorm(p.x, p.z) > 1.55 && pathFree(p.x, p.z, 2.2) && far(p, 8) &&
      Math.hypot(p.x - W.hill.x, p.z - W.hill.z) > 9
    ).forEach((p) => add(rnd() < 0.62 ? 'oak' : 'round', p.x, p.z, randRange(rnd, 0.9, 1.3)));

    // a few pines inside the park, toward the north-east
    scatter(rnd, 7, 600, (r) => {
      const a = r() * TAU, d = Math.sqrt(r()) * 16;
      return { x: 46 + Math.cos(a) * d, z: 34 + Math.sin(a) * d };
    }, 5.5, (p) => pathFree(p.x, p.z, 1.5) && far(p, 6) && Math.hypot(p.x, p.z) < W.parkRadius - 3)
      .forEach((p) => add('pine', p.x, p.z, randRange(rnd, 0.85, 1.15)));

    // the woods around the park
    scatter(rnd, 300, 9000, (r) => {
      const a = r() * TAU, d = lerp(W.parkRadius + 3.5, W.parkRadius + 46, Math.pow(r(), 0.8));
      return { x: Math.cos(a) * d, z: Math.sin(a) * d };
    }, (p) => lerp(4.6, 7.5, smoothstep(W.parkRadius, W.parkRadius + 46, Math.hypot(p.x, p.z))))
      .forEach((p) => {
        const k = rnd();
        add(k < 0.45 ? 'pine' : k < 0.8 ? 'oak' : k < 0.93 ? 'round' : 'birch', p.x, p.z, randRange(rnd, 0.95, 1.6), false);
      });

    // build variants and instance them
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (const [name, sp] of Object.entries(SPECIES)) {
      const variants = Array.from({ length: sp.variants }, () => sp.make(rnd));
      for (const park of [true, false]) {
        const mine = list.filter((t) => t.sp === name && t.park === park);
        if (!mine.length) continue;
        const byVariant = variants.map(() => []);
        mine.forEach((t, i) => byVariant[i % sp.variants].push(t));
        byVariant.forEach((items, vi) => {
          if (!items.length) return;
          const v = variants[vi];
          const { mat, depth } = this.materials[sp.tex];
          const trunks = new THREE.InstancedMesh(v.trunk, bark, items.length);
          const leaves = new THREE.InstancedMesh(v.leaves, mat, items.length);
          leaves.customDepthMaterial = depth;
          items.forEach((t, i) => {
            const y = terrain.heightAt(t.x, t.z);
            dummy.position.set(t.x, y, t.z);
            dummy.rotation.set(0, rnd() * TAU, 0);
            dummy.scale.setScalar(t.s);
            dummy.updateMatrix();
            trunks.setMatrixAt(i, dummy.matrix);
            leaves.setMatrixAt(i, dummy.matrix);
            color.set(pick(rnd, sp.colors)).offsetHSL(jitter(rnd, 0.012), jitter(rnd, 0.05), jitter(rnd, 0.035));
            leaves.setColorAt(i, color);
            if (park) {
              this.colliders.push({ x: t.x, z: t.z, r: v.trunkR * t.s + 0.12 });
              const crown = { x: t.x, y: y + v.height * t.s * 0.7, z: t.z, r: v.crownR * t.s, h: v.height * t.s, sp: name };
              this.crowns.push(crown);
              if (name === 'sakura') this.sakura.push(crown);
            }
          });
          trunks.castShadow = park;
          trunks.receiveShadow = true;
          leaves.castShadow = park;
          leaves.receiveShadow = true;
          trunks.instanceMatrix.needsUpdate = true;
          leaves.instanceMatrix.needsUpdate = true;
          leaves.instanceColor.needsUpdate = true;
          trunks.computeBoundingSphere();
          leaves.computeBoundingSphere();
          this.group.add(trunks, leaves);
        });
      }
    }

    this._buildBushes(terrain, rnd, pathFree, inOpen);
  }

  _buildBushes(terrain, rnd, pathFree, inOpen) {
    const W = WORLD;
    const green = [];
    const bloom = [];
    // hedge-like ring just inside the fence line
    for (let i = 0; i < 150; i++) {
      const a = (i / 150) * TAU + jitter(rnd, 0.012);
      const d = W.parkRadius + randRange(rnd, -0.6, 2.6);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!pathFree(x, z, 0.8)) continue;
      (rnd() < 0.16 ? bloom : green).push({ x, z, s: randRange(rnd, 1.0, 1.9) });
    }
    // formal ring around the plaza, leaving gaps for the paths
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU;
      const x = W.plaza.x + Math.cos(a) * (W.plaza.r + 1.6), z = W.plaza.z + Math.sin(a) * (W.plaza.r + 1.6);
      if (!pathFree(x, z, 1.3)) continue;
      (i % 2 ? bloom : green).push({ x, z, s: 0.95 });
    }
    // loose shrubs through the park
    scatter(rnd, 46, 2500, (r) => {
      const a = r() * TAU, d = Math.sqrt(r()) * (W.parkRadius - 5);
      return { x: Math.cos(a) * d, z: Math.sin(a) * d };
    }, 5, (p) => !inOpen(p.x, p.z) && pondNorm(p.x, p.z) > 1.3 && pathFree(p.x, p.z, 1.2) &&
      this.colliders.every((c) => Math.hypot(p.x - c.x, p.z - c.z) > 2.2))
      .forEach((p) => (rnd() < 0.3 ? bloom : green).push({ x: p.x, z: p.z, s: randRange(rnd, 0.8, 1.5) }));

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const make = (items, matKey, colors, flowering) => {
      if (!items.length) return;
      const { mat, depth } = this.materials[matKey];
      const mesh = new THREE.InstancedMesh(makeBush(rnd, flowering), mat, items.length);
      mesh.customDepthMaterial = depth;
      items.forEach((b, i) => {
        const y = terrain.heightAt(b.x, b.z);
        dummy.position.set(b.x, y - 0.05, b.z);
        dummy.rotation.set(0, rnd() * TAU, 0);
        dummy.scale.set(b.s, b.s * randRange(rnd, 0.85, 1.15), b.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        color.set(pick(rnd, colors)).offsetHSL(jitter(rnd, 0.015), 0, jitter(rnd, 0.04));
        mesh.setColorAt(i, color);
        this.bushes.push({ x: b.x, y, z: b.z, r: 0.75 * b.s, flowering });
        if (Math.hypot(b.x, b.z) < W.parkRadius - 1) this.colliders.push({ x: b.x, z: b.z, r: 0.5 * b.s, soft: true });
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    };
    make(green, 'leaf', ['#4c8a34', '#5b9a3b', '#43792f'], false);
    make(bloom, 'bushBloom', ['#f2a6c8', '#fff6f0', '#b7a6ea', '#ffd68a', '#a3c1f2'], true);
  }
}
