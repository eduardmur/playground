import files from 'virtual:audio-index';
import NOTES from './recordings.json';
import { clamp } from '../core/utils.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const fromDb = (d) => Math.pow(10, d / 20);

// ------------------------------------------------------------- recordings

/** 'sfx/bark_1' -> 'audio/sfx/bark_1.m4a', for every recording that is really there (see vite.config.js). */
const INDEX = new Map(files.map((f) => [f.replace(/\.[^.]+$/, ''), `audio/${f}`]));
/** 'bark' -> ['sfx/bark_1', 'sfx/bark_2', 'sfx/bark_3']: the takes the game picks from. */
const TAKES = new Map();
for (const key of INDEX.keys()) {
  const m = key.match(/^sfx\/(.+?)(?:_(\d+))?$/);
  if (!m) continue;
  if (!TAKES.has(m[1])) TAKES.set(m[1], []);
  TAKES.get(m[1]).push(key);
}

/**
 * How loud each recording plays, as a gain on top of the level the build gave it. Measured on
 * 2026-11-15 so that each one matches the synthesised sound it replaces: both rendered offline through
 * this class and compared by A-weighted loudness, the measure the build uses. The mix therefore holds
 * whichever of the two is playing.
 */
const GAIN = {
  bark: 0.5, yip: 0.51, howl: 1.29, crunch: 0.38, lap: 0.29, splash: 0.8, paddle: 0.37, step: 0.25, step_hard: 0.2,
  pickup: 0.38, toss: 0.24, land: 0.13, boing: 0.27, shake: 1.1, sniff: 0.36, yawn: 0.87, dig: 0.19, flutter: 1.71,
  owl: 1.38, frog: 0.26, whoosh: 0.5, bell: 1.16,
  // beds: against the synthesised bed at the same setting, and for birdsong and crickets, against the
  // synthesised calls over twenty seconds of a day or a night
  wind: 3.4, pond: 3.76, fountain: 7.34, birds: 0.053, crickets: 0.042,
  // a recorded track against the generative score
  music: 0.28,
};

/** A sound effect played from a recording: which one, how loud, how far it carries, on which bus. */
const REC = {
  crunch: ['crunch', 0.4],
  lap: ['lap', 0.2],
  splash: ['splash', 0.5, 12],
  paddle: ['paddle', 0.16],
  step: ['step', 0.055, 6],
  stepHard: ['step_hard', 0.07, 6],
  flutter: ['flutter', 0.34, 16],
  pickup: ['pickup', 0.22],
  toss: ['toss', 0.2],
  jump: ['toss', 0.1, 9, 0.85],
  land: ['land', 0.22, 7],
  boing: ['boing', 0.2],
  shake: ['shake', 0.3],
  sniff: ['sniff', 0.12],
  yawn: ['yawn', 0.14],
  dig: ['dig', 0.26],
  whoosh: ['whoosh', 0.14, 9, 1, 'amb'],
};
/** The little tunes, played on the recorded bell: [notes (midi), seconds between them, volume]. */
const TUNES = {
  chime: [[76, 79, 83, 88], 0.11, 0.42],
  friend: [[72, 76, 79, 84], 0.13, 0.42],
  heart: [[81, 84], 0.1, 0.3],
  tag: [[79, 86], 0.08, 0.3],
  click: [[84], 0, 0.12],
};
/** Which track goes with which part of the day. */
const TRACK_FOR = {
  Dawn: 'morning', Morning: 'morning', Midday: 'afternoon', Afternoon: 'afternoon',
  'Golden hour': 'dusk', Sunset: 'dusk', Dusk: 'dusk', Night: 'night',
};

// gentle progressions; each chord: root (midi) + intervals
const CHORDS_DAY = [
  [48, [0, 7, 16, 23]], // Cmaj7
  [45, [0, 7, 15, 22]], // Am7
  [41, [0, 7, 16, 23]], // Fmaj7
  [43, [0, 7, 14, 21]], // G6/9
  [40, [0, 7, 15, 22]], // Em7
  [41, [0, 7, 16, 26]], // Fmaj9
];
const CHORDS_NIGHT = [
  [45, [0, 7, 15, 26]], // Am9
  [41, [0, 7, 16, 23]], // Fmaj7
  [38, [0, 7, 15, 26]], // Dm9
  [40, [0, 7, 15, 22]], // Em7
];
const PENTA = [0, 2, 4, 7, 9]; // C major pentatonic fits every chord above

/**
 * Everything you hear: recordings made with ElevenLabs (src/audio/manifest.js) where they exist,
 * and otherwise sounds synthesised here with the Web Audio API: barks, splashes, birdsong, crickets,
 * wind, water, and a slow generative score. The single-page build has no recordings and plays the
 * synthesised ones throughout.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.lx = 0;
    this.lz = 0;
    this.rx = 1;
    this.rz = 0;
    this.t = { bird: 1, cricket: 0.5, owl: 20, note: 3, chord: 0, frog: 6 };
    this.chordIdx = 0;
    this.night = 0;
    this.pads = [];
    this.buffers = new Map(); // 'sfx/bark_1' -> AudioBuffer
    this.tracks = [...INDEX.keys()].filter((k) => k.startsWith('music/'));
    this.recorded = this.tracks.length > 0; // recorded music replaces the generative score
    this.track = null; // { id, el, gain }
    this.trackWait = 2;
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
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.9, ctx.currentTime + 2.5);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.8;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.55 : 0;
    for (const b of [this.sfxBus, this.ambBus, this.musicBus]) b.connect(this.master);

    // a soft outdoor reverb from decaying noise
    const len = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.reverb.connect(wet).connect(this.master);
    this.sendSfx = ctx.createGain();
    this.sendSfx.gain.value = 0.22;
    this.sfxBus.connect(this.sendSfx).connect(this.reverb);
    this.sendMusic = ctx.createGain();
    this.sendMusic.gain.value = 0.7;
    this.musicBus.connect(this.sendMusic).connect(this.reverb);
    this.sendAmb = ctx.createGain();
    this.sendAmb.gain.value = 0.3;

    // echo for the melody
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2200;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(this.musicBus);

    // noise source shared by everything that hisses
    const nlen = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    // recorded music skips the reverb: it has its own room
    this.trackBus = ctx.createGain();
    this.trackBus.gain.value = this.musicOn ? GAIN.music : 0;
    this.trackBus.connect(this.master);

    // looping beds: wind, pond, fountain, and with recordings, birdsong and crickets
    this.wind = this._bed('bandpass', 420, 0.5, 0.0, 'wind');
    this.pond = this._bed('bandpass', 1300, 0.9, 0.0, 'pond');
    this.fountain = this._bed('highpass', 1800, 0.6, 0.0, 'fountain');
    this.birds = TAKES.has('birds') ? this._bed(null, 0, 0, 0, 'birds') : null;
    this.crickets = TAKES.has('crickets') ? this._bed(null, 0, 0, 0, 'crickets') : null;

    // fetch the recordings in the background; the synthesised sounds cover until they arrive
    for (const [id, keys] of TAKES) for (const k of keys) this._load(k).then(() => this.beds?.[id]?.swap());
  }

  /** Fetch and decode one recorded sound effect. */
  _load(key) {
    return fetch(INDEX.get(key))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then((ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)))
      .then((buf) => this.buffers.set(key, buf))
      .catch(() => {
        /* the synthesised sound stays */
      });
  }

  /** The gain the build could not put into a recording, as noted in recordings.json. */
  _owed(key, buf) {
    const n = NOTES[key];
    return n && n.gain && Math.abs(n.seconds - buf.duration) < 0.2 ? fromDb(n.gain) : 1;
  }

  /** One recorded take of `id` (a random one where there are several), or null while none has loaded. */
  _take(id) {
    const ready = (TAKES.get(id) || []).filter((k) => this.buffers.has(k));
    if (!ready.length) return null;
    const key = pick(ready), buf = this.buffers.get(key);
    return { key, buf, gain: GAIN[id] * this._owed(key, buf) };
  }

  /** Play a recording of `id` into `out`. False when there is none (yet), so the caller can synthesise. */
  _rec(id, out, { rate = 1, vol = 1, at = 0 } = {}) {
    const t = this._take(id);
    if (!t) return false;
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = t.buf;
    src.playbackRate.value = rate;
    g.gain.value = t.gain * vol;
    src.connect(g).connect(out);
    src.start(ctx.currentTime + at);
    return true;
  }

  /** A tune on the recorded bell: each note is the one recording, played faster or slower. */
  _tune(name, pos) {
    const t = this._take('bell');
    if (!t) return false;
    const [notes, gap, vol] = TUNES[name];
    const root = NOTES[t.key]?.midi ?? 72;
    const out = this._out(name === 'tag' ? pos : null, vol, this.musicBus);
    notes.forEach((n, i) => this._rec('bell', out, { rate: Math.pow(2, (n - root) / 12), vol: 0.5, at: i * gap }));
    return true;
  }

  /**
   * A bed that keeps running. It starts on filtered noise (or silence, for a sound with no synthesised
   * version) and switches to the recording of `id` once that has loaded.
   */
  _bed(type, freq, q, gain, id) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(this.ambBus);
    const f = ctx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.value = freq || 20000;
    f.Q.value = q;
    f.connect(g);
    let src = null;
    if (type) {
      src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.playbackRate.value = rand(0.85, 1.15);
      src.connect(f);
      src.start();
    }
    const bed = {
      gain: g.gain,
      filter: f,
      recorded: false,
      swap: () => {
        const t = this._take(id);
        if (!t || bed.recorded) return;
        bed.recorded = true;
        const rec = ctx.createBufferSource(), rg = ctx.createGain();
        rec.buffer = t.buf;
        rec.loop = true;
        rg.gain.value = t.gain;
        rec.connect(rg).connect(g);
        rec.start(ctx.currentTime, Math.random() * t.buf.duration);
        if (src) src.stop(ctx.currentTime + 0.05);
      },
    };
    (this.beds ||= {})[id] = bed;
    return bed;
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.2);
  }

  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.6);
    this.trackBus.gain.setTargetAtTime(on ? GAIN.music : 0, this.ctx.currentTime, 0.6);
    if (!on && this.track) this._endTrack(0.8);
  }

  setListener(x, z, rx, rz) {
    this.lx = x;
    this.lz = z;
    this.rx = rx;
    this.rz = rz;
  }

  // ----------------------------------------------------------------- helpers

  /** Output node for a sound at a world position: distance gain + stereo pan. */
  _out(pos, vol = 1, bus = this.sfxBus, range = 9) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let gain = vol, pan = 0;
    if (pos) {
      const dx = pos.x - this.lx, dz = pos.z - this.lz;
      const d = Math.hypot(dx, dz);
      gain *= 1 / (1 + (d / range) * (d / range));
      if (d > 0.5) pan = clamp(((dx * this.rx + dz * this.rz) / d) * 0.75, -1, 1);
    }
    g.gain.value = gain;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(bus);
    } else {
      g.connect(bus);
    }
    return g;
  }

  _noise(dur, out, { type = 'bandpass', freq = 1000, q = 1, freqEnd, attack = 0.005, vol = 1, at = 0 } = {}) {
    const ctx = this.ctx, t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
    return g;
  }

  _tone(out, { type = 'sine', f0, f1, dur, vol = 0.3, attack = 0.005, at = 0, curve = 'exp' }) {
    const ctx = this.ctx, t0 = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    else g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  _bell(freq, out, { vol = 0.2, dur = 1.8, at = 0 } = {}) {
    this._tone(out, { f0: freq, dur, vol, attack: 0.004, at });
    this._tone(out, { f0: freq * 2.01, dur: dur * 0.5, vol: vol * 0.32, attack: 0.004, at });
    this._tone(out, { f0: freq * 3.02, dur: dur * 0.25, vol: vol * 0.14, attack: 0.004, at });
  }

  // --------------------------------------------------------------------- dogs

  bark(dog, vol = 1, yip = false) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const pitch = (dog.breed.voice?.pitch || 1) * (yip ? 1.35 : 1) * rand(0.96, 1.05) / Math.pow(dog.scale / dog.breed.scale, 0.5);
    // a recorded bark, a little higher or lower for each breed; small dogs and happy greetings yip
    const small = (dog.breed.voice?.pitch || 1) >= 1.25;
    if (this._rec(yip || small ? 'yip' : 'bark', this._out(dog.pos, vol * 0.5, this.sfxBus, 14), { rate: Math.pow(pitch / (yip ? 1.35 : 1), 0.5) * (small && !yip ? 0.95 : 1) })) return;
    const out = this._out(dog.pos, vol * 0.5, this.sfxBus, 14);
    const t0 = ctx.currentTime;
    const dur = yip ? 0.11 : 0.17;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(820 * Math.sqrt(pitch), t0);
    f.frequency.exponentialRampToValueAtTime(520 * Math.sqrt(pitch), t0 + dur);
    f.Q.value = 1.1;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    f.connect(lp).connect(out);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(1, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(f);
    for (const [type, mul, gain] of [['sawtooth', 1, 0.9], ['square', 0.5, 0.45]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(330 * pitch * mul * 1.28, t0);
      o.frequency.exponentialRampToValueAtTime(330 * pitch * mul * 0.68, t0 + dur);
      const og = ctx.createGain();
      og.gain.value = gain;
      o.connect(og).connect(g);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    }
    this._noise(0.06, out, { type: 'bandpass', freq: 1500, q: 0.7, vol: 0.35 });
  }

  howl(dog) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const pitch = (dog.breed.voice?.pitch || 1) * rand(0.95, 1.06);
    const out = this._out(dog.pos, 0.34, this.sfxBus, 22);
    if (this._rec('howl', out, { rate: Math.pow(pitch, 0.4), at: 0.25 })) return;
    const t0 = ctx.currentTime + 0.25, dur = 2.5;
    const f0 = 392 * pitch;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 760 * Math.sqrt(pitch);
    f.Q.value = 1.6;
    f.connect(out);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(1, t0 + 0.4);
    g.gain.setValueAtTime(1, t0 + dur - 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(f);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.6;
    const lg = ctx.createGain();
    lg.gain.value = f0 * 0.012;
    lfo.connect(lg);
    lfo.start(t0);
    lfo.stop(t0 + dur);
    for (const [type, mul, gain] of [['triangle', 1, 1], ['sawtooth', 1, 0.16], ['sine', 2, 0.22]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0 * 0.72 * mul, t0);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.18 * mul, t0 + 0.6);
      o.frequency.setValueAtTime(f0 * 1.18 * mul, t0 + dur - 0.9);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.86 * mul, t0 + dur);
      lg.connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = gain;
      o.connect(og).connect(g);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
  }

  // ---------------------------------------------------------------------- sfx

  sfx(name, pos = null) {
    if (!this.ctx) return;
    const v = pos && pos.vol !== undefined ? pos.vol : 1;
    const p = pos && pos.x !== undefined ? pos : null;
    if (TUNES[name] && this._tune(name, p)) return;
    const r = REC[name];
    if (r) {
      const [id, vol, range = 9, rate = 1, bus] = r;
      if (this._rec(id, this._out(p, vol * v, bus === 'amb' ? this.ambBus : this.sfxBus, range), { rate: rate * rand(0.97, 1.03) })) return;
    }
    switch (name) {
      case 'crunch': {
        const out = this._out(p, 0.4 * v);
        for (let i = 0; i < 4; i++) this._noise(0.045, out, { type: 'highpass', freq: rand(1500, 2400), vol: rand(0.5, 1), at: 0.26 + i * 0.105 });
        break;
      }
      case 'lap': {
        const out = this._out(p, 0.2 * v);
        this._tone(out, { f0: rand(340, 420), f1: rand(680, 820), dur: 0.07, vol: 0.5 });
        this._noise(0.05, out, { type: 'bandpass', freq: 2200, q: 2, vol: 0.25 });
        break;
      }
      case 'splash': {
        const out = this._out(p, 0.5 * v, this.sfxBus, 12);
        this._noise(0.55, out, { type: 'lowpass', freq: 3200, freqEnd: 500, vol: 0.9, attack: 0.01 });
        this._noise(0.3, out, { type: 'highpass', freq: 3000, vol: 0.3, at: 0.03 });
        this._tone(out, { f0: 130, f1: 60, dur: 0.18, vol: 0.5 });
        break;
      }
      case 'paddle': {
        const out = this._out(p, 0.16 * v);
        this._noise(0.22, out, { type: 'bandpass', freq: rand(900, 1500), q: 0.8, vol: 0.8, attack: 0.03 });
        break;
      }
      case 'step': {
        const out = this._out(p, 0.055 * v, this.sfxBus, 6);
        this._noise(0.05, out, { type: 'bandpass', freq: rand(600, 1100), q: 0.6, vol: 1 });
        break;
      }
      case 'stepHard': {
        const out = this._out(p, 0.07 * v, this.sfxBus, 6);
        this._noise(0.035, out, { type: 'bandpass', freq: rand(1900, 2800), q: 1.2, vol: 1 });
        break;
      }
      case 'flutter': {
        const out = this._out(p, 0.34 * v, this.sfxBus, 16);
        const g = this._noise(0.95, out, { type: 'bandpass', freq: 2300, q: 0.7, vol: 1, attack: 0.02 });
        const ctx = this.ctx, lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 23;
        lg.gain.value = 0.7;
        lfo.connect(lg).connect(g.gain);
        lfo.start();
        lfo.stop(ctx.currentTime + 1);
        for (let i = 0; i < 4; i++) this._chirp(out, rand(3200, 4600), rand(0.5, 0.9), rand(0, 0.5));
        break;
      }
      case 'chime': {
        const out = this._out(null, 0.42 * v, this.musicBus);
        [76, 79, 83, 88].forEach((n, i) => this._bell(midi(n), out, { vol: 0.2, dur: 2.2, at: i * 0.11 }));
        break;
      }
      case 'friend': {
        const out = this._out(null, 0.42, this.musicBus);
        [72, 76, 79, 84].forEach((n, i) => this._bell(midi(n), out, { vol: 0.2, dur: 2.4, at: i * 0.13 }));
        break;
      }
      case 'heart': {
        const out = this._out(null, 0.3, this.musicBus);
        this._bell(midi(81), out, { vol: 0.2, dur: 1.4 });
        this._bell(midi(84), out, { vol: 0.16, dur: 1.4, at: 0.1 });
        break;
      }
      case 'tag': {
        const out = this._out(p, 0.3, this.musicBus);
        this._bell(midi(79), out, { vol: 0.22, dur: 0.7 });
        this._bell(midi(86), out, { vol: 0.2, dur: 0.9, at: 0.08 });
        break;
      }
      case 'pickup': {
        const out = this._out(p, 0.22);
        this._tone(out, { f0: 420, f1: 880, dur: 0.07, vol: 0.6 });
        break;
      }
      case 'toss':
      case 'jump': {
        const out = this._out(p, name === 'toss' ? 0.2 : 0.1);
        this._noise(0.22, out, { type: 'bandpass', freq: 500, freqEnd: 1900, q: 1.2, vol: 0.9, attack: 0.04 });
        break;
      }
      case 'land': {
        const out = this._out(p, 0.22 * v, this.sfxBus, 7);
        this._tone(out, { f0: 95, f1: 48, dur: 0.1, vol: 0.9 });
        this._noise(0.07, out, { type: 'lowpass', freq: 900, vol: 0.5 });
        break;
      }
      case 'boing': {
        const out = this._out(p, 0.2 * v);
        this._tone(out, { f0: 240, f1: 140, dur: 0.08, vol: 0.8 });
        break;
      }
      case 'shake': {
        const out = this._out(p, 0.3);
        const g = this._noise(1.25, out, { type: 'bandpass', freq: 1700, q: 0.6, vol: 0.9, attack: 0.08 });
        const ctx = this.ctx, lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 17;
        lg.gain.value = 0.6;
        lfo.connect(lg).connect(g.gain);
        lfo.start();
        lfo.stop(ctx.currentTime + 1.4);
        break;
      }
      case 'sniff': {
        const out = this._out(p, 0.12);
        for (let i = 0; i < 4; i++) this._noise(0.09, out, { type: 'bandpass', freq: 1900, q: 1.5, vol: 0.9, attack: 0.02, at: 0.3 + i * 0.26 + (i % 2) * 0.05 });
        break;
      }
      case 'yawn': {
        const out = this._out(p, 0.14);
        this._tone(out, { type: 'triangle', f0: 520, f1: 250, dur: 1.1, vol: 0.5, attack: 0.3, curve: 'lin' });
        this._noise(1.0, out, { type: 'bandpass', freq: 900, q: 0.7, vol: 0.3, attack: 0.3 });
        break;
      }
      case 'dig': {
        const out = this._out(p, 0.26);
        for (let i = 0; i < 13; i++) this._noise(0.09, out, { type: 'bandpass', freq: rand(700, 1300), q: 0.7, vol: rand(0.5, 1), at: 0.3 + i * 0.14 });
        break;
      }
      case 'click': {
        const out = this._out(null, 0.12, this.musicBus);
        this._bell(midi(84), out, { vol: 0.2, dur: 0.3 });
        break;
      }
      case 'whoosh': {
        const out = this._out(null, 0.14, this.ambBus);
        this._noise(2.6, out, { type: 'bandpass', freq: 300, freqEnd: 1400, q: 0.8, vol: 0.8, attack: 1.2 });
        break;
      }
    }
  }

  _chirp(out, freq, vol = 1, at = 0, dur = 0.08, up = Math.random() < 0.5) {
    this._tone(out, { f0: freq * (up ? 0.82 : 1.2), f1: freq * (up ? 1.2 : 0.82), dur, vol: 0.5 * vol, attack: 0.008, at });
  }

  _birdsong() {
    const out = this._out({ x: this.lx + rand(-22, 22), z: this.lz + rand(-22, 22) }, rand(0.05, 0.11), this.ambBus, 30);
    out.connect(this.sendAmb);
    const kind = Math.random();
    const base = rand(2400, 4800);
    if (kind < 0.45) {
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) this._chirp(out, base * rand(0.9, 1.15), 1, i * rand(0.11, 0.17), rand(0.05, 0.09));
    } else if (kind < 0.75) {
      const n = 7 + Math.floor(Math.random() * 8), gap = rand(0.045, 0.07);
      for (let i = 0; i < n; i++) this._tone(out, { f0: base * (1 + 0.04 * Math.sin(i)), dur: 0.035, vol: 0.5, attack: 0.004, at: i * gap });
    } else {
      // two falling notes, like a far-off cuckoo
      const f = rand(700, 980);
      this._tone(out, { f0: f * 1.26, dur: 0.24, vol: 0.5, attack: 0.03, curve: 'lin' });
      this._tone(out, { f0: f, dur: 0.32, vol: 0.5, attack: 0.03, at: 0.3, curve: 'lin' });
    }
  }

  _cricket() {
    const out = this._out({ x: this.lx + rand(-16, 16), z: this.lz + rand(-16, 16) }, rand(0.016, 0.034), this.ambBus, 26);
    const f = rand(4100, 4900), n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < 9; i++) this._tone(out, { f0: f, dur: 0.014, vol: 0.8, attack: 0.002, at: k * 0.34 + i * 0.019 });
    }
  }

  _owl() {
    const out = this._out({ x: this.lx + rand(-30, 30), z: this.lz + rand(-30, 30) }, 0.07, this.ambBus, 40);
    out.connect(this.sendAmb);
    if (this._rec('owl', out, { rate: rand(0.95, 1.04) })) return;
    const f = rand(320, 380);
    [[0, 0.34], [0.55, 0.16], [0.78, 0.4]].forEach(([at, dur]) =>
      this._tone(out, { type: 'sine', f0: f, f1: f * 0.94, dur, vol: 0.9, attack: 0.05, at, curve: 'lin' })
    );
  }

  _frog() {
    const out = this._out(this.pondPos, 0.06, this.ambBus, 16);
    if (this._rec('frog', out, { rate: rand(0.9, 1.1) })) return;
    const f = rand(170, 230);
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 6; i++) this._tone(out, { type: 'square', f0: f, dur: 0.02, vol: 0.5, attack: 0.003, at: k * 0.3 + i * 0.03 });
    }
  }

  // -------------------------------------------------------------------- music

  _chord() {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const set = this.night > 0.5 ? CHORDS_NIGHT : CHORDS_DAY;
    this.chordIdx = (this.chordIdx + (Math.random() < 0.8 ? 1 : 2)) % set.length;
    const [root, ivs] = set[this.chordIdx];
    this.root = root;
    // let the previous pad go
    for (const p of this.pads) {
      p.g.gain.cancelScheduledValues(t0);
      p.g.gain.setTargetAtTime(0.0001, t0, 1.6);
      p.oscs.forEach((o) => o.stop(t0 + 9));
    }
    this.pads = [];
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.night > 0.5 ? 620 : 900;
    lp.connect(this.musicBus);
    ivs.forEach((iv, i) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(i === 0 ? 0.075 : 0.045, t0 + 3.5);
      g.connect(lp);
      const oscs = [-5, 5].map((cents) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = midi(root + iv);
        o.detune.value = cents;
        o.connect(g);
        o.start(t0);
        return o;
      });
      this.pads.push({ g, oscs });
    });
  }

  _note(at = 0, offset = null) {
    const oct = this.night > 0.5 ? 72 : pick([72, 72, 84]);
    const deg = offset ?? pick(PENTA);
    const f = midi(oct + deg);
    const out = this.ctx.createGain();
    out.gain.value = this.night > 0.5 ? 0.6 : 0.8;
    out.connect(this.musicBus);
    out.connect(this.delay);
    this._bell(f, out, { vol: rand(0.07, 0.12), dur: rand(1.6, 2.6), at });
  }

  // ------------------------------------------------------------------- tracks

  /** Start the recorded track for this part of the day. Streamed, not decoded: they are long. */
  _startTrack(id) {
    const ctx = this.ctx, el = new window.Audio(INDEX.get(`music/${id}`));
    el.crossOrigin = 'anonymous';
    const src = ctx.createMediaElementSource(el), gain = ctx.createGain();
    const n = NOTES[`music/${id}`];
    const level = n && n.gain ? fromDb(n.gain) : 1;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(level, ctx.currentTime + 3);
    src.connect(gain).connect(this.trackBus);
    const track = { id, el, gain };
    el.addEventListener('ended', () => {
      if (this.track !== track) return;
      this.track = null;
      this.trackWait = rand(25, 50); // a quiet stretch before the next one
    });
    el.play().catch(() => {
      if (this.track === track) this.track = null;
    });
    this.track = track;
  }

  _endTrack(fade = 5) {
    const t = this.track, ctx = this.ctx;
    if (!t) return;
    this.track = null;
    t.gain.gain.cancelScheduledValues(ctx.currentTime);
    t.gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 4);
    setTimeout(() => t.el.pause(), fade * 1000 + 200);
  }

  _tracks(dt, phase) {
    const want = TRACK_FOR[phase] || 'afternoon';
    if (!this.tracks.includes(`music/${want}`)) return;
    if (this.track) {
      // the light has moved on (time drifted ahead): let this one go and start the right one soon
      if (this.track.id !== want) {
        this._endTrack(5);
        this.trackWait = 7;
      }
      return;
    }
    this.trackWait -= dt;
    if (this.trackWait <= 0 && this.musicOn) this._startTrack(want);
  }

  // ------------------------------------------------------------------- update

  /** env: { night, mist, pond: 0..1, fountain: 0..1, gust: 0..1, pondPos, phase } */
  update(dt, env) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.night = env.night;
    this.pondPos = env.pondPos;
    this.wind.gain.setTargetAtTime(0.012 + env.gust * 0.03, now, 0.5);
    this.wind.filter.frequency.setTargetAtTime(340 + env.gust * 260, now, 0.8);
    this.pond.gain.setTargetAtTime(env.pond * 0.035, now, 0.4);
    this.fountain.gain.setTargetAtTime(env.fountain * 0.06, now, 0.4);
    // recorded birdsong and crickets run as beds, busiest at dawn and on a warm night
    const day = 1 - env.night;
    if (this.birds) this.birds.gain.setTargetAtTime(day > 0.25 ? Math.min(1, day * (1 + env.mist * 1.2)) : 0, now, 1.5);
    if (this.crickets) this.crickets.gain.setTargetAtTime(env.night > 0.35 ? env.night : 0, now, 1.5);

    const t = this.t;
    t.bird -= dt;
    if (t.bird <= 0) {
      // the dawn chorus is the busiest time of day
      t.bird = rand(0.5, 3.4) / Math.max(0.12, day * (1 + env.mist * 2.2));
      if (day > 0.25 && !this.birds?.recorded) this._birdsong();
    }
    t.cricket -= dt;
    if (t.cricket <= 0) {
      t.cricket = rand(0.5, 1.6);
      if (env.night > 0.35 && Math.random() < env.night && !this.crickets?.recorded) this._cricket();
    }
    t.owl -= dt;
    if (t.owl <= 0) {
      t.owl = rand(22, 50);
      if (env.night > 0.8) this._owl();
    }
    t.frog -= dt;
    if (t.frog <= 0) {
      t.frog = rand(4, 11);
      if (env.night > 0.5 && env.pond > 0.25 && this.pondPos) this._frog();
    }

    if (this.recorded) {
      this._tracks(dt, env.phase);
      return;
    }
    t.chord -= dt;
    if (t.chord <= 0) {
      t.chord = rand(9, 12);
      this._chord();
    }
    t.note -= dt;
    if (t.note <= 0) {
      t.note = rand(1.2, 4.5) * (env.night > 0.5 ? 1.6 : 1);
      if (Math.random() < 0.28) {
        // a little rising or falling figure
        const start = Math.floor(Math.random() * 3), dir = Math.random() < 0.6 ? 1 : -1, n = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < n; i++) this._note(i * 0.3, PENTA[(start + (dir > 0 ? i : n - 1 - i)) % PENTA.length] + (start + i >= PENTA.length && dir > 0 ? 12 : 0));
        t.note += 1.5;
      } else if (Math.random() < 0.8) {
        this._note();
      }
    }
  }
}
