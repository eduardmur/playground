import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, randRange, scatter, TAU, pick, Noise2D } from '../core/utils.js';
import { addSway } from './shared.js';
import { WORLD, pondNorm, pondShorePoint } from './terrain.js';

function setColor(geo, hex, tint = 0) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const t = new Float32Array(n).fill(tint);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aTint', new THREE.BufferAttribute(t, 1));
  return geo;
}

/** Wildflowers, rocks, reeds and lily pads: the small things. */
export class Flora {
  constructor(terrain, treeColliders) {
    this.group = new THREE.Group();
    this.group.name = 'flora';
    this.patches = []; // flower patches {x, z, r, color}
    this.colliders = [];
    const rnd = mulberry32(977);
    this._flowers(terrain, rnd, treeColliders);
    this._rocks(terrain, rnd, treeColliders);
    this._reeds(terrain, rnd);
    this._lilies(terrain, rnd);
  }

  _flowers(terrain, rnd, treeColliders) {
    const W = WORLD;
    // one flower: stem + cupped disc of petals + a little centre
    const stem = setColor(new THREE.CylinderGeometry(0.006, 0.009, 1, 3, 1, true).translate(0, 0.5, 0), '#5c9b3a', 0);
    const petals = new THREE.CircleGeometry(0.14, 7);
    petals.rotateX(-Math.PI / 2);
    const pp = petals.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const r = Math.hypot(pp.getX(i), pp.getZ(i));
      pp.setY(i, 1.0 + r * 0.32);
    }
    petals.computeVertexNormals();
    setColor(petals, '#ffffff', 1);
    const centre = setColor(new THREE.SphereGeometry(0.045, 6, 4).translate(0, 1.02, 0), '#f3b62d', 0);
    const geo = mergeGeometries([stem, petals, centre]);

    const palette = ['#ffffff', '#ffffff', '#ffd94c', '#ffd94c', '#ff9ec6', '#b592f2', '#f2604f', '#86adf7', '#ffa64d'];
    const items = [];
    const clusters = [];
    const tryCluster = (x, z, r, n, colors) => {
      if (Math.hypot(x, z) > W.parkRadius - 3 || pondNorm(x, z) < 1.12) return;
      clusters.push({ x, z, r, color: colors[0] });
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, d = r * Math.sqrt(-Math.log(1 - rnd() * 0.95)) * 0.62;
        const fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
        if (!terrain.isGrassy(fx, fz) || pondNorm(fx, fz) < 1.06) continue;
        if (treeColliders.some((c) => Math.hypot(fx - c.x, fz - c.z) < c.r + 0.15)) continue;
        items.push({ x: fx, z: fz, s: randRange(rnd, 0.75, 1.35), color: pick(rnd, colors) });
      }
    };
    // the wild meadow in the south-east is thick with them
    for (let i = 0; i < 30; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * W.meadow.r;
      const c1 = pick(rnd, palette), c2 = pick(rnd, palette);
      tryCluster(W.meadow.x + Math.cos(a) * d, W.meadow.z + Math.sin(a) * d, randRange(rnd, 3, 5.5), Math.round(randRange(rnd, 90, 160)), [c1, c1, c2]);
    }
    // smaller drifts everywhere else
    for (let i = 0; i < 70; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * (W.parkRadius - 6);
      const c1 = pick(rnd, palette);
      tryCluster(Math.cos(a) * d, Math.sin(a) * d, randRange(rnd, 1.6, 3.6), Math.round(randRange(rnd, 30, 80)), [c1, c1, c1, pick(rnd, palette)]);
    }
    this.patches = clusters;

    const mat = addSway(
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      0.55,
      { tintMask: true }
    );
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((f, i) => {
      dummy.position.set(f.x, terrain.heightAt(f.x, f.z) - 0.01, f.z);
      dummy.rotation.set(randRange(rnd, -0.3, 0.3), rnd() * TAU, randRange(rnd, -0.3, 0.3));
      const h = 0.36 * f.s;
      dummy.scale.set(h * 0.9, h, h * 0.9);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(f.color).offsetHSL(randRange(rnd, -0.015, 0.015), 0, randRange(rnd, -0.04, 0.04)));
    });
    mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.computeBoundingSphere();
    mesh.name = 'flowers';
    this.group.add(mesh);
    this.flowerCount = items.length;
  }

  _rocks(terrain, rnd, treeColliders) {
    const W = WORLD;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const n = new Noise2D(5);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + n.noise(x * 1.7 + y, z * 1.7 - y) * 0.28;
      p.setXYZ(i, x * k, Math.max(y * k * 0.72, -0.35), z * k);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true });

    const spots = [];
    // boulders at the water's edge
    for (let i = 0; i < 13; i++) {
      const a = rnd() * TAU;
      if (a > 2.5 && a < 3.2) continue; // keep the beach clear
      const q = pondShorePoint(a, randRange(rnd, 0.97, 1.12));
      spots.push({ x: q.x, z: q.z, s: randRange(rnd, 0.35, 0.95) });
    }
    // on the hill and scattered through the park
    scatter(rnd, 30, 1500, (r) => {
      const a = r() * TAU, d = Math.sqrt(r()) * (W.parkRadius - 4);
      return { x: Math.cos(a) * d, z: Math.sin(a) * d };
    }, 6, (q) => terrain.isGrassy(q.x, q.z) && pondNorm(q.x, q.z) > 1.3 &&
      Math.hypot(q.x - W.plaza.x, q.z - W.plaza.z) > 14 && Math.hypot(q.x - 2, q.z - 16) > 6 &&
      treeColliders.every((c) => Math.hypot(q.x - c.x, q.z - c.z) > 1.6))
      .forEach((q) => {
        spots.push({ x: q.x, z: q.z, s: randRange(rnd, 0.3, 0.85) });
        if (rnd() < 0.5) spots.push({ x: q.x + randRange(rnd, -1, 1), z: q.z + randRange(rnd, -1, 1), s: randRange(rnd, 0.18, 0.4) });
      });

    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    spots.forEach((r, i) => {
      dummy.position.set(r.x, terrain.heightAt(r.x, r.z) + r.s * 0.12, r.z);
      dummy.rotation.set(randRange(rnd, -0.25, 0.25), rnd() * TAU, randRange(rnd, -0.25, 0.25));
      dummy.scale.set(r.s * randRange(rnd, 0.85, 1.3), r.s * randRange(rnd, 0.7, 1.1), r.s * randRange(rnd, 0.85, 1.3));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(pick(rnd, ['#9a958c', '#8a8a86', '#a59d8f', '#7f8483'])));
      if (r.s > 0.33) this.colliders.push({ x: r.x, z: r.z, r: r.s * 0.95 });
    });
    mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = 'rocks';
    this.group.add(mesh);
  }

  _reeds(terrain, rnd) {
    // a tuft: three crossed tapering blades, and sometimes a cattail
    const blade = (rot, lean) => {
      const g = new THREE.BufferGeometry();
      const w = 0.035;
      const pts = [];
      const idx = [];
      const rows = 4;
      for (let j = 0; j <= rows; j++) {
        const t = j / rows;
        const ww = w * (1 - t * 0.9);
        pts.push(-ww, t, lean * t * t, ww, t, lean * t * t);
      }
      for (let j = 0; j < rows; j++) {
        const a = j * 2;
        idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((rows + 1) * 4).fill(0), 2));
      g.rotateY(rot);
      return setColor(g, '#7d9b48');
    };
    const tuft = mergeGeometries([blade(0, 0.18), blade(2.1, 0.12), blade(4.2, 0.22), blade(1.0, -0.1)]);
    const stalk = setColor(new THREE.CylinderGeometry(0.008, 0.012, 1.15, 4, 1, true).translate(0, 0.575, 0), '#8a9a52');
    const head = setColor(new THREE.CapsuleGeometry(0.03, 0.14, 3, 6).translate(0, 1.12, 0), '#6b4426');
    const cattail = mergeGeometries([tuft.clone(), stalk, head]);

    const spots = [];
    for (let i = 0; i < 46; i++) {
      const a = rnd() * TAU;
      if (a > 2.35 && a < 3.3) continue; // the beach
      const n = 3 + Math.floor(rnd() * 6);
      for (let k = 0; k < n; k++) {
        const q = pondShorePoint(a + randRange(rnd, -0.07, 0.07), randRange(rnd, 0.9, 1.03));
        spots.push({ x: q.x, z: q.z, s: randRange(rnd, 0.8, 1.5), cat: rnd() < 0.3 });
      }
    }
    const mat = addSway(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.5);
    const dummy = new THREE.Object3D();
    for (const cat of [false, true]) {
      const mine = spots.filter((s) => s.cat === cat);
      if (!mine.length) continue;
      const mesh = new THREE.InstancedMesh(cat ? cattail : tuft, mat, mine.length);
      mine.forEach((r, i) => {
        dummy.position.set(r.x, Math.max(terrain.heightAt(r.x, r.z), WORLD.waterLevel - 0.25) - 0.03, r.z);
        dummy.rotation.set(0, rnd() * TAU, 0);
        dummy.scale.set(r.s, r.s * 1.1, r.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  _lilies(terrain, rnd) {
    const pad = new THREE.CircleGeometry(0.42, 14, 0.28, TAU - 0.56);
    pad.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, side: THREE.DoubleSide });
    const petal = new THREE.SphereGeometry(0.1, 6, 5);
    petal.scale(0.45, 0.22, 1);
    petal.translate(0, 0, 0.11);
    const parts = [];
    for (let ring = 0; ring < 2; ring++) {
      const n = ring ? 5 : 7;
      for (let i = 0; i < n; i++) {
        const g = petal.clone();
        g.rotateX(ring ? -0.95 : -0.42);
        g.rotateY((i / n) * TAU + ring * 0.4);
        g.scale(ring ? 0.7 : 1, 1, ring ? 0.7 : 1);
        parts.push(g);
      }
    }
    const lotus = mergeGeometries(parts);
    const lotusMat = new THREE.MeshStandardMaterial({ color: '#ffd3e4', roughness: 0.7, emissive: '#ff9fc2', emissiveIntensity: 0.12 });

    const pads = [];
    for (const [ang, norm] of [[0.6, 0.62], [2.0, 0.7], [4.1, 0.6], [5.2, 0.72], [3.3, 0.45]]) {
      const c = pondShorePoint(ang, norm);
      const n = 5 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, d = Math.sqrt(rnd()) * 2.6;
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
        if (WORLD.waterLevel - terrain.heightAt(x, z) < 0.25) continue;
        if (pads.some((q) => Math.hypot(q.x - x, q.z - z) < 0.75)) continue;
        pads.push({ x, z, s: randRange(rnd, 0.7, 1.25), flower: rnd() < 0.28 });
      }
    }
    this.lilyPads = pads;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const padMesh = new THREE.InstancedMesh(pad, padMat, pads.length);
    const flowers = pads.filter((p) => p.flower);
    const lotusMesh = new THREE.InstancedMesh(lotus, lotusMat, Math.max(flowers.length, 1));
    let fi = 0;
    pads.forEach((p, i) => {
      dummy.position.set(p.x, WORLD.waterLevel + 0.012, p.z);
      dummy.rotation.set(0, rnd() * TAU, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      padMesh.setMatrixAt(i, dummy.matrix);
      padMesh.setColorAt(i, color.set(pick(rnd, ['#4f9a4a', '#5aa652', '#448c45'])));
      if (p.flower) {
        dummy.position.y += 0.03;
        dummy.scale.setScalar(p.s * 0.95);
        dummy.updateMatrix();
        lotusMesh.setMatrixAt(fi++, dummy.matrix);
      }
    });
    lotusMesh.count = fi;
    padMesh.instanceColor.needsUpdate = true;
    padMesh.receiveShadow = true;
    padMesh.renderOrder = 6;
    lotusMesh.renderOrder = 6;
    padMesh.computeBoundingSphere();
    lotusMesh.computeBoundingSphere();
    this.group.add(padMesh, lotusMesh);
  }
}
