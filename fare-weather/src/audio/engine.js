// Sound. Every id in the manifest is played from a recording in public/audio/
// when one exists and from a synthesised stand-in when it does not, so the two
// can be mixed freely while the real audio is being made.
import files from 'virtual:audio-index';
import NOTES from './recordings.json';
import { SFX, MUSIC, sfxFile } from './manifest.js';
import { synthBuffer } from './synth.js';
import { Lofi, LOFI_TRACKS } from './lofi.js';
import { plain, weight } from '../data/riders.js';
import { clamp, clamp01, damp, lerp, smoothstep } from '../core/utils.js';

/** 'sfx/door_open' -> 'audio/sfx/door_open.mp3' for every file that is really there. */
const INDEX = new Map();
for (const f of files) INDEX.set(f.replace(/\.[^.]+$/, ''), `audio/${f}`);
const SFX_BY_ID = new Map(SFX.map((s) => [s.id, s]));

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * What scripts/audio-tools.mjs noted about a recording it made: the gain it could not put in the
 * file without clipping. Only trusted while the file is still that long.
 */
const noteFor = (key, buf) => {
  const n = NOTES[key];
  return n && buf && Math.abs(n.seconds - buf.duration) < 0.2 ? n : null;
};

/** A bed that keeps running: one looping source, playing the recording if there is one. */
class Bed {
  constructor(engine, id, bus) {
    this.engine = engine;
    this.id = id;
    this.def = SFX_BY_ID.get(id);
    this.gain = engine.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(bus);
    this.level = 0;
    this.boost = 1;
    this.sources = [];
    this.running = false;
  }

  set(level, rate = 1, dt = 0.016) {
    this.level = damp(this.level, level, 3, dt);
    const g = this.level * this.def.gain;
    this.gain.gain.value = g < 0.0005 ? 0 : g * this.boost;
    if (g > 0.0005 && !this.running) this._start();
    else if (g <= 0.0005 && this.running && level <= 0) this._stop();
    for (const s of this.sources) s.src.playbackRate.value = rate;
  }

  _start() {
    const e = this.engine, ctx = e.ctx;
    this.running = true;
    const rec = e.looped(sfxFile(this.id));
    this.boost = rec ? e.boost(sfxFile(this.id)) : 1;
    const buf = rec || synthBuffer(ctx, this.id);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    if (buf.loopEnd) src.loopEnd = buf.loopEnd;
    src.connect(this.gain);
    src.start(ctx.currentTime, Math.random() * (buf.loopEnd || buf.duration));
    this.sources.push({ src });
  }

  _stop() {
    for (const s of this.sources) {
      try {
        s.src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.length = 0;
    this.running = false;
  }

  /** A recording has just finished loading: switch over to it. */
  refresh() {
    if (this.running) {
      this._stop();
      this._start();
    }
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.buffers = new Map(); // key -> AudioBuffer (recorded sound effects; voices are not kept)
    this.loading = new Map();
    // voices sit just above the radio (about 2 LU over it while it is ducked): what is said in the cab is
    // part of the evening, not an announcement
    this.vol = { master: 0.9, music: 0.6, ambience: 0.8, voice: 0.55 };
    try {
      const { v, ...saved } = JSON.parse(localStorage.getItem('fare-weather.volume') || '{}');
      if (v !== 2 && saved.voice === 1) delete saved.voice; // saved when voices were full up by default: take the new default
      Object.assign(this.vol, saved);
    } catch {
      /* fine */
    }
    this.musicOn = true;
    this.onSubtitle = null; // ({ who, name, text } | null)
    this.onTrack = null; // (title)
    this.speaking = null; // voice id currently talking, for lip-less nodding
    this.voiceLevel = 0;
    this.trackTitle = '';
    this.eventT = { horn: 30, siren: 150, puddle: 4 };
    this.mood = [];
    this.door = 0;
    this._say = null;
    this.instant = false;
    this.hasFiles = INDEX.size > 0;
    this.hasVoices = [...INDEX.keys()].some((k) => k.startsWith('voice/'));
  }

  has(key) {
    return INDEX.has(key);
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    this.master.gain.linearRampToValueAtTime(this.vol.master, ctx.currentTime + 2);

    // inside the car
    this.inBus = ctx.createGain();
    this.inBus.connect(this.master);
    // the street: muffled by the glass until a door opens
    this.outBus = ctx.createGain();
    this.outFilter = ctx.createBiquadFilter();
    this.outFilter.type = 'lowpass';
    this.outFilter.frequency.value = 800;
    this.outBus.connect(this.outFilter).connect(this.master);
    // riders and the car's own voice. Heads nod to the voice as recorded, however far down it is turned
    this.voiceIn = ctx.createGain();
    this.voiceBus = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this._wave = new Uint8Array(this.analyser.fftSize);
    this.voiceIn.connect(this.analyser);
    this.voiceIn.connect(this.voiceBus).connect(this.master);
    // radio: plays "through the speakers", so it gets a touch of cabin colouring
    this.musicBus = ctx.createGain();
    this.musicDuck = ctx.createGain();
    const mEq = ctx.createBiquadFilter();
    mEq.type = 'highshelf';
    mEq.frequency.value = 6000;
    mEq.gain.value = -3;
    this.musicBus.connect(mEq).connect(this.musicDuck).connect(this.master);
    this._applyVolumes();

    this.beds = {};
    for (const id of ['cabin_drive', 'cabin_idle', 'rain_light', 'rain_heavy', 'wet_road', 'snow_hush']) this.beds[id] = new Bed(this, id, this.inBus);
    for (const id of ['wind', 'city_day', 'city_night', 'birds_morning']) this.beds[id] = new Bed(this, id, this.outBus);

    // radio
    this.lofi = new Lofi(ctx, this.musicBus);
    this.lofi.onEnd = () => setTimeout(() => this.nextTrack(), 2500);
    this.playlist = [...INDEX.keys()].filter((k) => k.startsWith('music/'));
    this.el = null;
    this.elGain = null;
    this.ready = true;

    // fetch recordings in the background; stand-ins cover until they arrive
    for (const s of SFX) if (INDEX.has(sfxFile(s.id))) this.load(sfxFile(s.id)).then(() => this.beds[s.id]?.refresh());
    if (this.musicOn) this.nextTrack();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const v = this.vol;
    this.inBus.gain.value = v.ambience;
    this.voiceBus.gain.value = v.voice;
    this.musicBus.gain.value = v.music;
    this.master.gain.setTargetAtTime(v.master, this.ctx.currentTime, 0.05);
  }

  setVolume(name, value) {
    this.vol[name] = clamp01(value);
    this._applyVolumes();
    try {
      localStorage.setItem('fare-weather.volume', JSON.stringify({ ...this.vol, v: 2 }));
    } catch {
      /* fine */
    }
  }

  /** Fetch and decode a recording. Nothing is kept: a spoken clip is heard once in a long while. */
  decode(key) {
    const url = INDEX.get(key);
    if (!url || !this.ctx) return Promise.resolve(null);
    return fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then((ab) => this.ctx.decodeAudioData(ab))
      .catch(() => null);
  }

  /** The same, kept for good: sound effects are played again and again. */
  load(key) {
    if (this.buffers.has(key)) return Promise.resolve(this.buffers.get(key));
    if (this.loading.has(key)) return this.loading.get(key);
    const p = this.decode(key).then((buf) => {
      if (buf) this.buffers.set(key, buf);
      return buf;
    });
    this.loading.set(key, p);
    return p;
  }

  /**
   * A recorded bed, made safe to loop: its last moments are folded into its first, so the join
   * cannot be heard however the file was cut or encoded. Done once, in place.
   */
  looped(key) {
    const buf = this.buffers.get(key);
    if (!buf || buf.loopEnd) return buf || null;
    const n = Math.floor(Math.min(1.5, buf.duration * 0.2) * buf.sampleRate), L = buf.length;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = ((i / n) * Math.PI) / 2; // equal power: the two ends are different sounds
        d[i] = d[i] * Math.sin(t) + d[L - n + i] * Math.cos(t);
      }
    }
    buf.loopEnd = (L - n) / buf.sampleRate;
    return buf;
  }

  /** How much louder to play a recording than its file is (see noteFor). */
  boost(key) {
    const n = noteFor(key, this.buffers.get(key));
    return n && n.gain ? 10 ** (n.gain / 20) : 1;
  }

  // ------------------------------------------------------------ one-shots

  /** opts: { gain, rate, pan, out (play on the street bus), delay } */
  play(id, opts = {}) {
    if (!this.ready || this.instant) return; // nothing is heard while fast-forwarding: an hour of doors and passing cars would land at once
    const ctx = this.ctx;
    const def = SFX_BY_ID.get(id);
    if (!def) return;
    const rec = this.buffers.get(sfxFile(id));
    const buf = rec || synthBuffer(ctx, id);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate || 1;
    const g = ctx.createGain();
    g.gain.value = def.gain * (opts.gain ?? 1) * (rec ? this.boost(sfxFile(id)) : 1);
    let node = g;
    if (opts.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(opts.pan, -1, 1);
      g.connect(p);
      node = p;
    }
    src.connect(g);
    node.connect(opts.out ? this.outBus : this.inBus);
    src.start(ctx.currentTime + (opts.delay || 0));
  }

  // ------------------------------------------------------------ voices

  /**
   * Speak a clip. `lines` is [{ who, name, text }], nearly always one line. With a recording
   * the subtitle stays up for as long as it lasts (several lines share its length by their own);
   * without one it is shown at reading pace.
   * Returns a promise that resolves when it is over (or was cut short).
   */
  say(key, lines) {
    this.stopSpeech();
    if (this.instant) return Promise.resolve(); // fast-forwarding
    const total = lines.reduce((s, l) => s + weight(l.text), 0);
    const state = { stopped: false, timers: [], src: null };
    this._say = state;
    return new Promise((resolve) => {
      const finish = () => {
        if (state.done) return;
        state.done = true;
        for (const t of state.timers) clearTimeout(t);
        if (this._say === state) {
          this._say = null;
          this.speaking = null;
          this.onSubtitle?.(null);
        }
        resolve();
      };
      state.finish = finish;
      const run = (duration, hasAudio) => {
        if (state.stopped) return finish();
        state.silent = !hasAudio; // subtitles only: no need to duck the radio
        let at = 0;
        for (const line of lines) {
          state.timers.push(setTimeout(() => {
            if (state.stopped) return;
            this.speaking = line.who;
            this.onSubtitle?.({ who: line.who, name: line.name, text: plain(line.text), silent: !hasAudio });
          }, at * 1000));
          at += (weight(line.text) / total) * duration;
        }
        state.timers.push(setTimeout(finish, duration * 1000 + 250));
      };
      const fallback = () => run(Math.max(1.6, total * 0.058), false);
      if (!this.ready || !INDEX.has(key)) return fallback();
      this.decode(key).then((buf) => {
        if (state.stopped) return finish();
        if (!buf) return fallback();
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.voiceIn);
        src.start();
        state.src = src;
        run(buf.duration, true);
      });
    });
  }

  stopSpeech() {
    const s = this._say;
    if (!s) return;
    s.stopped = true;
    try {
      s.src?.stop();
    } catch {
      /* already stopped */
    }
    s.finish?.();
  }

  get talking() {
    return !!this._say;
  }

  // ------------------------------------------------------------ radio

  _pickTrack() {
    const score = (moods) => 1 + 3 * moods.filter((m) => this.mood.includes(m)).length;
    if (this.playlist.length) {
      const opts = this.playlist.filter((k) => k !== this.current || this.playlist.length === 1);
      const w = opts.map((k) => {
        const def = MUSIC.find((m) => `music/${m.id}` === k);
        return def ? score(def.mood) : 2;
      });
      let r = Math.random() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < opts.length; i++) if ((r -= w[i]) <= 0) return { key: opts[i] };
      return { key: opts[0] };
    }
    const opts = LOFI_TRACKS.filter((t) => t.title !== this.trackTitle);
    const w = opts.map((t) => score(t.mood));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < opts.length; i++) if ((r -= w[i]) <= 0) return { synth: opts[i] };
    return { synth: opts[0] };
  }

  nextTrack() {
    if (!this.ready || !this.musicOn) return;
    const pick = this._pickTrack();
    // let whatever is playing fade out
    this.lofi.stop(1.2);
    if (this.el) {
      const old = this.el, og = this.elGain;
      og.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      setTimeout(() => {
        old.pause();
        old.src = '';
      }, 2000);
      this.el = null;
    }
    if (pick.key) {
      this.current = pick.key;
      const def = MUSIC.find((m) => `music/${m.id}` === pick.key);
      this.trackTitle = def ? def.title : pick.key.replace('music/', '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const el = new Audio(INDEX.get(pick.key));
      el.preload = 'auto';
      const node = this.ctx.createMediaElementSource(el);
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(1, this.ctx.currentTime + 0.3, 0.8);
      node.connect(g).connect(this.musicBus);
      el.addEventListener('ended', () => {
        if (this.el === el) setTimeout(() => this.nextTrack(), 1800);
      });
      el.addEventListener('error', () => {
        if (this.el === el) this.nextTrack();
      });
      el.play().catch(() => {});
      this.el = el;
      this.elGain = g;
    } else {
      this.current = null;
      this.trackTitle = pick.synth.title;
      setTimeout(() => this.musicOn && this.lofi.start(pick.synth), 900);
    }
    this.onTrack?.(this.trackTitle);
  }

  setMusic(on) {
    this.musicOn = on;
    if (!this.ready) return;
    if (on) this.nextTrack();
    else {
      this.lofi.stop(0.6);
      if (this.el) {
        this.el.pause();
        this.el = null;
      }
      this.trackTitle = '';
      this.onTrack?.('');
    }
  }

  // ------------------------------------------------------------ each frame

  /**
   * s: { speed, wet, rain, snow, snowCover, wind, storm, night, hour, door (0..1), kind }
   */
  update(dt, s) {
    if (!this.ready) return;
    const ctx = this.ctx;
    this.lofi.tick();

    const door = (this.door = damp(this.door, s.door, 5, dt));
    const b = this.beds;
    const sp = smoothstep(0.4, 13, s.speed);
    b.cabin_drive.set(sp * (1 - 0.45 * s.snowCover), 0.72 + 0.5 * clamp01(s.speed / 13), dt);
    b.cabin_idle.set(1, 1, dt);
    const open = 1 + door * 0.9;
    b.rain_light.set(smoothstep(0.02, 0.3, s.rain) * (1 - smoothstep(0.6, 0.98, s.rain)) * open, 1, dt);
    b.rain_heavy.set(smoothstep(0.5, 0.98, s.rain) * open, 1, dt);
    b.wet_road.set(s.wet * (1 - s.snowCover) * smoothstep(1, 11, s.speed), 0.8 + 0.35 * clamp01(s.speed / 13), dt);
    b.snow_hush.set(s.snowCover * smoothstep(0.5, 7, s.speed), 0.8 + 0.3 * clamp01(s.speed / 10), dt);
    b.wind.set(clamp01(s.storm * 0.9 + s.snow * 0.35 + Math.max(0, s.wind - 0.5) * 0.6), 1, dt);
    b.city_day.set((1 - s.night) * (1 - 0.5 * s.rain), 1, dt);
    b.city_night.set(s.night, 1, dt);
    const dawn = smoothstep(4.6, 5.8, s.hour) * (1 - smoothstep(8.5, 10.5, s.hour));
    b.birds_morning.set(dawn * (s.rain > 0.05 || s.snow > 0.05 ? 0 : 1), 1, dt);
    // a door open lets the street in
    this.outFilter.frequency.value = lerp(750, 9000, door * door);
    this.outBus.gain.value = this.vol.ambience * lerp(0.6, 1.7, door);

    // the radio steps back a little while someone is talking: enough to hear them over it, not enough to pump
    const duck = this._say && !this._say.silent ? 0.65 : 1;
    this.musicDuck.gain.value = damp(this.musicDuck.gain.value, duck, 3, dt);

    // how loud the voice is right now, for heads that nod along
    if (this._say && this._say.src) {
      this.analyser.getByteTimeDomainData(this._wave);
      let peak = 0;
      for (let i = 0; i < this._wave.length; i += 4) peak = Math.max(peak, Math.abs(this._wave[i] - 128));
      this.voiceLevel = damp(this.voiceLevel, peak / 60, 14, dt);
    } else this.voiceLevel = damp(this.voiceLevel, this._say ? 0.35 + 0.3 * Math.sin(ctx.currentTime * 9) : 0, 8, dt);

    // the city, now and then
    const e = this.eventT;
    e.horn -= dt;
    if (e.horn <= 0) {
      e.horn = rand(35, 110) * (1 + s.night);
      this.play('horn_far', { out: true, pan: rand(-0.8, 0.8), gain: rand(0.5, 1) });
    }
    e.siren -= dt;
    if (e.siren <= 0) {
      e.siren = rand(170, 420);
      this.play('siren_far', { out: true, pan: rand(-0.6, 0.6) });
    }
    if (s.rain > 0.3 && s.speed > 5) {
      e.puddle -= dt;
      if (e.puddle <= 0) {
        e.puddle = rand(7, 22) / s.rain;
        this.play('puddle', { gain: rand(0.5, 1), pan: rand(-0.5, 0.5) });
      }
    }
  }

  /** Thunder for a strike `seconds` away. */
  thunder(seconds, amp) {
    const id = seconds < 1 ? (Math.random() < 0.5 ? 'thunder_1' : 'thunder_3') : seconds < 2.2 ? 'thunder_3' : 'thunder_2';
    this.play(id, { out: false, delay: seconds, gain: clamp(amp, 0.35, 1), pan: rand(-0.5, 0.5) });
  }
}
