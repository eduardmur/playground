import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp } from '../core/utils.js';
import { WORLD, pondNorm } from '../world/terrain.js';
import { CELL } from '../fx/particles.js';

const rand = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _ax = new THREE.Vector3();

function boneGeometry() {
  const parts = [new THREE.CapsuleGeometry(0.026, 0.1, 4, 8).rotateZ(Math.PI / 2)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(new THREE.SphereGeometry(0.036, 10, 8).translate(sx * 0.062, 0, sz * 0.026));
  return mergeGeometries(parts);
}

/** Something a dog can carry in its mouth, with simple bouncing physics. */
class Carryable {
  constructor(game, kind, mesh, opts) {
    this.game = game;
    this.kind = kind;
    this.mesh = mesh;
    this.r = opts.r;
    this.bounce = opts.bounce;
    this.roll = opts.roll; // rolling friction (per second)
    this.pos = mesh.position;
    this.vel = new THREE.Vector3();
    this.holder = null;
    this.rest = false;
    this.kickCool = 0;
    this.hold = opts.hold || { p: [0, 0, 0.02], r: [0, 0, 0] };
    game.items.group.add(mesh);
  }

  speed() {
    return this.vel.length();
  }

  pickUp(dog) {
    if (this.holder) return false;
    this.holder = dog;
    this.rest = false;
    dog.rig.mouth.add(this.mesh);
    this.mesh.position.set(...this.hold.p);
    this.mesh.rotation.set(...this.hold.r);
    this.mesh.scale.setScalar(1 / dog.scale);
    return true;
  }

  /** Let go. A toss sends it sailing ahead of the dog. */
  drop(dog, toss) {
    if (this.holder !== dog) return;
    const g = this.game;
    this.mesh.getWorldPosition(_v);
    g.items.group.add(this.mesh);
    this.mesh.position.copy(_v);
    this.mesh.scale.setScalar(1);
    this.holder = null;
    const fx = Math.sin(dog.heading), fz = Math.cos(dog.heading);
    const f = toss ? dog.speed * 0.95 + (this.kind === 'ball' ? 4.2 : 1.6) : 1.3;
    this.vel.set(fx * f, toss ? (this.kind === 'ball' ? 3.4 : 2.0) : 1.6, fz * f);
    this.kickCool = 0.45;
    if (toss && this.kind === 'ball') g.onBallThrown(this, dog);
  }

  update(dt) {
    if (this.holder) return;
    const g = this.game, terrain = g.terrain, p = this.pos, v = this.vel;
    this.kickCool -= dt;

    // dogs nose it along
    if (this.kickCool <= 0 && this.kind === 'ball') {
      for (const dog of g.dogs) {
        const fx = Math.sin(dog.heading), fz = Math.cos(dog.heading);
        const cx = dog.pos.x + fx * 0.22 * dog.scale, cz = dog.pos.z + fz * 0.22 * dog.scale;
        const dx = p.x - cx, dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        if (d < 0.32 * dog.scale + this.r && Math.abs(p.y - dog.pos.y - 0.2) < 0.5 && dog.speed > 0.4) {
          const k = dog.speed * 1.25 + 0.9;
          v.set(fx * k + (dx / (d || 1)) * 1.1, 1.3 + dog.speed * 0.38, fz * k + (dz / (d || 1)) * 1.1);
          this.kickCool = 0.3;
          this.rest = false;
          g.audio.sfx('boing', { x: p.x, z: p.z });
          if (dog.isPlayer && dog.speed > 3.2) g.onBallThrown(this, dog);
          break;
        }
      }
    }
    if (this.rest) return;

    v.y -= 12.5 * dt;
    p.addScaledVector(v, dt);

    const depth = terrain.waterDepthAt(p.x, p.z);
    const ground = terrain.heightAt(p.x, p.z) + this.r;
    if (depth > this.r && p.y < WORLD.waterLevel + this.r * 0.2) {
      // floats
      if (!this.wet && v.y < -1.5) {
        g.splash(p.x, p.z, 0.6);
        this.wet = true;
      }
      v.y += (WORLD.waterLevel - p.y) * 60 * dt + 12.5 * dt;
      v.multiplyScalar(Math.exp(-2.5 * dt));
      if (Math.random() < dt * 2) g.water.addRipple(p.x, p.z, 0.12);
    } else {
      this.wet = false;
      if (p.y < ground) {
        p.y = ground;
        terrain.normalAt(p.x, p.z, _n);
        const vn = v.dot(_n);
        if (vn < 0) {
          const hard = -vn > 1.2;
          v.addScaledVector(_n, -(1 + (hard ? this.bounce : 0)) * vn);
          v.multiplyScalar(hard ? 0.86 : 1);
          if (hard && -vn > 2) g.audio.sfx('boing', { x: p.x, z: p.z, vol: clamp(-vn / 8, 0.2, 1) });
        }
        // rolling: friction and the pull of the slope
        v.x += _n.x * _n.y * 12.5 * dt;
        v.z += _n.z * _n.y * 12.5 * dt;
        const f = Math.exp(-this.roll * dt);
        v.x *= f;
        v.z *= f;
        if (v.lengthSq() < 0.02) {
          v.set(0, 0, 0);
          this.rest = true;
        }
      }
    }

    // trees, benches, the fence
    for (const c of g.colliders) {
      const dx = p.x - c.x, dz = p.z - c.z, rr = c.r + this.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8 && !c.soft) {
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
        p.x = c.x + nx * rr;
        p.z = c.z + nz * rr;
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) {
          v.x -= 1.6 * vn * nx;
          v.z -= 1.6 * vn * nz;
        }
      }
    }
    const r = Math.hypot(p.x, p.z), lim = WORLD.parkRadius - 0.4;
    if (r > lim) {
      const nx = p.x / r, nz = p.z / r;
      p.x = nx * lim;
      p.z = nz * lim;
      const vn = v.x * nx + v.z * nz;
      if (vn > 0) {
        v.x -= 1.6 * vn * nx;
        v.z -= 1.6 * vn * nz;
      }
    }

    // spin as it rolls
    const hs = Math.hypot(v.x, v.z);
    if (hs > 0.05 && this.kind === 'ball') {
      _ax.set(v.z, 0, -v.x).normalize();
      this.mesh.rotateOnWorldAxis(_ax, (hs / this.r) * dt);
    }
  }
}

export class Items {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'items';
    this.treats = [];
    this.carryables = [];
    this.digs = [];
    this.digging = null;
    this.sparkT = 0;

    this.boneGeo = boneGeometry();
    this.treatMat = new THREE.MeshStandardMaterial({ color: '#edc98c', roughness: 0.6, emissive: '#ffb040', emissiveIntensity: 0.22 });
    this.goldMat = new THREE.MeshStandardMaterial({ color: '#ffd75a', roughness: 0.25, metalness: 0.65, emissive: '#ffb300', emissiveIntensity: 0.55 });
  }

  /** Called once the world exists. */
  populate() {
    const g = this.game;
    for (let i = 0; i < 17; i++) this._spawnTreat(i < 5 ? this._pathSpot() : this._spot());
    // golden bones tucked away in the corners of the park
    const gold = [
      ['hill', WORLD.hill.x - 4.6, WORLD.hill.z - 2.4],
      ['island', WORLD.island.x + 1.1, WORLD.island.z + 1.2],
      ['pines', 51, 37],
      ['fence', -69.5, 2],
    ];
    for (const [id, x, z] of gold) if (!g.save.gold.includes(id)) this._spawnTreat({ x, z }, id);

    // a tennis ball on the lawn, sticks under the trees
    const ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 18, 14),
      new THREE.MeshStandardMaterial({ color: '#cfe645', roughness: 0.8, emissive: '#5f7a00', emissiveIntensity: 0.12 })
    );
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.0745, 0.006, 5, 24), new THREE.MeshStandardMaterial({ color: '#f6f8e6', roughness: 0.8 }));
    seam.rotation.x = 1.1;
    ballMesh.add(seam);
    ballMesh.castShadow = true;
    ballMesh.position.set(-6, g.terrain.heightAt(-6, -20) + 0.075, -20);
    this.ball = new Carryable(g, 'ball', ballMesh, { r: 0.075, bounce: 0.52, roll: 0.75, hold: { p: [0, -0.005, 0.02], r: [0, 0, 0] } });
    this.carryables.push(this.ball);

    const stickGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.016, 0.02, 0.52, 6).rotateZ(Math.PI / 2),
      new THREE.CylinderGeometry(0.008, 0.012, 0.14, 5).rotateZ(0.9).translate(0.12, 0.05, 0),
    ]);
    const stickMat = new THREE.MeshStandardMaterial({ color: '#7a5636', roughness: 1 });
    for (const [x, z] of [[6.5, 21], [-33, -27], [44, -38], [-20, 40]]) {
      const m = new THREE.Mesh(stickGeo, stickMat);
      m.castShadow = true;
      m.position.set(x, g.terrain.heightAt(x, z) + 0.022, z);
      m.rotation.y = Math.random() * TAU;
      const s = new Carryable(g, 'stick', m, { r: 0.022, bounce: 0.1, roll: 6, hold: { p: [0, -0.005, 0.015], r: [0, 0, 0] } });
      s.rest = true;
      this.carryables.push(s);
    }

    // freshly turned earth worth investigating
    const moundGeo = new THREE.SphereGeometry(0.34, 12, 8).scale(1, 0.32, 1);
    const moundMat = new THREE.MeshStandardMaterial({ color: '#6b4a32', roughness: 1 });
    const spots = [[-39, -36, 'dig'], [12, 34, null], [-14, 30, null]];
    for (const [x, z, goldId] of spots) {
      const m = new THREE.Mesh(moundGeo, moundMat);
      m.receiveShadow = true;
      const dig = { x, z, y: 0, mesh: m, gold: goldId && !g.save.gold.includes(goldId) ? goldId : null, hidden: 0 };
      this._placeDig(dig, x, z);
      this.group.add(m);
      this.digs.push(dig);
    }
  }

  _placeDig(dig, x, z) {
    dig.x = x;
    dig.z = z;
    dig.y = this.game.terrain.heightAt(x, z);
    dig.mesh.position.set(x, dig.y + 0.01, z);
    dig.mesh.visible = true;
    dig.hidden = 0;
  }

  _valid(x, z) {
    const g = this.game;
    if (Math.hypot(x, z) > WORLD.parkRadius - 5) return false;
    if (pondNorm(x, z) < 1.14) return false;
    if (g.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.7)) return false;
    return true;
  }

  _spot() {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * (WORLD.parkRadius - 6);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (this._valid(x, z) && !this.treats.some((t) => t.alive && Math.hypot(t.x - x, t.z - z) < 7)) return { x, z };
    }
    return { x: rand(-10, 10), z: rand(10, 30) };
  }

  /** A spot on or beside a path, so there is always something to follow. */
  _pathSpot() {
    const g = this.game;
    for (let i = 0; i < 60; i++) {
      const p = this._spot();
      if (g.terrain.maskAt(p.x, p.z).path > 0.5) return p;
    }
    return this._spot();
  }

  _spawnTreat(p, goldId = null) {
    const g = this.game;
    const m = new THREE.Mesh(this.boneGeo, goldId ? this.goldMat : this.treatMat);
    m.castShadow = true;
    const s = goldId ? 1.7 : 1.25;
    m.scale.setScalar(s);
    const t = { x: p.x, z: p.z, y: g.terrain.heightAt(p.x, p.z) + 0.24, mesh: m, alive: true, respawn: 0, gold: goldId, phase: Math.random() * TAU, pop: 0 };
    m.position.set(t.x, t.y, t.z);
    this.group.add(m);
    this.treats.push(t);
    return t;
  }

  nearestTreat(pos, maxDist) {
    let best = null, bd = maxDist;
    for (const t of this.treats) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - pos.x, t.z - pos.z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  nearestCarryable(pos, maxDist) {
    let best = null, bd = maxDist;
    for (const c of this.carryables) {
      if (c.holder) continue;
      const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
      if (d < bd && Math.abs(c.pos.y - pos.y) < 0.8) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  nearestDig(pos, maxDist) {
    for (const d of this.digs) {
      if (!d.hidden && Math.hypot(d.x - pos.x, d.z - pos.z) < maxDist) return d;
    }
    return null;
  }

  dig(spot, player) {
    const g = this.game, dog = player.dog;
    dog.heading = Math.atan2(spot.x - dog.pos.x, spot.z - dog.pos.z);
    if (!dog.doAct('dig')) return;
    this.digging = { spot, t: 0, dog, puff: 0 };
    g.audio.sfx('dig', { x: spot.x, z: spot.z });
  }

  update(dt, t) {
    const g = this.game;
    const pdog = g.player.dog;

    // treats bob and turn; dogs gobble them
    this.sparkT -= dt;
    const sparkle = this.sparkT <= 0;
    if (sparkle) this.sparkT = 0.28;
    for (const tr of this.treats) {
      if (!tr.alive) {
        if (!tr.gold) {
          tr.respawn -= dt;
          if (tr.respawn <= 0) {
            const p = Math.random() < 0.3 ? this._pathSpot() : this._spot();
            tr.x = p.x;
            tr.z = p.z;
            tr.y = g.terrain.heightAt(p.x, p.z) + 0.24;
            tr.alive = true;
            tr.pop = 0;
            tr.mesh.visible = true;
          }
        }
        continue;
      }
      tr.pop = Math.min(1, tr.pop + dt * 2.5);
      const s = (tr.gold ? 1.7 : 1.25) * (0.3 + 0.7 * tr.pop);
      tr.mesh.scale.setScalar(s);
      tr.mesh.position.set(tr.x, tr.y + Math.sin(t * 2.1 + tr.phase) * 0.04, tr.z);
      tr.mesh.rotation.set(0.35, t * 1.3 + tr.phase, 0.25);
      const dp = Math.hypot(tr.x - pdog.pos.x, tr.z - pdog.pos.z);
      if (sparkle && dp < 26 && Math.random() < (tr.gold ? 0.6 : 0.22)) {
        g.glow.spawn({
          x: tr.x + rand(-0.14, 0.14), y: tr.y + rand(-0.05, 0.2), z: tr.z + rand(-0.14, 0.14), vy: 0.18,
          life: 0.9, size: tr.gold ? 0.11 : 0.075, sizeEnd: 0.02, color: tr.gold ? '#ffe27a' : '#ffd9a0', cell: CELL.SPARK,
          alpha: 0.9, rotv: 2, fadeIn: 0.2, fadeOut: 0.6,
        });
      }
      for (const dog of g.dogs) {
        if (!dog.isPlayer && !(dog.npc && (dog.npc.traits.hungry || dog.npc.state === 'treat'))) continue;
        if (dog.isPlayer && g.state !== 'play') continue;
        if (dog.npc && tr.gold) continue;
        const reach = (dog.dims.Lh + dog.dims.hr * 1.5) * dog.scale;
        const mx = dog.pos.x + Math.sin(dog.heading) * reach, mz = dog.pos.z + Math.cos(dog.heading) * reach;
        if (Math.hypot(tr.x - mx, tr.z - mz) < 0.46 * Math.max(dog.scale, 0.9) && dog.air < 0.6 && Math.abs(tr.y - 0.24 - dog.pos.y) < 0.9) {
          tr.alive = false;
          tr.mesh.visible = false;
          tr.respawn = rand(35, 70);
          dog.doAct('eat');
          g.onTreat(dog, tr);
          break;
        }
      }
    }

    for (const c of this.carryables) c.update(dt);

    // digging: dirt flies, then something turns up
    const dg = this.digging;
    if (dg) {
      dg.t += dt;
      dg.puff -= dt;
      if (dg.dog.actName !== 'dig') {
        this.digging = null;
      } else {
        if (dg.puff <= 0 && dg.t > 0.3 && dg.t < 2.1) {
          dg.puff = 0.07;
          const a = dg.dog.heading + Math.PI + rand(-0.5, 0.5);
          g.fx.spawn({
            x: dg.spot.x + rand(-0.1, 0.1), y: dg.spot.y + 0.08, z: dg.spot.z + rand(-0.1, 0.1),
            vx: Math.sin(a) * rand(1, 2.4), vy: rand(1.4, 2.8), vz: Math.cos(a) * rand(1, 2.4),
            life: rand(0.5, 0.9), size: rand(0.06, 0.12), color: '#6b4a32', gravity: 9, cell: CELL.DROP, fadeOut: 0.3,
          });
        }
        if (dg.t > 2.15) {
          const spot = dg.spot;
          spot.mesh.visible = false;
          spot.hidden = rand(70, 110);
          const a = dg.dog.heading + rand(-0.6, 0.6);
          const p = { x: spot.x + Math.sin(a) * 0.9, z: spot.z + Math.cos(a) * 0.9 };
          this._spawnTreat(p, spot.gold);
          if (!spot.gold) this._spawnTreat({ x: spot.x - Math.sin(a) * 0.7, z: spot.z - Math.cos(a) * 0.7 });
          spot.gold = null;
          g.sparkle(spot.x, spot.y + 0.3, spot.z, '#ffe9a8', 12);
          g.audio.sfx('chime', { x: spot.x, z: spot.z });
          g.joys.unlock('dig');
          this.digging = null;
        }
      }
    }
    for (const d of this.digs) {
      if (d.hidden > 0) {
        d.hidden -= dt;
        if (d.hidden <= 0) {
          const p = this._spot();
          this._placeDig(d, p.x, p.z);
        }
      } else if (sparkle && Math.random() < 0.25 && Math.hypot(d.x - pdog.pos.x, d.z - pdog.pos.z) < 22) {
        g.glow.spawn({
          x: d.x + rand(-0.25, 0.25), y: d.y + rand(0.1, 0.4), z: d.z + rand(-0.25, 0.25), vy: 0.25,
          life: 1.0, size: 0.07, sizeEnd: 0.02, color: '#fff0c0', cell: CELL.SPARK, alpha: 0.8, rotv: 2, fadeIn: 0.2, fadeOut: 0.6,
        });
      }
    }
  }
}
