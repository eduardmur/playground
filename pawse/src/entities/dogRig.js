import * as THREE from 'three';
import { lerp, smoothstep, clamp, mulberry32 } from '../core/utils.js';
import { buildSkin, sdEllipsoid, sdRoundCone } from './skin.js';
import { shellGeometry, furAttributes, furMaterials, layersFor } from './fur.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const Z = new THREE.Vector3(0, 0, 1);

function place(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return geo;
}

/** Vertex-colour a geometry with a flat colour or a function of position. */
function paint(geo, color) {
  const p = geo.attributes.position;
  const arr = new Float32Array(p.count * 3);
  const fn = typeof color === 'function';
  for (let i = 0; i < p.count; i++) {
    if (fn) color(p.getX(i), p.getY(i), p.getZ(i), _c);
    else _c.copy(color);
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const sphere = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
/** Capsule along +Z, centred on the origin. */
const capsuleZ = (r, len, cap = 5, rad = 12) => new THREE.CapsuleGeometry(r, len, cap, rad).rotateX(Math.PI / 2);
// ----------------------------------------------------------------- parts

const ellipsoid = (cx, cy, cz, rx, ry, rz) => ({
  sdf: (x, y, z) => sdEllipsoid(x - cx, y - cy, z - cz, rx, ry, rz),
  box: [cx - rx, cy - ry, cz - rz, cx + rx, cy + ry, cz + rz],
});
/** A tapered capsule from a (radius r1) to b (radius r2); `sy` squashes it vertically about a. */
const roundCone = (a, b, r1, r2, sy = 1) => {
  const r = Math.max(r1, r2);
  return {
    sdf: sy === 1
      ? (x, y, z) => sdRoundCone(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], r1, r2)
      : (x, y, z) => sdRoundCone(x, a[1] + (y - a[1]) / sy, z, a[0], a[1], a[2], b[0], b[1], b[2], r1, r2) * sy,
    box: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r],
  };
};
const dist3 = (x, y, z, p) => Math.hypot(x - p[0], y - p[1], z - p[2]);

/** The smooth body of a breed is the same for every dog of that breed: build it once. */
const SKINS = new Map();

/**
 * Builds a dog from a breed description.
 * Local space: +Z is forward, +Y up, +X the dog's left. Feet rest on y = 0.
 *
 * The body, neck, head, legs and tail are one skinned mesh (see skin.js) with fur shells over it
 * (fur.js); the joints are bones, so dog.js animates them exactly as it would plain groups. Eyes,
 * nose, ears, jaw, tongue and collar are small separate meshes on those bones.
 */
export function buildDogRig(breed, opts = {}) {
  const B = breed.body, H = breed.head, marks = breed.marks || {};
  const col = {};
  for (const [k, v] of Object.entries(breed.colors)) col[k] = new THREE.Color(v);
  if (opts.collar) col.collar = new THREE.Color(opts.collar);
  col.tongue = new THREE.Color('#ee8496');
  col.mouth = new THREE.Color('#3b1e22');
  const rnd = mulberry32(breed.id.length * 131 + 7);
  const furLen = breed.fur ?? 0.012;

  const R = B.r, LEN = B.len, half = LEN / 2;
  const legLen = breed.leg.len, legR = breed.leg.r;
  const pawH = legR * 0.85;
  const Lh = half - R * 0.78; // hip joints, fore and aft of the body centre
  const hx = R * 0.6; // ...and to each side
  const J = R * 0.28; // ...and below it
  const standH = legLen * 0.985 + J;

  const { skin: fur, shell } = furMaterials(furLen);
  const mats = { fur, shell };
  const parts = [];
  const bones = [];
  const bone = (parent) => {
    const b = new THREE.Bone();
    parent.add(b);
    bones.push(b);
    return b;
  };

  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  const body = bone(tilt);
  body.rotation.order = 'YXZ';
  body.position.y = standH;

  const mesh = (geo, material, parent) => {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  /** A small rigid part with its own fur: the ears and the jaw. */
  const furry = (geo, parent) => {
    const m = mesh(geo, fur, parent);
    const s = new THREE.Mesh(shellGeometry(geo, layersFor(furLen)), shell);
    s.receiveShadow = true;
    parent.add(s);
    return m;
  };

  // ------------------------------------------------------------- torso
  const torsoColor = (x, y, z, out) => {
    out.copy(col.coat);
    const u = (z + half) / LEN, yn = y / R;
    if (marks.mask === 'husky') out.lerp(col.dark, smoothstep(0.1, 0.8, yn) * 0.75);
    if (marks.belly) out.lerp(col.under, smoothstep(-0.15, -0.7, yn));
    if (marks.belly || marks.chest) out.lerp(col.under, smoothstep(0.62, 0.95, u) * smoothstep(0.5, -0.25, yn) * (marks.chest ? 1 : 0.85));
    if (spots) for (const sp of spots) if (dist3(x, y, z, sp) < sp[3]) out.copy(col.dark);
  };
  const sx = (u) => lerp(B.hips, B.chest, smoothstep(0.1, 0.85, u));
  const sy = (u, y) => (y >= 0 ? lerp(0.95, 1.03, u) : lerp(B.tuck, B.chest * 1.06, smoothstep(0.15, 0.8, u)));
  // dalmatian spots: patches of colour on the surface
  let spots = null;
  if (marks.spots) {
    spots = [];
    for (let k = 0; k < marks.spots; k++) {
      const u = lerp(0.12, 0.92, rnd()), a = lerp(-Math.PI * 0.8, Math.PI * 0.8, rnd()) + Math.PI / 2;
      const y = Math.sin(a) * R * sy(u, Math.sin(a)), x = Math.cos(a) * R * sx(u);
      if (Math.sin(a) < -0.55) continue;
      spots.push([x, y, u * LEN - half, lerp(0.022, 0.045, rnd())]);
    }
  }
  parts.push({
    bone: body, k: 0, fur: 1, color: torsoColor,
    sdf: (x, y, z) => {
      const zc = clamp(z, -half + R, half - R), u = clamp((z + half) / LEN, 0, 1);
      const ax = sx(u), ay = sy(u, y);
      return (Math.hypot(x / ax, y / ay, z - zc) - R) * Math.min(ax, ay, 1);
    },
    box: [-R * 1.3, -R * 1.25, -half, R * 1.3, R * 1.1, half],
  });
  if (marks.fluff) {
    // a fluffy chest and breeches
    parts.push({ bone: body, k: 0.05, fur: 1.5, color: col.under, ...ellipsoid(0, -R * 0.3, half - R * 0.95, R * 0.8, R * 0.84, R * 0.72) });
    parts.push({ bone: body, k: 0.05, fur: 1.3, color: col.coat, ...ellipsoid(0, -R * 0.05, -half + R * 0.8, R * 0.82, R * 0.78, R * 0.7) });
  }

  // -------------------------------------------------------------- neck
  const neckBase = breed.neck.angle;
  const neck = bone(body);
  neck.position.set(0, R * 0.38, half - R * 0.72);
  neck.rotation.order = 'YXZ';
  const nLen = breed.neck.len, nR = breed.neck.r;
  // the fur lies flat under the collar
  const collarY = nLen * 0.42;
  const neckFur = (k) => (x, y) => k * lerp(0.25, 1, smoothstep(0.012, 0.03, Math.abs(y - collarY)));
  parts.push({
    bone: neck, k: 0.045, fur: neckFur(1.15),
    color: (x, y, z, out) => {
      out.copy(col.coat);
      if (marks.mask === 'husky') out.lerp(col.dark, smoothstep(0.0, -0.8, z / nR) * 0.7);
      if (marks.belly || marks.chest) out.lerp(col.under, smoothstep(0.1, 0.75, z / nR));
    },
    ...roundCone([0, -R * 0.35, 0], [0, nLen, 0], nR * 1.12, nR * 0.84),
  });
  if (marks.fluff) parts.push({ bone: neck, k: 0.04, fur: neckFur(1.5), color: col.under, ...ellipsoid(0, nLen * 0.25, nR * 0.1, nR * 1.24, nR * 1.12, nR * 1.24) });
  // collar and tag, sitting on the fur rather than in it
  const collarR = nR * (marks.fluff ? 1.24 : 1.0) + 0.004 + furLen * 0.3;
  mats.collar = new THREE.MeshStandardMaterial({ color: col.collar, roughness: 0.55 });
  const collar = mesh(new THREE.TorusGeometry(collarR, 0.013, 6, 24).rotateX(Math.PI / 2), mats.collar, neck);
  collar.position.y = collarY;
  mats.tag = new THREE.MeshStandardMaterial({ color: '#f0c85a', roughness: 0.3, metalness: 0.8 });
  const tag = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.005, 10).rotateX(Math.PI / 2), mats.tag, neck);
  tag.position.set(0, collarY - 0.02, collarR + 0.012);

  // -------------------------------------------------------------- head
  const head = bone(neck);
  head.position.set(0, nLen, 0);
  head.rotation.order = 'YXZ';
  const hr = H.r, sR = H.snoutR, sL = H.snoutLen;
  const skullY = hr * 0.18, skullZ = hr * 0.22;
  const snoutY = skullY - hr * 0.3;
  const snoutZ = skullZ + hr * 0.74 + sL * 0.5 - sR * 0.5;
  const noseZ = snoutZ + sL / 2 + sR * 0.74;
  const er = hr * 0.17;
  const eyeDirs = [-1, 1].map((s) => new THREE.Vector3(s * 0.43, 0.2, 0.86).normalize());
  const eyeAt = eyeDirs.map((d) => [d.x * hr, skullY + d.y * hr * 0.94, skullZ + d.z * hr * 1.03]);
  const noseAt = [0, snoutY + sR * 0.36, noseZ];
  // bare around the eyes and the nose
  const faceFur = (x, y, z) =>
    Math.min(smoothstep(er * 1.05, er * 2.2, dist3(x, y, z, eyeAt[0])), smoothstep(er * 1.05, er * 2.2, dist3(x, y, z, eyeAt[1])), smoothstep(sR * 0.5, sR * 1.4, dist3(x, y, z, noseAt)));
  const headSpots = marks.spots
    ? [[0.62, 0.42, 0.62, 0.05], [-0.3, 0.86, 0.3, 0.035], [-0.8, 0.1, 0.35, 0.03]].map(([a, b, c, r]) => {
      const n = new THREE.Vector3(a, b, c).normalize();
      return [n.x * hr, skullY + n.y * hr * 0.94, skullZ + n.z * hr * 1.04, r];
    })
    : null;
  const brows = marks.brows ? [-1, 1].map((s) => [s * hr * 0.4, skullY + hr * 0.5, skullZ + hr * 0.84]) : null;

  parts.push({
    bone: head, k: 0.045, fur: (x, y, z) => 0.75 * faceFur(x, y, z),
    color: (x, y, z, out) => {
      const xn = x / hr, yn = (y - skullY) / hr, zn = (z - skullZ) / hr;
      out.copy(col.coat);
      if (marks.mask === 'husky') {
        out.lerp(col.dark, 0.75);
        out.lerp(col.under, smoothstep(0.5, 0.1, yn - Math.abs(xn) * 0.25) * smoothstep(-0.15, 0.35, zn));
        out.lerp(col.under, smoothstep(0.2, 0.1, Math.abs(xn)) * smoothstep(0.2, 0.6, zn));
      }
      if (marks.blaze) out.lerp(col.under, smoothstep(0.24, 0.13, Math.abs(xn)) * smoothstep(-0.1, 0.5, zn + yn * 0.3));
      if (marks.mask === 'pug') {
        // the mask thins out around the eyes, or plain dark eyes would vanish into it
        const nearEye = Math.min(dist3(x, y, z, eyeAt[0]), dist3(x, y, z, eyeAt[1]));
        out.lerp(col.dark, smoothstep(0.45, 0.85, zn) * smoothstep(0.55, 0.1, yn) * 0.9 * lerp(0.45, 1, smoothstep(er * 1.15, er * 2.1, nearEye)));
      }
      if (marks.muzzle) out.lerp(col.under, smoothstep(-0.2, -0.6, yn) * smoothstep(-0.1, 0.4, zn));
      if (brows) for (const b of brows) out.lerp(col.under, smoothstep(hr * 0.14, hr * 0.07, dist3(x, y, z, b)));
      if (headSpots) for (const sp of headSpots) if (dist3(x, y, z, sp) < sp[3]) out.copy(col.dark);
    },
    ...ellipsoid(0, skullY, skullZ, hr, hr * 0.94, hr * 1.04),
  });
  parts.push({
    bone: head, k: 0.035, fur: (x, y, z) => 0.32 * faceFur(x, y, z),
    color: (x, y, z, out) => {
      out.copy(col.coat);
      const yn = (y - snoutY) / sR;
      if (marks.mask === 'husky' || marks.blaze) out.copy(col.under);
      if (marks.muzzle) out.lerp(col.under, smoothstep(0.75, 0.2, yn));
      if (marks.mask === 'pug') out.copy(col.dark);
    },
    ...roundCone([0, snoutY, snoutZ - sL / 2], [0, snoutY, snoutZ + sL / 2], sR * 1.12, sR * 0.86, 0.9),
  });
  if (H.cheeks > 0.25) {
    const cc = marks.mask === 'pug' ? col.coat : marks.cheeks || marks.muzzle || marks.mask === 'husky' ? col.under : col.coat;
    for (const s of [-1, 1]) {
      const r = hr * 0.52 * Math.min(H.cheeks, 1.3);
      parts.push({ bone: head, k: 0.03, fur: (x, y, z) => (marks.cheeks ? 1.15 : 0.8) * faceFur(x, y, z), color: cc, ...ellipsoid(s * hr * 0.6, skullY - hr * 0.34, skullZ + hr * 0.3, r, r * 0.82, r) });
    }
  }
  mats.nose = new THREE.MeshStandardMaterial({ color: col.nose, roughness: 0.45 });
  mesh(place(sphere(sR * 0.37, 14, 10), 0, noseAt[1], noseZ - sR * 0.04, 0, 0, 0, 1.3, 0.92, 0.85), mats.nose, head);
  mats.mouth = new THREE.MeshStandardMaterial({ color: col.mouth, roughness: 0.7 });
  mesh(place(sphere(sR * 0.62, 10, 8), 0, snoutY - sR * 0.32, skullZ + hr * 0.62, 0, 0, 0, 1, 0.4, 1.3), mats.mouth, head);

  // eyes: plain dark dots, softly lit; no painted-on glints
  mats.eye = new THREE.MeshStandardMaterial({ color: '#0e0a09', roughness: 0.55, metalness: 0 });
  const eyes = [];
  [-1, 1].forEach((s, i) => {
    const eye = new THREE.Group();
    eye.position.fromArray(eyeAt[i]);
    eye.quaternion.setFromUnitVectors(Z, eyeDirs[i]);
    const ball = mesh(sphere(er, 14, 10), mats.eye, eye);
    ball.scale.set(1, 1.08, 0.55);
    ball.castShadow = false;
    head.add(eye);
    eyes.push(eye);
  });

  // jaw + tongue
  const jaw = new THREE.Group();
  jaw.position.set(0, snoutY - sR * 0.28, skullZ + hr * 0.6);
  head.add(jaw);
  const jawLen = Math.max(sL * 0.8, sR * 0.6);
  const jawG = place(capsuleZ(sR * 0.68, jawLen, 4, 10), 0, -sR * 0.12, jawLen * 0.5 + sR * 0.05, 0, 0, 0, 1, 0.5, 1);
  paint(jawG, marks.mask === 'pug' ? col.dark : marks.muzzle || marks.mask === 'husky' || marks.blaze ? col.under : col.coat);
  furry(furAttributes(jawG, null, 0.3), jaw);
  mats.tongue = new THREE.MeshStandardMaterial({ color: col.tongue, roughness: 0.5 });
  const tongue = mesh(place(capsuleZ(sR * 0.42, jawLen * 0.75, 4, 8), 0, 0, 0, 0, 0, 0, 1, 0.26, 1), mats.tongue, jaw);
  const tongueRest = new THREE.Vector3(0, sR * 0.02, jawLen * 0.42);
  tongue.position.copy(tongueRest);
  tongue.castShadow = false;

  // ears: part of the same skin, each on its own bone, so they grow out of the head
  const E = breed.ears, S = E.size;
  const earColor = marks.darkEars ? col.dark : marks.mask === 'husky' ? col.dark : col.coat;
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = bone(head);
    ear.rotation.order = 'YXZ';
    let rest;
    if (E.type === 'pointy') {
      ear.position.set(s * hr * 0.56, skullY + hr * 0.7, skullZ - hr * 0.12);
      rest = { x: -0.1, y: s * 0.25, z: -s * 0.24 };
      // a flattened cone, thick and broad where it meets the head, thin at the tip
      const base = 0.5 * S, tip = Math.max(0.05 * S, 0.0045), flat = 0.55, top = 1.12 * S;
      const radiusAt = (y) => lerp(base, tip, clamp((y + 0.05 * S) / (top + 0.05 * S), 0, 1));
      // the front is the paler, barer inside of the ear
      const inside = (x, y, z) => smoothstep(0.0, 0.25, z / (radiusAt(y) * flat)) * smoothstep(0.75, 0.45, Math.abs(x) / radiusAt(y)) * smoothstep(0.05 * S, 0.2 * S, y) * smoothstep(1.02 * S, 0.8 * S, y);
      parts.push({
        bone: ear, k: 0.03,
        fur: (x, y, z) => lerp(0.7, 0.12, inside(x, y, z)),
        color: (x, y, z, out) => out.copy(earColor).lerp(col.earInner, inside(x, y, z)),
        sdf: (x, y, z) => sdRoundCone(x, y, z / flat, 0, -0.05 * S, 0, 0, top, 0, base, tip) * flat,
        box: [-base, -0.05 * S - base, -base * flat, base, top + tip, base * flat],
      });
    } else {
      const long = E.type === 'long', button = E.type === 'button';
      const w = S * (button ? 0.6 : 0.46), h = S * (long ? 0.95 : button ? 0.6 : 0.68);
      const thick = Math.max(S * 0.12, 0.0105); // half the flap's thickness: enough for the skin's grid to hold
      ear.position.set(s * (hr * 0.82 + thick * 0.5), skullY + hr * (button ? 0.62 : 0.5), skullZ - hr * (button ? -0.1 : 0.05));
      rest = button ? { x: -0.9, y: s * 0.5, z: s * 0.5 } : { x: 0.0, y: s * 0.25, z: s * 0.22 };
      const earFur = (x, y) => lerp(0.5, furLen > 0.02 ? 1.4 : 0.6, clamp(-y / (h * 1.6), 0, 1));
      // the root flows into the head; the flap itself only touches it, so it never sticks to the cheek
      parts.push({ bone: ear, k: 0.03, fur: earFur, color: earColor, ...ellipsoid(0, -h * 0.12, 0, w * 0.62, h * 0.32, thick * 1.5) });
      parts.push({ bone: ear, k: 0.008, reach: 0.004, fur: earFur, color: earColor, ...ellipsoid(0, -h * 0.82, 0, w, h, thick) });
    }
    ear.rotation.set(rest.x, rest.y, rest.z);
    ear.userData.rest = rest;
    ear.userData.side = s;
    ears.push(ear);
  }

  // -------------------------------------------------------------- legs
  const legs = [];
  const segLen = (legLen - pawH) / 2;
  for (const front of [true, false]) {
    for (const s of [1, -1]) {
      const L1 = segLen * (front ? 1.0 : 1.09), L2 = segLen * (front ? 1.0 : 1.09);
      const hip = bone(body);
      hip.rotation.order = 'ZXY';
      const joint = new THREE.Vector3(s * hx, -J, front ? Lh : -Lh);
      hip.position.copy(joint);
      const legColor = (x, y, z, out) => {
        out.copy(col.coat);
        if (marks.belly) out.lerp(col.under, smoothstep(0.1, 0.9, (-s * x) / legR) * 0.8);
      };
      parts.push({ bone: hip, k: 0.04, fur: 0.85, color: legColor, ...roundCone([0, 0, 0], [0, -L1, 0], legR * (front ? 1.3 : 1.55), legR) });
      if (!front) parts.push({ bone: hip, k: 0.04, fur: 1, color: legColor, ...ellipsoid(s * R * 0.04, -L1 * 0.12, R * 0.02, R * 0.4, R * 0.59, R * 0.63) });
      else parts.push({ bone: hip, k: 0.04, fur: 0.9, color: legColor, ...ellipsoid(s * R * 0.02, -L1 * 0.05, 0, R * 0.31, R * 0.44, R * 0.42) });
      const knee = bone(hip);
      knee.position.set(0, -L1, 0);
      const lowerColor = (x, y, z, out) => {
        out.copy(col.coat);
        if (marks.socks) out.lerp(col.under, smoothstep(-L2 * 0.25, -L2 * 0.7, y));
        else if (marks.belly) out.lerp(col.under, smoothstep(0.1, 0.9, (-s * x) / legR) * 0.8);
      };
      parts.push({ bone: knee, k: 0.022, fur: 0.55, color: lowerColor, ...roundCone([0, 0, 0], [0, -L2, 0], legR, legR * 0.92) });
      // the paw: a little smaller than the old ball, its sole at the same height
      parts.push({
        bone: knee, k: 0.02, fur: 0.22, color: marks.socks ? col.under : col.coat,
        ...ellipsoid(0, -L2 - pawH * 0.12 - legR * 0.15, legR * 0.45, legR * 1.32, legR * 0.9, legR * 1.75),
      });
      legs.push({
        hip, knee, L1, L2, front, side: s, joint,
        rest: new THREE.Vector3(s * hx * 1.04, 0, (front ? Lh + legLen * 0.03 : -Lh - legLen * 0.05)),
      });
    }
  }

  // -------------------------------------------------------------- tail
  const T = breed.tail;
  const tailCfg = {
    curl: { n: 4, lift: 1.25, curl: 0.72, taper: 0.75, wag: 0.35, fur: 1.7 },
    long: { n: 4, lift: 0.45, curl: 0.1, taper: 0.4, wag: 1.0, fur: 0.7 },
    feather: { n: 4, lift: 0.4, curl: 0.1, taper: 0.5, wag: 1.0, fur: 1.5 },
    bushy: { n: 3, lift: 0.95, curl: T.curl ?? 0.36, taper: 0.7, wag: 0.7, fur: 2.0 },
    stub: { n: 1, lift: 0.6, curl: 0, taper: 0.9, wag: 1.4, fur: 1.2 },
    pigcurl: { n: 3, lift: 1.2, curl: 1.5, taper: 0.8, wag: 0.5, fur: 0.5 },
  }[T.type];
  const tailBase = bone(body);
  tailBase.position.set(0, R * 0.42 * B.hips, -half + R * 0.32);
  const tail = [];
  let parent = tailBase;
  const tl = T.len / tailCfg.n;
  for (let i = 0; i < tailCfg.n; i++) {
    const seg = bone(parent);
    if (i > 0) seg.position.y = tl;
    const r0 = T.r * lerp(1, tailCfg.taper, i / tailCfg.n), r1 = T.r * lerp(1, tailCfg.taper, (i + 1) / tailCfg.n);
    const tipColor = marks.tailTip && i >= tailCfg.n - 2 ? col.under : marks.mask === 'husky' ? col.dark : col.coat;
    parts.push({ bone: seg, k: i === 0 ? 0.035 : 0.02, fur: tailCfg.fur, color: tipColor, ...roundCone([0, 0, 0], [0, tl, 0], r0, r1) });
    if (T.type === 'feather') parts.push({ bone: seg, k: 0.02, fur: 1.6, color: tipColor, ...ellipsoid(0, tl * 0.5, -T.r * 1.2, T.r * 0.7, tl * 0.75, T.r * lerp(2.4, 1.4, i / tailCfg.n)) });
    if (T.type === 'stub') parts.push({ bone: seg, k: 0.02, fur: 1.2, color: tipColor, ...ellipsoid(0, tl * 0.4, 0, T.r * 1.5, T.r * 1.5, T.r * 1.5) });
    tail.push(seg);
    parent = seg;
  }

  // ------------------------------------------------- the body as one skin
  // bind pose: the neck and head as a dog stands, the tail straight out at its usual angle
  neck.rotation.x = neckBase;
  head.rotation.x = -neckBase * 0.92;
  tailBase.rotation.x = -(Math.PI / 2 - tailCfg.lift);
  root.updateMatrixWorld(true);
  let built = SKINS.get(breed.id);
  if (!built) {
    // the fur grows from a coarser copy of the same surface: it needs the shape, not the detail
    const geo = buildSkin(parts, bones, { cell: 0.009 });
    const coarse = buildSkin(parts, bones, { cell: 0.014, ao: 0.45 });
    built = { geo, shells: shellGeometry(coarse, layersFor(furLen)) };
    // every dog of this breed draws these: nobody disposes them
    built.geo.userData.shared = built.shells.userData.shared = true;
    SKINS.set(breed.id, built);
  }
  const skeleton = new THREE.Skeleton(bones);
  const bodyMesh = new THREE.SkinnedMesh(built.geo, fur);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  const coat = new THREE.SkinnedMesh(built.shells, shell);
  coat.receiveShadow = true;
  for (const m of [bodyMesh, coat]) {
    root.add(m);
    m.bind(skeleton, new THREE.Matrix4());
    // the legs and tail swing well outside the bind pose
    m.boundingSphere = built.geo.boundingSphere.clone();
    m.boundingSphere.radius *= 1.35;
  }

  // ----------------------------------------------------- carried things
  const mouth = new THREE.Group(); // items held in the mouth attach here
  mouth.position.set(0, snoutY - sR * 0.5, noseZ - sR * 0.5);
  head.add(mouth);

  root.scale.setScalar(opts.scale ?? breed.scale);

  /** Wet fur: darker, glossier, flatter. */
  const setWet = (wet) => {
    const k = lerp(1, 0.66, wet);
    fur.color.setRGB(k, k, k * lerp(1, 1.04, wet)).multiplyScalar(fur.userData.base);
    fur.roughness = lerp(0.92, 0.5, wet);
    shell.color.setRGB(k, k, k * lerp(1, 1.04, wet));
    shell.userData.uniforms.uWet.value = wet;
  };

  return {
    breed, root, tilt, body, neck, head, jaw, tongue, tongueRest, eyes, ears, legs, tail, tailBase, tailCfg, mouth, mats, collar, setWet,
    dims: {
      R, LEN, half, Lh, hx, J, legLen, pawH, standH, hr, nLen, neckBase, sL, sR,
      belly: R * lerp(B.tuck, B.chest * 1.06, 0.5),
      scale: opts.scale ?? breed.scale,
      noseZ, snoutY,
    },
  };
}
