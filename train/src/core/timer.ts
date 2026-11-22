// A pomodoro timer: spells of work with short breaks between, and a longer one after every few.
import { settings } from './settings';

export type Phase = 'focus' | 'rest' | 'long';

export class Timer {
  phase: Phase = 'focus';
  round = 1;
  running = false;
  /** seconds left in this phase */
  left = settings.focus * 60;
  private endAt = 0;
  onChange: () => void = () => {};
  /** a phase ran out by itself */
  onEnd: (finished: Phase) => void = () => {};

  length(p: Phase = this.phase) {
    return (p === 'focus' ? settings.focus : p === 'rest' ? settings.rest : settings.long) * 60;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.endAt = Date.now() + this.left * 1000;
    this.onChange();
  }
  pause() {
    if (!this.running) return;
    this.left = Math.max(0, (this.endAt - Date.now()) / 1000);
    this.running = false;
    this.onChange();
  }
  toggle() {
    if (this.running) this.pause();
    else this.start();
  }
  /** Back to the start of a first spell of work. */
  reset() {
    this.running = false;
    this.phase = 'focus';
    this.round = 1;
    this.left = this.length();
    this.onChange();
  }
  /** On to the next phase now. */
  skip() {
    this.advance();
    this.onChange();
  }
  /** The lengths were changed: a phase that has not begun takes its new length. */
  resize() {
    if (!this.running && Math.abs(this.left - this.length()) > 0.5 && this.fresh) this.left = this.length();
    this.onChange();
  }
  private fresh = true;

  private advance() {
    if (this.phase === 'focus') {
      this.phase = this.round >= settings.rounds ? 'long' : 'rest';
    } else {
      this.round = this.phase === 'long' ? 1 : this.round + 1;
      this.phase = 'focus';
    }
    this.left = this.length();
    this.fresh = true;
    if (this.running) this.endAt = Date.now() + this.left * 1000;
  }

  /** Call often; the clock is the wall's, so a sleeping tab loses no time. */
  tick() {
    if (!this.running) return;
    this.fresh = false;
    const left = (this.endAt - Date.now()) / 1000;
    if (left <= 0) {
      const done = this.phase;
      this.advance();
      this.onEnd(done);
      this.onChange();
      return;
    }
    if (Math.ceil(left) !== Math.ceil(this.left)) {
      this.left = left;
      this.onChange();
    } else this.left = left;
  }

  get text() {
    const s = Math.max(0, Math.ceil(this.left)), m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  get label() {
    return this.phase === 'focus' ? 'Focus' : this.phase === 'rest' ? 'Break' : 'Long break';
  }
}
