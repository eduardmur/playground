import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, damp, lerp, mulberry32 } from '../core/utils.js';
import { addSway, shared } from '../world/shared.js';
import { WORLD, pondNorm } from '../world/terrain.js';

const rand = (a, b) => a + Math.random() * (b - a);

function tinted(geo, hex, tint) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
  return geo;
}

// ============================================================== birds

const FLOCKS = [
  { x: 3.5, z: 3.2, n: 8, color: '#8f98a8', size: 1.25 }, // pigeons on the plaza
  { x: -12, z: -22, n: 7, color: '#9b6f48', size: 0.95 }, // sparrows on the lawn
  { x: 24, z: 30, n: 7, color: '#c98a4e', size: 0.9 },
  { x: -24, z: 8, n: 6, color: '#6e8fc4', size: 0.95 }, // bluebirds
  { x: 6, z: 40, n: 7, color: '#a47a55', size: 0.95 },
  { x: 40, z: 6, n: 6, color: '#e8e4dc', size: 1.1 }, // doves
];

/**
 * Small flocks that peck about on the ground and burst into the air when a
 * dog comes bounding up, circle for a while, then settle somewhere quieter.
 */
export class Birds {
  constructor(game) {
    this.game = game;
    const body = mergeGeometries([
      tinted(new THREE.SphereGeometry(1, 10, 8).scale(0.045, 0.043, 0.068).translate(0, 0.05, 0), '#ffffff', 1),
      tinted(new THREE.SphereGeometry(0.031, 9, 7).translate(0, 0.088, 0.05), '#ffffff', 1),
      tinted(new THREE.ConeGeometry(0.011, 0.03, 5).rotateX(Math.PI / 2).translate(0, 0.085, 0.09), '#e8973a', 0),
      tinted(new THREE.SphereGeometry(1, 6, 5).scale(0.022, 0.007, 0.05).translate(0, 0.052, -0.085), '#d9d9d9', 1),
      tinted(new THREE.SphereGeometry(0.0055, 5, 4).translate(0.02, 0.096, 0.068), '#15110f', 0),
      tinted(new THREE.SphereGeometry(0.0055, 5, 4).translate(-0.02, 0.096, 0.068), '#15110f', 0),
    ]);
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.035, 0, 0, -0.04, 0.125, 0, -0.03, 0.1, 0, 0.012], 3));
    wing.setIndex([0, 1, 2, 0, 2, 3]);
    wing.computeVertexNormals();
    wing.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
    tinted(wing, '#dcdcdc', 1);

    this.birds = [];
    this.flocks = FLOCKS.map((f) => ({
      ...f, cx: f.x, cz: f.z, state: 'ground', timer: 0, tx: f.x, ty: 0, tz: f.z, orbit: Math.random() * TAU, birds: [],
    }));
    for (const f of this.flocks) {
      for (let i = 0; i < f.n; i++) {
        const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * 1.6;
        const b = {
          flock: f, x: f.x + Math.cos(a) * d, z: f.z + Math.sin(a) * d, y: 0, vx: 0, vy: 0, vz: 0,
          yaw: Math.random() * TAU, pitch: 0, roll: 0, mode: 0, t: Math.random() * 3, hop: 0, hx: 0, hz: 0, sx: 0, sz: 0,
          peck: 0, flap: Math.random() * TAU, delay: 0, ox: rand(-1.6, 1.6), oy: rand(-0.6, 0.8), oz: rand(-1.6, 1.6),
          size: f.size * rand(0.9, 1.1), fold: 1,
        };
        b.y = game.terrain.heightAt(b.x, b.z);
        f.birds.push(b);
        this.birds.push(b);
      }
    }
    const n = this.birds.length;
    const mat = addSway(new THREE.MeshLambertMaterial({ vertexColors: true }), 0, { tintMask: true });
    const wingMat = addSway(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0, { tintMask: true });
    this.bodyMesh = new THREE.InstancedMesh(body, mat, n);
    this.wingL = new THREE.InstancedMesh(wing, wingMat, n);
    this.wingR = new THREE.InstancedMesh(wing, wingMat, n);
    const c = new THREE.Color();
    this.birds.forEach((b, i) => {
      c.set(b.flock.color).offsetHSL(rand(-0.01, 0.01), 0, rand(-0.05, 0.05));
      this.bodyMesh.setColorAt(i, c);
      c.multiplyScalar(0.78);
      this.wingL.setColorAt(i, c);
      this.wingR.setColorAt(i, c);
    });
    for (const m of [this.bodyMesh, this.wingL, this.wingR]) {
      m.frustumCulled = false;
      m.castShadow = true;
      m.instanceColor.needsUpdate = true;
    }
    this.group = new THREE.Group();
    this.group.add(this.bodyMesh, this.wingL, this.wingR);
    this._d = new THREE.Object3D();
    this._w = new THREE.Object3D();
    this._m = new THREE.Matrix4();
  }

  _landingSpot(f) {
    const g = this.game;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * (WORLD.parkRadius - 8);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (pondNorm(x, z) < 1.2) continue;
      if (g.dogs.some((dg) => Math.hypot(dg.pos.x - x, dg.pos.z - z) < 15)) continue;
      if (g.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 1.5)) continue;
      return { x, z };
    }
    return { x: f.x, z: f.z };
  }

  /** Startle every flock near a point (a bark, a splash). */
  startle(x, z, radius, byPlayer) {
    for (const f of this.flocks) {
      if (f.state === 'ground' && Math.hypot(f.cx - x, f.cz - z) < radius) this._scatter(f, x, z, byPlayer);
    }
  }

  _scatter(f, tx, tz, byPlayer) {
    const g = this.game;
    f.state = 'flee';
    f.timer = 1.3;
    let ax = f.cx - tx, az = f.cz - tz;
    const l = Math.hypot(ax, az) || 1;
    ax /= l;
    az /= l;
    f.tx = f.cx + ax * 12;
    f.tz = f.cz + az * 12;
    f.ty = g.terrain.heightAt(f.cx, f.cz) + 7.5;
    for (const b of f.birds) {
      b.delay = Math.random() * 0.35;
      b.mode = 1;
      b.vx = ax * rand(1, 3) + rand(-1.5, 1.5);
      b.vz = az * rand(1, 3) + rand(-1.5, 1.5);
      b.vy = rand(2.5, 4.5);
    }
    g.audio.sfx('flutter', { x: f.cx, z: f.cz });
    if (byPlayer) g.onBirds();
  }

  update(dt, t) {
    const g = this.game, terrain = g.terrain;
    const day = g.sky.night < 0.75;

    for (const f of this.flocks) {
      if (f.state === 'ground') {
        // any dog bounding up?
        for (const dg of g.dogs) {
          const d = Math.hypot(dg.pos.x - f.cx, dg.pos.z - f.cz);
          if (d < 3.4 + clamp(dg.speed, 0, 6) * 0.45) {
            this._scatter(f, dg.pos.x, dg.pos.z, !!dg.isPlayer);
            break;
          }
        }
      } else {
        f.timer -= dt;
        if (f.state === 'flee' && f.timer <= 0) {
          f.state = 'circle';
          f.timer = rand(5, 9);
          // circle over somewhere toward the middle of the park
          f.ox = f.cx * 0.6 + rand(-10, 10);
          f.oz = f.cz * 0.6 + rand(-10, 10);
        }
        if (f.state === 'circle') {
          f.orbit += dt * 0.75;
          f.tx = f.ox + Math.cos(f.orbit) * 9;
          f.tz = f.oz + Math.sin(f.orbit) * 9;
          f.ty = terrain.heightAt(f.tx, f.tz) + 8 + Math.sin(f.orbit * 0.7) * 1.5;
          if (f.timer <= 0) {
            const s = this._landingSpot(f);
            f.cx = s.x;
            f.cz = s.z;
            f.state = 'land';
            f.timer = 12;
            for (const b of f.birds) {
              const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * 1.7;
              b.hx = s.x + Math.cos(a) * d;
              b.hz = s.z + Math.sin(a) * d;
            }
          }
        }
        if (f.state === 'land' && f.birds.every((b) => b.mode === 0)) f.state = 'ground';
      }
    }

    const d = this._d, w = this._w, m = this._m;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i], f = b.flock;
      if (b.mode === 0) {
        // on the ground: hop, peck, look about
        b.t -= dt;
        if (b.hop > 0) {
          b.hop -= dt / 0.24;
          const k = 1 - clamp(b.hop, 0, 1);
          b.x = lerp(b.sx, b.hx, k);
          b.z = lerp(b.sz, b.hz, k);
          b.y = terrain.heightAt(b.x, b.z) + Math.sin(Math.PI * k) * 0.07;
        } else {
          b.y = terrain.heightAt(b.x, b.z);
          if (b.t <= 0) {
            b.t = rand(0.5, 3.2) * (day ? 1 : 4);
            if (Math.random() < 0.55) {
              const a = Math.random() * TAU, dd = Math.sqrt(Math.random()) * 1.7;
              b.sx = b.x;
              b.sz = b.z;
              b.hx = f.cx + Math.cos(a) * dd;
              b.hz = f.cz + Math.sin(a) * dd;
              b.yaw = Math.atan2(b.hx - b.x, b.hz - b.z);
              b.hop = 1;
            } else if (Math.random() < 0.7) {
              b.peck = 1;
            } else {
              b.yaw += rand(-1.5, 1.5);
            }
          }
        }
        b.peck = Math.max(0, b.peck - dt * 3.2);
        b.pitch = Math.sin(Math.min(1, b.peck) * Math.PI) * 0.75;
        b.roll = 0;
        b.fold = damp(b.fold, 1, 10, dt);
      } else {
        // in the air
        b.delay -= dt;
        if (b.delay > 0) continue;
        let tx, ty, tz, speed;
        if (f.state === 'land') {
          tx = b.hx;
          tz = b.hz;
          ty = terrain.heightAt(tx, tz) + 0.05;
          speed = 6;
        } else {
          tx = f.tx + b.ox;
          ty = f.ty + b.oy;
          tz = f.tz + b.oz;
          speed = f.state === 'flee' ? 8.5 : 7;
        }
        let dx = tx - b.x, dy = ty - b.y, dz = tz - b.z;
        const dist = Math.hypot(dx, dy, dz) || 1e-4;
        if (f.state === 'land') {
          speed = Math.min(speed, 1.2 + dist * 1.6);
          if (dist < 0.3) {
            b.mode = 0;
            b.x = tx;
            b.z = tz;
            b.y = ty - 0.05;
            b.hop = 0;
            b.t = rand(0.3, 1.5);
            b.vx = b.vy = b.vz = 0;
            continue;
          }
        }
        const k = 1 - Math.exp(-2.4 * dt);
        b.vx += ((dx / dist) * speed - b.vx) * k;
        b.vy += ((dy / dist) * speed - b.vy) * k;
        b.vz += ((dz / dist) * speed - b.vz) * k;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;
        const floor = terrain.heightAt(b.x, b.z) + 0.05;
        if (b.y < floor) b.y = floor;
        const hs = Math.hypot(b.vx, b.vz);
        const yaw = Math.atan2(b.vx, b.vz);
        let dyaw = yaw - b.yaw;
        dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        b.yaw += dyaw * Math.min(1, dt * 8);
        b.roll = damp(b.roll, clamp(-dyaw * 2.2, -0.8, 0.8), 6, dt);
        b.pitch = damp(b.pitch, clamp(-Math.atan2(b.vy, hs + 0.5), -0.7, 0.7), 6, dt);
        b.flap += dt * (20 + Math.max(0, b.vy) * 2.5);
        b.fold = damp(b.fold, 0, 12, dt);
      }

      d.position.set(b.x, b.y, b.z);
      d.rotation.set(b.pitch, b.yaw, b.roll, 'YXZ');
      d.scale.setScalar(b.size);
      d.updateMatrix();
      this.bodyMesh.setMatrixAt(i, d.matrix);
      const flap = b.mode === 0 && b.fold > 0.95 ? 0 : Math.sin(b.flap) * 1.0 + 0.15;
      for (const s of [1, -1]) {
        w.position.set(s * 0.03, 0.066, 0.0);
        // folded: tucked back along the body; flying: beating up and down
        w.rotation.set(0, s * b.fold * 1.25, s * lerp(flap, -0.25, b.fold), 'YZX');
        w.scale.set(s * lerp(1, 0.72, b.fold), 1, 1);
        w.updateMatrix();
        m.multiplyMatrices(d.matrix, w.matrix);
        (s > 0 ? this.wingL : this.wingR).setMatrixAt(i, m);
      }
    }
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.wingL.instanceMatrix.needsUpdate = true;
    this.wingR.instanceMatrix.needsUpdate = true;
  }
}

// ========================================================= butterflies

export class Butterflies {
  constructor(game, patches, count = 26) {
    this.game = game;
    const rnd = mulberry32(99);
    const geo = new THREE.BufferGeometry();
    // two wings meeting along the body (x = 0)
    const pts = [];
    const idx = [];
    for (const s of [1, -1]) {
      const b = pts.length / 3;
      pts.push(0, 0, -0.028, 0, 0, 0.034, s * 0.062, 0, 0.056, s * 0.058, 0, -0.012, s * 0.04, 0, -0.05);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 3, b + 4);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) phase[i] = rnd() * TAU;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));

    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = shared.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
          float bfA = sin(uTime * 15.0 + aPhase) * 1.0 + 0.35;
          transformed.y = abs(position.x) * sin(bfA);
          transformed.x = position.x * cos(bfA);`
        );
    };
    mat.customProgramCacheKey = () => 'butterfly';
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    const colors = ['#ffffff', '#ffe066', '#ffa64d', '#8fc1ff', '#ff9ec6', '#fff4b8', '#c7a6ff'];
    const c = new THREE.Color();
    this.list = [];
    const spots = patches.length ? patches : [{ x: 0, z: 20, r: 4 }];
    for (let i = 0; i < count; i++) {
      const p = spots[Math.floor(rnd() * spots.length)];
      const b = {
        home: p, x: p.x + (rnd() - 0.5) * p.r, z: p.z + (rnd() - 0.5) * p.r, y: 0, h: 0.5 + rnd() * 0.6,
        heading: rnd() * TAU, turn: 0, t: rnd() * 10, speed: 0.5 + rnd() * 0.6, scare: 0, seed: rnd() * 100, vis: 1,
      };
      b.y = game.terrain.heightAt(b.x, b.z) + b.h;
      this.list.push(b);
      this.mesh.setColorAt(i, c.set(colors[Math.floor(rnd() * colors.length)]));
    }
    this.mesh.instanceColor.needsUpdate = true;
    this._d = new THREE.Object3D();
    this.chase = 0;
  }

  update(dt, t) {
    const g = this.game, terrain = g.terrain, d = this._d;
    const pdog = g.player.dog;
    const awake = 1 - g.sky.night;
    let chased = false;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      b.vis = damp(b.vis, awake > 0.4 ? 1 : 0, 2, dt);
      // wander around the home patch
      b.t += dt;
      const hx = b.home.x - b.x, hz = b.home.z - b.z;
      const hd = Math.hypot(hx, hz);
      let want = b.heading + Math.sin(b.t * 0.9 + b.seed) * 1.4 * dt * 4;
      if (hd > b.home.r + 2) {
        const toHome = Math.atan2(hx, hz);
        want = b.heading + Math.atan2(Math.sin(toHome - b.heading), Math.cos(toHome - b.heading)) * dt * 2.2;
      }
      // dogs are big and loud: flit away
      let speed = b.speed;
      for (const dg of g.dogs) {
        const dx = b.x - dg.pos.x, dz = b.z - dg.pos.z;
        const dd = Math.hypot(dx, dz);
        if (dd < 1.5) {
          const away = Math.atan2(dx, dz);
          want = b.heading + Math.atan2(Math.sin(away - b.heading), Math.cos(away - b.heading)) * dt * 9;
          b.scare = 1;
          if (dg === pdog && dg.speed > 1 && b.vis > 0.5) chased = true;
        }
      }
      b.scare = Math.max(0, b.scare - dt * 0.7);
      speed += b.scare * 2.2;
      b.heading = want;
      b.x += Math.sin(b.heading) * speed * dt;
      b.z += Math.cos(b.heading) * speed * dt;
      const ground = Math.max(terrain.heightAt(b.x, b.z), WORLD.waterLevel);
      const ty = ground + b.h + b.scare * 1.1 + Math.sin(b.t * 5.5 + b.seed) * 0.09;
      b.y = damp(b.y, ty, 4, dt);
      d.position.set(b.x, b.y, b.z);
      d.rotation.set(0.25, b.heading, Math.sin(b.t * 3 + b.seed) * 0.2, 'YXZ');
      d.scale.setScalar(Math.max(b.vis, 0.001) * 1.15);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (chased) {
      this.chase += dt;
      if (this.chase > 2.5) g.joys.unlock('butterfly');
    }
  }
}
