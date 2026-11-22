// Turns the raw takes in takes/ into the recordings the page plays from public/audio/.
//
//   node scripts/audio-tools.mjs probe <file...>         measure any audio files
//   node scripts/audio-tools.mjs build [sfx] [music]     takes/ -> public/audio/ (both if neither is named)
//
// What was asked of the generator is in src/audio/manifest.json. takes/sfx holds three takes of
// every sound: the loops as <id>.<take>.mp3, the short ones packed end to end in oneshots.mp3, one
// to each eight seconds, in the order of ONESHOTS below. takes/music holds one take of each track.
// Where there are several takes the build picks one by measurement; takes/picks.json overrides it:
// { "sfx/<id>": <take> }.
//
//   loops   lose what is under 30 Hz and are levelled to the loudness the manifest gives them
//   shorts  are trimmed to the sound itself, faded, and levelled by their loudest moment
//   music   is levelled to one loudness, with the silence trimmed from the end
//
// Decoding and encoding go through afconvert, which ships with macOS.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAKES = join(ROOT, 'takes');
// AUDIO_OUT=<folder> builds into <folder>/audio instead, to look at the result before it goes into the page
const OUT = process.env.AUDIO_OUT ? resolve(process.env.AUDIO_OUT) : null;
const PUBLIC = OUT ? join(OUT, 'audio') : join(ROOT, 'public', 'audio');

const RATE = 44100;
const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
const amp = (d) => 10 ** (d / 20);
const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN);

// What the game should hear, in dB(A) re full scale (see loudness()).
const MUSIC_LEVEL = -25; // a radio track, before the page's own radio volume
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
    active: d(act / Math.max(1, actN)), // the average of the parts within 25 dB of the loudest: for music
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

// ------------------------------------------------------------------ building

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
const MANIFEST = readJson(join(ROOT, 'src', 'audio', 'manifest.json'), { sfx: [], stations: [] });
const ONESHOTS = ['tunnel_exit', 'horn_far', 'timer_focus_end', 'timer_break_end', 'radio_tune'];
const CELL = 8;

/** The takes there are of one sound: [{ take, a }]. */
function takesOf(id, packed) {
  const out = [];
  for (let take = 1; take <= 3; take++) {
    const file = join(TAKES, 'sfx', `${id}.${take}.mp3`);
    if (existsSync(file)) out.push({ take, a: decode(file) });
  }
  const at = ONESHOTS.indexOf(id);
  if (!out.length && at >= 0 && packed) {
    for (let take = 1; take <= 3; take++) {
      const from = Math.round((at * 3 + take - 1) * CELL * packed.rate), to = from + Math.round(CELL * packed.rate);
      out.push({ take, a: { rate: packed.rate, ch: packed.ch.map((c) => c.slice(from, to)) } });
    }
  }
  return out;
}

function buildSfx(log) {
  const packedFile = join(TAKES, 'sfx', 'oneshots.mp3');
  const packed = existsSync(packedFile) ? decode(packedFile) : null;
  const chosen = readJson(join(TAKES, 'picks.json'), {});
  for (const s of MANIFEST.sfx) {
    const cand = takesOf(s.id, packed).map((t) => ({ ...t, m: measure(t.a) }));
    if (!cand.length) continue;
    // a loop should be even and never drop out; a short sound should be a strong, clean recording
    cand.sort((p, q) => (s.loop ? p.m.silent - q.m.silent || p.m.wander - q.m.wander : q.m.topA - p.m.topA));
    const pick = cand.find((c) => c.take === chosen[`sfx/${s.id}`]) || cand[0];
    const body = s.loop ? highpass(pick.a, BED_HIGHPASS) : trim(pick.a, { fadeOut: s.seconds > 2 ? 0.25 : 0.06 });
    const have = loudness(body);
    const [out, g, owed] = level(body, s.loop ? have.whole : have.loudest, s.level);
    encode(out, join(PUBLIC, 'sfx', `${s.id}.m4a`), out.ch.length > 1 && s.loop ? 128000 : 80000);
    log(`sfx/${s.id}  take ${pick.take} of ${cand.length}  ${seconds(out)} s  gain ${signed(g)} dB  peak ${round(db(peakOf(out)), 1)}` +
      (s.loop ? `  wander ${pick.m.wander} dB` : `  onsets ${pick.m.onsets}  cut ${pick.m.lead} s from the start`) +
      (owed > 0.5 ? `  (${round(owed, 1)} dB short of its level: it would clip)` : '') +
      `   [others: ${cand.filter((c) => c !== pick).map((c) => `take ${c.take} ${s.loop ? `wander ${c.m.wander}` : `top ${c.m.topA} onsets ${c.m.onsets}`}`).join(', ')}]`);
  }
}

function buildMusic(log) {
  for (const st of MANIFEST.stations) {
    for (const m of st.tracks) {
      const file = join(TAKES, 'music', `${m.id}.mp3`);
      if (!existsSync(file)) continue;
      const body = trim(decode(file), { pre: 0.05, post: 0.4, fadeIn: 0.01, fadeOut: 0.3 });
      const [out, g, owed] = level(body, loudness(body).active, MUSIC_LEVEL);
      encode(out, join(PUBLIC, 'music', `${m.id}.m4a`), 112000);
      log(`music/${m.id}  ${seconds(out)} s  gain ${signed(g)} dB  peak ${round(db(peakOf(out)), 1)}` + (owed > 0.5 ? `  (${round(owed, 1)} dB short of the target: it would clip)` : ''));
    }
  }
}

// ------------------------------------------------------------------ command line

async function main([cmd, ...rest]) {
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const args = rest.filter((a) => !a.startsWith('--'));
  if (cmd === 'probe') {
    const rows = args.map((file) => ({ file: basename(file), ...measure(decode(file)) }));
    if (flags.has('--json')) console.log(JSON.stringify(rows, null, 1));
    else console.table(rows);
  } else if (cmd === 'build') {
    const kinds = args.length ? args : ['sfx', 'music'];
    const log = (line) => console.log(line);
    if (kinds.includes('sfx')) buildSfx(log);
    if (kinds.includes('music')) buildMusic(log);
  } else {
    console.error('usage: audio-tools.mjs probe [--json] <file...>\n       audio-tools.mjs build [sfx] [music]');
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
