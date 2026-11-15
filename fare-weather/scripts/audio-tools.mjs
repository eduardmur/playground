// Turns the raw takes in takes/ into the recordings the game plays from public/audio/.
//
//   node scripts/audio-tools.mjs probe [--voice] <file...>     measure any audio files
//   node scripts/audio-tools.mjs build [sfx] [music] [voice]   takes/ -> public/audio/ (all three if none is named)
//
// takes/<kind>/index.json lists what has been recorded: [{ label, take, file }], where label is
// "sfx/<id>", "music/<id>", "car/<id>" or "<rider>/<clip>". Where a label has several
// takes the build picks one by measurement. takes/picks.json overrides it: { "<label>": <take> }, or
// { "<label>": { "take": <take>, "keep": [[from, to], ...] } } to use only those stretches of the
// take (in seconds), joined end to end: for a take with a gap in it, or one click too many. Two more
// things an entry can ask for: "fade": seconds, a longer fade-out for a one-shot that was cut off
// while still sounding, and "highpass": Hz, a higher cut than usual for a bed that is mostly rumble.
//
// What the build does:
//   sfx    one-shots are trimmed to the sound itself, beds lose what is under 30 Hz, and every sound
//          is levelled to match the stand-in in src/audio/synth.js that it replaces, so the volumes in
//          the manifest still hold; what cannot be made up inside the file without clipping is left
//          to the game as `gain`. A sound whose manifest entry has `notes` is one recorded note
//          played once per [seconds, semitones]: the model will not play a set number of notes.
//   music  levelled to one loudness, with the silence trimmed from the end
//   voice  each clip is one line: trimmed and levelled (peaks that stand in the way are held down,
//          and a line far quieter than the rest of its voice is left a little quieter)
//
// What the game needs to know about a recording (the gain a bed is still owed) goes to
// src/audio/recordings.json, with the recording's length, so the note is ignored if the file is
// later swapped for another.
//
// Decoding and encoding go through afconvert, which ships with macOS.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAKES = join(ROOT, 'takes');
// AUDIO_OUT=<folder> builds into <folder>/audio and <folder>/recordings.json instead, to look at the
// result before it goes into the game (the dev server reloads the page for every file that lands)
const OUT = process.env.AUDIO_OUT ? resolve(process.env.AUDIO_OUT) : null;
const PUBLIC = OUT ? join(OUT, 'audio') : join(ROOT, 'public', 'audio');
const NOTES = OUT ? join(OUT, 'recordings.json') : join(ROOT, 'src', 'audio', 'recordings.json');

const RATE = 44100;
const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
const amp = (d) => 10 ** (d / 20);
const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN);
const median = (list) => pct([...list].sort((p, q) => p - q), 0.5);

// What the game should hear, in dB(A) re full scale (see loudness()).
const SPEECH_LEVEL = -20; // the talking parts of a line
const SPEECH_WINDOW = 6; // dB: how far a line's gain may stray from what the rest of that voice needed
const MUSIC_LEVEL = -26; // a radio track, before the game's own music volume: clear of the road noise, well under a voice
const CEILING = -1; // no sample goes above this, dBFS
const BED_HIGHPASS = 30; // Hz: what a bed loses at the bottom, unless takes/picks.json says otherwise

// ------------------------------------------------------------------ files

function scratch() {
  return mkdtempSync(join(tmpdir(), 'audio-tools-'));
}

function afconvert(args) {
  execFileSync('afconvert', args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

/** Any audio file -> { rate, ch: [Float32Array, ...] } at 44.1 kHz. */
export function decode(file) {
  const dir = scratch();
  const wav = join(dir, 'in.wav');
  try {
    afconvert(['-f', 'WAVE', '-d', `LEI16@${RATE}`, file, wav]);
    return readWav(readFileSync(wav));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    else if (id === 'data') {
      data = buf.subarray(p + 8, Math.min(buf.length, p + 8 + size));
      break;
    }
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error('expected 16-bit PCM');
  const n = Math.floor(data.length / 2 / fmt.channels);
  const ch = Array.from({ length: fmt.channels }, () => new Float32Array(n));
  for (let i = 0, o = 0; i < n; i++) for (let c = 0; c < fmt.channels; c++, o += 2) ch[c][i] = data.readInt16LE(o) / 32768;
  return { rate: fmt.rate, ch };
}

/** 24-bit WAV, so nothing is lost on the way to the encoder. */
export function wavBytes(a) {
  const n = a.ch[0].length, C = a.ch.length, bytes = n * C * 3;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + bytes, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(C, 22);
  buf.writeUInt32LE(a.rate, 24); buf.writeUInt32LE(a.rate * C * 3, 28); buf.writeUInt16LE(C * 3, 32); buf.writeUInt16LE(24, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(bytes, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < C; c++, o += 3) buf.writeIntLE(Math.round(Math.max(-1, Math.min(1, a.ch[c][i])) * 8388607), o, 3);
  }
  return buf;
}

/**
 * An .m4a notes when it was made, in three headers. Without those times the same takes build the
 * same bytes, and a rebuild that changes nothing leaves nothing for git to see.
 */
function unstamp(file) {
  const b = readFileSync(file);
  const walk = (from, to) => {
    for (let i = from; i + 8 <= to; ) {
      const size = b.readUInt32BE(i), type = b.toString('latin1', i + 4, i + 8);
      const head = size === 1 ? 16 : 8, len = size === 1 ? Number(b.readBigUInt64BE(i + 8)) : size || to - i;
      if (len < head) return;
      if (['moov', 'trak', 'mdia'].includes(type)) walk(i + head, i + len);
      else if (['mvhd', 'tkhd', 'mdhd'].includes(type)) b.fill(0, i + head + 4, i + head + (b[i + head] === 1 ? 20 : 12));
      i += len;
    }
  };
  walk(0, b.length);
  writeFileSync(file, b);
}

/** Write `a` as AAC in an .m4a, replacing any other recording of the same name. */
function encode(a, file, bitrate) {
  const dir = scratch();
  const wav = join(dir, 'out.wav');
  try {
    writeFileSync(wav, wavBytes(a));
    mkdirSync(dirname(file), { recursive: true });
    const stem = basename(file).replace(/\.[^.]+$/, '');
    for (const f of readdirSync(dirname(file))) if (f.replace(/\.[^.]+$/, '') === stem && /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(f)) rmSync(join(dirname(file), f));
    afconvert(['-f', 'm4af', '-d', 'aac', '-b', String(bitrate), '-q', '127', wav, file]);
    unstamp(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ signal

export function mono(a) {
  if (a.ch.length === 1) return a.ch[0];
  const n = a.ch[0].length, out = new Float32Array(n);
  for (const c of a.ch) for (let i = 0; i < n; i++) out[i] += c[i] / a.ch.length;
  return out;
}

const peakOf = (a) => {
  let p = 0;
  for (const c of a.ch) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  return p;
};

/** RMS of each `hop` seconds of signal. */
function frames(x, rate, hop = 0.01) {
  const h = Math.round(rate * hop), n = Math.floor(x.length / h), out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * h, e = i + h; i < e; i++) s += x[i] * x[i];
    out[f] = Math.sqrt(s / h);
  }
  return out;
}

/** First and last sample of the sound itself: everything 50 dB under its loudest moment counts as silence. */
function bounds(a) {
  const hop = 0.005, f = frames(mono(a), a.rate, hop), h = Math.round(a.rate * hop);
  let top = 0;
  for (const v of f) top = Math.max(top, v);
  const quiet = Math.max(amp(-66), top * amp(-50));
  let first = 0, last = f.length - 1;
  while (first < f.length && f[first] < quiet) first++;
  while (last > first && f[last] < quiet) last--;
  return [first * h, Math.min(a.ch[0].length, (last + 1) * h)];
}

/** The sound without the silence around it, with a breath of room and a short fade at each end. */
export function trim(a, { pre = 0.012, post = 0.09, fadeIn = 0.004, fadeOut = 0.05 } = {}) {
  const [s0, e0] = bounds(a);
  const s = Math.max(0, s0 - Math.round(pre * a.rate)), e = Math.min(a.ch[0].length, e0 + Math.round(post * a.rate));
  // fade in only over the room before the sound, so an attack keeps its edge; and never fade out more than a third of it
  const nIn = Math.max(16, Math.min(Math.round(fadeIn * a.rate), s0 - s)), nOut = Math.min(Math.round(fadeOut * a.rate), Math.floor((e - s) * 0.35));
  const ch = a.ch.map((c) => {
    const out = c.slice(s, e);
    for (let i = 0; i < nIn && i < out.length; i++) out[i] *= i / nIn;
    for (let i = 0; i < nOut; i++) out[out.length - 1 - i] *= i / nOut;
    return out;
  });
  return { rate: a.rate, ch };
}

/** Only the given stretches of `a` (in seconds), joined end to end with a few milliseconds of overlap. */
function splice(a, keep) {
  const x = Math.round(0.008 * a.rate);
  const ch = a.ch.map((c) => {
    let out = new Float32Array(0);
    for (const [from, to] of keep) {
      const part = c.slice(Math.max(0, Math.round(from * a.rate)), Math.min(c.length, Math.round(to * a.rate)));
      const n = Math.min(x, out.length, part.length);
      const next = new Float32Array(out.length + part.length - n);
      next.set(out);
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / (n + 1);
        next[out.length - n + i] = out[out.length - n + i] * (1 - t) + part[i] * t;
      }
      next.set(part.subarray(n), out.length);
      out = next;
    }
    return out;
  });
  return { rate: a.rate, ch };
}

/**
 * A fourth-order high-pass. Generated beds carry a lot of rumble under 30 Hz that nobody hears and
 * that only eats headroom once the bed is brought up to level. The filter is run in on the end of
 * the sound, so a loop still meets itself.
 */
function highpass(a, hz) {
  const lead = Math.min(a.ch[0].length, a.rate);
  const ch = a.ch.map((c) => {
    const y = new Float32Array(lead + c.length);
    y.set(c.subarray(c.length - lead));
    y.set(c, lead);
    for (const q of [0.5412, 1.3066]) {
      const w = (2 * Math.PI * hz) / a.rate, cs = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
      const b0 = (1 + cs) / 2 / a0, b1 = -(1 + cs) / a0, a1 = (-2 * cs) / a0, a2 = (1 - al) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < y.length; i++) {
        const x = y[i], v = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = v;
        y[i] = v;
      }
    }
    return y.slice(lead);
  });
  return { rate: a.rate, ch };
}

/**
 * `a` played once for each [seconds, semitones] of `notes` and mixed: a tune out of one recorded
 * note, the way a sampler plays one. A higher note is the same recording run faster.
 */
function tune(a, notes) {
  const parts = notes.map(([at, semitones]) => {
    const r = 2 ** (semitones / 12), n = Math.floor((a.ch[0].length - 3) / r);
    const ch = a.ch.map((c) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = i * r, k = Math.floor(p), f = p - k;
        const p0 = c[Math.max(0, k - 1)], p1 = c[k], p2 = c[k + 1], p3 = c[k + 2];
        out[i] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
      }
      return out;
    });
    return { at: Math.round(at * a.rate), ch };
  });
  const total = Math.max(...parts.map((p) => p.at + p.ch[0].length));
  const ch = a.ch.map((_, c) => {
    const out = new Float32Array(total);
    for (const p of parts) for (let i = 0; i < p.ch[c].length; i++) out[p.at + i] += p.ch[c][i];
    return out;
  });
  return { rate: a.rate, ch };
}

function scaled(a, gainDb) {
  const g = amp(gainDb);
  return { rate: a.rate, ch: a.ch.map((c) => c.map((v) => v * g)) };
}

/** Bring `a` from `have` to `want` dB, but never so far that it clips. Returns [audio, gain applied, gain still owed]. */
function level(a, have, want) {
  const g = Math.min(want - have, CEILING - db(peakOf(a)));
  return [scaled(a, g), g, want - have - g];
}

/**
 * Brings the few samples of `a` that go over the ceiling down to it and leaves the rest alone: a
 * look-ahead limiter. The gain is the least that any sample within 6 ms needs, averaged over the
 * same span, so it never jumps and never lets a peak through.
 */
function limit(a, ceiling = amp(CEILING)) {
  const n = a.ch[0].length, W = Math.round(0.006 * a.rate);
  const need = new Float32Array(n);
  let over = false;
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of a.ch) p = Math.max(p, Math.abs(c[i]));
    need[i] = p > ceiling ? ceiling / p : 1;
    over ||= p > ceiling;
  }
  if (!over) return a;
  const least = new Float32Array(n), queue = new Int32Array(n);
  for (let i = 0, j = 0, head = 0, tail = 0; i < n; i++) {
    for (; j < Math.min(n, i + W + 1); j++) {
      while (tail > head && need[queue[tail - 1]] >= need[j]) tail--;
      queue[tail++] = j;
    }
    while (queue[head] < i - W) head++;
    least[i] = need[queue[head]];
  }
  const sum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + least[i];
  const ch = a.ch.map((c) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - W), hi = Math.min(n - 1, i + W);
      out[i] = (c[i] * (sum[hi + 1] - sum[lo])) / (hi - lo + 1);
    }
    return out;
  });
  return { rate: a.rate, ch };
}

const seconds = (a) => round(a.ch[0].length / a.rate, 2);
const signed = (g) => (g >= 0 ? '+' : '') + round(g, 1);

/** In-place radix-2 FFT. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const xr = re[q] * cr - im[q] * ci, xi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - xr; im[q] = im[p] - xi;
        re[p] += xr; im[p] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const N = 8192, HOP = 2048;
let WINDOW = null, CURVE = null;

/**
 * How loud it sounds, frame by frame (about a fifth of a second each): the power of the signal
 * weighted by the ear's sensitivity at low levels (the A curve), in dB re full scale. A rumble and a
 * hiss with the same RMS do not sound equally loud; this is the number to match between them.
 */
export function loudness(a) {
  if (!WINDOW) {
    WINDOW = new Float32Array(N);
    for (let i = 0; i < N; i++) WINDOW[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  }
  if (!CURVE || CURVE.rate !== a.rate) {
    CURVE = new Float64Array(N / 2);
    CURVE.rate = a.rate;
    for (let k = 1; k < N / 2; k++) {
      const f2 = ((k * a.rate) / N) ** 2;
      const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
      CURVE[k] = (ra * amp(2)) ** 2;
    }
  }
  let wsum = 0;
  for (let i = 0; i < N; i++) wsum += WINDOW[i] * WINDOW[i];
  // frames start half a window before the sound, so a click on the very first sample is not lost to the window's edge
  const len = a.ch[0].length, count = Math.floor(len / HOP) + 1;
  const power = new Float64Array(count);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (const c of a.ch) {
    for (let f = 0; f < count; f++) {
      const s = f * HOP - N / 2;
      for (let i = 0; i < N; i++) {
        const j = s + i;
        re[i] = j >= 0 && j < len ? c[j] * WINDOW[i] : 0;
        im[i] = 0;
      }
      fft(re, im);
      let p = 0;
      for (let k = 1; k < N / 2; k++) p += (re[k] * re[k] + im[k] * im[k]) * CURVE[k];
      power[f] += (2 * p) / (N * wsum) / a.ch.length;
    }
  }
  let top = 0, sum = 0, act = 0, actN = 0;
  for (const p of power) { top = Math.max(top, p); sum += p; }
  for (const p of power) if (p > top * 10 ** -2.5) { act += p; actN++; }
  const d = (p) => (p > 1e-18 ? 10 * Math.log10(p) : -180);
  return {
    whole: d(sum / count), // the average over the whole file: for beds
    loudest: d(top), // its loudest moment: for one-shots
    active: d(act / Math.max(1, actN)), // the average of the parts within 25 dB of the loudest: for speech and music
  };
}

// ------------------------------------------------------------------ measuring

const QUIET = amp(-48); // below this a 10 ms frame counts as silence, for reporting

/** Level, silence at the ends, and how steady the level is. */
export function measure(a) {
  const x = mono(a), rate = a.rate;
  let sq = 0;
  for (let i = 0; i < x.length; i++) sq += x[i] * x[i];
  const f = frames(x, rate);
  let first = 0, last = f.length - 1;
  while (first < f.length && f[first] < QUIET) first++;
  while (last > first && f[last] < QUIET) last--;
  let act = 0, actN = 0;
  for (let i = 0; i < f.length; i++) if (f[i] >= QUIET) { act += f[i] * f[i]; actN++; }
  // one-second windows, for beds: how far the level wanders
  const secDb = [...frames(x, rate, 1)].map(db).sort((p, q) => p - q);
  const sorted = [...f].sort((p, q) => p - q);
  // moments where the level jumps: notes of a chime, clicks, knocks
  let onsets = 0, top = 0;
  for (const v of f) top = Math.max(top, v);
  for (let i = 3, hold = 0; i < f.length; i++) {
    const before = Math.max(f[i - 3], f[i - 2], f[i - 1]);
    if (hold > 0) hold--;
    else if (f[i] > top * amp(-20) && f[i] > before * amp(6)) { onsets++; hold = 6; }
  }
  const l = loudness(a);
  return {
    seconds: round(x.length / rate, 3),
    channels: a.ch.length,
    peakDb: round(db(peakOf(a)), 1),
    rmsDb: round(db(Math.sqrt(sq / Math.max(1, x.length))), 1),
    activeDb: round(db(Math.sqrt(act / Math.max(1, actN))), 1), // level of the parts that are not silent
    floorDb: round(db(pct(sorted, 0.05)), 1), // the quietest 5% of frames
    lead: round(first * 0.01, 2), // silence before the sound starts
    tail: round((f.length - 1 - last) * 0.01, 2), // and after it ends
    silent: round(1 - actN / Math.max(1, f.length), 2), // share of the file that is silence
    wander: secDb.length > 2 ? round(secDb[secDb.length - 1] - secDb[0], 1) : 0, // loudest second minus quietest, dB
    onsets,
    loudA: round(l.whole, 1), topA: round(l.loudest, 1), activeA: round(l.active, 1),
  };
}

/** Where the weight of the spectrum sits, in Hz: higher is brighter. */
function centroid(x, rate) {
  const M = 2048, re = new Float32Array(M), im = new Float32Array(M);
  let num = 0, den = 0;
  for (let s = 0; s + M <= x.length; s += M) {
    let e = 0;
    for (let i = 0; i < M; i++) {
      const v = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (M - 1)));
      re[i] = v; im[i] = 0; e += v * v;
    }
    if (Math.sqrt(e / M) < QUIET) continue;
    fft(re, im);
    for (let k = 1; k < M / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      num += m * ((k * rate) / M);
      den += m;
    }
  }
  return den ? num / den : 0;
}

/** Pitch and pace of a spoken take: what can be told about a voice without hearing it. */
export function voiceStats(a) {
  const x = mono(a);
  // a quarter of the rate is plenty for pitch
  const D = 4, r = a.rate / D, y = new Float32Array(Math.floor(x.length / D));
  for (let i = 0; i < y.length; i++) y[i] = (x[i * D] + x[i * D + 1] + x[i * D + 2] + x[i * D + 3]) / 4;
  const W = Math.round(r * 0.046), H = Math.round(r * 0.01);
  const lo = Math.floor(r / 400), hi = Math.ceil(r / 70);
  const f0 = [];
  let total = 0;
  for (let s = 0; s + W + hi < y.length; s += H) {
    total++;
    let e0 = 0;
    for (let i = 0; i < W; i++) e0 += y[s + i] * y[s + i];
    if (Math.sqrt(e0 / W) < amp(-40)) continue;
    let best = 0, bestLag = 0;
    const rs = new Float32Array(hi + 2);
    for (let lag = lo; lag <= hi; lag++) {
      let c = 0, e1 = 0;
      for (let i = 0; i < W; i++) {
        c += y[s + i] * y[s + i + lag];
        e1 += y[s + i + lag] * y[s + i + lag];
      }
      const v = c / Math.sqrt(e0 * e1 + 1e-12);
      rs[lag] = v;
      if (v > best) { best = v; bestLag = lag; }
    }
    if (best < 0.6) continue;
    // the shortest period that is nearly as good: keeps the estimate off the octave below
    for (let lag = lo + 1; lag < bestLag; lag++) {
      if (rs[lag] > 0.9 * best && rs[lag] >= rs[lag - 1] && rs[lag] >= rs[lag + 1]) { bestLag = lag; break; }
    }
    f0.push(r / bestLag);
  }
  f0.sort((p, q) => p - q);
  return {
    pitchHz: round(pct(f0, 0.5), 0),
    pitchLowHz: round(pct(f0, 0.1), 0),
    pitchHighHz: round(pct(f0, 0.9), 0),
    rangeSemitones: round(12 * Math.log2(pct(f0, 0.9) / pct(f0, 0.1)), 1), // how much the voice moves
    voiced: round(f0.length / Math.max(1, total), 2),
    brightHz: round(centroid(x, a.rate), 0),
  };
}

// ------------------------------------------------------------------ building

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);

/** label -> [{ take, file (absolute) }] for one kind of take. */
function takesOf(kind) {
  const out = new Map();
  for (const e of readJson(join(TAKES, kind, 'index.json'), [])) {
    if (!out.has(e.label)) out.set(e.label, []);
    out.get(e.label).push({ take: e.take, file: join(TAKES, kind, e.file) });
  }
  return out;
}

/** label -> { take, keep } as asked for in takes/picks.json. */
function picks() {
  const raw = readJson(join(TAKES, 'picks.json'), {});
  return Object.fromEntries(Object.entries(raw).map(([label, v]) => [label, typeof v === 'object' ? v : { take: v }]));
}

function writeNotes(notes) {
  const sorted = Object.fromEntries(Object.entries(notes).sort(([p], [q]) => (p < q ? -1 : 1)));
  writeFileSync(NOTES, JSON.stringify(sorted, null, 1) + '\n');
}

/** The stand-in the game plays when there is no recording: the level a recording has to match. */
async function standIn(id) {
  const { synthBuffer } = await import(pathToFileURL(join(ROOT, 'src', 'audio', 'synth.js')).href);
  const ctx = {
    sampleRate: RATE,
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] };
    },
  };
  // the stand-ins are made of noise: give them the same noise every time, so the same takes build the same files
  const random = Math.random;
  let seed = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  Math.random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  let buf;
  try {
    buf = synthBuffer(ctx, id);
  } finally {
    Math.random = random;
  }
  if (!buf) return null;
  return { rate: RATE, ch: Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)) };
}

async function buildSfx(log) {
  const { SFX } = await import(pathToFileURL(join(ROOT, 'src', 'audio', 'manifest.js')).href);
  const takes = takesOf('sfx'), chosen = picks(), notes = readJson(NOTES, {});
  for (const s of SFX) {
    const label = `sfx/${s.id}`, list = takes.get(label);
    if (!list) continue;
    const cand = list.map((t) => {
      const a = decode(t.file);
      return { ...t, a, m: measure(a) };
    });
    // a bed should be even and never drop out; a one-shot should be a strong, clean recording
    cand.sort((p, q) => (s.loop ? p.m.silent - q.m.silent || p.m.wander - q.m.wander : q.m.topA - p.m.topA));
    const asked = chosen[label] || {};
    const pick = cand.find((c) => c.take === asked.take) || cand[0];
    const ref = await standIn(s.id);
    const whole = asked.keep ? splice(pick.a, asked.keep) : pick.a;
    let body;
    if (s.loop) body = highpass(whole, asked.highpass ?? BED_HIGHPASS);
    else {
      body = trim(whole, asked.fade ? { fadeOut: asked.fade } : undefined);
      if (s.notes) body = tune(body, s.notes);
    }
    const have = loudness(body), want = ref ? loudness(ref) : null;
    const [out, g, owed] = want ? level(body, s.loop ? have.whole : have.loudest, s.loop ? want.whole : want.loudest) : [body, 0, 0];
    encode(out, join(PUBLIC, 'sfx', `${s.id}.m4a`), out.ch.length > 1 ? 128000 : 96000);
    // only a bed is turned up further by the game: a one-shot that is still short of its stand-in at the
    // ceiling is all low end (thunder), and more gain would only push the rest of the mix down
    if (s.loop && owed > 0.5) notes[`sfx/${s.id}`] = { seconds: seconds(out), gain: round(owed, 1) };
    else delete notes[`sfx/${s.id}`];
    log(`sfx/${s.id}  take ${pick.take} of ${cand.length}  ${seconds(out)} s  gain ${signed(g)} dB  peak ${round(db(peakOf(out)), 1)}` +
      (s.loop ? `  wander ${pick.m.wander} dB  cut under ${asked.highpass ?? BED_HIGHPASS} Hz` : asked.keep ? `  kept ${asked.keep.map((k) => k.join('-')).join(', ')} s` : `  cut ${pick.m.lead} s from the start`) +
      (s.notes ? `  ${s.notes.length} notes` : '') +
      (owed > 0.5 ? (s.loop ? `  (the game adds ${signed(owed)} dB)` : `  (${round(owed, 1)} dB under its stand-in, and as loud as the file can be)`) : ''));
  }
  writeNotes(notes);
}

async function buildMusic(log) {
  const { MUSIC } = await import(pathToFileURL(join(ROOT, 'src', 'audio', 'manifest.js')).href);
  const takes = takesOf('music'), chosen = picks();
  for (const m of MUSIC) {
    const label = `music/${m.id}`, list = takes.get(label);
    if (!list) continue;
    const pick = list.find((t) => t.take === chosen[label]?.take) || list[0];
    const body = trim(decode(pick.file), { pre: 0.05, post: 0.4, fadeIn: 0.01, fadeOut: 0.3 });
    const [out, g, owed] = level(body, loudness(body).active, MUSIC_LEVEL);
    encode(out, join(PUBLIC, 'music', `${m.id}.m4a`), 160000);
    log(`music/${m.id}  take ${pick.take} of ${list.length}  ${seconds(out)} s  gain ${signed(g)} dB  peak ${round(db(peakOf(out)), 1)}` + (owed > 0.5 ? `  (${round(owed, 1)} dB short of the target: it would clip)` : ''));
  }
}

async function buildVoice(log) {
  const { RIDERS, CAR_LINES, clipsOf } = await import(pathToFileURL(join(ROOT, 'src', 'data', 'riders.js')).href);
  const takes = takesOf('voice'), chosen = picks();
  // every clip is one line in one voice; `label` is what its takes were recorded under
  const clips = CAR_LINES.map((l) => ({ key: `voice/car/${l.id}`, who: 'nim', label: `car/${l.id}` }));
  for (const r of RIDERS) for (const [clip] of clipsOf(r)) clips.push({ key: `voice/${r.id}/${clip}`, who: r.id, label: `${r.id}/${clip}` });
  const ready = clips.filter((c) => takes.has(c.label));
  // measure every take once; a voice's usual pitch is the middle of all its takes
  const pitches = new Map();
  for (const c of ready) {
    c.cand = takes.get(c.label).map((t) => {
      const a = decode(t.file);
      return { ...t, a, pitch: voiceStats(a).pitchHz };
    });
    if (!pitches.has(c.who)) pitches.set(c.who, []);
    pitches.get(c.who).push(...c.cand.map((x) => x.pitch).filter(Number.isFinite));
  }
  const usual = new Map([...pitches].map(([who, list]) => [who, median(list)]));
  const off = (who, pitch) => (Number.isFinite(pitch) ? Math.abs(Math.log2(pitch / usual.get(who))) : 9);
  // of several takes, the one that sounds most like the rest of that voice; and what it would take to bring it to level
  const gains = new Map();
  for (const c of ready) {
    c.pick = c.cand.find((x) => x.take === chosen[c.label]?.take) || [...c.cand].sort((p, q) => off(c.who, p.pitch) - off(c.who, q.pitch))[0];
    c.body = trim(c.pick.a);
    c.gain = SPEECH_LEVEL - loudness(c.body).active;
    if (!gains.has(c.who)) gains.set(c.who, []);
    gains.get(c.who).push(c.gain);
  }
  const usualGain = new Map([...gains].map(([who, list]) => [who, median(list)]));
  for (const c of ready) {
    // every line at the same loudness, give or take: one spoken under the breath stays a little under, and
    // where a laugh or a hard consonant stands in the way, only that is held down
    const g = Math.max(usualGain.get(c.who) - SPEECH_WINDOW, Math.min(usualGain.get(c.who) + SPEECH_WINDOW, c.gain));
    const held = Math.max(0, db(peakOf(c.body)) + g - CEILING);
    const out = mono(limit(scaled(c.body, g)));
    // a moment of quiet at each end, so nothing starts or stops on a click
    const lead = Math.round(0.03 * RATE), mix = new Float32Array(lead + out.length + Math.round(0.05 * RATE));
    mix.set(out, lead);
    encode({ rate: RATE, ch: [mix] }, join(PUBLIC, `${c.key}.m4a`), 96000);
    log(`${c.key}  ${round(mix.length / RATE, 2)} s  take ${c.pick.take} of ${c.cand.length}  gain ${signed(g)} dB` +
      (Math.abs(g - c.gain) > 0.5 ? `  (${round(Math.abs(g - c.gain), 1)} dB ${g < c.gain ? 'under' : 'over'} the rest)` : '') + (held > 0.5 ? `  (peaks held ${round(held, 1)} dB)` : ''));
  }
  // a spoken clip needs nothing noted about it: clear what a build of longer clips left behind
  const notes = readJson(NOTES, {});
  for (const k of Object.keys(notes)) if (k.startsWith('voice/')) delete notes[k];
  writeNotes(notes);
  log(`usual pitch: ${[...usual].map(([who, hz]) => `${who} ${hz} Hz`).join(', ')}`);
  const waiting = clips.length - ready.length;
  if (waiting) log(`${waiting} clips have no take yet`);
}

// ------------------------------------------------------------------ command line

async function main([cmd, ...rest]) {
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const args = rest.filter((a) => !a.startsWith('--'));
  if (cmd === 'probe') {
    const rows = args.map((file) => {
      const a = decode(file);
      return { file: basename(file), ...measure(a), ...(flags.has('--voice') ? voiceStats(a) : {}) };
    });
    if (flags.has('--json')) console.log(JSON.stringify(rows, null, 1));
    else console.table(rows);
  } else if (cmd === 'build') {
    const kinds = args.length ? args : ['sfx', 'music', 'voice'];
    const log = (line) => console.log(line);
    if (kinds.includes('sfx')) await buildSfx(log);
    if (kinds.includes('music')) await buildMusic(log);
    if (kinds.includes('voice')) await buildVoice(log);
  } else {
    console.error('usage: audio-tools.mjs probe [--voice] [--json] <file...>\n       audio-tools.mjs build [sfx] [music] [voice]');
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
