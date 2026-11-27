// The walkthrough: eight steps, each with its text, its camera, what the model does over the
// step's duration, and what is drawn over it.
import * as THREE from 'three';
import { model } from './model/load';
import type { Overlay } from './scene/overlay';
import type { Pose, Stage, View } from './scene/stage';
import { REST, THRUST } from './scene/stage';

export type SchemeName = 'forces' | 'planner' | 'cut' | 'recovery';

export interface Step {
  id: string;
  /** One word, for the timeline. */
  name: string;
  title: string;
  /** Paragraphs of the explanation. */
  body: string[];
  facts?: [string, string][];
  scheme?: SchemeName;
  /** Rows that follow the model as it moves. */
  live?: (p: Pose) => [string, string][];
  /** Seconds the step takes to play. */
  duration: number;
  view: View;
  /** Shown as a radiograph unless the viewer chooses otherwise. */
  xray?: boolean;
  /** Set the pose at time t (0..1). `p` arrives as the previous step left it. */
  pose: (t: number, p: Pose) => void;
  /** Draw the annotations. `k` fades them in when the step is entered. */
  draw: (o: Overlay, t: number, k: number, s: Stage, p: Pose) => void;
}

const D = Math.PI / 180;
const V = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 0 before a, 1 after b, smooth between. */
const ramp = (t: number, a: number, b: number) => { const x = clamp01((t - a) / (b - a)); return x * x * (3 - 2 * x); };
/** Up between a and b, down between c and d. */
const band = (t: number, a: number, b: number, c: number, d: number) => ramp(t, a, b) * (1 - ramp(t, c, d));
const lerp = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);

const A = model.anchors;
const L = model.ligaments;
const E = V(model.eminence);
const T = V(model.talus);
const U = new THREE.Vector3(Math.cos(model.tpa * D), Math.sin(model.tpa * D), 0); // up the plateau's slope
// the plateau line, drawn in the sagittal plane, and where it crosses the long axis
const PC = V(model.plateau.cranial).setZ(0);
const PD = V(model.plateau.caudal).setZ(0);
const PX = new THREE.Vector3(0, PC.y - PC.x * Math.tan(model.tpa * D), 0);

/** The plateau angle at a pose. */
export const angleAt = (p: Pose) => model.tpa - clamp01(p.turn) * model.rotation;
/** How far a point on the cut has travelled at a pose, in millimetres. */
export const travelAt = (p: Pose) => 2 * model.radius * Math.sin((clamp01(p.turn) * model.rotation * D) / 2);

/** The plateau line with its angle to the perpendicular of the long axis. */
function plateauAngle(o: Overlay, s: Stage, a: number, value: number, len = 34): void {
  if (a <= 0.01) return;
  const x = s.place(PX, 'fragment');
  const dir = s.place(PC, 'fragment').sub(s.place(PD, 'fragment')).normalize();
  o.line(x.clone().addScaledVector(dir, -len), x.clone().addScaledVector(dir, len), { a });
  o.line(x.clone().setX(x.x - len), x.clone().setX(x.x + len), { a: a * 0.8, tone: 'muted', dash: true });
  const deg = Math.atan2(dir.y, dir.x) / D;
  if (deg > 0.6) o.arc(x, 26, 0, deg, { a, tone: 'accent', w: 1.5 });
  const mid = (Math.max(deg, 4) / 2) * D;
  o.text(new THREE.Vector3(x.x + 31 * Math.cos(mid), x.y + 31 * Math.sin(mid), 0), `${value.toFixed(value % 1 ? 1 : 0)}°`, { a, tone: 'accent', dx: -6, dy: -2 });
}

export const steps: Step[] = [
  {
    id: 'anatomy',
    name: 'Anatomy',
    title: 'The stifle',
    body: [
      'The stifle is the dog’s knee. The femur rests on the tibial plateau, and the plateau is not level: it slopes down towards the back of the limb.',
      'Two cruciate ligaments cross inside the joint. The cranial one stops the tibia from sliding forward under the femur. Two C-shaped menisci cushion the contact.',
    ],
    facts: [
      ['Model', 'Right stifle from its medial side, a dog of about 30 kg'],
      ['Plateau slope here', `${model.tpa}°`],
      ['Usual range in dogs', '20–30°'],
    ],
    duration: 6,
    view: { azimuth: 16, polar: 82, distance: 740, target: [0, -10, 0] },
    pose(t, p) {
      p.glass = ramp(t, 0.5, 0.72);
    },
    draw(o, t, k, s) {
      const a = k * (1 - ramp(t, 0.42, 0.56));
      const femur = o.lateral ? A.femurLateral : A.femur, patella = o.lateral ? A.patellaLateral : A.patella;
      const tub = o.lateral ? A.tuberosityLateral : A.tuberosity;
      o.label(s.place(V(femur.p), 'femur'), 'Femur', { a, dx: 70, dy: -24 });
      o.label(s.place(V(patella.p), 'femur'), 'Patella', { a, dx: -64, dy: -26 });
      o.label(lerp(s.place(V(L.patellar.from), 'femur'), s.place(V(L.patellar.to), 'shaft'), 0.5).setZ(3), 'Patellar ligament', { a, dx: -72, dy: 0 });
      o.label(s.place(V(tub.p), 'shaft'), 'Tibial tuberosity', { a, dx: -60, dy: 30 });
      o.label(s.place(V(A.plateau.p), 'fragment'), 'Tibial plateau', { a, dx: 96, dy: 6, n: [0, 0.4, 0.92] });
      o.label(s.place(new THREE.Vector3(3, -78, o.lateral ? -10.5 : 11.5), 'shaft'), 'Tibia', { a, dx: 84, dy: 10 });
      o.label(s.place(V(A.fibula.p), 'shaft'), 'Fibula', { a, dx: 60, dy: 34, n: A.fibula.n });
      const b = k * ramp(t, 0.66, 0.8);
      const cr = lerp(s.place(V(L.cranial.from), 'femur'), s.place(V(L.cranial.to), 'fragment'), 0.62);
      const ca = lerp(s.place(V(L.caudal.from), 'femur'), s.place(V(L.caudal.to), 'fragment'), 0.5);
      o.label(cr, 'Cranial cruciate ligament', { a: b, dx: -84, dy: -62 });
      o.label(ca, 'Caudal cruciate ligament', { a: b, dx: 92, dy: -4 });
      o.label(s.place(V(A.meniscusMedial.p), 'fragment'), 'Medial meniscus', { a: b, dx: 88, dy: 44 });
      o.label(s.place(V(tub.p), 'shaft'), 'Tibial tuberosity', { a: b, dx: -60, dy: 30 });
    },
  },
  {
    id: 'rupture',
    name: 'Rupture',
    title: 'Why the joint fails',
    body: [
      'In dogs the cranial cruciate ligament usually degenerates over months and then gives way, often with no real injury.',
      'Each time the limb takes weight, the femur is pressed onto the sloped plateau, and the slope turns part of that load into a push on the tibia: cranial tibial thrust. The ligament used to resist it. Without it the tibia slides forward at every step. The joint becomes inflamed and arthritic, and the medial meniscus is caught under the femur and torn.',
    ],
    scheme: 'forces',
    duration: 8,
    view: { azimuth: 8, polar: 84, distance: 560, target: [8, 4, 0] },
    pose(t, p) {
      p.glass = 1;
      p.focus = ramp(t, 0.04, 0.16);
      p.tear = t > 0.26 ? 1 : 0;
      p.load = ramp(t, 0.48, 0.86);
    },
    draw(o, t, k, s, p) {
      const cr = lerp(s.place(V(L.cranial.from), 'femur'), s.place(V(L.cranial.to), 'fragment'), 0.62);
      o.label(cr, 'Cranial cruciate ligament', { a: k * band(t, 0.02, 0.1, 0.24, 0.28), tone: 'accent', dx: -84, dy: -70, dot: false });
      o.label(cr, 'Torn', { a: k * band(t, 0.27, 0.32, 0.9, 2), tone: 'accent', dx: -84, dy: -70, dot: false });
      // the load comes down the long axis; the thrust runs up the slope
      const la = k * ramp(t, 0.4, 0.5);
      o.arrow(new THREE.Vector3(0, 96, 0), new THREE.Vector3(0, 96 - 34 - 50 * p.load, 0), { a: la });
      o.text(new THREE.Vector3(0, 96, 0), 'Load', { a: la, dy: -12 });
      const from = s.place(new THREE.Vector3(36, -3, 0), 'shaft');
      const ta = k * ramp(t, 0.5, 0.6);
      o.arrow(from, from.clone().addScaledVector(U, 6 + 30 * p.load), { a: ta, tone: 'accent' });
      const slip = p.load * p.tear * (1 - p.turn) * THRUST;
      o.text(from.clone().addScaledVector(U, 6 + 30 * p.load), 'Cranial tibial thrust', { a: ta, tone: 'accent', dx: -10, dy: -8, sub: `tibia ${slip.toFixed(1)} mm forward` });
    },
  },
  {
    id: 'planning',
    name: 'Planning',
    title: 'Measure the slope',
    body: [
      'A TPLO does not replace the ligament. It changes the shape of the tibia so that the ligament is no longer needed.',
      'Planning starts from a true lateral radiograph that shows the stifle and the hock. The tibial plateau angle (TPA) is measured between the medial plateau and a line perpendicular to the tibial long axis, which runs from the intercondylar eminence to the centre of the talus. The plan is to bring that angle down to about 5°.',
    ],
    scheme: 'planner',
    duration: 6,
    xray: true,
    view: { azimuth: 0, polar: 90, distance: 960, target: [-16, -92, 0] },
    pose(_t, p) {
      p.load = 0;
      p.glass = 1;
    },
    draw(o, t, k, s) {
      const g = ramp(t, 0.08, 0.4);
      const a = k * ramp(t, 0.05, 0.12);
      o.dot(E, { a });
      o.line(new THREE.Vector3(0, 46, 0), lerp(new THREE.Vector3(0, 46, 0), T, g), { a });
      o.dot(T, { a: k * ramp(t, 0.36, 0.42) });
      o.label(E, 'Intercondylar eminence', { a, dx: 96, dy: -34, dot: false });
      o.label(T, 'Centre of the talus', { a: k * ramp(t, 0.36, 0.44), dx: 80, dy: 0, dot: false });
      o.label(new THREE.Vector3(0, -112, 0), 'Tibial long axis', { a: k * ramp(t, 0.3, 0.4), dx: 80, dy: 0, dot: false });
      plateauAngle(o, s, k * ramp(t, 0.48, 0.62), model.tpa, 44);
      o.text(new THREE.Vector3(44, 20, 0), 'Tibial plateau angle', { a: k * ramp(t, 0.66, 0.78), tone: 'accent', dx: -8, dy: -4 });
    },
  },
  {
    id: 'inspection',
    name: 'Inspection',
    title: 'Inspect the joint',
    body: [
      'The tibia is approached from its medial side. Before any bone is cut, the joint is opened through a small incision or examined with an arthroscope, and the torn ends of the ligament are removed.',
      'The medial meniscus is probed, because its caudal horn is torn in about half of these joints. A torn part is taken out: left in place, it is a common reason for lameness afterwards.',
    ],
    facts: [
      ['Approach', 'Medial, over the proximal tibia'],
      ['Medial meniscus found torn', 'About half of joints'],
    ],
    duration: 6,
    view: { azimuth: -24, polar: 70, distance: 430, target: [-2, 2, 4] },
    pose(t, p) {
      p.glass = 1;
      p.load = 0;
      p.debride = ramp(t, 0.22, 0.42);
      p.meniscus = ramp(t, 0.52, 0.7);
    },
    draw(o, t, k, s) {
      const cr = lerp(s.place(V(L.cranial.from), 'femur'), s.place(V(L.cranial.to), 'fragment'), 0.6);
      o.label(cr, 'Torn ligament removed', { a: k * band(t, 0.02, 0.1, 0.44, 0.52), tone: 'accent', dx: -80, dy: -60, dot: false });
      o.label(s.place(V(A.meniscusCaudalHorn.p), 'fragment'), 'Medial meniscus', { a: k * ramp(t, 0.56, 0.7), tone: 'accent', dx: 84, dy: 30, sub: 'caudal horn probed for tears' });
    },
  },
  {
    id: 'osteotomy',
    name: 'Osteotomy',
    title: 'The curved cut',
    body: [
      'A crescent-shaped blade on an oscillating saw cuts an arc through the top of the tibia, from the medial side straight across to the lateral side. The arc is centred on the intercondylar eminence, so the piece that carries the joint surface can turn in place like a wheel in its socket.',
      'The tibial tuberosity, where the patellar ligament pulls, stays on the shaft and must keep enough bone to take that pull. Before the cut is finished, two marks are scored across it, as far apart as the planned rotation.',
    ],
    scheme: 'cut',
    duration: 10,
    view: { azimuth: 18, polar: 80, distance: 540, target: [2, -14, 0] },
    pose(t, p) {
      p.glass = 0;
      p.soft = 0;
      p.meniscus = 0;
      p.debride = 1;
      p.saw = ramp(t, 0.24, 0.44) * (1 - ramp(t, 0.84, 1));
      p.plunge = clamp01((t - 0.46) / 0.34);
      p.cut = t >= 0.8 ? 1 : 0;
    },
    draw(o, t, k, s) {
      // the planned line on the bone, until the blade covers it
      const a = k * band(t, 0.02, 0.1, 0.3, 0.4);
      o.polyline(model.cutLine.map((q) => V(q).setZ(q[2] + 0.4)), { a, dash: true, w: 1.5 });
      const c = V(A.centre.p);
      o.dot(c, { a });
      const rim = V(model.cutLine[Math.floor(model.cutLine.length * 0.62)]);
      o.line(c, rim, { a: a * 0.8, tone: 'muted' });
      o.text(lerp(c, rim, 0.5), `r ${model.radius} mm`, { a, dx: 12, dy: 0 });
      o.label(c, 'Centre: intercondylar eminence', { a, dx: 110, dy: 22, dot: false });
      marks(o, s, k * ramp(t, 0.12, 0.22));
      const m0 = V(model.marks.shaft[1].p);
      o.label(m0, 'Rotation marks', { a: k * band(t, 0.14, 0.22, 0.3, 0.4), tone: 'accent', dx: -56, dy: 50, dot: false });
      o.label(s.place(V(A.tuberosity.p), 'shaft'), 'Tuberosity stays on the shaft', { a: k * ramp(t, 0.86, 0.96), dx: -40, dy: 58, n: A.tuberosity.n });
    },
  },
  {
    id: 'rotation',
    name: 'Rotation',
    title: 'Level the plateau',
    body: [
      'The plateau segment is now free. With a pin in it as a handle, the surgeon turns it along the cut until the two marks meet.',
      `The joint surface has gone from ${model.tpa}° to ${model.target}°. A wire driven through the tuberosity into the segment holds it there while the plate is put on.`,
    ],
    live: (p) => [
      ['Plateau angle', `${angleAt(p).toFixed(1)}°`],
      ['Rotation', `${(model.tpa - angleAt(p)).toFixed(1)}°`],
      ['Travel along the cut', `${travelAt(p).toFixed(1)} mm`],
    ],
    duration: 8,
    view: { azimuth: 6, polar: 84, distance: 480, target: [0, -8, 0] },
    pose(t, p) {
      p.glass = 0.85 * (1 - ramp(t, 0.8, 0.95));
      p.turn = ramp(t, 0.14, 0.68);
      p.wire = ramp(t, 0.76, 0.94);
    },
    draw(o, t, k, s, p) {
      marks(o, s, k);
      plateauAngle(o, s, k * (1 - ramp(t, 0.82, 0.95)), angleAt(p), 40);
      o.label(V(model.wire.from), 'Temporary wire', { a: k * ramp(t, 0.86, 0.96), dx: -30, dy: 46, dot: false });
    },
  },
  {
    id: 'fixation',
    name: 'Fixation',
    title: 'Plate and screws',
    body: [
      'A TPLO plate, shaped to the medial surface of the tibia, bridges the cut. Three screws go into the plateau segment, clear of the joint, and three into the shaft. In a locking plate the screw heads thread into the plate itself.',
      'The plate holds the two cut surfaces pressed together. The wire comes out, the tissues are closed in layers, and radiographs are taken to check the angle and the implants.',
    ],
    facts: [
      ['Plate', 'Medial, across the cut'],
      ['Screws', '3 in the plateau segment, 3 in the shaft'],
      ['Checked on radiographs', `Plateau angle about ${model.target}°`],
    ],
    duration: 10,
    view: { azimuth: 20, polar: 80, distance: 540, target: [2, -24, 0] },
    pose(t, p) {
      p.glass = 0;
      p.plate = ramp(t, 0.02, 0.24);
      p.screws = 6 * clamp01((t - 0.26) / 0.58);
      p.wire = 1 - ramp(t, 0.88, 0.99);
    },
    draw(o, t, k) {
      const sc = model.plate.screws;
      const head = (i: number) => new THREE.Vector3(sc[i].x, sc[i].y, sc[i].top + 1);
      o.label(lerp(head(2), head(3), 0.5), 'TPLO plate', { a: k * ramp(t, 0.2, 0.28), dx: 92, dy: -8, dot: false });
      o.label(head(0), 'Plateau segment', { a: k * ramp(t, 0.5, 0.56), dx: 70, dy: -40, sub: '3 screws', dot: false });
      o.label(head(5), 'Shaft', { a: k * ramp(t, 0.8, 0.86), dx: 76, dy: 10, sub: '3 screws', dot: false });
    },
  },
  {
    id: 'outcome',
    name: 'Outcome',
    title: 'Stable without the ligament',
    body: [
      'With the plateau close to level, weight presses the femur onto the tibia without pushing the tibia forward. The joint is stable while the dog stands on the limb; the caudal cruciate ligament and the muscles deal with what remains.',
      'The cut heals like a fracture held by a plate. Until it has, the plate carries the load, and that is why the first weeks are spent on a leash.',
    ],
    scheme: 'recovery',
    duration: 8,
    view: { azimuth: 10, polar: 84, distance: 600, target: [4, -12, 0] },
    pose(t, p) {
      p.glass = 1;
      p.soft = 1;
      p.wire = 0;
      p.load = ramp(t, 0.3, 0.72);
    },
    draw(o, t, k, s, p) {
      const la = k * ramp(t, 0.22, 0.32);
      o.arrow(new THREE.Vector3(0, 96, 0), new THREE.Vector3(0, 96 - 34 - 50 * p.load, 0), { a: la });
      o.text(new THREE.Vector3(0, 96, 0), 'Load', { a: la, dy: -12 });
      plateauAngle(o, s, k * ramp(t, 0.5, 0.62), angleAt(p), 32);
      o.label(s.place(V(A.tuberosity.p), 'shaft'), 'No forward slide', { a: k * ramp(t, 0.72, 0.82), dx: -50, dy: 52, sub: 'the tibia stays where it is', n: A.tuberosity.n });
    },
  },
];

/** The two score marks either side of the cut. */
function marks(o: Overlay, s: Stage, a: number): void {
  if (a <= 0.01) return;
  for (const [part, pair] of [['shaft', model.marks.shaft], ['fragment', model.marks.fragment]] as const) {
    const n = V(pair[0].n);
    const p0 = s.place(V(pair[0].p), part), p1 = s.place(V(pair[1].p), part);
    o.line(p0, p1, { a: a * o.facing(p0, n), tone: 'accent', w: 2.25 });
  }
}

// ---- poses

const ends: Pose[] = [];
{
  let p: Pose = { ...REST };
  for (const step of steps) {
    p = { ...p };
    step.pose(1, p);
    ends.push(p);
  }
}

/** The pose at time t of a step. */
export function poseAt(index: number, t: number): Pose {
  const p: Pose = { ...(index > 0 ? ends[index - 1] : REST) };
  steps[index].pose(clamp01(t), p);
  return p;
}
