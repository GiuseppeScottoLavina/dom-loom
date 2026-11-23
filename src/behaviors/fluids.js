import { FluidSim } from './fluid-sim.js';

const SELECTOR = '[fluid]';

/** The strength of a [fluid] element: its value, 1 when empty. */
export function strengthOf(el) {
  const raw = el.getAttribute('fluid');
  if (raw === null || raw.trim() === '') return 1;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), 3) : 1;
}

/**
 * An element with the `fluid` attribute is water: the pointer stirs its content like a
 * finger through water, and it swirls, wobbles and settles. The stirring is a small fluid
 * on the stage's displacement grid (fluid-sim.js); the picture is moved on the GPU and the
 * live content stays live: a click lands on what is shown under the pointer.
 * `fluid="0.5"` is the strength.
 */
export class Fluids {
  constructor(stage) {
    this.stage = stage;
    this.sim = new FluidSim(stage.field.cols, stage.field.rows, stage.field.data);
    this.fingers = new Map();
    this.owned = false; // this behaviour switched the field on
    stage.listen('pointermove', (e) => this.stir(e));
    const lift = (e) => this.fingers.delete(e.pointerId);
    stage.listen('pointerleave', lift);
    stage.listen('pointerup', lift);
    stage.listen('pointercancel', lift);
  }

  elements() {
    return [...this.stage.source.querySelectorAll(SELECTOR)].filter((el) => this.stage.visible(el));
  }

  stir(e) {
    const stage = this.stage;
    if (stage.reduced || !stage.gpu) return;
    const els = this.elements();
    if (!els.length) return;
    const canvas = stage.querySelector(':scope > canvas') ?? stage.source;
    const box = canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    const rects = els.filter((el) => strengthOf(el) > 0).map((el) => stage.rectOf(el));
    const events = e.getCoalescedEvents?.() ?? [];
    let stirred = false;
    for (const ev of events.length ? events : [e]) {
      const x = ev.clientX - box.left;
      const y = ev.clientY - box.top;
      if (!rects.some(([rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh)) {
        this.fingers.delete(e.pointerId);
        continue;
      }
      const last = this.fingers.get(e.pointerId);
      const t = ev.timeStamp;
      if (!last || t - last.t > 150) {
        this.fingers.set(e.pointerId, { x, y, t, vx: 0, vy: 0 });
        continue;
      }
      const dt = Math.max(t - last.t, 4) / 1000;
      const vx = last.vx * 0.4 + ((x - last.x) / dt) * 0.6;
      const vy = last.vy * 0.4 + ((y - last.y) / dt) * 0.6;
      this.fingers.set(e.pointerId, { x, y, t, vx, vy });
      if (Math.hypot(vx, vy) < 12) continue;
      this.sim.resize(box.width, box.height);
      this.sim.splat(x, y, vx, vy);
      stirred = true;
    }
    if (stirred) {
      this.owned = true;
      stage.field.active = true;
      stage.field.changed();
    }
  }

  step(now, dt) {
    if (!this.owned) return false;
    if (this.stage.reduced || !this.stage.gpu) return this.rest();
    this.sim.step(dt || 1 / 60);
    if (this.sim.resting) return this.rest();
    this.stage.field.changed();
    return true;
  }

  /** Back at rest: the field is zero and off, and no frames are needed. */
  rest() {
    this.sim.reset();
    this.fingers.clear();
    if (this.owned) {
      this.owned = false;
      this.stage.field.active = false;
      this.stage.field.changed();
    }
    return false;
  }

  emit(scene) {
    if (!this.owned || !this.stage.field.active) return;
    for (const el of this.elements()) {
      const strength = strengthOf(el);
      if (strength > 0) this.stage.draw('fluid', scene, { el, rect: this.stage.rectOf(el), strength });
    }
  }
}
