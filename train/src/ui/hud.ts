// The interface: one small bar at the bottom, and a panel over each of its buttons.
import {
  createElement, createIcons, type IconNode,
  Binoculars, Timer as TimerIcon, Radio, TrainFront, RotateCcw, SkipForward, Play, Pause, Minus, Plus,
  Sunrise, Sun, Sunset, Moon, Volume2, Volume1, VolumeX, Maximize, Minimize,
} from 'lucide';
import type { App } from '../app';
import type { Audio } from '../audio/engine';
import type { Timer } from '../core/timer';
import { settings, save } from '../core/settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const TIMES: [string, number][] = [['Dawn', 6.1], ['Noon', 12.4], ['Golden', 17.3], ['Dusk', 18.5], ['Night', 22.5]];
const PANELS: [string, string][] = [['timeBtn', 'timePop'], ['timerBtn', 'timerPop'], ['radioBtn', 'radioPop'], ['soundBtn', 'soundPop']];
const LENGTHS: [keyof typeof settings & ('focus' | 'rest' | 'long'), string, number, number][] = [['focus', 'Focus', 5, 90], ['rest', 'Break', 1, 30], ['long', 'Long break', 5, 60]];

export function clockText(h: number) {
  const m = Math.round(h * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function phase(h: number): [string, IconNode] {
  if (h < 5.2) return ['Night', Moon];
  if (h < 6.8) return ['Dawn', Sunrise];
  if (h < 11) return ['Morning', Sun];
  if (h < 15) return ['Midday', Sun];
  if (h < 16.9) return ['Afternoon', Sun];
  if (h < 18.1) return ['Golden hour', Sunset];
  if (h < 19.2) return ['Dusk', Sunset];
  return ['Night', Moon];
}
function icon(node: IconNode) {
  const el = createElement(node);
  el.setAttribute('aria-hidden', 'true');
  return el;
}
const fill = (el: HTMLInputElement) => el.style.setProperty('--p', `${((+el.value - +el.min) / (+el.max - +el.min)) * 100}%`);

export class Hud {
  private open: string | null = null;
  private idleAt = 0;
  private lastPhase = '';
  private lastVol = '';
  private hintTimer = 0;

  constructor(private app: App, private audio: Audio, private timer: Timer) {
    createIcons({ icons: { Binoculars, Timer: TimerIcon, Radio, TrainFront, RotateCcw, SkipForward }, attrs: { 'aria-hidden': 'true' } });

    for (const [btn, pop] of PANELS) $(btn).addEventListener('click', () => this.show(this.open === pop ? null : pop));
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Element;
      if (this.open && !t.closest('.pop') && !PANELS.some(([btn]) => t.closest(`#${btn}`))) this.show(null);
    });
    window.addEventListener('resize', () => this.place());

    // ---- window view, fullscreen
    $('viewBtn').addEventListener('click', () => app.setWindowView(true));
    $('fullBtn').addEventListener('click', () => this.fullscreen());
    document.addEventListener('fullscreenchange', () => this.paintFull());
    this.paintFull();

    // ---- time of day
    const slider = $<HTMLInputElement>('timeSlider');
    slider.addEventListener('input', () => app.setHour(parseFloat(slider.value)));
    for (const [label, h] of TIMES) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => app.setHour(h));
      $('timeChips').appendChild(b);
    }
    $('driftBtn').addEventListener('click', () => this.setDrift(!app.drift));

    // ---- timer
    $('timerGo').addEventListener('click', () => timer.toggle());
    $('timerReset').addEventListener('click', () => timer.reset());
    $('timerSkip').addEventListener('click', () => timer.skip());
    for (const [key, label, min, max] of LENGTHS) {
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = label;
      const st = document.createElement('span');
      st.className = 'stepper';
      const out = document.createElement('output');
      const paint = () => (out.textContent = `${settings[key]} min`);
      const step = (d: number) => {
        const big = settings[key] >= 30 ? 5 : settings[key] >= 10 && key !== 'rest' ? 5 : 1;
        settings[key] = Math.min(max, Math.max(min, settings[key] + d * big));
        paint();
        save();
        timer.resize();
      };
      const less = document.createElement('button'), more = document.createElement('button');
      less.append(icon(Minus));
      more.append(icon(Plus));
      less.setAttribute('aria-label', `Shorter ${label.toLowerCase()}`);
      more.setAttribute('aria-label', `Longer ${label.toLowerCase()}`);
      less.addEventListener('click', () => step(-1));
      more.addEventListener('click', () => step(1));
      st.append(less, out, more);
      row.append(name, st);
      $('lengths').appendChild(row);
      paint();
    }

    // ---- radio
    $('radioSwitch').addEventListener('click', () => this.setRadio(!audio.radioOn));
    $('nextBtn').addEventListener('click', () => audio.nextTrack());
    for (const st of audio.stations) {
      const b = document.createElement('button');
      b.dataset.value = st.id;
      b.textContent = st.name;
      b.addEventListener('click', () => this.setStation(st.id));
      $('stationTabs').appendChild(b);
    }
    audio.onTrack = () => this.paintRadio();

    // ---- sound
    for (const [id, which] of [['volRadio', 'radio'], ['volTrain', 'train']] as const) {
      const el = $<HTMLInputElement>(id), out = $(`${id}Value`);
      const paint = () => {
        fill(el);
        out.textContent = `${Math.round(+el.value * 100)}%`;
      };
      el.value = String(which === 'radio' ? settings.volRadio : settings.volTrain);
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        audio.setVolume(which, v);
        if (which === 'radio') settings.volRadio = v;
        else settings.volTrain = v;
        save();
        paint();
        this.paintSound();
      });
      paint();
    }
    $('muteBtn').addEventListener('click', () => this.setMuted(!audio.muted));

    // ---- keys
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === 'Escape') {
        if (this.open) this.show(null);
        else if (app.windowView) app.setWindowView(false);
        return;
      }
      if (tag === 'INPUT' && (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')) return;
      const k = e.key.toLowerCase();
      if (k === 'f' && e.shiftKey) this.fullscreen();
      else if (k === 'f') app.setWindowView(!app.windowView);
      else if (k === 't') this.show(this.open === 'timePop' ? null : 'timePop');
      else if (k === 'p') this.show(this.open === 'timerPop' ? null : 'timerPop');
      else if (k === ' ') {
        if (tag === 'BUTTON') return;
        timer.toggle();
      } else if (k === 'r') this.setRadio(!audio.radioOn);
      else if (k === 'n') this.nextStation();
      else if (k === 'm') this.setMuted(!audio.muted);
      else if (k === '[') app.setHour(app.hour - 0.5);
      else if (k === ']') app.setHour(app.hour + 0.5);
      else return;
      e.preventDefault();
      this.wake();
    });

    // ---- stepping back when nothing moves
    for (const ev of ['pointermove', 'pointerdown', 'touchstart'] as const) window.addEventListener(ev, () => this.wake(), { passive: true });
    this.wake();

    app.on((what) => {
      if (what === 'hour') this.paintTime();
      if (what === 'view') this.paintView();
    });
    timer.onChange = () => this.paintTimer();
    this.paintTime();
    this.paintTimer();
    this.paintRadio();
    this.paintSound();
    this.paintView();
    $('driftBtn').setAttribute('aria-checked', String(app.drift));
  }

  // ---- actions

  setDrift(on: boolean) {
    this.app.drift = on;
    settings.drift = on;
    save();
    $('driftBtn').setAttribute('aria-checked', String(on));
  }
  setRadio(on: boolean) {
    this.audio.setRadio(on);
    settings.radio = on;
    save();
    this.paintRadio();
  }
  setStation(id: string) {
    this.audio.setStation(id);
    settings.station = id;
    if (!this.audio.radioOn) this.setRadio(true);
    save();
    this.paintRadio();
  }
  nextStation() {
    const list = this.audio.stations, i = list.indexOf(this.audio.station);
    this.setStation(list[(i + 1) % list.length].id);
  }
  setMuted(m: boolean) {
    this.audio.setMuted(m);
    settings.muted = m;
    save();
    this.paintSound();
  }
  fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  // ---- painting

  private paintTime() {
    const h = this.app.hour;
    const [name, ic] = phase(h);
    $('clock').textContent = clockText(h);
    $('timeLabel').textContent = clockText(h);
    $('phaseName').textContent = name;
    const slider = $<HTMLInputElement>('timeSlider');
    if (document.activeElement !== slider || Math.abs(+slider.value - h) > 0.03) slider.value = String(h);
    if (name !== this.lastPhase) {
      this.lastPhase = name;
      $('timeIcon').replaceChildren(icon(ic));
    }
  }

  private paintTimer() {
    const t = this.timer;
    $('timerText').textContent = t.text;
    $('timerBig').textContent = t.text;
    $('timerPhase').textContent = t.phase === 'long' ? 'Long break' : `${t.label} · ${t.round} of ${settings.rounds}`;
    $('timerGoText').textContent = t.running ? 'Pause' : t.left < t.length() - 0.5 ? 'Resume' : 'Start';
    const want = t.running ? 'pause' : 'play';
    const host = $('timerGoIcon');
    if (host.dataset.icon !== want) {
      host.dataset.icon = want;
      host.replaceChildren(icon(t.running ? Pause : Play));
    }
    $('timerBtn').classList.toggle('off', !t.running);
    document.title = t.running ? `${t.text} · ${t.label} · Pomodoro train` : 'Pomodoro train';
  }

  private paintRadio() {
    const a = this.audio;
    $('radioSwitch').setAttribute('aria-checked', String(a.radioOn));
    $('radioText').textContent = a.radioOn ? a.station.name : 'Radio';
    $('radioBtn').classList.toggle('off', !a.radioOn);
    $('trackLine').textContent = a.radioOn ? a.trackTitle : 'Off';
    for (const b of $('stationTabs').children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.value === a.station.id && a.radioOn));
  }

  private paintSound() {
    const a = this.audio;
    const loud = Math.max(a.volRadio, a.volTrain);
    const key = a.muted || loud === 0 ? 'x' : loud < 0.45 ? '1' : '2';
    if (key !== this.lastVol) {
      this.lastVol = key;
      $('soundIcon').replaceChildren(icon(key === 'x' ? VolumeX : key === '1' ? Volume1 : Volume2));
    }
    $('muteBtn').setAttribute('aria-checked', String(a.muted));
    $('soundBtn').classList.toggle('off', a.muted);
  }

  private paintFull() {
    $('fullIcon').replaceChildren(icon(document.fullscreenElement ? Minimize : Maximize));
  }

  private paintView() {
    const on = this.app.windowView;
    document.body.classList.toggle('window', on);
    if (on) this.show(null);
    const hint = $('hint');
    window.clearTimeout(this.hintTimer);
    hint.classList.toggle('show', on);
    if (on) this.hintTimer = window.setTimeout(() => hint.classList.remove('show'), 4200);
  }

  // ---- panels

  private show(id: string | null) {
    this.open = id;
    for (const [btn, pop] of PANELS) {
      $(pop).hidden = pop !== id;
      $(btn).setAttribute('aria-expanded', String(pop === id));
    }
    this.place();
    this.wake();
  }

  /** Put the open panel over its button, kept inside the window. */
  private place() {
    const pair = PANELS.find(([, pop]) => pop === this.open);
    if (!pair) return;
    const btn = $(pair[0]).getBoundingClientRect(), pop = $(pair[1]);
    const half = pop.offsetWidth / 2;
    const x = Math.min(window.innerWidth - half - 12, Math.max(half + 12, btn.left + btn.width / 2));
    pop.style.left = `${x}px`;
  }

  private wake() {
    this.idleAt = performance.now() + 3800;
    document.body.classList.remove('idle');
  }

  /** Call now and then. */
  tick() {
    const over = document.querySelector('.bar:hover, .pop:hover');
    if (!this.open && !over && performance.now() > this.idleAt) document.body.classList.add('idle');
    if (this.app.drift) this.paintTime();
  }
}
