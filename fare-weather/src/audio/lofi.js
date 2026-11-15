// The radio's stand-in: a small generative lo-fi band (electric piano, bass,
// dusty drums, a shy melody, crackle and tape wobble) that plays until real
// tracks are put in public/audio/music/.
import { mulberry32 } from '../core/utils.js';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

const CHORDS = {
  maj9: [4, 7, 11, 14], m9: [3, 7, 10, 14], dom13: [10, 14, 16, 21], maj7: [4, 7, 11, 14], m7: [3, 7, 10, 14], sus: [5, 7, 10, 14],
};
const PROGS = {
  minor: [
    [[0, 'm9'], [5, 'dom13'], [10, 'maj9'], [7, 'm9']],
    [[0, 'm9'], [8, 'maj7'], [3, 'maj9'], [10, 'sus']],
    [[0, 'm9'], [5, 'm9'], [8, 'maj9'], [7, 'm7']],
  ],
  major: [
    [[0, 'maj9'], [9, 'm9'], [2, 'm9'], [7, 'dom13']],
    [[5, 'maj9'], [4, 'm7'], [2, 'm9'], [0, 'maj9']],
    [[0, 'maj9'], [4, 'm7'], [9, 'm9'], [5, 'maj9']],
  ],
};
const PENTA = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10] };

export const LOFI_TRACKS = [
  { title: 'Wet Asphalt', bpm: 74, key: 2, mode: 'minor', mood: ['rain', 'night'], seed: 11 },
  { title: 'Kerbside', bpm: 80, key: 5, mode: 'major', mood: ['clear', 'evening'], seed: 23 },
  { title: 'Four A.M. Fare', bpm: 68, key: 9, mode: 'minor', mood: ['night', 'fog'], seed: 37 },
  { title: 'Soft Launch', bpm: 84, key: 3, mode: 'major', mood: ['morning', 'clear'], seed: 41 },
  { title: 'Flurries', bpm: 66, key: 10, mode: 'major', mood: ['snow'], seed: 53 },
  { title: 'Amber Phase', bpm: 78, key: 7, mode: 'minor', mood: ['cloudy', 'evening', 'rain'], seed: 67 },
];

// bars: [name, length, drums, melody]
const FORM = [['intro', 4, 0, 0], ['a', 8, 1, 0], ['b', 8, 1, 1], ['break', 2, 0, 1], ['a', 8, 1, 0], ['b', 8, 1, 1], ['outro', 4, 0, 0]];

export class Lofi {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.playing = false;
    this.track = null;
    this.onEnd = null;

    // tape: everything passes through a wobbling delay and a dull filter
    this.mix = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3600;
    lp.Q.value = 0.4;
    this.lp = lp;
    const tape = ctx.createDelay(0.05);
    tape.delayTime.value = 0.014;
    const wow = ctx.createOscillator(), wowG = ctx.createGain();
    wow.frequency.value = 0.37;
    wowG.gain.value = 0.0011;
    wow.connect(wowG).connect(tape.delayTime);
    const flut = ctx.createOscillator(), flutG = ctx.createGain();
    flut.frequency.value = 5.7;
    flutG.gain.value = 0.00009;
    flut.connect(flutG).connect(tape.delayTime);
    wow.start();
    flut.start();
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.mix.connect(lp).connect(tape).connect(this.level).connect(out);

    // room
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.reverb.connect(wet).connect(this.mix);
    this.echo = ctx.createDelay(1.5);
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const echoLP = ctx.createBiquadFilter();
    echoLP.type = 'lowpass';
    echoLP.frequency.value = 1500;
    this.echo.connect(echoLP).connect(fb).connect(this.echo);
    echoLP.connect(this.mix);

    // band
    this.keys = ctx.createGain();
    this.keys.gain.value = 0.5;
    const trem = ctx.createGain();
    const tremO = ctx.createOscillator(), tremG = ctx.createGain();
    tremO.frequency.value = 4.6;
    tremG.gain.value = 0.1;
    tremO.connect(tremG).connect(trem.gain);
    tremO.start();
    const keysLP = ctx.createBiquadFilter();
    keysLP.type = 'lowpass';
    keysLP.frequency.value = 2100;
    this.pump = ctx.createGain(); // ducks with the kick
    this.keys.connect(keysLP).connect(trem).connect(this.pump);
    this.bass = ctx.createGain();
    this.bass.gain.value = 0.55;
    this.bass.connect(this.pump);
    this.pump.connect(this.mix);
    const kSend = ctx.createGain();
    kSend.gain.value = 0.35;
    trem.connect(kSend).connect(this.reverb);
    this.drums = ctx.createGain();
    this.drums.gain.value = 0.62;
    const drumLP = ctx.createBiquadFilter();
    drumLP.type = 'lowpass';
    drumLP.frequency.value = 5200;
    this.drums.connect(drumLP).connect(this.mix);
    const dSend = ctx.createGain();
    dSend.gain.value = 0.08;
    drumLP.connect(dSend).connect(this.reverb);
    this.lead = ctx.createGain();
    this.lead.gain.value = 0.26;
    const leadLP = ctx.createBiquadFilter();
    leadLP.type = 'lowpass';
    leadLP.frequency.value = 1700;
    this.lead.connect(leadLP).connect(this.mix);
    const lSend = ctx.createGain();
    lSend.gain.value = 0.5;
    leadLP.connect(lSend).connect(this.echo);
    const lRev = ctx.createGain();
    lRev.gain.value = 0.5;
    leadLP.connect(lRev).connect(this.reverb);

    // noise for drums, and a loop of vinyl crackle
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = nb;
    const cb = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const cd = cb.getChannelData(0);
    let hiss = 0;
    for (let i = 0; i < cd.length; i++) {
      hiss = hiss * 0.6 + (Math.random() * 2 - 1) * 0.4;
      cd[i] = hiss * 0.012;
      if (Math.random() < 0.00055) {
        const a = (Math.random() * 2 - 1) * (0.2 + Math.random() * 0.6);
        for (let k = 0; k < 24 && i + k < cd.length; k++) cd[i + k] += a * Math.exp(-k / 3);
      }
    }
    this.crackleBuf = cb;
    this.crackle = null;
  }

  // ------------------------------------------------------------ transport

  start(track) {
    const ctx = this.ctx;
    this.track = track;
    this.rnd = mulberry32(track.seed + Math.floor(Math.random() * 1000));
    const rnd = this.rnd;
    this.beat = 60 / track.bpm;
    this.six = this.beat / 4;
    this.swing = 0.1 + rnd() * 0.08;
    this.prog = PROGS[track.mode][Math.floor(rnd() * PROGS[track.mode].length)];
    this.echo.delayTime.value = this.beat * 0.75;
    // drum pattern for this track
    this.kick = [[0, 7, 10], [0, 6, 10], [0, 10, 11], [0, 7, 9]][Math.floor(rnd() * 4)];
    this.hatEvery = rnd() < 0.3 ? 1 : 2;
    // a little tune: scale steps and lengths over two bars
    const scale = PENTA[track.mode];
    this.motif = [];
    let step = 0, deg = 2 + Math.floor(rnd() * 3);
    while (step < 28) {
      if (rnd() < 0.8) this.motif.push({ step, note: 72 + track.key - 12 + scale[((deg % 5) + 5) % 5] + 12 * Math.floor(deg / 5), len: 2 + Math.floor(rnd() * 3) });
      deg += Math.floor(rnd() * 5) - 2;
      deg = Math.max(0, Math.min(9, deg));
      step += [2, 3, 4, 4, 6][Math.floor(rnd() * 5)];
    }
    this.bar = 0;
    this.stepInBar = 0;
    this.section = 0;
    this.barInSection = 0;
    this.nextTime = ctx.currentTime + 0.15;
    this.playing = true;
    this.level.gain.cancelScheduledValues(ctx.currentTime);
    this.level.gain.setValueAtTime(this.level.gain.value, ctx.currentTime);
    this.level.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
    this.lp.frequency.setTargetAtTime(3600, ctx.currentTime, 0.5);
    if (!this.crackle) {
      this.crackle = ctx.createBufferSource();
      this.crackle.buffer = this.crackleBuf;
      this.crackle.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0.55;
      this.crackle.connect(g).connect(this.mix);
      this.crackle.start();
    }
  }

  stop(fade = 1.5) {
    if (!this.playing) return;
    this.playing = false;
    const t = this.ctx.currentTime;
    this.level.gain.cancelScheduledValues(t);
    this.level.gain.setValueAtTime(this.level.gain.value, t);
    this.level.gain.linearRampToValueAtTime(0, t + fade);
  }

  /** Call often; schedules whatever falls in the next quarter second. */
  tick() {
    if (!this.playing) return;
    const ctx = this.ctx;
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05; // the tab was asleep
    while (this.playing && this.nextTime < ctx.currentTime + 0.25) {
      const s = this.stepInBar;
      const t = this.nextTime + (s % 2 === 1 ? this.six * this.swing : 0);
      this._step(s, t);
      this.nextTime += this.six;
      this.stepInBar++;
      if (this.stepInBar === 16) {
        this.stepInBar = 0;
        this.bar++;
        this.barInSection++;
        if (this.barInSection >= FORM[this.section][1]) {
          this.barInSection = 0;
          this.section++;
          if (this.section >= FORM.length) {
            this.stop(2.5);
            this.onEnd?.();
          } else if (FORM[this.section][0] === 'outro') this.lp.frequency.setTargetAtTime(700, this.nextTime, this.beat * 6);
        }
      }
    }
  }

  // ------------------------------------------------------------ the band

  _step(s, t) {
    const rnd = this.rnd;
    const [name, , drumsOn, melodyOn] = FORM[this.section];
    const [rootOff, type] = this.prog[this.bar % 4];
    const root = this.track.key + rootOff;
    const human = () => (rnd() - 0.5) * 0.018;

    // chords: a long one on the downbeat, a softer push later in the bar
    if (s === 0 || (s === 6 && rnd() < 0.55) || (s === 10 && rnd() < 0.45)) {
      const tones = CHORDS[type].map((iv) => {
        let n = 48 + root + iv;
        while (n > 71) n -= 12;
        while (n < 55) n += 12;
        return n;
      }).sort((a, b) => a - b);
      const vel = s === 0 ? 0.8 : 0.45;
      const dur = s === 0 ? this.beat * 2.6 : this.beat * 1.1;
      tones.forEach((n, i) => this._rhodes(n, t + i * 0.014 + human(), dur, vel * (0.85 + rnd() * 0.3)));
    }
    // bass
    if (name !== 'intro') {
      const b = 36 + ((root % 12) + 12) % 12;
      if (s === 0) this._bass(b, t, this.beat * 1.6, 0.9);
      else if (s === 10 && rnd() < 0.7) this._bass(b + (rnd() < 0.5 ? 7 : 12), t, this.beat * 0.8, 0.6);
      else if (s === 14 && rnd() < 0.5) {
        const nextRoot = this.track.key + this.prog[(this.bar + 1) % 4][0];
        this._bass(36 + ((nextRoot % 12) + 12) % 12 - 1, t, this.beat * 0.45, 0.5);
      }
    }
    // drums
    if (drumsOn) {
      if (this.kick.includes(s)) this._kick(t + human() * 0.4, s === 0 ? 1 : 0.8);
      if (s === 4 || s === 12) this._snare(t + 0.006 + human() * 0.5, 0.9);
      else if (s === 15 && rnd() < 0.3) this._snare(t, 0.25);
      if (s % this.hatEvery === 0) this._hat(t + human() * 0.5, (s % 4 === 2 ? 0.75 : 0.42) * (0.7 + rnd() * 0.5), s === 14 && rnd() < 0.25);
    }
    // melody: only in some phrases, and never the same twice
    if (melodyOn && Math.floor(this.barInSection / 2) % 2 === 0) {
      const ps = (this.barInSection % 2) * 16 + s;
      for (const m of this.motif) if (m.step === ps && rnd() < 0.88) this._lead(m.note, t + human(), m.len * this.six * 1.5, 0.5 + rnd() * 0.3);
    }
  }

  _rhodes(note, t, dur, vel) {
    const ctx = this.ctx;
    const f = midi(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.09 * vel, t + 0.3);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.28);
    g.connect(this.keys);
    const o1 = ctx.createOscillator();
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f;
    o2.detune.value = 5;
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    // the "tine": a bright partial that dies away fast
    const o3 = ctx.createOscillator();
    o3.frequency.value = f * 4;
    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(0.22 * vel, t);
    g3.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
    o1.connect(g);
    o2.connect(g2).connect(g);
    o3.connect(g3).connect(g);
    for (const o of [o1, o2, o3]) {
      o.start(t);
      o.stop(t + dur + 1.6);
    }
  }

  _bass(note, t, dur, vel) {
    const ctx = this.ctx;
    const f = midi(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.015);
    g.gain.setTargetAtTime(0.32 * vel, t + 0.02, 0.2);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.07);
    g.connect(this.bass);
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.16;
    o.connect(g);
    o2.connect(g2).connect(g);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.5);
    o2.stop(t + dur + 0.5);
  }

  _kick(t, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(125, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.3);
    // everything else leans out of the way
    const p = this.pump.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(0.68, t);
    p.setTargetAtTime(1, t + 0.02, 0.09);
  }

  _noise(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * 0.8, dur + 0.05);
    return s;
  }

  _snare(t, vel) {
    const ctx = this.ctx;
    const n = this._noise(t, 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1750;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n.connect(bp).connect(g).connect(this.drums);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(205, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.06);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.3 * vel, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g2).connect(this.drums);
    o.start(t);
    o.stop(t + 0.1);
  }

  _hat(t, vel, open) {
    const ctx = this.ctx;
    const n = this._noise(t, open ? 0.22 : 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.2 : 0.04));
    n.connect(hp).connect(g).connect(this.drums);
  }

  _lead(note, t, dur, vel) {
    const ctx = this.ctx;
    const f = midi(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3 * vel, t + 0.02);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.6, 0.18);
    g.connect(this.lead);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.15;
    // a slow, shallow vibrato once the note has settled
    const v = ctx.createOscillator(), vg = ctx.createGain();
    v.frequency.value = 5;
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.004, t + 0.3);
    v.connect(vg).connect(o.frequency);
    o.connect(g);
    o2.connect(g2).connect(g);
    for (const x of [o, o2, v]) {
      x.start(t);
      x.stop(t + dur + 1.2);
    }
  }
}
