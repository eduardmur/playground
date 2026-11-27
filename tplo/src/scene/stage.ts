// The 3D scene: the stifle, the instruments and the implants, and one function that poses them.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadGeometry, model, type MeshName } from '../model/load';
import { TINT, bake, clip, glass, newCut, solid, steel, tuneGlass } from './materials';
import { bandGeometry, ligamentMaterial, sawBlade, screw, stretch, wireMesh } from './parts';

const RAD = Math.PI / 180;
const v3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);

/** Everything about the scene that changes from one moment of the walkthrough to the next. */
export interface Pose {
  glass: number; // femur and patella seen through, 0..1
  xray: number; // everything as on a radiograph
  soft: number; // cruciate ligaments and menisci shown
  focus: number; // the cranial cruciate ligament is picked out
  tear: number; // the cranial cruciate ligament is torn
  debride: number; // its remnants are removed
  load: number; // weight on the limb
  saw: number; // the blade is brought to the bone
  plunge: number; // the blade goes through
  cut: number; // the saw has gone all the way through
  turn: number; // the plateau segment is rotated, 0..1 of the planned angle
  wire: number; // the temporary wire is in
  plate: number; // the plate is on
  screws: number; // how many screws are in, 0..6
  meniscus: number; // the medial meniscus is picked out
}
export const REST: Pose = { glass: 0, xray: 0, soft: 1, focus: 0, tear: 0, debride: 0, load: 0, saw: 0, plunge: 0, cut: 0, turn: 0, wire: 0, plate: 0, screws: 0, meniscus: 0 };

/**
 * A camera position, in the model's own terms: azimuth 0 looks at the medial side, 90 at the front
 * of the limb, 180 at the lateral side; the target is a point of the model.
 */
export interface View { azimuth: number; polar: number; distance: number; target: [number, number, number] }

/** Where the blade's tip is when it touches the bone, and how far it then travels (mm along Z). */
const SAW_START = 25;
const SAW_TRAVEL = 52;

/** How far the unrestrained tibia slides forward under load, in millimetres. */
export const THRUST = 7;

interface Bone { solid: THREE.Mesh; glass: THREE.Mesh; metal?: boolean }
/** What a point of the model is attached to. */
export type Part = 'femur' | 'shaft' | 'fragment';

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(22, 1, 10, 4000);
  readonly controls: OrbitControls;

  /**
   * Everything hangs from this. The model is built as a left stifle; mirrored, it is a right one, and
   * seen from its medial side the front of the limb is on the left, as on a radiograph.
   */
  readonly root = new THREE.Group();
  /** The femur with the patella. */
  readonly femur = new THREE.Group();
  /** Everything below the joint: it moves as one when the tibia slides. */
  readonly tibia = new THREE.Group();
  /** The plateau segment, with the menisci on it. Turns about Z. */
  readonly fragment = new THREE.Group();

  dirty = true;
  dark = true;
  private bones: Record<string, Bone> = {};
  private rim = new THREE.DirectionalLight(0xdfe8ff, 1.1);
  private key = new THREE.DirectionalLight(0xfff6ea, 2.5);
  private fibula = new THREE.Group();
  private cut = newCut(model.radius);
  private faces: THREE.Mesh[] = [];
  private saw!: THREE.Group;
  private plate!: Bone;
  private screws: THREE.Group[] = [];
  private screwGlass: THREE.Mesh[] = [];
  private wire!: THREE.Mesh;
  private wireFrom = v3(model.wire.from);
  private wireTo = v3(model.wire.to);
  private lig!: {
    patellar: THREE.Mesh; cranial: THREE.Mesh; caudal: THREE.Mesh; stumpA: THREE.Mesh; stumpB: THREE.Mesh;
    cranialMat: THREE.MeshStandardMaterial; stumpMat: THREE.MeshStandardMaterial; softMat: THREE.MeshStandardMaterial;
  };
  private menisci: THREE.Mesh[] = [];
  private meniscusMat!: THREE.MeshStandardMaterial;
  private medialMat!: THREE.MeshStandardMaterial;
  private glassMats: { m: THREE.ShaderMaterial; metal: boolean }[] = [];
  private fly: { from: View; to: View; t: number; dur: number } | null = null;
  private slide = new THREE.Vector3();

  constructor(readonly canvas: HTMLCanvasElement) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.28;
    pmrem.dispose();

    // one soft key that follows the camera, so the model is lit the same from every side
    const k = this.key;
    k.castShadow = true;
    k.shadow.mapSize.set(2048, 2048);
    k.shadow.camera.left = k.shadow.camera.bottom = -150;
    k.shadow.camera.right = k.shadow.camera.top = 150;
    k.shadow.camera.near = 100;
    k.shadow.camera.far = 1200;
    k.shadow.bias = -0.0006;
    k.shadow.normalBias = 0.9;
    k.shadow.radius = 5;
    this.scene.add(k, k.target);
    // a cool light from behind lifts the far edge off the ground
    this.rim.position.set(0, 0, 0);
    this.scene.add(this.rim, this.rim.target);

    const c = (this.controls = new OrbitControls(this.camera, canvas));
    c.enableDamping = true;
    c.dampingFactor = 0.09;
    c.rotateSpeed = 0.75;
    c.zoomSpeed = 0.8;
    c.minDistance = 220;
    c.maxDistance = 1500;
    c.enablePan = true;
    c.screenSpacePanning = true;
    c.addEventListener('change', () => { this.dirty = true; });
    c.addEventListener('start', () => { this.fly = null; });
    this.setView({ azimuth: 35, polar: 80, distance: 640, target: [2, 6, 0] });
    this.root.scale.x = -1;
    this.scene.add(this.root);
    this.root.add(this.femur, this.tibia);
    this.tibia.add(this.fragment, this.fibula);
    this.root.updateMatrixWorld(true);
  }

  async load(): Promise<void> {
    const g = await loadGeometry();
    const bone = (key: string, name: MeshName, parent: THREE.Object3D, opts: { tint?: THREE.Color; metal?: boolean; side?: number } = {}): Bone => {
      const geometry = g[name].hasAttribute('color') ? g[name] : bake(g[name], opts.tint ?? TINT.bone, opts.metal ? 0.5 : 0.85);
      const sm = opts.metal ? steel({ vertexColors: true }) : solid(opts.tint ?? TINT.bone);
      const s = new THREE.Mesh(geometry, opts.side ? clip(sm, this.cut, opts.side) : sm);
      s.castShadow = s.receiveShadow = true;
      if (opts.side) s.customDepthMaterial = clip(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), this.cut, opts.side);
      const gm = opts.side ? glass(this.cut, opts.side) : glass();
      this.glassMats.push({ m: gm, metal: !!opts.metal });
      const x = new THREE.Mesh(geometry, gm);
      x.visible = false;
      x.renderOrder = 2;
      parent.add(s, x);
      return (this.bones[key] = { solid: s, glass: x, metal: opts.metal });
    };

    bone('femur', 'femur', this.femur);
    bone('patella', 'patella', this.femur);
    bone('talus', 'talus', this.tibia);
    // the tibia is drawn twice: what lies outside the blade's circle, and what lies inside it
    bone('shaft', 'tibia', this.tibia, { side: -1 });
    bone('fragment', 'tibia', this.fragment, { side: 1 });
    // the two sawn faces
    const sawn = new THREE.MeshStandardMaterial({ color: TINT.cut, roughness: 0.85 });
    for (const [name, parent] of [['cutShaft', this.tibia], ['cutFragment', this.fragment]] as const) {
      const m = new THREE.Mesh(g[name], sawn);
      m.receiveShadow = true;
      parent.add(m);
      this.faces.push(m);
    }

    // the fibula is thin enough to give a little when the plateau segment turns: it hinges at its far end
    this.fibula.position.set(-3, -205, -14);
    const fib = bone('fibula', 'fibula', this.fibula);
    fib.solid.position.copy(this.fibula.position).negate();
    fib.glass.position.copy(fib.solid.position);

    // menisci ride on the plateau segment
    this.meniscusMat = new THREE.MeshStandardMaterial({ color: TINT.meniscus, roughness: 0.5, vertexColors: true, transparent: true });
    this.medialMat = this.meniscusMat.clone();
    for (const [name, mat] of [['meniscusMedial', this.medialMat], ['meniscusLateral', this.meniscusMat]] as const) {
      const m = new THREE.Mesh(bake(g[name], TINT.meniscus, 0.5), mat);
      m.castShadow = m.receiveShadow = true;
      this.fragment.add(m);
      this.menisci.push(m);
    }

    // ligaments
    const softMat = ligamentMaterial();
    const cranialMat = ligamentMaterial();
    const stumpMat = ligamentMaterial();
    for (const m of [softMat, cranialMat, stumpMat]) m.transparent = true;
    const band = bandGeometry();
    const stump = bandGeometry(true);
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.Mesh(geo, mat);
      m.matrixAutoUpdate = false;
      m.castShadow = m.receiveShadow = true;
      this.root.add(m);
      return m;
    };
    this.lig = {
      patellar: mk(band, ligamentMaterial()), cranial: mk(band, cranialMat), caudal: mk(band, softMat),
      stumpA: mk(stump, stumpMat), stumpB: mk(stump, stumpMat), cranialMat, stumpMat, softMat,
    };

    // instruments and implants
    this.saw = sawBlade(model.radius, model.kerf);
    this.saw.visible = false;
    this.root.add(this.saw);

    this.plate = bone('plate', 'plate', this.tibia, { tint: TINT.steel, metal: true });
    const driverGlass = glass();
    this.glassMats.push({ m: driverGlass, metal: true });
    for (const s of model.plate.screws) {
      const grp = screw(s.length);
      grp.visible = false;
      this.tibia.add(grp);
      this.screws.push(grp);
      // on a radiograph a screw is a solid white bar
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, s.length, 12).rotateX(Math.PI / 2).translate(0, 0, -s.length / 2), driverGlass);
      bar.visible = false;
      bar.renderOrder = 3;
      grp.add(bar);
      this.screwGlass.push(bar);
    }
    this.wire = wireMesh(this.wireFrom, this.wireTo, model.wire.radius);
    this.wire.visible = false;
    this.tibia.add(this.wire);

    this.setTheme(this.dark);
    this.apply(REST, 0, false);
  }

  setTheme(dark: boolean): void {
    this.dark = dark;
    for (const { m, metal } of this.glassMats) tuneGlass(m, dark, metal);
    this.scene.environmentIntensity = dark ? 0.28 : 0.42;
    this.rim.intensity = dark ? 1.1 : 0.5;
    this.dirty = true;
  }

  resize(w: number, h: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  // ---- camera

  getView(): View {
    const off = this.camera.position.clone().sub(this.controls.target);
    const s = new THREE.Spherical().setFromVector3(off);
    const t = this.controls.target;
    return { azimuth: -s.theta / RAD, polar: s.phi / RAD, distance: s.radius, target: [-t.x, t.y, t.z] };
  }
  setView(v: View): void {
    const s = new THREE.Spherical(v.distance, v.polar * RAD, -v.azimuth * RAD);
    this.controls.target.set(-v.target[0], v.target[1], v.target[2]);
    this.camera.position.setFromSpherical(s).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
    this.dirty = true;
  }
  /** Glide to a view. A narrow window needs the camera further back to fit the same thing. */
  flyTo(to: View, dur = 1.1): void {
    const from = this.getView();
    // take the short way round
    let da = to.azimuth - from.azimuth;
    da = ((((da + 180) % 360) + 360) % 360) - 180;
    this.fly = { from, to: { ...to, azimuth: from.azimuth + da, distance: to.distance * this.fit() }, t: 0, dur };
  }
  private fit(): number {
    return Math.max(1, 1.15 / this.camera.aspect);
  }

  // ---- posing

  /** Where a point of the model is now, given what it is attached to (in the model's frame, not the mirrored one). */
  place(p: THREE.Vector3, on: Part, out = new THREE.Vector3()): THREE.Vector3 {
    out.copy(p);
    if (on === 'femur') return out.add(this.femur.position);
    if (on === 'fragment') out.applyAxisAngle(new THREE.Vector3(0, 0, 1), this.fragment.rotation.z);
    return out.add(this.tibia.position);
  }

  apply(p: Pose, time: number, running: boolean): void {
    const turn = THREE.MathUtils.clamp(p.turn, 0, 1);
    const cut = p.cut > 0.5;
    const xray = p.xray;

    // the tibia slides up its own slope when it is loaded with nothing to hold it
    const unstable = p.tear * (1 - turn);
    const slip = p.load * unstable * THRUST;
    this.slide.set(Math.cos(model.tpa * RAD), Math.sin(model.tpa * RAD), 0).multiplyScalar(slip);
    this.tibia.position.copy(this.slide);
    this.femur.position.set(0, 1.5 * turn, 0); // the levelled plateau carries the condyles a little higher
    this.fragment.rotation.z = -turn * model.rotation * RAD;
    this.fibula.rotation.z = turn * 1.6 * RAD;

    // bones: solid, glass, or between
    const see = (name: string, amount: number, shown = true) => {
      const bone = this.bones[name];
      const k = THREE.MathUtils.clamp(amount, 0, 1);
      const sm = bone.solid.material as THREE.MeshStandardMaterial;
      bone.solid.visible = shown && k < 0.995;
      sm.transparent = k > 0.005;
      sm.opacity = 1 - k;
      sm.depthWrite = k < 0.6;
      bone.glass.visible = shown && k > 0.005;
      (bone.glass.material as THREE.ShaderMaterial).uniforms.uOpacity.value = k;
    };
    const g = Math.max(p.glass, xray);
    see('femur', g);
    see('patella', g);
    for (const n of ['shaft', 'fragment', 'talus', 'fibula']) see(n, xray);

    // the kerf follows the tip of the blade, and stays once the blade is through
    this.cut.kerf.value = cut || p.plunge > 0.001 ? model.kerf : 0;
    this.cut.depth.value = cut ? -1e4 : SAW_START - p.plunge * SAW_TRAVEL;
    for (const f of this.faces) f.visible = this.cut.kerf.value > 0 && xray < 0.5;

    // ligaments
    const L = model.ligaments;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const soft = p.soft * (1 - xray);
    this.place(v3(L.patellar.from), 'femur', a);
    this.place(v3(L.patellar.to), 'shaft', b);
    stretch(this.lig.patellar, a, b, 4.6, 1.5);
    const pm = this.lig.patellar.material as THREE.MeshStandardMaterial;
    pm.transparent = xray > 0.005;
    pm.opacity = 1 - xray * 0.9;
    this.lig.patellar.visible = xray < 0.995;

    this.place(v3(L.caudal.from), 'femur', a);
    this.place(v3(L.caudal.to), 'fragment', b);
    stretch(this.lig.caudal, a, b, 2.9, 2.4);
    this.lig.softMat.opacity = soft;
    this.lig.caudal.visible = soft > 0.01;

    this.place(v3(L.cranial.from), 'femur', a);
    this.place(v3(L.cranial.to), 'fragment', b);
    const torn = p.tear > 0.5;
    stretch(this.lig.cranial, a, b, 2.5, 2.1);
    this.lig.cranial.visible = !torn && soft > 0.01;
    this.lig.cranialMat.opacity = soft;
    // the two torn ends hang a little off the line the ligament ran along
    const sag = new THREE.Vector3(1.5, -2.5, 0.5);
    stretch(this.lig.stumpA, a, b.clone().add(sag), 2.5, 2.1, 0.42);
    stretch(this.lig.stumpB, b, a.clone().add(sag.set(-2, 1.5, -1.5)), 2.5, 2.1, 0.34);
    const stumps = torn ? soft * (1 - p.debride) : 0;
    this.lig.stumpMat.opacity = stumps;
    this.lig.stumpA.visible = this.lig.stumpB.visible = stumps > 0.01;
    // the ligament this is all about is picked out while it is intact or freshly torn
    this.lig.cranialMat.color.copy(TINT.ligament).lerp(TINT.accent, 0.85 * THREE.MathUtils.clamp(p.focus, 0, 1));
    this.lig.stumpMat.color.copy(TINT.ligament).lerp(TINT.accent, 0.85);

    for (const m of this.menisci) m.visible = soft > 0.01;
    this.meniscusMat.opacity = soft;
    this.medialMat.opacity = soft;
    this.medialMat.color.copy(TINT.meniscus).lerp(TINT.accent, 0.8 * p.meniscus);

    // saw: comes in from the medial side, goes through, and its tip ends beyond the far cortex
    const sawOn = p.saw > 0.002;
    this.saw.visible = sawOn;
    if (sawOn) {
      const ease = p.saw * p.saw * (3 - 2 * p.saw);
      this.saw.position.set(this.tibia.position.x, this.tibia.position.y, THREE.MathUtils.lerp(150, SAW_START, ease) - p.plunge * SAW_TRAVEL);
      this.saw.rotation.z = running && p.saw > 0.6 ? Math.sin(time * 70) * 0.035 : 0;
    }

    // wire: slides in along its own line
    this.wire.visible = p.wire > 0.002;
    if (this.wire.visible) {
      const out = this.wireFrom.clone().sub(this.wireTo).multiplyScalar(1 - p.wire);
      this.wire.position.copy(this.wireFrom).add(out);
    }

    // plate and screws
    const plateOn = p.plate > 0.002;
    const pe = p.plate * p.plate * (3 - 2 * p.plate);
    for (const m of [this.plate.solid, this.plate.glass]) m.position.z = (1 - pe) * 60;
    see('plate', xray, plateOn);
    model.plate.screws.forEach((s, i) => {
      const k = THREE.MathUtils.clamp(p.screws - i, 0, 1);
      const grp = this.screws[i];
      grp.visible = k > 0.002;
      const e = 1 - Math.pow(1 - k, 2);
      grp.position.set(s.x, s.y, s.top + (1 - e) * (s.length + 10));
      grp.rotation.z = -(1 - e) * 14;
      this.screwGlass[i].visible = xray > 0.005;
      (this.screwGlass[i].material as THREE.ShaderMaterial).uniforms.uOpacity.value = xray;
      for (const c of grp.children) if (c !== this.screwGlass[i]) c.visible = xray < 0.6;
    });
    this.dirty = true;
  }

  /** Advance the camera. Returns true if a frame was drawn. */
  frame(dt: number): boolean {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - Math.pow(-2 * f.t + 2, 3) / 2;
      const L = THREE.MathUtils.lerp;
      this.setView({
        azimuth: L(f.from.azimuth, f.to.azimuth, e),
        polar: L(f.from.polar, f.to.polar, e),
        distance: L(f.from.distance, f.to.distance, e),
        target: [L(f.from.target[0], f.to.target[0], e), L(f.from.target[1], f.to.target[1], e), L(f.from.target[2], f.to.target[2], e)],
      });
      if (f.t >= 1) this.fly = null;
    }
    this.controls.update();
    if (!this.dirty) return false;
    this.dirty = false;
    // the key light keeps its place over the viewer's left shoulder
    const t = this.controls.target;
    const dir = new THREE.Vector3(-0.62, 0.72, 0.62).normalize().applyQuaternion(this.camera.quaternion);
    this.key.position.copy(t).addScaledVector(dir, 600);
    this.key.target.position.copy(t);
    this.rim.position.copy(t).addScaledVector(dir.set(0.75, 0.25, -0.75).normalize().applyQuaternion(this.camera.quaternion), 600);
    this.rim.target.position.copy(t);
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  get flying(): boolean { return this.fly !== null; }
}
