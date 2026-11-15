// The interface outside the car: a quiet row of controls, three small panels
// (weather and time, sound, settings), subtitles, and the list of riders met.
import {
  createElement, createIcons,
  Sun, Cloud, CloudRain, CloudLightning, CloudFog, Snowflake, Shuffle,
  Volume2, VolumeX, Music, CarFront, MessageCircle, SkipForward,
  Video, Users, Settings, EyeOff, X, RotateCcw,
} from 'lucide';
import { WEATHERS, WEATHER_ORDER } from '../world/weather.js';
import { RIDERS, VOICES } from '../data/riders.js';
import { clockText } from '../core/utils.js';

const $ = (id) => document.getElementById(id);
const SKY = { clear: Sun, cloudy: Cloud, rain: CloudRain, storm: CloudLightning, fog: CloudFog, snow: Snowflake, auto: Shuffle };
const TIMES = [['Dawn', 6.2], ['Noon', 12.5], ['Golden', 17.6], ['Dusk', 18.9], ['Night', 22.5]];
const FLOWS = [['Hold', 0, 'The clock stands still'], ['Real', 1, 'A minute lasts a minute'], ['Drift', 20, 'A day in 72 minutes'], ['Fast', 120, 'A day in 12 minutes']];
const VIEWS = [['Front', 'front'], ['Rear', 'rear'], ['Riders', 'riders']];
const PICTURE = [['Light', 'low'], ['Standard', 'med'], ['Sharp', 'high']];
const KEYS = [['Weather', '1–6'], ['Surprise me', '0'], ['An hour back', '['], ['An hour on', ']'], ['Pace of the day', 'T'], ['Radio', 'M'], ['Next track', 'N'], ['View', 'C'], ['Riders', 'J'], ['Hide the interface', 'H']];
/** The button that opens each panel. */
const PANELS = [['skyBtn', 'skyPop'], ['soundBtn', 'soundPop'], ['setBtn', 'setPop']];

function phase(h) {
  if (h < 4.8) return 'Night';
  if (h < 6.6) return 'Dawn';
  if (h < 11) return 'Morning';
  if (h < 15) return 'Midday';
  if (h < 17.2) return 'Afternoon';
  if (h < 18.6) return 'Golden hour';
  if (h < 19.6) return 'Dusk';
  return 'Night';
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const hourText = (h) => clockText(h).replace(':00', '');
const initial = (name) => name.replace(/^(Mr|Mrs|Ms|Dr)\.?\s+/, '')[0];

/** A lucide icon as an element. */
function icon(node) {
  const el = createElement(node);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** A row of mutually exclusive choices. `items` is [[label, value, hint?]]. */
function choices(host, items, pick) {
  for (const [label, value, hint] of items) {
    const b = document.createElement('button');
    b.dataset.value = value;
    b.textContent = label;
    if (hint) b.title = hint;
    b.addEventListener('click', () => pick(value));
    host.appendChild(b);
  }
}

const press = (host, value) => {
  for (const b of host.children) b.setAttribute('aria-pressed', b.dataset.value === String(value));
};

/** Paint the part of a slider's track that lies before its thumb. */
const fill = (el) => el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);

export class Hud {
  constructor(game) {
    this.game = game;
    this.subsOn = true;
    this.bare = false;
    this.open = null; // id of the panel that is showing
    this.tick = 0;
    this.sky = null;

    createIcons({ icons: { Music, CarFront, MessageCircle, SkipForward, Video, Users, Settings, EyeOff, X, RotateCcw }, attrs: { 'aria-hidden': 'true' } });

    // ---- the row of controls
    for (const [btn, pop] of PANELS) $(btn).addEventListener('click', () => this.show(this.open === pop ? null : pop));
    document.addEventListener('pointerdown', (e) => {
      if (this.open && !e.target.closest('.pop') && !PANELS.some(([btn]) => e.target.closest(`#${btn}`))) this.show(null);
    });
    window.addEventListener('resize', () => this.place());
    $('camBtn').addEventListener('click', () => game.cycleView());
    $('ridersBtn').addEventListener('click', () => this.toggleRiders());
    $('hideBtn').addEventListener('click', () => this.setBare(true));
    $('ridersClose').addEventListener('click', () => this.toggleRiders(false));
    $('riders').addEventListener('click', (e) => {
      if (e.target === $('riders')) this.toggleRiders(false);
    });
    $('resetBtn').addEventListener('click', () => {
      game.rides.reset();
      this.renderRiders();
      this.setMet();
    });

    // ---- weather and time
    for (const k of [...WEATHER_ORDER, 'auto']) {
      const b = document.createElement('button');
      b.className = 'toggle';
      b.dataset.value = k;
      b.append(icon(SKY[k]), k === 'auto' ? 'Surprise me' : WEATHERS[k].label);
      b.addEventListener('click', () => game.setWeather(k));
      $('weatherChips').appendChild(b);
    }
    const slider = $('timeSlider');
    slider.addEventListener('input', () => game.setHour(parseFloat(slider.value)));
    choices($('timeChips'), TIMES, (h) => game.setHour(h));
    choices($('flowChips'), FLOWS, (f) => game.setFlow(f));

    // ---- sound
    $('musicBtn').addEventListener('click', () => game.toggleMusic());
    $('nextBtn').addEventListener('click', () => game.audio.nextTrack());
    const vol = game.audio.vol;
    for (const [id, name] of [['volMusic', 'music'], ['volAmb', 'ambience'], ['volVoice', 'voice']]) {
      const el = $(id), out = $(`${id}Value`);
      const paint = () => {
        fill(el);
        out.textContent = `${Math.round(el.value * 100)}%`;
      };
      el.value = vol[name];
      el.addEventListener('input', () => {
        game.audio.setVolume(name, parseFloat(el.value));
        paint();
      });
      paint();
    }
    $('subsOn').addEventListener('click', () => {
      this.subsOn = !this.subsOn;
      $('subsOn').setAttribute('aria-checked', this.subsOn);
      if (!this.subsOn) $('subs').classList.remove('on');
    });

    // ---- settings
    choices($('viewTabs'), VIEWS, (v) => game.setView(v));
    choices($('qualityTabs'), PICTURE, (q) => {
      // a different picture is a different renderer: reload, keeping the rest of the address
      const p = new URLSearchParams(location.search);
      p.set('q', q);
      location.search = p.toString();
    });
    const q = game.params.get('q');
    press($('qualityTabs'), PICTURE.some(([, v]) => v === q) ? q : 'med');
    $('keys').innerHTML = KEYS.map(([what, key]) => `<div><span>${what}</span><kbd>${key}</kbd></div>`).join('');

    this.sound(Volume2);
    this.setMet();
    this.sync();
  }

  // ------------------------------------------------------------ opening

  /** Browsers keep a page silent until it is touched: say so where the radio's name will go. */
  setSilent() {
    $('trackName').textContent = 'Click for sound';
    $('trackLine').textContent = 'Waiting for a click';
    $('soundBtn').classList.add('off');
    this.sound(VolumeX);
  }

  clearFade() {
    $('fade').classList.add('clear');
  }

  sound(node) {
    $('soundIcon').replaceChildren(icon(node));
  }

  // ------------------------------------------------------------ panels

  /** Show one panel, under the button that opens it, or none. */
  show(id) {
    this.open = id;
    for (const [btn, pop] of PANELS) {
      $(pop).hidden = pop !== id;
      $(btn).setAttribute('aria-expanded', pop === id);
    }
    this.place();
  }

  place() {
    const pair = PANELS.find(([, pop]) => pop === this.open);
    if (!pair) return;
    // under the whole row, which wraps onto more lines on a narrow screen
    const r = $(pair[0]).getBoundingClientRect(), p = $(pair[1]);
    p.style.top = `${Math.round($(pair[0]).closest('.bar').getBoundingClientRect().bottom + 8)}px`;
    p.style.right = `${Math.max(12, Math.round(window.innerWidth - r.right))}px`;
  }

  /** Tab opens the weather, or closes whatever is open. */
  togglePanel(force) {
    this.show(force === false || (force === undefined && this.open) ? null : 'skyPop');
  }

  toggleRiders(force) {
    const r = $('riders');
    const show = force === undefined ? r.hidden : force;
    if (show) {
      this.show(null);
      this.renderRiders();
    }
    r.hidden = !show;
  }

  get ridersOpen() {
    return !$('riders').hidden;
  }

  setBare(on) {
    this.bare = on;
    document.body.classList.toggle('bare', on);
    if (on) this.show(null);
    const h = $('hint');
    if (on) {
      h.classList.add('show');
      setTimeout(() => h.classList.remove('show'), 2600);
    }
  }

  // ------------------------------------------------------------ live bits

  /** Reflect weather, time, pace and view in the controls. */
  sync() {
    const g = this.game;
    press($('weatherChips'), g.weather.auto ? 'auto' : g.weather.kind);
    press($('flowChips'), g.timeFlow);
    press($('viewTabs'), g.view);
    $('flowLabel').textContent = (FLOWS.find(([, f]) => f === g.timeFlow) || FLOWS[0])[2];
    if (this.sky !== g.weather.kind) {
      this.sky = g.weather.kind;
      $('skyIcon').replaceChildren(icon(SKY[this.sky]));
    }
    $('skyName').textContent = g.weather.label;
    this.clock();
  }

  clock() {
    const h = this.game.hour;
    $('clock').textContent = clockText(h);
    $('timeLabel').textContent = `${clockText(h)} · ${phase(h)}`;
    const s = $('timeSlider');
    if (document.activeElement !== s) s.value = h;
    fill(s);
  }

  setRide(st) {
    $('rideLabel').textContent = st.label || '';
    $('rideHead').textContent = st.headline || '';
  }

  setTrack(title) {
    $('trackName').textContent = title || 'Radio off';
    $('trackLine').textContent = title || 'Off';
    $('musicBtn').setAttribute('aria-checked', !!title);
    $('soundBtn').classList.toggle('off', !title);
    this.sound(Volume2);
  }

  setSubtitle(line) {
    const el = $('subs');
    if (!line || !this.subsOn) {
      el.classList.remove('on');
      return;
    }
    $('subWho').textContent = line.name;
    $('subText').textContent = line.text;
    el.classList.add('on');
  }

  toast(html, ms = 5200) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    $('toasts').appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 520);
    }, ms);
  }

  fare({ name, fare, tip }) {
    const tipText = tip ? ` + $${tip.toFixed(2)} tip` : '';
    this.toast(`<b>${esc(name)}</b> dropped off<small>$${fare.toFixed(2)}${tipText} · ★★★★★</small>`);
  }

  met(ride, first) {
    this.setMet();
    if (first) this.toast(`<b>${esc(ride.name)}</b> is in your notebook<small>${esc(ride.memory)}</small>`, 9000);
  }

  setMet() {
    const met = this.game.rides.stats.met;
    $('metCount').textContent = RIDERS.filter((r) => met[r.id]).length;
  }

  renderRiders() {
    const g = this.game, st = g.rides.stats, city = g.city;
    const metN = RIDERS.filter((r) => st.met[r.id]).length;
    $('ridersSub').textContent = metN === RIDERS.length ? 'You have met everyone. They will ride again.' : `${metN} of ${RIDERS.length} met. Some only ride at certain hours.`;
    $('riderGrid').innerHTML = RIDERS.map((r) => {
      const met = !!st.met[r.id];
      const name = r.party.map((p) => VOICES[p.voice].name).join(' & ');
      const where = `${city.poi[r.from].name} → ${city.poi[r.to].name}`;
      const when = r.hours ? `Rides between ${hourText(r.hours[0])} and ${hourText(r.hours[1])}.` : 'Rides at any hour.';
      return `<div class="rider ${met ? 'met' : ''}">
        <div class="av">${met ? esc(initial(name)) : '?'}</div>
        <div><h3>${met ? esc(name) : 'Not met yet'}</h3>
        <div class="where">${met ? esc(where) : esc(when)}</div>
        ${met ? `<p>${esc(r.memory)}</p>` : ''}</div>
      </div>`;
    }).join('');
    const miles = st.meters / 1609.34;
    $('shiftStats').textContent = `${st.trips} trip${st.trips === 1 ? '' : 's'} · ${miles.toFixed(1)} miles · $${st.earned.toFixed(2)} earned`;
  }

  update(dt) {
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.25;
      this.clock();
    }
  }
}
