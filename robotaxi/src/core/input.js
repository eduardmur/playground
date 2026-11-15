// Pointer look, wheel zoom and keys. The game reads the accumulated motion once a frame.
export class Input {
  constructor(el) {
    this.el = el;
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.recenter = false;
    this.dragging = false;
    this.onKey = null;
    this.onTap = null;
    let id = null, moved = 0, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      id = e.pointerId;
      moved = 0;
      lx = e.clientX;
      ly = e.clientY;
      this.dragging = true;
      el.setPointerCapture?.(id);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging || e.pointerId !== id) return;
      const mx = e.clientX - lx, my = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      this.dx += mx;
      this.dy += my;
      moved += Math.abs(mx) + Math.abs(my);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      this.dragging = false;
      id = null;
      if (moved < 5) this.onTap?.(e);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => (this.recenter = true));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += e.deltaY;
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.type !== 'range') return;
      if (this.onKey?.(e.code, e)) e.preventDefault();
    });
  }

  consume() {
    const r = { dx: this.dx, dy: this.dy, wheel: this.wheel, recenter: this.recenter };
    this.dx = this.dy = this.wheel = 0;
    this.recenter = false;
    return r;
  }
}
