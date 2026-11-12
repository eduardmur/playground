import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, smoothstep, clamp, mulberry32, TAU } from '../core/utils.js';

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
/** Capsule along Y hanging from the origin down to -len (or up to +len). */
const capsuleDown = (r, len, cap = 4, rad = 10) => new THREE.CapsuleGeometry(r, len, cap, rad).translate(0, -len / 2, 0);
const capsuleUp = (r, len, cap = 4, rad = 10) => new THREE.CapsuleGeometry(r, len, cap, rad).translate(0, len / 2, 0);

/** Scale x/z of a Y-aligned limb linearly from `top` (at y0) to `bottom` (at y1). */
function taperY(geo, y0, y1, top, bottom) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = lerp(top, bottom, clamp((p.getY(i) - y0) / (y1 - y0), 0, 1));
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  return geo;
}

/**
 * Builds a dog from a breed description.
 * Local space: +Z is forward, +Y up, +X the dog's left. Feet rest on y = 0.
 */
export function buildDogRig(breed, opts = {}) {
  const B = breed.body, H = breed.head, marks = breed.marks || {};
  const col = {};
  for (const [k, v] of Object.entries(breed.colors)) col[k] = new THREE.Color(v);
  if (opts.collar) col.collar = new THREE.Color(opts.collar);
  col.tongue = new THREE.Color('#ee8496');
  col.mouth = new THREE.Color('#3b1e22');
  const rnd = mulberry32(breed.id.length * 131 + 7);

  const R = B.r, LEN = B.len, half = LEN / 2;
  const legLen = breed.leg.len, legR = breed.leg.r;
  const pawH = legR * 0.85;
  const Lh = half - R * 0.78; // hip joints, fore and aft of the body centre
  const hx = R * 0.6; // ...and to each side
  const J = R * 0.28; // ...and below it
  const standH = legLen * 0.985 + J;

  const fur = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  const mats = { fur };

  const root = new THREE.Group();
  const tilt = new THREE.Group();
  const body = new THREE.Group();
  body.rotation.order = 'YXZ';
  body.position.y = standH;
  root.add(tilt);
  tilt.add(body);

  const mesh = (geo, material = fur, parent = body) => {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // ------------------------------------------------------------- torso
  const torsoParts = [];
  const torso = capsuleZ(R, LEN - 2 * R, 8, 20);
  {
    const tp = torso.attributes.position, tn = torso.attributes.normal;
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i);
      const u = clamp((z + half) / LEN, 0, 1);
      const sx = lerp(B.hips, B.chest, smoothstep(0.1, 0.85, u));
      const sy = y >= 0 ? lerp(0.95, 1.03, u) : lerp(B.tuck, B.chest * 1.06, smoothstep(0.15, 0.8, u));
      tp.setXYZ(i, x * sx, y * sy, z);
      const nx = tn.getX(i) / sx, ny = tn.getY(i) / sy, nz = tn.getZ(i);
      const l = Math.hypot(nx, ny, nz) || 1;
      tn.setXYZ(i, nx / l, ny / l, nz / l);
    }
  }
  const torsoColor = (x, y, z, out) => {
    out.copy(col.coat);
    const u = (z + half) / LEN, yn = y / R;
    if (marks.mask === 'husky') out.lerp(col.dark, smoothstep(0.1, 0.8, yn) * 0.75);
    if (marks.belly) out.lerp(col.under, smoothstep(-0.15, -0.7, yn));
    if (marks.belly || marks.chest) out.lerp(col.under, smoothstep(0.62, 0.95, u) * smoothstep(0.5, -0.25, yn) * (marks.chest ? 1 : 0.85));
  };
  paint(torso, torsoColor);
  torsoParts.push(torso);

  if (marks.fluff) {
    // a fluffy chest and breeches
    torsoParts.push(paint(place(sphere(R * 0.8, 14, 10), 0, -R * 0.3, half - R * 0.95, 0, 0, 0, 1.0, 1.05, 0.9), col.under));
    torsoParts.push(paint(place(sphere(R * 0.78, 14, 10), 0, -R * 0.05, -half + R * 0.8, 0, 0, 0, 1.05, 1.0, 0.9), col.coat));
  }
  if (marks.spots) {
    const tp = torso.attributes.position, tn = torso.attributes.normal;
    for (let k = 0; k < marks.spots; k++) {
      const i = Math.floor(rnd() * tp.count);
      const n = new THREE.Vector3(tn.getX(i), tn.getY(i), tn.getZ(i));
      if (n.y < -0.55) continue;
      const rs = lerp(0.02, 0.042, rnd());
      const g = sphere(1, 8, 6);
      g.scale(rs * lerp(0.8, 1.3, rnd()), rs, rs * 0.22);
      g.applyQuaternion(_q.setFromUnitVectors(Z, n));
      g.translate(tp.getX(i) + n.x * 0.001, tp.getY(i) + n.y * 0.001, tp.getZ(i) + n.z * 0.001);
      torsoParts.push(paint(g, col.dark));
    }
  }
  mesh(mergeGeometries(torsoParts));

  // -------------------------------------------------------------- neck
  const neck = new THREE.Group();
  const neckBase = breed.neck.angle;
  neck.position.set(0, R * 0.38, half - R * 0.72);
  neck.rotation.order = 'YXZ';
  body.add(neck);
  const nLen = breed.neck.len, nR = breed.neck.r;
  const neckParts = [];
  const neckG = taperY(new THREE.CapsuleGeometry(nR, nLen + R * 0.35, 5, 14).translate(0, (nLen - R * 0.35) / 2, 0), -R * 0.35, nLen, 1.12, 0.84);
  paint(neckG, (x, y, z, out) => {
    out.copy(col.coat);
    if (marks.mask === 'husky') out.lerp(col.dark, smoothstep(0.0, -0.8, z / nR) * 0.7);
    if (marks.belly || marks.chest) out.lerp(col.under, smoothstep(0.1, 0.75, z / nR));
  });
  neckParts.push(neckG);
  if (marks.fluff) neckParts.push(paint(place(sphere(nR * 1.18, 14, 10), 0, nLen * 0.25, nR * 0.1, 0, 0, 0, 1.05, 0.95, 1.05), col.under));
  mesh(mergeGeometries(neckParts), fur, neck);
  // collar and tag
  const collarR = nR * (marks.fluff ? 1.2 : 1.0);
  mats.collar = new THREE.MeshStandardMaterial({ color: col.collar, roughness: 0.55 });
  const collar = mesh(new THREE.TorusGeometry(collarR, 0.013, 6, 20).rotateX(Math.PI / 2), mats.collar, neck);
  collar.position.y = nLen * 0.42;
  collar.scale.set(1, 1, 1);
  mats.tag = new THREE.MeshStandardMaterial({ color: '#f0c85a', roughness: 0.3, metalness: 0.8 });
  const tag = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.005, 10).rotateX(Math.PI / 2), mats.tag, neck);
  tag.position.set(0, nLen * 0.42 - 0.02, collarR + 0.012);

  // -------------------------------------------------------------- head
  const head = new THREE.Group();
  head.position.set(0, nLen, 0);
  head.rotation.order = 'YXZ';
  neck.add(head);
  const hr = H.r, sR = H.snoutR, sL = H.snoutLen;
  const skullY = hr * 0.18, skullZ = hr * 0.22;
  const snoutY = skullY - hr * 0.3;
  const snoutZ = skullZ + hr * 0.74 + sL * 0.5 - sR * 0.5;
  const headParts = [];

  const skull = place(sphere(hr, 22, 16), 0, skullY, skullZ, 0, 0, 0, 1.0, 0.94, 1.04);
  paint(skull, (x, y, z, out) => {
    const xn = x / hr, yn = (y - skullY) / hr, zn = (z - skullZ) / hr;
    out.copy(col.coat);
    if (marks.mask === 'husky') {
      out.lerp(col.dark, 0.75);
      out.lerp(col.under, smoothstep(0.5, 0.1, yn - Math.abs(xn) * 0.25) * smoothstep(-0.15, 0.35, zn));
      out.lerp(col.under, smoothstep(0.2, 0.1, Math.abs(xn)) * smoothstep(0.2, 0.6, zn));
    }
    if (marks.blaze) out.lerp(col.under, smoothstep(0.24, 0.13, Math.abs(xn)) * smoothstep(-0.1, 0.5, zn + yn * 0.3));
    if (marks.mask === 'pug') out.lerp(col.dark, smoothstep(0.45, 0.85, zn) * smoothstep(0.55, 0.1, yn) * 0.9);
    if (marks.muzzle) out.lerp(col.under, smoothstep(-0.2, -0.6, yn) * smoothstep(-0.1, 0.4, zn));
  });
  headParts.push(skull);

  const snout = capsuleZ(sR, sL, 6, 14);
  {
    const sp = snout.attributes.position;
    const zl = sL / 2 + sR;
    for (let i = 0; i < sp.count; i++) {
      const k = lerp(1.12, 0.86, clamp((sp.getZ(i) + zl) / (2 * zl), 0, 1));
      sp.setX(i, sp.getX(i) * k);
      sp.setY(i, sp.getY(i) * k * 0.9);
    }
  }
  place(snout, 0, snoutY, snoutZ);
  paint(snout, (x, y, z, out) => {
    out.copy(col.coat);
    const yn = (y - snoutY) / sR;
    if (marks.mask === 'husky' || marks.blaze) out.copy(col.under);
    if (marks.muzzle) out.lerp(col.under, smoothstep(0.75, 0.2, yn));
    if (marks.mask === 'pug') out.copy(col.dark);
  });
  headParts.push(snout);

  const noseZ = snoutZ + sL / 2 + sR * 0.74;
  headParts.push(paint(place(sphere(sR * 0.44, 12, 9), 0, snoutY + sR * 0.36, noseZ, 0, 0, 0, 1.25, 0.95, 0.9), col.nose));
  headParts.push(paint(place(sphere(sR * 0.62, 10, 8), 0, snoutY - sR * 0.32, skullZ + hr * 0.62, 0, 0, 0, 1, 0.4, 1.3), col.mouth));

  if (H.cheeks > 0.25) {
    const cc = marks.cheeks || marks.muzzle || marks.mask === 'husky' ? col.under : col.coat;
    for (const s of [-1, 1]) {
      headParts.push(paint(
        place(sphere(hr * 0.52 * Math.min(H.cheeks, 1.3), 14, 10), s * hr * 0.6, skullY - hr * 0.34, skullZ + hr * 0.3, 0, 0, 0, 1, 0.82, 1),
        marks.mask === 'pug' ? col.coat : cc
      ));
    }
  }
  if (marks.brows) {
    for (const s of [-1, 1]) {
      headParts.push(paint(place(sphere(hr * 0.105, 8, 6), s * hr * 0.4, skullY + hr * 0.5, skullZ + hr * 0.84, -0.5, 0, 0, 1.25, 0.8, 0.5), col.under));
    }
  }
  if (marks.spots) {
    for (const [sx, sy, sz, rs] of [[0.62, 0.42, 0.62, 0.05], [-0.3, 0.86, 0.3, 0.035], [-0.8, 0.1, 0.35, 0.03]]) {
      const n = new THREE.Vector3(sx, sy, sz).normalize();
      const g = sphere(1, 8, 6);
      g.scale(rs, rs, rs * 0.22);
      g.applyQuaternion(_q.setFromUnitVectors(Z, n));
      g.translate(n.x * hr * 1.0, skullY + n.y * hr * 0.94, skullZ + n.z * hr * 1.04);
      headParts.push(paint(g, col.dark));
    }
  }
  mesh(mergeGeometries(headParts), fur, head);

  // eyes
  const er = hr * 0.17;
  mats.eye = new THREE.MeshStandardMaterial({ color: col.eye, roughness: 0.12, metalness: 0 });
  mats.glint = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.2 });
  const lightEye = col.eye.r + col.eye.g + col.eye.b > 0.5;
  if (lightEye) mats.pupil = new THREE.MeshStandardMaterial({ color: '#16110f', roughness: 0.2 });
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    const dir = new THREE.Vector3(s * 0.43, 0.2, 0.86).normalize();
    eye.position.set(dir.x * hr, skullY + dir.y * hr * 0.94, skullZ + dir.z * hr * 1.03);
    eye.quaternion.setFromUnitVectors(Z, dir);
    const ball = mesh(sphere(er, 12, 10), mats.eye, eye);
    ball.scale.set(1, 1.08, 0.55);
    ball.castShadow = false;
    if (lightEye) {
      const pupil = mesh(sphere(er * 0.55, 10, 8), mats.pupil, eye);
      pupil.position.z = er * 0.34;
      pupil.scale.z = 0.5;
      pupil.castShadow = false;
    }
    const glint = mesh(sphere(er * 0.27, 8, 6), mats.glint, eye);
    glint.position.set(-s * er * 0.3, er * 0.38, er * 0.47);
    glint.castShadow = false;
    head.add(eye);
    eyes.push(eye);
  }

  // jaw + tongue
  const jaw = new THREE.Group();
  jaw.position.set(0, snoutY - sR * 0.28, skullZ + hr * 0.6);
  head.add(jaw);
  const jawLen = Math.max(sL * 0.8, sR * 0.6);
  const jawG = place(capsuleZ(sR * 0.68, jawLen, 4, 10), 0, -sR * 0.12, jawLen * 0.5 + sR * 0.05, 0, 0, 0, 1, 0.5, 1);
  mesh(paint(jawG, marks.mask === 'pug' ? col.dark : marks.muzzle || marks.mask === 'husky' || marks.blaze ? col.under : col.coat), fur, jaw);
  mats.tongue = new THREE.MeshStandardMaterial({ color: col.tongue, roughness: 0.5 });
  const tongue = mesh(place(capsuleZ(sR * 0.42, jawLen * 0.75, 4, 8), 0, 0, 0, 0, 0, 0, 1, 0.26, 1), mats.tongue, jaw);
  const tongueRest = new THREE.Vector3(0, sR * 0.02, jawLen * 0.42);
  tongue.position.copy(tongueRest);
  tongue.castShadow = false;

  // ears
  const E = breed.ears;
  const earColor = marks.darkEars ? col.dark : marks.mask === 'husky' ? col.dark : col.coat;
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.rotation.order = 'YXZ';
    let g, rest;
    if (E.type === 'pointy') {
      const outer = place(new THREE.ConeGeometry(E.size * 0.52, E.size * 1.2, 7), 0, E.size * 0.55, 0, 0, 0, 0, 1, 1, 0.5);
      const inner = place(new THREE.ConeGeometry(E.size * 0.34, E.size * 0.85, 7), 0, E.size * 0.48, E.size * 0.11, 0, 0, 0, 1, 1, 0.4);
      g = mergeGeometries([paint(outer, earColor), paint(inner, col.earInner)]);
      ear.position.set(s * hr * 0.56, skullY + hr * 0.7, skullZ - hr * 0.12);
      rest = { x: -0.1, y: s * 0.25, z: -s * 0.24 };
    } else {
      const long = E.type === 'long', button = E.type === 'button';
      const w = E.size * (button ? 0.6 : 0.46), h = E.size * (long ? 0.95 : button ? 0.6 : 0.68);
      const flap = place(sphere(1, 12, 9), 0, -h * 0.82, 0, 0, 0, 0, w, h, E.size * 0.13);
      g = paint(flap, earColor);
      ear.position.set(s * hr * 0.82, skullY + hr * (button ? 0.62 : 0.5), skullZ - hr * (button ? -0.1 : 0.05));
      rest = button ? { x: -0.9, y: s * 0.5, z: s * 0.5 } : { x: 0.0, y: s * 0.25, z: s * 0.22 };
    }
    mesh(g, fur, ear);
    ear.rotation.set(rest.x, rest.y, rest.z);
    ear.userData.rest = rest;
    ear.userData.side = s;
    head.add(ear);
    ears.push(ear);
  }

  // -------------------------------------------------------------- legs
  const legs = [];
  const segLen = (legLen - pawH) / 2;
  for (const front of [true, false]) {
    for (const s of [1, -1]) {
      const L1 = segLen * (front ? 1.0 : 1.09), L2 = segLen * (front ? 1.0 : 1.09);
      const hip = new THREE.Group();
      hip.rotation.order = 'ZXY';
      const joint = new THREE.Vector3(s * hx, -J, front ? Lh : -Lh);
      hip.position.copy(joint);
      body.add(hip);
      const upParts = [taperY(capsuleDown(legR, L1, 4, 10), 0, -L1, front ? 1.3 : 1.55, 1.0)];
      if (!front) upParts.push(place(sphere(R * 0.56, 12, 9), s * R * 0.04, -L1 * 0.12, R * 0.02, 0, 0, 0, 0.72, 1.05, 1.12));
      else upParts.push(place(sphere(R * 0.44, 12, 9), s * R * 0.02, -L1 * 0.05, 0, 0, 0, 0, 0.7, 1.0, 0.95));
      const legColor = (x, y, z, out) => {
        out.copy(col.coat);
        if (marks.belly) out.lerp(col.under, smoothstep(0.1, 0.9, (-s * x) / legR) * 0.8);
      };
      mesh(paint(mergeGeometries(upParts), legColor), fur, hip);
      const knee = new THREE.Group();
      knee.position.set(0, -L1, 0);
      hip.add(knee);
      const sock = marks.socks ? col.under : col.coat;
      const lower = paint(capsuleDown(legR, L2, 4, 10), (x, y, z, out) => {
        out.copy(col.coat);
        if (marks.socks) out.lerp(col.under, smoothstep(-L2 * 0.25, -L2 * 0.7, y));
        else if (marks.belly) out.lerp(col.under, smoothstep(0.1, 0.9, (-s * x) / legR) * 0.8);
      });
      const paw = paint(place(sphere(legR * 1.42, 12, 9), 0, -L2 - pawH * 0.12, legR * 0.42, 0, 0, 0, 1.12, 0.74, 1.45), sock);
      mesh(mergeGeometries([lower, paw]), fur, knee);
      legs.push({
        hip, knee, L1, L2, front, side: s, joint,
        rest: new THREE.Vector3(s * hx * 1.04, 0, (front ? Lh + legLen * 0.03 : -Lh - legLen * 0.05)),
      });
    }
  }

  // -------------------------------------------------------------- tail
  const T = breed.tail;
  const tailCfg = {
    curl: { n: 4, lift: 1.25, curl: 0.72, taper: 0.75, wag: 0.35 },
    long: { n: 4, lift: 0.45, curl: 0.1, taper: 0.4, wag: 1.0 },
    feather: { n: 4, lift: 0.4, curl: 0.1, taper: 0.5, wag: 1.0 },
    bushy: { n: 3, lift: 0.95, curl: T.curl ?? 0.36, taper: 0.7, wag: 0.7 },
    stub: { n: 1, lift: 0.6, curl: 0, taper: 0.9, wag: 1.4 },
    pigcurl: { n: 3, lift: 1.2, curl: 1.5, taper: 0.8, wag: 0.5 },
  }[T.type];
  const tailBase = new THREE.Group();
  tailBase.position.set(0, R * 0.42 * B.hips, -half + R * 0.32);
  body.add(tailBase);
  const tail = [];
  let parent = tailBase;
  const tl = T.len / tailCfg.n;
  for (let i = 0; i < tailCfg.n; i++) {
    const seg = new THREE.Group();
    if (i > 0) seg.position.y = tl;
    parent.add(seg);
    const r0 = T.r * lerp(1, tailCfg.taper, i / tailCfg.n), r1 = T.r * lerp(1, tailCfg.taper, (i + 1) / tailCfg.n);
    const parts = [taperY(capsuleUp(r0, tl, 4, 9), 0, tl, 1, r1 / r0)];
    if (T.type === 'feather') parts.push(place(sphere(1, 10, 8), 0, tl * 0.5, -T.r * 1.2, 0, 0, 0, T.r * 0.7, tl * 0.75, T.r * lerp(2.4, 1.4, i / tailCfg.n)));
    if (T.type === 'stub') parts.push(place(sphere(T.r * 1.5, 10, 8), 0, tl * 0.4, 0));
    const tipColor = marks.tailTip && i >= tailCfg.n - 2 ? col.under : marks.mask === 'husky' ? col.dark : col.coat;
    mesh(paint(mergeGeometries(parts), tipColor), fur, seg);
    tail.push(seg);
    parent = seg;
  }

  // ----------------------------------------------------- carried things
  const mouth = new THREE.Group(); // items held in the mouth attach here
  mouth.position.set(0, snoutY - sR * 0.5, noseZ - sR * 0.5);
  head.add(mouth);

  root.scale.setScalar(opts.scale ?? breed.scale);

  return {
    breed, root, tilt, body, neck, head, jaw, tongue, tongueRest, eyes, ears, legs, tail, tailBase, tailCfg, mouth, mats, collar,
    dims: {
      R, LEN, half, Lh, hx, J, legLen, pawH, standH, hr, nLen, neckBase, sL, sR,
      belly: R * lerp(B.tuck, B.chest * 1.06, 0.5),
      scale: opts.scale ?? breed.scale,
      noseZ, snoutY,
    },
  };
}
