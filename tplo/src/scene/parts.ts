// The things in the scene that are not bone: ligaments, the saw blade, screws, the wire.
import * as THREE from 'three';
import { TINT, steel } from './materials';

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/**
 * A band of unit length along +Y and unit radius, to be stretched between two points.
 * `frayed` tapers the far end to a ragged tip, for a torn ligament.
 */
export function bandGeometry(frayed = false): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let r = 1 - 0.14 * Math.sin(Math.PI * t); // a little narrower in the middle
    if (frayed) r *= 1 - 0.82 * Math.pow(t, 1.7);
    pts.push(new THREE.Vector2(r, t));
  }
  pts.push(new THREE.Vector2(0, 1));
  const g = new THREE.LatheGeometry(pts, 20);
  if (frayed) {
    // pull the tip into a few uneven strands
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const k = Math.pow(y, 3);
      p.setY(i, y - k * 0.22 * (0.5 + 0.5 * Math.sin(a * 3 + 1.3)));
    }
    g.computeVertexNormals();
  }
  return g;
}

const _d = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
/** Stretch a band from one point to another. `wide` is its half-width across Z, `thick` the other way. */
export function stretch(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, wide: number, thick: number, portion = 1): void {
  _d.subVectors(to, from);
  const len = _d.length() * portion;
  _d.normalize();
  _z.copy(Z).addScaledVector(_d, -Z.dot(_d)).normalize();
  _x.crossVectors(_d, _z);
  mesh.matrix.makeBasis(_x.multiplyScalar(thick), _d.multiplyScalar(len), _z.multiplyScalar(wide));
  mesh.matrix.setPosition(from);
  mesh.matrixWorldNeedsUpdate = true;
}

export function ligamentMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: TINT.ligament, roughness: 0.42, metalness: 0 });
}

/**
 * The saw blade: a slice of a tube with teeth on its leading rim, on an arbor. Its axis is Z and
 * it cuts towards -Z; z = 0 is the tip of the teeth.
 */
export function sawBlade(radius: number, kerf: number): THREE.Group {
  const group = new THREE.Group();
  const from = THREE.MathUtils.degToRad(-142);
  const sweep = THREE.MathUtils.degToRad(160);
  const depth = 44;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius + kerf / 2, from, from + sweep, false);
  shape.absarc(0, 0, radius - kerf / 2, from + sweep, from, true);
  shape.closePath();
  const shell = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 120, steps: 1 });
  const p = shell.getAttribute('position');
  const pitch = 1.9;
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) > 0.01) continue;
    const s = (Math.atan2(p.getY(i), p.getX(i)) - from) * radius;
    const saw = Math.abs(((s / pitch) % 1) - 0.5) * 2;
    p.setZ(i, saw * 1.25);
  }
  shell.computeVertexNormals();
  const metal = steel({ roughness: 0.42, metalness: 0.9, color: new THREE.Color('#dfe2e5'), side: THREE.DoubleSide });
  group.add(new THREE.Mesh(shell, metal));

  // a narrow arm joins the shell to the arbor the saw holds
  const mid = from + sweep / 2;
  const arm = new THREE.Shape();
  arm.moveTo(0, 0);
  arm.absarc(0, 0, radius + kerf / 2, mid - 0.2, mid + 0.2, false);
  arm.closePath();
  const armMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(arm, { depth: 1.6, bevelEnabled: false, curveSegments: 16 }), metal);
  armMesh.position.z = depth - 1.6;
  group.add(armMesh);
  const arbor = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 52, 28), metal);
  arbor.rotation.x = Math.PI / 2;
  arbor.position.z = depth + 24;
  group.add(arbor);
  return group;
}

/** A bone screw with its head at z = 0 and its shaft along -Z. */
export function screw(length: number): THREE.Group {
  const group = new THREE.Group();
  const metal = steel({ roughness: 0.28 });
  // head: a low dome with a conical underside that sits in the plate's countersink
  const head = new THREE.LatheGeometry(
    [new THREE.Vector2(0, 0.55), new THREE.Vector2(1.6, 0.5), new THREE.Vector2(2.9, 0.1), new THREE.Vector2(3.15, -0.5), new THREE.Vector2(2.0, -2.0), new THREE.Vector2(1.75, -2.2)],
    40,
  );
  // threads as rings: enough to read as a thread at this size
  const pts: THREE.Vector2[] = [];
  const pitch = 1.25;
  for (let y = -2.2; y > -length + 1.6; y -= pitch / 2) pts.push(new THREE.Vector2(pts.length % 2 ? 1.28 : 1.75, y));
  pts.push(new THREE.Vector2(1.3, -length + 1.6), new THREE.Vector2(0, -length));
  const shaft = new THREE.LatheGeometry(pts, 20);
  for (const g of [head, shaft]) {
    const m = new THREE.Mesh(g, metal);
    m.rotation.x = Math.PI / 2; // lathe axis Y -> Z
    m.castShadow = true;
    group.add(m);
  }
  // the driver recess
  const recess = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.1, 0.5, 6), new THREE.MeshStandardMaterial({ color: '#2a2c2f', roughness: 0.6, metalness: 0.6 }));
  recess.rotation.x = Math.PI / 2;
  recess.position.z = 0.4;
  group.add(recess);
  return group;
}

/** A smooth wire from one point to another. */
export function wireMesh(from: THREE.Vector3, to: THREE.Vector3, radius: number): THREE.Mesh {
  const len = from.distanceTo(to);
  const g = new THREE.CylinderGeometry(radius, radius, len, 16);
  g.translate(0, len / 2, 0);
  const m = new THREE.Mesh(g, steel({ roughness: 0.25 }));
  m.position.copy(from);
  m.quaternion.setFromUnitVectors(Y, to.clone().sub(from).normalize());
  m.castShadow = true;
  return m;
}
