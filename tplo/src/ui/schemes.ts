// The 2D schemes in the side panel. They are drawn from the same model as the 3D view: the bone
// outlines are its silhouettes seen from the side, front of the limb on the left.
import { model } from '../model/load';
import type { SchemeName } from '../steps';

const D = Math.PI / 180;
type Loop = number[][];

const h = (tag: string, attrs: Record<string, string | number> = {}, html = ''): string =>
  `<${tag}${Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}>${html}</${tag}>`;

/** An outline as an SVG path. The scheme's x runs towards the back of the limb and its y down. */
function path(loops: Loop[], min = 0): string {
  return loops
    .filter((l) => l.length > min)
    .map((l) => 'M' + l.map(([x, y]) => `${(-x).toFixed(2)} ${(-y).toFixed(2)}`).join('L') + 'Z')
    .join('');
}
const O = model.outlines;
const BONES = {
  tibia: path(O.tibia),
  fragment: path(O.fragment),
  shaft: path(O.shaft),
  femur: path(O.femur),
  patella: path(O.patella),
};
// the plateau line crosses the long axis here
const PX = model.plateau.cranial[1] - model.plateau.cranial[0] * Math.tan(model.tpa * D);

function arrow(x0: number, y0: number, x1: number, y1: number, cls: string, head = 4): string {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 0.8) return '';
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len, k = Math.min(head, len * 0.5);
  const bx = x1 - ux * k, by = y1 - uy * k;
  return h('path', { class: cls, d: `M${x0} ${y0}L${x1} ${y1}M${bx - uy * k * 0.55} ${by + ux * k * 0.55}L${x1} ${y1}L${bx + uy * k * 0.55} ${by - ux * k * 0.55}` });
}

function slider(id: string, min: number, max: number, step: number, value: number, label: string): string {
  return `<input class="slider" id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}">`;
}
function fill(el: HTMLInputElement): void {
  el.style.setProperty('--p', `${((+el.value - +el.min) / (+el.max - +el.min)) * 100}%`);
}

// ---------------------------------------------------------------- forces

function forces(root: HTMLElement): void {
  root.innerHTML = `
    <div class="card-head"><span>Slope and thrust</span><span class="num" id="fSlope"></span></div>
    <svg class="scheme" viewBox="-66 -58 132 112" role="img" aria-label="The top of the tibia from the side, with the load and the forward thrust it produces">
      <g id="fArt"></g>
    </svg>
    <div class="field">
      ${slider('fRange', 0, 40, 0.5, model.tpa, 'Plateau slope')}
      <div class="chips"><button data-v="${model.tpa}">Before ${model.tpa}°</button><button data-v="${model.target}">After ${model.target}°</button></div>
    </div>
    <dl class="rows"><div><dt>Forward thrust</dt><dd class="num" id="fThrust"></dd></div></dl>
    <p class="note">The simple model: thrust = load × sin(slope). In cadaver limbs the thrust changes direction at about 6.5°, so surgeons aim for about 5°.</p>`;
  const art = root.querySelector('#fArt') as SVGGElement;
  const range = root.querySelector('#fRange') as HTMLInputElement;
  const draw = () => {
    const s = +range.value;
    fill(range);
    const c = Math.cos(s * D), sn = Math.sin(s * D);
    const turn = model.tpa - s; // how far the plateau segment has been turned from where it grew
    const W = 40; // length of the load arrow
    // the plateau, in scheme coordinates: it rises towards the front (the left)
    const y0 = -PX * Math.cos(turn * D);
    const L = 30;
    const thrust = W * sn;
    art.innerHTML =
      h('path', { class: 'bone', d: BONES.shaft }) +
      h('path', { class: 'bone hot', d: BONES.fragment, transform: `rotate(${-turn})` }) +
      h('path', { class: 'axis', d: `M0 -56L0 54` }) +
      h('path', { class: 'ref', d: `M${-L - 6} ${y0}L${L + 6} ${y0}` }) +
      h('path', { class: 'ink', d: `M${-c * L} ${y0 - sn * L}L${c * L} ${y0 + sn * L}` }) +
      (s > 1.5 ? h('path', { class: 'accent thin', d: `M${-20} ${y0}A20 20 0 0 1 ${-20 * c} ${y0 - 20 * sn}` }) : '') +
      arrow(0, y0 - 10 - W, 0, y0 - 10, 'ink arrow') +
      arrow(-c * 3, y0 - sn * 3 - 0.01, -c * (3 + thrust), y0 - sn * (3 + thrust), 'accent arrow') +
      h('text', { x: 4, y: y0 - 10 - W + 5, class: 'lbl' }, 'Load') +
      (thrust > 2.5 ? h('text', { x: -c * (3 + thrust) + 2, y: y0 - sn * (3 + thrust) - 5, class: 'lbl accent', 'text-anchor': 'end' }, 'Thrust') : '');
    (root.querySelector('#fSlope') as HTMLElement).textContent = `${s.toFixed(s % 1 ? 1 : 0)}°`;
    (root.querySelector('#fThrust') as HTMLElement).textContent = `${Math.round(sn * 100)}% of the load`;
    root.querySelectorAll<HTMLButtonElement>('.chips button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v! === s)));
  };
  range.addEventListener('input', draw);
  root.querySelectorAll<HTMLButtonElement>('.chips button').forEach((b) => b.addEventListener('click', () => { range.value = b.dataset.v!; draw(); }));
  draw();
}

// ---------------------------------------------------------------- planner

const BLADES = [12, 15, 18, 21, 24, 27, 30];

function planner(root: HTMLElement): void {
  root.innerHTML = `
    <div class="card-head"><span>Rotation planner</span><span class="num muted">target ${model.target}°</span></div>
    <svg class="scheme short" viewBox="-66 -12 132 74" role="img" aria-label="The arc of the cut with the planned rotation marked on it">
      <g id="pArt"></g>
    </svg>
    <div class="field">
      <div class="label"><span>Measured plateau angle</span><span class="num" id="pTpa"></span></div>
      ${slider('pRange', 12, 45, 0.5, model.tpa, 'Measured plateau angle')}
    </div>
    <div class="field">
      <div class="label"><span>Blade radius</span><span class="num muted">mm</span></div>
      <div class="seg wide" id="pBlades">${BLADES.map((b) => `<button data-v="${b}">${b}</button>`).join('')}</div>
    </div>
    <dl class="rows">
      <div><dt>Rotation</dt><dd class="num" id="pRot"></dd></div>
      <div><dt>Distance between the marks</dt><dd class="num" id="pChord"></dd></div>
    </dl>
    <p class="note" id="pNote"></p>`;
  const art = root.querySelector('#pArt') as SVGGElement;
  const range = root.querySelector('#pRange') as HTMLInputElement;
  let blade = model.radius;
  const draw = () => {
    fill(range);
    const tpa = +range.value;
    const rot = Math.max(0, tpa - model.target);
    const chord = 2 * blade * Math.sin((rot * D) / 2);
    // the arc hangs below its centre, as the cut does below the joint
    const k = 1.75; // millimetres to scheme units
    const r = blade * k;
    const mid = 90; // straight down
    const a0 = (mid - rot / 2) * D, a1 = (mid + rot / 2) * D;
    const p = (a: number, rr = r) => [rr * Math.cos(a), rr * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    const [e0x, e0y] = p(30 * D), [e1x, e1y] = p(150 * D);
    art.innerHTML =
      h('path', { class: 'ref', d: `M${e0x} ${e0y}A${r} ${r} 0 0 1 ${e1x} ${e1y}` }) +
      h('path', { class: 'ink thin', d: `M0 0L${x0} ${y0}M0 0L${x1} ${y1}` }) +
      (rot > 0 ? h('path', { class: 'accent', d: `M${x0} ${y0}L${x1} ${y1}` }) : '') +
      h('circle', { class: 'pt', cx: 0, cy: 0, r: 1.6 }) +
      h('circle', { class: 'pt accent', cx: x0, cy: y0, r: 1.6 }) +
      h('circle', { class: 'pt accent', cx: x1, cy: y1, r: 1.6 }) +
      h('text', { x: 0, y: Math.min(y0, y1) + 9, class: 'lbl accent', 'text-anchor': 'middle' }, rot > 0 ? `${chord.toFixed(1)} mm` : '') +
      h('text', { x: 4, y: -3, class: 'lbl' }, 'centre of the cut') +
      h('text', { x: e0x + 3, y: e0y + 1, class: 'lbl muted' }, `r ${blade}`);
    (root.querySelector('#pTpa') as HTMLElement).textContent = `${tpa.toFixed(tpa % 1 ? 1 : 0)}°`;
    (root.querySelector('#pRot') as HTMLElement).textContent = `${rot.toFixed(rot % 1 ? 1 : 0)}°`;
    (root.querySelector('#pChord') as HTMLElement).textContent = `${chord.toFixed(1)} mm`;
    (root.querySelector('#pNote') as HTMLElement).textContent =
      tpa <= model.target
        ? 'Already at or below the target: nothing to rotate.'
        : tpa >= 35
          ? 'Slopes this steep often need more than a plain TPLO, for example a wedge taken out as well.'
          : 'The blade is chosen to fit the bone. The distance is measured straight across, mark to mark: 2 × radius × sin(rotation ÷ 2).';
    root.querySelectorAll<HTMLButtonElement>('#pBlades button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v! === blade)));
  };
  range.addEventListener('input', draw);
  root.querySelectorAll<HTMLButtonElement>('#pBlades button').forEach((b) => b.addEventListener('click', () => { blade = +b.dataset.v!; draw(); }));
  draw();
}

// ---------------------------------------------------------------- where the cut goes

function cut(root: HTMLElement): void {
  const R = model.radius;
  const lig = model.ligaments.patellar;
  root.innerHTML = `
    <div class="card-head"><span>Where the cut goes</span><span class="num muted">side view</span></div>
    <svg class="scheme" viewBox="-66 -62 132 120" role="img" aria-label="The top of the tibia from the side with the circle the blade follows">
      ${h('path', { class: 'bone ghost', d: BONES.femur })}
      ${h('path', { class: 'bone ghost', d: BONES.patella })}
      ${h('path', { class: 'bone', d: BONES.shaft })}
      ${h('path', { class: 'bone hot', d: BONES.fragment })}
      ${h('path', { class: 'ref', d: `M${-lig.from[0]} ${-lig.from[1]}L${-lig.to[0]} ${-lig.to[1]}` })}
      ${h('circle', { class: 'cutline', cx: 0, cy: 0, r: R })}
      ${h('circle', { class: 'pt', cx: 0, cy: 0, r: 1.6 })}
      ${h('path', { class: 'ink thin', d: `M0 0L${R * Math.cos(35 * D)} ${R * Math.sin(35 * D)}` })}
      ${h('text', { x: R * 0.5 * Math.cos(35 * D) + 2.5, y: R * 0.5 * Math.sin(35 * D) - 2, class: 'lbl' }, `${R} mm`)}
      ${h('text', { x: -3, y: -2.5, class: 'lbl', 'text-anchor': 'end' }, 'centre')}
      ${h('text', { x: -4, y: 42, class: 'lbl muted', 'text-anchor': 'middle' }, 'shaft')}
      ${h('text', { x: -40, y: 6, class: 'lbl muted', 'text-anchor': 'end' }, 'tuberosity')}
      ${h('text', { x: -24, y: -26, class: 'lbl muted', 'text-anchor': 'end' }, 'patellar ligament')}
      ${h('text', { x: 30, y: -40, class: 'lbl muted' }, 'femur')}
    </svg>
    <dl class="rows">
      <div><dt>Blade radius</dt><dd class="num">${R} mm</dd></div>
      <div><dt>Rotation planned</dt><dd class="num">${model.rotation}° · ${model.chord.toFixed(1)} mm</dd></div>
      <div><dt>Direction of the cut</dt><dd>Straight across, medial to lateral</dd></div>
    </dl>`;
}

// ---------------------------------------------------------------- recovery

function recovery(root: HTMLElement): void {
  const W = 300, x = (wk: number) => 6 + (wk / 14) * (W - 12);
  const phases: [number, number, string][] = [[0, 2, 'Rest'], [2, 8, 'Leash walks'], [8, 12, 'Building up'], [12, 14, 'Normal']];
  root.innerHTML = `
    <div class="card-head"><span>Recovery</span><span class="num muted">weeks</span></div>
    <svg class="timeline" viewBox="0 0 ${W} 58" role="img" aria-label="Recovery over the first twelve weeks">
      ${phases.map(([a, b], i) => h('rect', { class: `phase p${i}`, x: x(a) + 1, y: 22, width: x(b) - x(a) - 2, height: 8, rx: 2 })).join('')}
      ${phases.map(([a, b, name]) => h('text', { class: 'lbl', x: (x(a) + x(b)) / 2, y: 15, 'text-anchor': 'middle' }, name)).join('')}
      ${[0, 2, 8, 12].map((wk) => h('text', { class: 'lbl muted num', x: x(wk), y: 43, 'text-anchor': wk ? 'middle' : 'start' }, String(wk))).join('')}
      ${h('path', { class: 'accent', d: `M${x(6)} 34L${x(8)} 34` })}
      ${h('text', { class: 'lbl accent', x: x(7), y: 55, 'text-anchor': 'middle' }, 'radiographs')}
      ${h('path', { class: 'accent thin', d: `M${x(7)} 36L${x(7)} 46` })}
    </svg>
    <dl class="rows wide">
      <div><dt>Weeks 0–2</dt><dd>Rest and short walks on a leash. Most dogs touch the foot down within days.</dd></div>
      <div><dt>Weeks 2–8</dt><dd>Leash walks, a little longer each week. No running, jumping or play.</dd></div>
      <div><dt>Weeks 6–8</dt><dd>Radiographs show whether the cut has healed.</dd></div>
      <div><dt>Weeks 8–12</dt><dd>Activity is built back up to normal.</dd></div>
    </dl>
    <div class="card-head sub"><span>In published series</span></div>
    <dl class="rows">
      <div><dt>Any complication</dt><dd class="num">10–34%</dd></div>
      <div><dt>A second operation</dt><dd class="num">about 3–4%</dd></div>
      <div><dt>Meniscus torn later</dt><dd class="num">about 2%</dd></div>
    </dl>
    <p class="note">Timings differ between surgeons and dogs. Sources are listed under About.</p>`;
}

const BUILD: Record<SchemeName, (root: HTMLElement) => void> = { forces, planner, cut, recovery };

export function mountScheme(name: SchemeName, root: HTMLElement): void {
  BUILD[name](root);
}
