// Stand-ins. Every sound in the manifest has a synthesised version here, so the
// game is never silent while the real recordings are still being made. They are
// rendered into buffers once, on first use.

const rand = (a, b) => a + Math.random() * (b - a);

/** RBJ biquad, processed sample by sample. */
class Biquad {
  constructor(type, f, q, sr) {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.sr = sr;
    this.set(type, f, q);
  }

  set(type, f, q) {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.45)) / this.sr;
    const cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; } // band-pass, constant peak
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }

  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const white = () => Math.random() * 2 - 1;
function brownSource() {
  let v = 0;
  return () => {
    v = (v + white() * 0.04) * 0.996;
    return v * 6;
  };
}
function pinkSource() {
  let b0 = 0, b1 = 0, b2 = 0;
  return () => {
    const w = white();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return (b0 + b1 + b2 + w * 0.1848) * 0.22;
  };
}

/** Fill a buffer from a per-sample function of (time, channel). */
function render(ctx, seconds, channels, fn) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(channels, n, sr);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    const f = fn(c, sr);
    for (let i = 0; i < n; i++) d[i] = f(i / sr, i);
  }
  return buf;
}

/** Blend the tail into the head so a noise bed loops without a tick. */
function seam(buf, seconds = 0.35) {
  const n = Math.floor(seconds * buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    const L = d.length;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = d[i] * t + d[L - n + i] * (1 - t);
    }
  }
  // the blended head now continues from the sample just before the tail region
  const out = buf;
  out.loopEnd = (buf.length - n) / buf.sampleRate;
  return out;
}

const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
const hump = (t, len) => {
  const x = t / len;
  return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x) ** 1.5;
};

/** Random ticks: little filtered noise bursts scattered through a bed (raindrops, crunch). */
function ticks(sr, seconds, perSecond, f0, f1, amp) {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const count = Math.floor(seconds * perSecond);
  for (let k = 0; k < count; k++) {
    const at = Math.floor(Math.random() * (n - 800));
    const bp = new Biquad('bp', rand(f0, f1), rand(1.5, 5), sr);
    const a = amp * rand(0.3, 1) ** 2;
    const len = Math.floor(rand(0.004, 0.02) * sr);
    for (let i = 0; i < len; i++) out[at + i] += bp.run(white()) * a * Math.exp(-i / (len * 0.3));
  }
  return out;
}

const MAKERS = {
  cabin_drive: (ctx) => seam(render(ctx, 7, 2, (c, sr) => {
    const br = brownSource(), pk = pinkSource();
    const lp = new Biquad('lp', 210, 0.7, sr), bp = new Biquad('bp', 640 + c * 60, 0.6, sr);
    return (t) => lp.run(br()) * 0.5 + bp.run(pk()) * 0.16 + Math.sin(2 * Math.PI * (520 + 4 * Math.sin(t * 1.3)) * t) * 0.006 + Math.sin(2 * Math.PI * 1047 * t) * 0.002;
  })),
  cabin_idle: (ctx) => seam(render(ctx, 5, 2, (c, sr) => {
    const pk = pinkSource();
    const lp = new Biquad('lp', 420, 0.7, sr), fan = new Biquad('bp', 176 + c * 5, 3, sr);
    return (t) => lp.run(pk()) * 0.1 + fan.run(white()) * 0.03 + Math.sin(2 * Math.PI * 100 * t) * 0.0025;
  })),
  rain_light: (ctx) => seam(render(ctx, 7, 2, (c, sr) => {
    const hp = new Biquad('hp', 1500, 0.7, sr), lp = new Biquad('lp', 6500, 0.7, sr);
    const tk = ticks(sr, 7, 26, 1800, 5200, 0.5);
    return (t, i) => lp.run(hp.run(white())) * 0.07 * (0.8 + 0.2 * Math.sin(t * 0.9 + c)) + tk[i];
  })),
  rain_heavy: (ctx) => seam(render(ctx, 7, 2, (c, sr) => {
    const bp = new Biquad('bp', 1700, 0.35, sr), br = brownSource(), lp = new Biquad('lp', 320, 0.7, sr);
    const tk = ticks(sr, 7, 110, 1200, 4500, 0.55);
    return (t, i) => bp.run(white()) * 0.3 + lp.run(br()) * 0.28 + tk[i];
  })),
  wet_road: (ctx) => seam(render(ctx, 5, 2, (c, sr) => {
    const bp = new Biquad('bp', 4000, 0.5, sr), hp = new Biquad('hp', 1800, 0.7, sr);
    return (t) => hp.run(bp.run(white())) * 0.3 * (0.85 + 0.15 * Math.sin(t * 5.1 + c * 2));
  })),
  wind: (ctx) => seam(render(ctx, 9, 2, (c, sr) => {
    const pk = pinkSource();
    const bp = new Biquad('bp', 400, 1.2, sr);
    let k = 0;
    return (t) => {
      if (k++ % 64 === 0) bp.set('bp', 380 + 260 * Math.sin(t * 0.7 + c) + 120 * Math.sin(t * 1.9), 1.2);
      return bp.run(pk()) * 0.9 * (0.55 + 0.45 * Math.sin(t * 0.7 + 1 + c * 0.5));
    };
  }), 0.6),
  city_day: (ctx) => seam(render(ctx, 9, 2, (c, sr) => {
    const br = brownSource(), lp = new Biquad('lp', 520, 0.7, sr), bp = new Biquad('bp', 300, 0.8, sr), pk = pinkSource();
    return (t) => lp.run(br()) * 0.22 + bp.run(pk()) * 0.25 * hump((t + c * 1.5) % 4.5, 4.5);
  }), 0.6),
  city_night: (ctx) => seam(render(ctx, 9, 2, (c, sr) => {
    const br = brownSource(), lp = new Biquad('lp', 280, 0.7, sr);
    return (t) => lp.run(br()) * 0.2 + Math.sin(2 * Math.PI * 120 * t) * 0.003;
  }), 0.6),
  birds_morning: (ctx) => render(ctx, 8, 2, (c, sr) => {
    const chirps = [];
    for (let k = 0; k < 16; k++) chirps.push({ at: rand(0.1, 7.6), f: rand(2400, 4600), d: rand(0.04, 0.09), up: rand(-900, 1200), a: rand(0.2, 1) * (Math.random() < 0.5 ? c : 1 - c) });
    const pk = pinkSource(), lp = new Biquad('lp', 600, 0.7, sr);
    return (t) => {
      let s = lp.run(pk()) * 0.03;
      for (const ch of chirps) {
        const u = t - ch.at;
        if (u > 0 && u < ch.d) s += Math.sin(2 * Math.PI * (ch.f + (ch.up * u) / ch.d) * u) * Math.sin((Math.PI * u) / ch.d) * 0.05 * ch.a;
      }
      return s;
    };
  }),
  snow_hush: (ctx) => seam(render(ctx, 6, 2, (c, sr) => {
    const pk = pinkSource(), lp = new Biquad('lp', 900, 0.7, sr);
    const tk = ticks(sr, 6, 40, 700, 1600, 0.25);
    return (t, i) => lp.run(pk()) * 0.16 + tk[i];
  })),

  door_open: (ctx) => render(ctx, 2, 1, (c, sr) => {
    const hp = new Biquad('hp', 2000, 0.7, sr), bp = new Biquad('bp', 900, 2, sr);
    return (t) => {
      let s = hp.run(white()) * env(t, 0.001, 0.006) * 0.5;
      const u = t - 0.08;
      if (u > 0 && u < 1.45) {
        const f = 190 + 70 * (u / 1.45);
        const e = Math.min(1, u / 0.12) * Math.min(1, (1.45 - u) / 0.2);
        s += (Math.sin(2 * Math.PI * f * u) * 0.05 + Math.sin(2 * Math.PI * f * 2.01 * u) * 0.02 + bp.run(white()) * 0.05) * e;
      }
      const v = t - 1.55;
      if (v > 0) s += Math.sin(2 * Math.PI * 78 * v) * Math.exp(-v / 0.05) * 0.25;
      return s;
    };
  }),
  door_close: (ctx) => render(ctx, 1.7, 1, (c, sr) => {
    const bp = new Biquad('bp', 800, 2, sr), lp = new Biquad('lp', 380, 0.7, sr), hp = new Biquad('hp', 3200, 0.7, sr);
    return (t) => {
      let s = 0;
      if (t < 0.95) {
        const f = 250 - 70 * (t / 0.95);
        const e = Math.min(1, t / 0.1) * Math.min(1, (0.95 - t) / 0.12);
        s += (Math.sin(2 * Math.PI * f * t) * 0.05 + bp.run(white()) * 0.05) * e;
      }
      const v = t - 0.98;
      if (v > 0) s += Math.sin(2 * Math.PI * (62 - 14 * v) * v) * Math.exp(-v / 0.11) * 0.75 + lp.run(white()) * Math.exp(-v / 0.04) * 0.5 + hp.run(white()) * Math.exp(-v / 0.03) * 0.06;
      return s;
    };
  }),
  seat: (ctx) => render(ctx, 1, 1, (c, sr) => {
    const bp = new Biquad('bp', 1300, 0.8, sr);
    return (t) => bp.run(white()) * (hump(t, 0.3) * 0.5 + hump(t - 0.32, 0.25) * 0.35 + hump(t - 0.6, 0.3) * 0.2) * 0.4 + Math.sin(2 * Math.PI * (130 - 30 * t) * t) * hump(t - 0.1, 0.4) * 0.06;
  }),
  belt: (ctx) => render(ctx, 0.75, 1, (c, sr) => {
    const hp = new Biquad('hp', 2800, 0.8, sr);
    return (t) => {
      let s = hp.run(white()) * hump(t, 0.34) * 0.12;
      const v = t - 0.42;
      if (v > 0) s += (Math.sin(2 * Math.PI * 2900 * v) + Math.sin(2 * Math.PI * 4400 * v) * 0.6) * Math.exp(-v / 0.012) * 0.25 + Math.sin(2 * Math.PI * 180 * v) * Math.exp(-v / 0.03) * 0.15;
      return s;
    };
  }),
  belt_off: (ctx) => render(ctx, 0.75, 1, (c, sr) => {
    const bp = new Biquad('bp', 2400, 1, sr);
    return (t) => {
      let s = (Math.sin(2 * Math.PI * 2500 * t) + Math.sin(2 * Math.PI * 3700 * t) * 0.5) * Math.exp(-t / 0.01) * 0.22;
      s += bp.run(white()) * hump(t - 0.08, 0.36) * 0.14;
      const v = t - 0.5;
      if (v > 0) s += Math.sin(2 * Math.PI * 240 * v) * Math.exp(-v / 0.02) * 0.12;
      return s;
    };
  }),
  wiper: (ctx) => render(ctx, 1.1, 1, (c, sr) => {
    const bp = new Biquad('bp', 1000, 2.5, sr);
    let k = 0;
    return (t) => {
      if (k++ % 32 === 0) bp.set('bp', 800 + 900 * hump(t, 0.9), 2.5);
      let s = bp.run(white()) * hump(t, 0.9) * 0.5;
      const v = t - 0.92;
      if (v > 0) s += Math.sin(2 * Math.PI * 95 * v) * Math.exp(-v / 0.035) * 0.3;
      return s;
    };
  }),
  blinker: (ctx) => render(ctx, 0.12, 1, () => (t) => Math.sin(2 * Math.PI * 1900 * t) * Math.exp(-t / 0.007) * 0.4 + white() * Math.exp(-t / 0.0015) * 0.3),
  pull_away: (ctx) => render(ctx, 2.2, 1, (c, sr) => {
    const pk = pinkSource(), lp = new Biquad('lp', 500, 0.7, sr);
    let ph = 0;
    return (t) => {
      ph += (2 * Math.PI * (170 + 360 * (t / 2.2) ** 0.7)) / sr;
      return (Math.sin(ph) * 0.03 + Math.sin(ph * 2) * 0.012) * hump(t, 2.2) + lp.run(pk()) * 0.2 * Math.min(1, t / 1.5) * Math.min(1, (2.2 - t) / 0.4);
    };
  }),
  stop: (ctx) => render(ctx, 1, 1, () => (t) => Math.sin(2 * Math.PI * (2200 - 900 * t) * t) * hump(t, 0.2) * 0.012 + Math.sin(2 * Math.PI * 82 * Math.max(0, t - 0.25)) * (t > 0.25 ? Math.exp(-(t - 0.25) / 0.09) : 0) * 0.25),
  puddle: (ctx) => render(ctx, 1.5, 2, (c, sr) => {
    const lp = new Biquad('lp', 4000, 0.7, sr);
    let k = 0;
    return (t) => {
      if (k++ % 32 === 0) lp.set('lp', 4500 * Math.exp(-t * 2.2) + 500, 0.7);
      return lp.run(white()) * env(t, 0.02, 0.38) * 0.6;
    };
  }),

  chime_request: (ctx) => render(ctx, 1.3, 1, () => (t) => {
    const note = (f, at) => (t > at ? (Math.sin(2 * Math.PI * f * (t - at)) + Math.sin(2 * Math.PI * f * 4 * (t - at)) * 0.2 * Math.exp(-(t - at) / 0.03)) * Math.exp(-(t - at) / 0.22) : 0);
    return (note(659.3, 0) + note(880, 0.15)) * 0.2;
  }),
  chime_pickup: (ctx) => render(ctx, 1.6, 1, () => (t) => {
    const note = (f, at) => (t > at ? (Math.sin(2 * Math.PI * f * (t - at)) + Math.sin(2 * Math.PI * f * 2.76 * (t - at)) * 0.18) * Math.exp(-(t - at) / 0.35) : 0);
    return (note(523.3, 0) + note(659.3, 0.14) + note(784, 0.28)) * 0.16;
  }),
  chime_arrive: (ctx) => render(ctx, 2, 1, () => (t) => {
    const note = (f, at) => (t > at ? (Math.sin(2 * Math.PI * f * (t - at)) + Math.sin(2 * Math.PI * f * 3 * (t - at)) * 0.1) * Math.exp(-(t - at) / 0.45) : 0);
    return (note(784, 0) + note(659.3, 0.18) + note(523.3, 0.36)) * 0.16;
  }),
  ui_tap: (ctx) => render(ctx, 0.08, 1, () => (t) => Math.sin(2 * Math.PI * 1300 * t) * Math.exp(-t / 0.006) * 0.25),

  pass_dry: (ctx) => render(ctx, 1.9, 2, (c, sr) => {
    const pk = pinkSource(), bp = new Biquad('bp', 800, 0.8, sr);
    let k = 0;
    return (t) => {
      if (k++ % 32 === 0) bp.set('bp', 950 - 300 * (t / 1.9), 0.8);
      const pan = c === 0 ? 1 - t / 1.9 : t / 1.9;
      return bp.run(pk()) * hump(t, 1.9) ** 2 * 1.4 * (0.4 + 0.6 * pan);
    };
  }),
  pass_wet: (ctx) => render(ctx, 2.3, 2, (c, sr) => {
    const pk = pinkSource(), bp = new Biquad('bp', 800, 0.8, sr), hp = new Biquad('hp', 2600, 0.7, sr);
    let k = 0;
    return (t) => {
      if (k++ % 32 === 0) bp.set('bp', 950 - 300 * (t / 2.3), 0.8);
      const pan = c === 0 ? 1 - t / 2.3 : t / 2.3;
      return (bp.run(pk()) * 1.1 + hp.run(white()) * 0.3) * hump(t, 2.3) ** 2 * (0.4 + 0.6 * pan);
    };
  }),
  horn_far: (ctx) => render(ctx, 2, 2, (c, sr) => {
    const lp = new Biquad('lp', 850, 0.7, sr);
    const tone = (t) => {
      let s = 0;
      for (const f of [415, 523]) for (let h = 1; h <= 5; h += 2) s += Math.sin(2 * Math.PI * f * h * t) / h;
      return s;
    };
    const beep = (t) => (t > 0 && t < 0.3 ? Math.min(1, t / 0.02) * Math.min(1, (0.3 - t) / 0.04) : 0);
    return (t) => lp.run(tone(t) * (beep(t) + beep(t - 0.42)) + tone(t - 0.19) * (beep(t - 0.19) + beep(t - 0.61)) * 0.35 + tone(t - 0.4) * beep(t - 0.4 - 0.42) * 0.12) * 0.05;
  }),
  siren_far: (ctx) => render(ctx, 7, 2, (c, sr) => {
    const lp = new Biquad('lp', 1000, 0.7, sr);
    let ph = 0;
    return (t) => {
      ph += (2 * Math.PI * (875 + 275 * Math.sin(2 * Math.PI * 0.55 * t))) / sr;
      return lp.run(Math.sin(ph) + Math.sin(ph * 2) * 0.3) * hump(t, 7) * 0.035 * (c === 0 ? 1 - t / 9 : 0.3 + t / 9);
    };
  }),
  thunder_1: (ctx) => thunder(ctx, 6.5, true, 1),
  thunder_2: (ctx) => thunder(ctx, 8, false, 0.7),
  thunder_3: (ctx) => thunder(ctx, 6, true, 0.9),
};

function thunder(ctx, seconds, crack, amp) {
  return render(ctx, seconds, 2, (c, sr) => {
    const br = brownSource(), lp = new Biquad('lp', 160, 0.7, sr), hp = new Biquad('hp', 900, 0.7, sr);
    const rolls = [];
    for (let k = 0; k < 7; k++) rolls.push({ at: rand(0, seconds * 0.6), d: rand(0.3, 1.1), a: rand(0.3, 1) });
    return (t) => {
      let e = Math.exp(-t / (seconds * 0.32)) * 0.55;
      for (const r of rolls) if (t > r.at) e += r.a * Math.exp(-(t - r.at) / r.d) * 0.3;
      let s = lp.run(br()) * e * 2.2;
      if (crack) s += hp.run(white()) * (Math.exp(-t / 0.05) + 0.5 * Math.exp(-Math.abs(t - 0.13) / 0.03)) * 0.5;
      return s * amp * Math.min(1, t / 0.01) * Math.min(1, (seconds - t) / 1.5);
    };
  });
}

const cache = new Map();

/** A synthesised buffer for a manifest id, or null if there is no stand-in for it. */
export function synthBuffer(ctx, id) {
  if (cache.has(id)) return cache.get(id);
  const make = MAKERS[id];
  const buf = make ? make(ctx) : null;
  cache.set(id, buf);
  return buf;
}
