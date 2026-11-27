// Annotations drawn over the 3D view: thin lines, angles, arrows and labels, placed at points of
// the model and redrawn whenever the camera or the model moves. Everything is given in the model's
// frame, in millimetres; the overlay works out where that is on screen.
import * as THREE from 'three';
import type { Stage } from './stage';

const NS = 'http://www.w3.org/2000/svg';
export type Tone = 'fg' | 'muted' | 'accent';
export interface Stroke { a?: number; tone?: Tone; dash?: boolean; w?: number }
export interface LabelOpts { a?: number; tone?: Tone; dx?: number; dy?: number; n?: THREE.Vector3 | number[]; sub?: string; dot?: boolean }

const D = Math.PI / 180;

export class Overlay {
  w = 1;
  h = 1;
  /** Labels shrink their reach on a narrow view. */
  reach = 1;
  /** The viewer is on the lateral side: front and back have changed places on screen, and labels follow. */
  lateral = false;
  private m = new THREE.Matrix4();
  private eye = new THREE.Vector3();
  private v = new THREE.Vector3();
  private paths: SVGPathElement[] = [];
  private texts: SVGTextElement[] = [];
  private dots: SVGCircleElement[] = [];
  private np = 0;
  private nt = 0;
  private nd = 0;
  private gLines: SVGGElement;
  private gText: SVGGElement;

  constructor(readonly svg: SVGSVGElement, readonly stage: Stage) {
    this.gLines = svg.appendChild(document.createElementNS(NS, 'g'));
    this.gText = svg.appendChild(document.createElementNS(NS, 'g'));
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.reach = Math.min(1, Math.max(0.55, w / 760));
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  begin(): void {
    this.np = this.nt = this.nd = 0;
    const { camera, root } = this.stage;
    camera.updateMatrixWorld();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(root.matrixWorld);
    this.eye.copy(camera.position);
    this.eye.x = -this.eye.x; // the camera, in the model's frame
    this.lateral = this.eye.z < this.stage.controls.target.z;
  }
  end(): void {
    for (let i = this.np; i < this.paths.length; i++) this.paths[i].style.display = 'none';
    for (let i = this.nt; i < this.texts.length; i++) this.texts[i].style.display = 'none';
    for (let i = this.nd; i < this.dots.length; i++) this.dots[i].style.display = 'none';
  }

  /** Screen position of a model point. */
  at(p: THREE.Vector3): [number, number] {
    this.v.copy(p).applyMatrix4(this.m);
    return [(this.v.x * 0.5 + 0.5) * this.w, (-this.v.y * 0.5 + 0.5) * this.h];
  }
  /** 1 when a surface with this normal faces the viewer, 0 when it faces away. */
  facing(p: THREE.Vector3, n: THREE.Vector3): number {
    const d = this.v.copy(this.eye).sub(p).normalize().dot(n);
    return THREE.MathUtils.smoothstep(d, -0.12, 0.18);
  }

  private path(d: string, s: Stroke): void {
    const a = s.a ?? 1;
    if (a <= 0.01) return;
    let el = this.paths[this.np];
    if (!el) {
      el = this.paths[this.np] = this.gLines.appendChild(document.createElementNS(NS, 'path'));
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
    }
    this.np++;
    el.style.display = '';
    el.setAttribute('d', d);
    el.setAttribute('class', s.tone ?? 'fg');
    el.setAttribute('stroke-width', String(s.w ?? 1.25));
    el.setAttribute('stroke-dasharray', s.dash ? '1 5' : 'none');
    el.setAttribute('opacity', a.toFixed(3));
  }

  line(a: THREE.Vector3, b: THREE.Vector3, s: Stroke = {}): void {
    const [x0, y0] = this.at(a), [x1, y1] = this.at(b);
    this.path(`M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`, s);
  }
  polyline(pts: THREE.Vector3[], s: Stroke = {}): void {
    if (pts.length < 2) return;
    let d = '';
    for (let i = 0; i < pts.length; i++) { const [x, y] = this.at(pts[i]); d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }
    this.path(d, s);
  }
  /** An arc about Z through a centre, from one angle to another (degrees, counter-clockwise from +X). */
  arc(c: THREE.Vector3, r: number, from: number, to: number, s: Stroke = {}): void {
    const n = Math.max(2, Math.ceil(Math.abs(to - from) / 3));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) { const a = (from + ((to - from) * i) / n) * D; pts.push(new THREE.Vector3(c.x + r * Math.cos(a), c.y + r * Math.sin(a), c.z)); }
    this.polyline(pts, s);
  }
  /** A line with an open head at b. */
  arrow(a: THREE.Vector3, b: THREE.Vector3, s: Stroke = {}): void {
    const [x0, y0] = this.at(a), [x1, y1] = this.at(b);
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 3) return;
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len, k = Math.min(8, len * 0.45);
    const hx = x1 - ux * k, hy = y1 - uy * k;
    this.path(
      `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}M${(hx - uy * k * 0.55).toFixed(1)} ${(hy + ux * k * 0.55).toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}L${(hx + uy * k * 0.55).toFixed(1)} ${(hy - ux * k * 0.55).toFixed(1)}`,
      { w: 1.75, ...s },
    );
  }
  dot(p: THREE.Vector3, s: Stroke & { r?: number } = {}): void {
    const a = s.a ?? 1;
    if (a <= 0.01) return;
    let el = this.dots[this.nd];
    if (!el) el = this.dots[this.nd] = this.gLines.appendChild(document.createElementNS(NS, 'circle'));
    this.nd++;
    const [x, y] = this.at(p);
    el.style.display = '';
    el.setAttribute('cx', x.toFixed(1));
    el.setAttribute('cy', y.toFixed(1));
    el.setAttribute('r', String(s.r ?? 2.5));
    el.setAttribute('class', `dot ${s.tone ?? 'fg'}`);
    el.setAttribute('opacity', a.toFixed(3));
  }

  /** Text at a screen offset from a model point. */
  text(p: THREE.Vector3, str: string, o: LabelOpts = {}): void {
    const a = o.a ?? 1;
    if (a <= 0.01) return;
    const [x, y] = this.at(p);
    const dx = (o.dx ?? 0) * (this.lateral ? -1 : 1);
    this.write(x + dx, y + (o.dy ?? 0), str, o, dx < -1 ? 'end' : dx > 1 ? 'start' : 'middle');
  }
  private write(x: number, y: number, str: string, o: LabelOpts, anchor: string): void {
    let el = this.texts[this.nt];
    if (!el) {
      el = this.texts[this.nt] = this.gText.appendChild(document.createElementNS(NS, 'text'));
      el.appendChild(document.createElementNS(NS, 'tspan'));
      el.appendChild(document.createElementNS(NS, 'tspan')).setAttribute('class', 'sub');
    }
    this.nt++;
    el.style.display = '';
    el.setAttribute('x', x.toFixed(1));
    el.setAttribute('y', (y + (o.sub ? -3 : 4)).toFixed(1));
    el.setAttribute('text-anchor', anchor);
    el.setAttribute('class', o.tone ?? 'fg');
    el.setAttribute('opacity', (o.a ?? 1).toFixed(3));
    const [main, sub] = el.children as unknown as SVGTSpanElement[];
    if (main.textContent !== str) main.textContent = str;
    const s = o.sub ?? '';
    if (sub.textContent !== s) sub.textContent = s;
    sub.setAttribute('x', x.toFixed(1));
    sub.setAttribute('dy', '14');
  }
  /** A label on a leader: a dot on the model, a thin line, and the text at its end. */
  label(p: THREE.Vector3, str: string, o: LabelOpts = {}): void {
    let a = o.a ?? 1;
    if (o.n) a *= this.facing(p, Array.isArray(o.n) ? new THREE.Vector3(o.n[0], o.n[1], o.n[2]) : o.n);
    if (a <= 0.01) return;
    const [x, y] = this.at(p);
    const dx = (o.dx ?? 60) * this.reach * (this.lateral ? -1 : 1), dy = (o.dy ?? 0) * this.reach;
    const ex = x + dx, ey = y + dy;
    const len = Math.hypot(dx, dy) || 1;
    this.path(`M${(x + (dx / len) * 5).toFixed(1)} ${(y + (dy / len) * 5).toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}`, { a: a * 0.7, tone: 'muted', w: 1 });
    if (o.dot !== false) this.dot(p, { a, tone: o.tone, r: 2.5 });
    this.write(ex + (dx >= 0 ? 7 : -7), ey, str, { ...o, a }, dx >= 0 ? 'start' : 'end');
  }
}
