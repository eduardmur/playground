/**
 * Keyboard, mouse and touch input.
 * - `move`: x = strafe right, y = forward, both in [-1, 1]
 * - `hit(code)`: true once on the frame a key went down
 * - drag deltas for orbiting the camera, wheel for zoom
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.move = { x: 0, y: 0 };
    this.run = false;
    this.dragX = 0;
    this.dragY = 0;
    this.wheel = 0;
    this.dragging = false;
    this.enabled = true;
    this.lastInputAt = performance.now();
    this.touch = { stickId: null, camId: null, ox: 0, oy: 0, x: 0, y: 0, active: false };
    this.isTouch = false;
    this.onStick = null; // (active, ox, oy, x, y) for drawing the on-screen stick

    const block = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (block.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.lastInputAt = performance.now();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.dragging = false;
    });

    const pointers = new Map();
    canvas.addEventListener('pointerdown', (e) => {
      this.lastInputAt = performance.now();
      canvas.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.pointerType === 'touch') {
        this.isTouch = true;
        const t = this.touch;
        if (e.clientX < window.innerWidth * 0.45 && t.stickId === null) {
          t.stickId = e.pointerId;
          t.ox = t.x = e.clientX;
          t.oy = t.y = e.clientY;
          t.active = true;
          this.onStick?.(true, t.ox, t.oy, t.x, t.y);
        } else if (t.camId === null) {
          t.camId = e.pointerId;
        }
      } else {
        this.dragging = true;
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (e.pointerType === 'touch') {
        const t = this.touch;
        if (e.pointerId === t.stickId) {
          t.x = e.clientX;
          t.y = e.clientY;
          this.onStick?.(true, t.ox, t.oy, t.x, t.y);
        } else if (e.pointerId === t.camId) {
          this.dragX += dx;
          this.dragY += dy;
        }
      } else if (this.dragging) {
        this.dragX += dx;
        this.dragY += dy;
      }
      this.lastInputAt = performance.now();
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      const t = this.touch;
      if (e.pointerId === t.stickId) {
        t.stickId = null;
        t.active = false;
        this.onStick?.(false, 0, 0, 0, 0);
      }
      if (e.pointerId === t.camId) t.camId = null;
      if (e.pointerType !== 'touch') this.dragging = false;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += e.deltaY;
      this.lastInputAt = performance.now();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  down(code) {
    return this.keys.has(code);
  }

  /** True once per key press. */
  hit(code) {
    return this.pressed.has(code);
  }

  /** Queue a virtual key press (used by on-screen buttons). */
  tap(code) {
    this.pressed.add(code);
    this.lastInputAt = performance.now();
  }

  update() {
    let x = 0, y = 0;
    if (this.enabled) {
      if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
      if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
      if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
      if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    }
    let run = this.down('ShiftLeft') || this.down('ShiftRight');
    const t = this.touch;
    if (t.active && this.enabled) {
      const R = 56;
      const dx = (t.x - t.ox) / R, dy = (t.y - t.oy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 0.12) {
        const k = Math.min(l, 1) / l;
        x = dx * k;
        y = -dy * k;
        if (l > 1.25) run = true;
      }
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    this.move.x = x;
    this.move.y = y;
    this.run = run;
    if (l > 0.01) this.lastInputAt = performance.now();
  }

  endFrame() {
    this.pressed.clear();
    this.dragX = 0;
    this.dragY = 0;
    this.wheel = 0;
  }

  idleSeconds() {
    return (performance.now() - this.lastInputAt) / 1000;
  }
}
