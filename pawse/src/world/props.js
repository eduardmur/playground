import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU } from '../core/utils.js';
import { WORLD, PATHS } from './terrain.js';

const col = (geo, hex) => {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
};
const box = (w, h, d, x, y, z, hex, rx = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return col(g, hex);
};
const cyl = (rt, rb, h, seg, x, y, z, hex) => col(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), hex);

function softDiscTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 300;
  const g = cv.getContext('2d');
  g.fillStyle = '#e9dcc0';
  g.fillRect(0, 0, 512, 300);
  g.strokeStyle = '#6f5334';
  g.lineWidth = 10;
  g.strokeRect(14, 14, 484, 272);
  g.fillStyle = '#5b4026';
  g.textAlign = 'center';
  g.font = 'italic 600 78px Georgia, "Iowan Old Style", serif';
  g.fillText('Dog Park', 256, 128);
  g.font = '500 30px Georgia, serif';
  g.fillText('all good dogs welcome', 256, 186);
  // a paw print
  g.fillStyle = '#b5673c';
  const px = 256, py = 236;
  g.beginPath();
  g.ellipse(px, py + 8, 17, 13, 0, 0, TAU);
  g.fill();
  for (const [dx, dy] of [[-21, -8], [-8, -19], [8, -19], [21, -8]]) {
    g.beginPath();
    g.ellipse(px + dx, py + dy, 6.5, 8, 0, 0, TAU);
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Benches, lamps, the fountain, water bowls, the fence, a sign. */
export class Props {
  constructor(terrain) {
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.colliders = [];
    this.lamps = []; // {x, y, z}
    this.lights = [];
    this.benches = [];
    this.drinkSpots = []; // {x, z, r, y, kind}
    this.nightAmount = -1;

    const std = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
    this._benches(terrain, std);
    this._lamps(terrain, std);
    this._fountain(terrain, std);
    this._bowls(terrain);
    this._fence(terrain, std);
    this._sign(terrain, std);
  }

  _benches(terrain, std) {
    const wood = '#a8713d', iron = '#2f3437';
    const parts = [];
    for (const z of [-0.14, 0, 0.14]) parts.push(box(1.5, 0.04, 0.12, 0, 0.42, z, wood));
    parts.push(box(1.5, 0.11, 0.035, 0, 0.62, -0.25, wood, -0.14), box(1.5, 0.11, 0.035, 0, 0.78, -0.275, wood, -0.14));
    for (const x of [-0.62, 0.62]) {
      parts.push(box(0.05, 0.4, 0.44, x, 0.2, 0, iron), box(0.05, 0.5, 0.05, x, 0.62, -0.26, iron, -0.14));
      parts.push(box(0.05, 0.04, 0.4, x, 0.56, -0.03, iron));
    }
    const geo = mergeGeometries(parts);

    const W = WORLD;
    const spots = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const x = W.plaza.x + Math.cos(a) * 5.3, z = W.plaza.z + Math.sin(a) * 5.3;
      spots.push({ x, z, ry: Math.atan2(W.plaza.x - x, W.plaza.z - z) });
    }
    const loop = PATHS.loop;
    for (let k = 0; k < 8; k++) {
      const i = Math.floor(((k + 0.5) / 8) * loop.length) % loop.length;
      const p = loop[i], q = loop[(i + 1) % loop.length];
      const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
      // sit on the outer side of the loop, facing back in toward the park
      let nx = -tz / tl, nz = tx / tl;
      if (nx * p.x + nz * p.z < 0) {
        nx = -nx;
        nz = -nz;
      }
      spots.push({ x: p.x + nx * 2.3, z: p.z + nz * 2.3, ry: Math.atan2(-nx, -nz) });
    }
    // the sunset bench on the hill, and one by the beach
    spots.push({ x: W.hill.x + 2.9, z: W.hill.z - 1.4, ry: Math.atan2(0.84, -0.54) });
    spots.push({ x: 14.6, z: -18.6, ry: Math.atan2(1, 0.25) });

    const mesh = new THREE.InstancedMesh(geo, std, spots.length);
    const d = new THREE.Object3D();
    spots.forEach((s, i) => {
      const y = terrain.heightAt(s.x, s.z);
      d.position.set(s.x, y, s.z);
      d.rotation.set(0, s.ry, 0);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      const ax = Math.cos(s.ry), az = -Math.sin(s.ry); // bench's long axis
      for (const o of [-0.5, 0, 0.5]) this.colliders.push({ x: s.x + ax * o, z: s.z + az * o, r: 0.36 });
      this.benches.push({ x: s.x, y, z: s.z, ry: s.ry });
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  _lamps(terrain, std) {
    const iron = '#27322c';
    const post = mergeGeometries([
      cyl(0.085, 0.13, 0.26, 8, 0, 0.13, 0, iron),
      cyl(0.036, 0.05, 2.9, 7, 0, 1.6, 0, iron),
      cyl(0.15, 0.07, 0.07, 8, 0, 3.06, 0, iron),
      col(new THREE.ConeGeometry(0.21, 0.16, 8).translate(0, 3.46, 0), iron),
      cyl(0.02, 0.02, 0.07, 5, 0, 3.57, 0, iron),
    ]);
    const glass = new THREE.CylinderGeometry(0.13, 0.1, 0.28, 8).translate(0, 3.24, 0);
    this.glassMat = new THREE.MeshStandardMaterial({
      color: '#fff4d6', emissive: '#ffc76b', emissiveIntensity: 0, roughness: 0.4,
    });

    const W = WORLD;
    const spots = [];
    for (let k = 0; k < 4; k++) {
      const a = 0.35 + (k * Math.PI) / 2;
      spots.push({ x: W.plaza.x + Math.cos(a) * 6.2, z: W.plaza.z + Math.sin(a) * 6.2, light: k % 2 === 0 });
    }
    const loop = PATHS.loop;
    for (let k = 0; k < 8; k++) {
      const i = Math.floor((k / 8) * loop.length) % loop.length;
      const p = loop[i], q = loop[(i + 1) % loop.length];
      const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
      let nx = -tz / tl, nz = tx / tl;
      if (nx * p.x + nz * p.z > 0) {
        nx = -nx;
        nz = -nz;
      }
      spots.push({ x: p.x + nx * 1.9, z: p.z + nz * 1.9, light: k % 2 === 1 });
    }
    spots.push({ x: W.hill.x + 4.6, z: W.hill.z + 1.4, light: true });
    spots.push({ x: 15.2, z: -15.4, light: true });
    spots.push({ x: 4.2, z: 27, light: true });

    const posts = new THREE.InstancedMesh(post, std, spots.length);
    const glasses = new THREE.InstancedMesh(glass, this.glassMat, spots.length);
    const d = new THREE.Object3D();
    const haloTex = softDiscTexture();
    this.haloMat = new THREE.SpriteMaterial({
      map: haloTex, color: '#ffbe6a', transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    spots.forEach((s, i) => {
      const y = terrain.heightAt(s.x, s.z);
      d.position.set(s.x, y - 0.03, s.z);
      d.rotation.set(0, i * 1.3, 0);
      d.updateMatrix();
      posts.setMatrixAt(i, d.matrix);
      glasses.setMatrixAt(i, d.matrix);
      this.colliders.push({ x: s.x, z: s.z, r: 0.2 });
      this.lamps.push({ x: s.x, y: y + 3.24, z: s.z });
      const halo = new THREE.Sprite(this.haloMat);
      halo.position.set(s.x, y + 3.24, s.z);
      halo.scale.setScalar(1.7);
      this.group.add(halo);
      if (s.light) {
        const light = new THREE.PointLight('#ffc27a', 0, 17, 1.7);
        light.position.set(s.x, y + 3.1, s.z);
        this.lights.push(light);
        this.group.add(light);
      }
    });
    posts.castShadow = true;
    posts.receiveShadow = true;
    posts.computeBoundingSphere();
    glasses.computeBoundingSphere();
    this.group.add(posts, glasses);
  }

  _fountain(terrain, std) {
    const W = WORLD;
    const stone = '#cfc6b4', stoneDark = '#b3a996';
    const y0 = terrain.heightAt(W.plaza.x, W.plaza.z);
    const lathe = (pts, hex, seg = 40) =>
      col(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), hex);
    const basin = lathe(
      [[2.32, -0.1], [2.4, 0.08], [2.34, 0.4], [2.44, 0.5], [2.12, 0.52], [2.06, 0.42], [2.04, 0.1], [0.0, 0.1]],
      stone
    );
    const pillar = lathe([[0.0, 0.1], [0.42, 0.1], [0.3, 0.3], [0.2, 0.75], [0.26, 1.02], [0.2, 1.06]], stoneDark, 20);
    const bowl = lathe(
      [[0.0, 1.0], [0.3, 1.02], [0.78, 1.2], [0.86, 1.3], [0.76, 1.31], [0.66, 1.22], [0.0, 1.14]],
      stone, 28
    );
    const finial = lathe([[0.0, 1.14], [0.1, 1.16], [0.07, 1.42], [0.12, 1.5], [0.0, 1.62]], stoneDark, 12);
    const geo = mergeGeometries([basin, pillar, bowl, finial]);
    const mesh = new THREE.Mesh(geo, std);
    mesh.position.set(W.plaza.x, y0, W.plaza.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    this.waterMat = new THREE.MeshStandardMaterial({
      color: '#7fd0d6', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.82,
      emissive: '#2a7f8c', emissiveIntensity: 0.2,
    });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.07, 40).rotateX(-Math.PI / 2), this.waterMat);
    pool.position.set(W.plaza.x, y0 + 0.4, W.plaza.z);
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24).rotateX(-Math.PI / 2), this.waterMat);
    top.position.set(W.plaza.x, y0 + 1.26, W.plaza.z);
    this.group.add(pool, top);

    this.fountain = { x: W.plaza.x, y: y0, z: W.plaza.z, top: y0 + 1.6, rim: y0 + 1.3, pool: y0 + 0.4 };
    this.colliders.push({ x: W.plaza.x, z: W.plaza.z, r: 2.5 });
    this.drinkSpots.push({ x: W.plaza.x, z: W.plaza.z, r: 3.25, y: y0 + 0.42, kind: 'fountain' });
  }

  _bowls(terrain) {
    const lathe = (pts, seg = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    const bowlGeo = lathe([[0.0, 0.01], [0.15, 0.01], [0.2, 0.0], [0.17, 0.09], [0.15, 0.09], [0.13, 0.03], [0.0, 0.03]]);
    const waterGeo = new THREE.CircleGeometry(0.14, 16).rotateX(-Math.PI / 2);
    const spots = [
      { x: 3.6, z: 4.6, color: '#d9534f' },
      { x: 14.3, z: -16.9, color: '#4f8fd9' },
      { x: WORLD.hill.x + 3.8, z: WORLD.hill.z + 0.3, color: '#e9b44c' },
      { x: 26.5, z: 46.4, color: '#58b58a' },
    ];
    for (const s of spots) {
      const y = terrain.heightAt(s.x, s.z);
      const m = new THREE.Mesh(bowlGeo, new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.35 }));
      m.position.set(s.x, y, s.z);
      m.castShadow = true;
      const w = new THREE.Mesh(waterGeo, this.waterMat);
      w.position.set(s.x, y + 0.075, s.z);
      this.group.add(m, w);
      this.drinkSpots.push({ x: s.x, z: s.z, r: 0.75, y: y + 0.075, kind: 'bowl' });
      this.colliders.push({ x: s.x, z: s.z, r: 0.16 });
    }
  }

  _fence(terrain, std) {
    const R = WORLD.parkRadius + 1.5;
    const n = Math.round((TAU * R) / 2.6);
    const postG = box(0.11, 0.95, 0.11, 0, 0.42, 0, '#8d6c49');
    const railG = mergeGeometries([box(1, 0.075, 0.045, 0, 0.36, 0, '#9b7850'), box(1, 0.075, 0.045, 0, 0.68, 0, '#9b7850')]);
    const posts = new THREE.InstancedMesh(postG, std, n);
    const rails = new THREE.InstancedMesh(railG, std, n);
    const d = new THREE.Object3D();
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      pts.push(new THREE.Vector3(x, terrain.heightAt(x, z), z));
    }
    const dir = new THREE.Vector3();
    const X = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      d.position.copy(p);
      d.quaternion.identity();
      d.rotation.set(0, -((i / n) * TAU), 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      posts.setMatrixAt(i, d.matrix);
      dir.subVectors(q, p);
      const len = dir.length();
      d.position.copy(p).lerp(q, 0.5);
      d.quaternion.setFromUnitVectors(X, dir.normalize());
      d.scale.set(len, 1, 1);
      d.updateMatrix();
      rails.setMatrixAt(i, d.matrix);
    }
    posts.receiveShadow = rails.receiveShadow = true;
    posts.castShadow = rails.castShadow = true;
    posts.computeBoundingSphere();
    rails.computeBoundingSphere();
    this.group.add(posts, rails);
  }

  _sign(terrain, std) {
    const x = 5.4, z = 11.2;
    const y = terrain.heightAt(x, z);
    const frame = mergeGeometries([
      box(0.09, 1.5, 0.09, -0.62, 0.75, 0, '#7b5c3c'),
      box(0.09, 1.5, 0.09, 0.62, 0.75, 0, '#7b5c3c'),
      box(1.42, 0.82, 0.05, 0, 1.08, 0, '#8d6c49'),
    ]);
    const m = new THREE.Mesh(frame, std);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.72),
      new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.9 })
    );
    face.position.set(0, 1.08, 0.03);
    const g = new THREE.Group();
    g.add(m, face);
    g.position.set(x, y - 0.05, z);
    g.rotation.y = -0.5;
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(g);
    this.colliders.push({ x: x - 0.5, z: z - 0.3, r: 0.2 }, { x: x + 0.5, z: z + 0.3, r: 0.2 });
  }

  /** Lamps come on at dusk. */
  setNight(n) {
    if (Math.abs(n - this.nightAmount) < 0.002) return;
    this.nightAmount = n;
    this.glassMat.emissiveIntensity = n * 5.5;
    this.haloMat.opacity = n * 0.3;
    for (const l of this.lights) l.intensity = n * 34;
  }
}
