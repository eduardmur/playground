import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './style.css';
import { createIcons, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Info, Moon, Pause, Play, RotateCcw, Sun, Tag, X } from 'lucide';
import { Overlay } from './scene/overlay';
import { REST, Stage, type Pose, type View } from './scene/stage';
import { poseAt, steps } from './steps';
import { mountScheme } from './ui/schemes';

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const icons = { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Info, Moon, Pause, Play, RotateCcw, Sun, Tag, X };
const drawIcons = () => createIcons({ icons, attrs: { 'stroke-width': '1.75' } });
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);

const view = $('#view');
const panel = $('#panel');
const track = $('#track');
const stage = new Stage($<HTMLCanvasElement>('#scene'));
const overlay = new Overlay($<SVGSVGElement>('#overlay'), stage);

// ---- state

let index = Math.max(0, steps.findIndex((s) => s.id === location.hash.slice(1)));
let t = 0; // where we are in the step, 0..1
let playing = false;
/** What the viewer asked for on this step; a step has its own default until they do. */
let mode: 'auto' | 'solid' | 'xray' = 'auto';
let labels = true;
let entered = -1; // when the step was entered, on the frame clock; -1 until its first frame
const shown: Pose = { ...REST }; // what is on screen: it eases towards the step's pose
const keys = Object.keys(REST) as (keyof Pose)[];
const xray = () => (mode === 'auto' ? !!steps[index].xray : mode === 'xray');

function go(to: number, opts: { at?: number; play?: boolean } = {}): void {
  index = (to + steps.length) % steps.length;
  t = opts.at ?? (calm ? 1 : 0);
  playing = opts.play ?? !calm;
  mode = 'auto';
  entered = -1;
  stage.flyTo(steps[index].view, calm ? 0.01 : 1.2);
  history.replaceState(null, '', `#${steps[index].id}`);
  renderPanel();
  sync();
}
function toggle(): void {
  if (t >= 1) { t = 0; playing = true; } else playing = !playing;
  sync();
}

// ---- side panel

const pad = (n: number) => String(n).padStart(2, '0');
let liveCells: HTMLElement[] = [];

function renderPanel(): void {
  const s = steps[index];
  const last = index === steps.length - 1;
  const rows = (list: [string, string][]) => list.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  panel.innerHTML = `
    <div><span class="eyebrow num">${pad(index + 1)} / ${pad(steps.length)}</span><h2>${s.title}</h2></div>
    <div class="text">${s.body.map((p) => `<p>${p}</p>`).join('')}</div>
    ${s.live ? `<div class="card"><dl class="rows" id="live">${s.live(shown).map(([k]) => `<div><dt>${k}</dt><dd class="num"></dd></div>`).join('')}</dl></div>` : ''}
    ${s.scheme ? '<div class="card" id="scheme"></div>' : ''}
    ${s.facts ? `<div class="card"><dl class="rows">${rows(s.facts)}</dl></div>` : ''}
    <div class="step-nav">
      <button class="btn outline icon" id="backBtn" aria-label="Previous step" ${index === 0 ? 'disabled' : ''}><i data-lucide="arrow-left"></i></button>
      <button class="btn solid next" id="fwdBtn"><span>${last ? 'Start again' : `Next: ${steps[index + 1].name}`}</span><i data-lucide="${last ? 'rotate-ccw' : 'arrow-right'}"></i></button>
    </div>`;
  if (s.scheme) mountScheme(s.scheme, $('#scheme'));
  liveCells = [...panel.querySelectorAll<HTMLElement>('#live dd')];
  $('#backBtn').addEventListener('click', () => go(index - 1));
  $('#fwdBtn').addEventListener('click', () => go(index + 1));
  panel.scrollTop = 0;
  drawIcons();
}

// ---- timeline

track.innerHTML = steps
  .map((s, i) => `<li role="button" tabindex="0" aria-label="Step ${i + 1}: ${s.name}"><span class="name"><span class="num">${i + 1}</span><span>${s.name}</span></span><span class="bar"><span class="fill"></span></span></li>`)
  .join('');
const cells = [...track.children] as HTMLElement[];
const fills = cells.map((c) => c.querySelector('.fill') as HTMLElement);

/** Which step a point of the track belongs to, and how far along it. */
function locate(x: number): { i: number; f: number } {
  let best = 0;
  for (let i = 0; i < cells.length; i++) if (x >= cells[i].getBoundingClientRect().left) best = i;
  const r = cells[best].getBoundingClientRect();
  return { i: best, f: Math.min(1, Math.max(0, (x - r.left) / r.width)) };
}
let drag: { x: number; moved: boolean } | null = null;
track.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, moved: false };
  track.setPointerCapture(e.pointerId);
});
track.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (Math.abs(e.clientX - drag.x) > 4) drag.moved = true;
  if (!drag.moved) return;
  const { i, f } = locate(e.clientX);
  if (i !== index) go(i, { at: f, play: false });
  else { t = f; playing = false; sync(); }
});
track.addEventListener('pointerup', (e) => {
  if (drag && !drag.moved) go(locate(e.clientX).i);
  drag = null;
  (document.activeElement as HTMLElement | null)?.blur(); // a click should not leave a focus ring behind
});
track.addEventListener('pointercancel', () => { drag = null; });
cells.forEach((c, i) => c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); go(i); } }));

// ---- controls

function sync(): void {
  $('#playBtn').innerHTML = `<i data-lucide="${playing ? 'pause' : t >= 1 ? 'rotate-ccw' : 'play'}"></i>`;
  $('#playBtn').dataset.tip = playing ? 'Pause' : t >= 1 ? 'Play again' : 'Play';
  document.querySelectorAll<HTMLElement>('#modeSeg button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.mode === 'xray') === xray())));
  $('#labelsBtn').setAttribute('aria-pressed', String(labels));
  $('#overlay').classList.toggle('off', !labels);
  const dark = document.documentElement.dataset.theme !== 'light';
  $('#themeBtn').innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}"></i>`;
  cells.forEach((c, i) => {
    c.classList.toggle('now', i === index);
    c.classList.toggle('past', i < index);
    c.setAttribute('aria-current', i === index ? 'step' : 'false');
  });
  drawIcons();
}
function setTheme(dark: boolean, keep = true): void {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (keep) try { localStorage.setItem('tplo.theme', dark ? 'dark' : 'light'); } catch { /* private mode */ }
  stage.setTheme(dark);
  sync();
}
const flipTheme = () => setTheme(document.documentElement.dataset.theme === 'light');
const flipMode = () => { mode = xray() ? 'solid' : 'xray'; sync(); };
const flipLabels = () => { labels = !labels; sync(); };

$('#prevBtn').addEventListener('click', () => go(index - 1));
$('#nextBtn').addEventListener('click', () => go(index + 1));
$('#playBtn').addEventListener('click', toggle);
$('#themeBtn').addEventListener('click', flipTheme);
$('#labelsBtn').addEventListener('click', flipLabels);
document.querySelectorAll<HTMLElement>('#modeSeg button').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode as 'solid' | 'xray'; sync(); }));

const SIDES: Record<string, number> = { medial: 0, cranial: 90, lateral: 180, caudal: -90 };
document.querySelectorAll<HTMLElement>('#viewSeg button').forEach((b) =>
  b.addEventListener('click', () => {
    const v: View = { ...steps[index].view, azimuth: SIDES[b.dataset.view!], polar: 86 };
    stage.flyTo(v, calm ? 0.01 : 0.9);
  }),
);

// a double click puts the camera back where the step had it
stage.canvas.addEventListener('dblclick', () => stage.flyTo(steps[index].view, calm ? 0.01 : 0.9));
addEventListener('hashchange', () => {
  const i = steps.findIndex((s) => s.id === location.hash.slice(1));
  if (i >= 0 && i !== index) go(i);
});

const about = $<HTMLDialogElement>('#about');
$('#aboutBtn').addEventListener('click', () => about.showModal());
$('#aboutClose').addEventListener('click', () => about.close());
about.addEventListener('click', (e) => { if (e.target === about) about.close(); });

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || about.open) return;
  const el = e.target as HTMLElement;
  const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  if (e.key === 'ArrowRight' && !typing) go(Math.min(steps.length - 1, index + 1));
  else if (e.key === 'ArrowLeft' && !typing) go(Math.max(0, index - 1));
  else if (e.key === ' ' && el.tagName !== 'BUTTON' && !typing) toggle();
  else if (/^[1-8]$/.test(e.key) && !typing) go(+e.key - 1);
  else if (e.key.toLowerCase() === 'x') flipMode();
  else if (e.key.toLowerCase() === 'l') flipLabels();
  else if (e.key.toLowerCase() === 't') flipTheme();
  else return;
  e.preventDefault();
});

// ---- size

const fit = () => {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  stage.resize(w, h);
  overlay.resize(w, h);
};
new ResizeObserver(fit).observe(view);
fit();

// ---- start

if (params.has('theme')) setTheme(params.get('theme') !== 'light', false);
else setTheme(document.documentElement.dataset.theme !== 'light', false);
renderPanel();
await stage.load();
$('#loading').classList.add('done');
setTimeout(() => $('#loading')?.remove(), 600);
stage.setView({ ...steps[index].view, distance: steps[index].view.distance * Math.max(1, 1.15 / stage.camera.aspect) });
t = params.has('t') ? +params.get('t')! : calm ? 1 : 0;
playing = !calm && !params.has('t');
Object.assign(shown, poseAt(index, t));
sync();

let last = performance.now();
let lastT = -1;
let lastIndex = -1;
let lastFade = -1;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (playing) {
    t += dt / steps[index].duration;
    if (t >= 1) { t = 1; playing = false; sync(); }
  }
  const target = poseAt(index, t);
  target.xray = xray() ? 1 : 0;
  // ease what is shown towards the step's pose
  let posed = index !== lastIndex;
  const k = 1 - Math.exp(-dt * 16);
  for (const key of keys) {
    const before = shown[key];
    const d = target[key] - before;
    shown[key] = Math.abs(d) > 1e-4 ? before + d * k : target[key];
    if (shown[key] !== before) posed = true;
  }
  if (posed || playing) stage.apply(shown, now / 1000, playing);
  const drew = stage.frame(dt);
  if (entered < 0) entered = now;
  const fade = Math.min(1, (now - entered) / 500);
  if (drew || posed || playing || fade !== lastFade || t !== lastT) {
    overlay.begin();
    steps[index].draw(overlay, t, fade * fade * (3 - 2 * fade), stage, shown);
    overlay.end();
    fills.forEach((f, i) => { f.style.width = `${(i < index ? 1 : i > index ? 0 : t) * 100}%`; });
    const live = steps[index].live?.(shown);
    if (live) live.forEach(([, v], i) => { if (liveCells[i] && liveCells[i].textContent !== v) liveCells[i].textContent = v; });
  }
  lastFade = fade;
  lastT = t;
  lastIndex = index;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// for looking at things from the console
Object.assign(window, { tplo: { stage, overlay, steps, go, get state() { return { index, t, playing, shown }; } } });
