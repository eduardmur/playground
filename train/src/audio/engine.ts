// Sound: the train itself (a bed that changes with what the line is doing), a few moments (tunnel
// mouths, a far horn, the timer's bell), and the radio. All of it is recorded; nothing is synthesised.
import manifest from './manifest.json';

const BASE = import.meta.env.BASE_URL;
const LOOPS = ['cabin_loop', 'tunnel_loop', 'bridge_loop', 'window_wind'] as const;
type LoopId = (typeof LOOPS)[number];

/** A recording played round and round, each pass fading into the next, so the join is never heard. */
class Loop {
  readonly gain: GainNode;
  private next = 0;
  private live: AudioBufferSourceNode[] = [];
  rate = 1;
  constructor(private ctx: AudioContext, private buffer: AudioBuffer, out: AudioNode, private overlap = 1.6) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(out);
    this.next = ctx.currentTime + 0.05;
  }
  /** Keep a pass queued up; call a few times a second. */
  pump() {
    const ctx = this.ctx;
    while (this.next < ctx.currentTime + 3.5) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.playbackRate.value = this.rate;
      const env = ctx.createGain();
      const len = this.buffer.duration / this.rate, t0 = Math.max(this.next, ctx.currentTime), o = this.overlap;
      // equal-power fades, as curves
      const up = new Float32Array(16), down = new Float32Array(16);
      for (let i = 0; i < 16; i++) {
        up[i] = Math.sin((i / 15) * Math.PI * 0.5);
        down[i] = Math.cos((i / 15) * Math.PI * 0.5);
      }
      env.gain.setValueAtTime(0, t0);
      env.gain.setValueCurveAtTime(up, t0, o);
      env.gain.setValueCurveAtTime(down, t0 + len - o, o);
      src.connect(env).connect(this.gain);
      src.start(t0);
      src.stop(t0 + len + 0.05);
      src.onended = () => {
        this.live = this.live.filter((s) => s !== src);
        env.disconnect();
      };
      this.live.push(src);
      this.next = t0 + len - o;
    }
  }
  set(level: number, ctx: AudioContext, seconds = 0.4) {
    this.gain.gain.setTargetAtTime(level, ctx.currentTime, seconds / 3);
  }
}

export interface Scene {
  tunnel: number;
  bridge: number;
  lean: number;
  speed: number;
}

export type Station = (typeof manifest.stations)[number];

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private trainBus!: GainNode;
  private radioBus!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loops = new Map<LoopId, Loop>();
  private started = false;
  private wasTunnel = 0;
  private hornAt = 90 + Math.random() * 200;
  private clock = 0;

  // radio
  readonly stations = manifest.stations;
  private el: HTMLAudioElement | null = null;
  private radioGain!: GainNode;
  station = manifest.stations[0];
  private order: number[] = [];
  private at = 0;
  radioOn = true;
  volRadio = 0.5;
  volTrain = 0.7;
  muted = false;
  onTrack: (title: string) => void = () => {};

  get running() {
    return this.started;
  }
  get trackTitle() {
    return this.station.tracks[this.order[this.at] ?? 0]?.title ?? '';
  }

  /** On the first click or key: browsers allow no sound before it. */
  async start() {
    if (this.started) return;
    this.started = true;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.trainBus = ctx.createGain();
    this.trainBus.connect(this.master);
    // the radio: a small speaker somewhere in the car. Narrow band, a little of the room.
    this.radioBus = ctx.createGain();
    this.radioGain = ctx.createGain();
    this.radioGain.gain.value = 0;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 170;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6200;
    lp.Q.value = 0.5;
    const box = ctx.createBiquadFilter();
    box.type = 'peaking';
    box.frequency.value = 1100;
    box.Q.value = 0.8;
    box.gain.value = 2.5;
    this.radioGain.connect(hp).connect(lp).connect(box).connect(this.radioBus);
    const room = ctx.createConvolver();
    room.buffer = this.roomResponse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.16;
    box.connect(room).connect(wet).connect(this.radioBus);
    this.radioBus.connect(this.master);
    this.applyVolumes(0);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, ctx.currentTime + 0.05, 0.9);

    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    await Promise.all(manifest.sfx.map((s) => this.load(s.id)));
    for (const id of LOOPS) {
      const b = this.buffers.get(id);
      if (b) this.loops.set(id, new Loop(ctx, b, this.trainBus));
    }
    window.setInterval(() => this.loops.forEach((l) => l.pump()), 300);
    this.loops.forEach((l) => l.pump());
    if (this.radioOn) this.play();
  }

  /** The echo of a small, furnished room: a short burst of decaying noise to convolve the radio with. */
  private roomResponse(ctx: AudioContext): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * 0.22), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.045)) * (i < 40 ? i / 40 : 1);
    }
    return b;
  }

  private async load(id: string) {
    try {
      const res = await fetch(`${BASE}audio/sfx/${id}.m4a`);
      this.buffers.set(id, await this.ctx!.decodeAudioData(await res.arrayBuffer()));
    } catch {
      // a missing sound is a quiet one
    }
  }

  private applyVolumes(seconds = 0.2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.trainBus.gain.setTargetAtTime(this.volTrain * 1.6, t, seconds / 3 + 0.001);
    this.radioBus.gain.setTargetAtTime(this.volRadio * 1.5, t, seconds / 3 + 0.001);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.08);
  }
  setVolume(which: 'radio' | 'train', v: number) {
    if (which === 'radio') this.volRadio = v;
    else this.volTrain = v;
    this.applyVolumes();
  }
  setMuted(m: boolean) {
    this.muted = m;
    this.applyVolumes();
  }

  /** A short sound, once. `rate` re-pitches it. */
  one(id: string, gain = 1, rate = 1, delay = 0) {
    const ctx = this.ctx, b = this.buffers.get(id);
    if (!ctx || !b) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(id.startsWith('timer') || id === 'radio_tune' ? this.master : this.trainBus);
    src.start(ctx.currentTime + delay);
  }

  /** The bell at the end of a spell of work: the one recorded note, struck twice. And once, lower, when a break ends. */
  chime(kind: 'focus' | 'break') {
    if (kind === 'focus') {
      this.one('timer_focus_end', 0.8, 1, 0);
      this.one('timer_focus_end', 0.7, 1.335, 0.55);
    } else this.one('timer_break_end', 0.8);
  }

  /** What the train is doing now. Call every frame. */
  update(s: Scene, dt: number) {
    const ctx = this.ctx;
    if (!ctx || !this.loops.size) return;
    this.clock += dt;
    const sp = Math.min(1.3, Math.max(0, s.speed / 25));
    const run = sp ** 1.2;
    const rate = 0.9 + 0.1 * sp;
    const open = 1 - s.tunnel;
    const set = (id: LoopId, v: number) => {
      const l = this.loops.get(id);
      if (!l) return;
      l.rate = rate;
      l.set(v * run, ctx);
    };
    set('cabin_loop', (1 - 0.8 * s.tunnel) * (1 - 0.45 * s.bridge));
    set('tunnel_loop', s.tunnel);
    set('bridge_loop', s.bridge * open);
    set('window_wind', (0.1 + 0.8 * s.lean) * open);

    if (s.tunnel > 0.5 && this.wasTunnel <= 0.5) this.one('tunnel_enter', 0.9);
    if (s.tunnel < 0.5 && this.wasTunnel >= 0.5) this.one('tunnel_exit', 0.9);
    this.wasTunnel = s.tunnel;

    // somewhere down the valley, another train
    if (this.clock > this.hornAt) {
      this.hornAt = this.clock + 240 + Math.random() * 420;
      if (s.tunnel < 0.05) this.one('horn_far', 0.5 + Math.random() * 0.4, 0.94 + Math.random() * 0.1);
    }
  }

  // ---- radio

  private shuffle() {
    this.order = this.station.tracks.map((_, i) => i);
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    this.at = 0;
  }

  setStation(id: string, tune = true) {
    const st = this.stations.find((s) => s.id === id) ?? this.stations[0];
    const changed = st !== this.station || !this.order.length;
    this.station = st;
    if (!changed) return;
    this.shuffle();
    if (this.started && this.radioOn) {
      if (tune) this.one('radio_tune', 0.5 * this.volRadio + 0.05);
      // a station is already playing when you find it
      this.play(true);
    } else this.onTrack(this.trackTitle);
  }

  setRadio(on: boolean) {
    this.radioOn = on;
    if (!this.started) return;
    if (on) this.play();
    else if (this.el && this.ctx) {
      this.radioGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
      const el = this.el;
      window.setTimeout(() => !this.radioOn && el.pause(), 600);
    }
  }

  nextTrack() {
    this.at = (this.at + 1) % this.order.length;
    if (this.started && this.radioOn) this.play();
    else this.onTrack(this.trackTitle);
  }

  private play(midway = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.order.length) this.shuffle();
    const track = this.station.tracks[this.order[this.at]];
    if (!this.el) {
      this.el = new window.Audio();
      this.el.crossOrigin = 'anonymous';
      this.el.preload = 'auto';
      ctx.createMediaElementSource(this.el).connect(this.radioGain);
      this.el.addEventListener('ended', () => {
        this.at = (this.at + 1) % this.order.length;
        if (this.radioOn) this.play();
      });
    }
    const el = this.el;
    const src = `${BASE}audio/music/${track.id}.m4a`;
    this.radioGain.gain.cancelScheduledValues(ctx.currentTime);
    this.radioGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    window.setTimeout(() => {
      if (!this.radioOn) return;
      if (!el.src.endsWith(src.replace(/^\.\//, ''))) el.src = src;
      const begin = () => {
        if (midway && Number.isFinite(el.duration)) el.currentTime = el.duration * (0.08 + Math.random() * 0.5);
        el.play().catch(() => {});
        this.radioGain.gain.setTargetAtTime(1, ctx.currentTime + 0.05, 0.35);
      };
      if (midway && !(el.readyState >= 1)) el.addEventListener('loadedmetadata', begin, { once: true });
      else begin();
    }, 180);
    this.onTrack(track.title);
  }
}
