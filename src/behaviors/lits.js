import { Spring } from '../core/spring.js';

/** The intensity an element asks for: `lit="0.6"`, default 1. */
function intensity(el) {
  const v = parseFloat(el.getAttribute('lit'));
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), 2) : 1;
}

/**
 * An element with the `lit` attribute is a surface under a point light: the pointer.
 * The light eases toward the pointer and fades in and out; the shader reads the
 * picture as relief (text, borders and icons emboss and catch a specular). Nothing
 * moves, so input is untouched. On touch the light follows a finger while it is down.
 */
export class Lits {
  constructor(stage) {
    this.stage = stage;
    this.states = new Map();
    this.current = null;
    stage.listen('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.move(e);
    });
    stage.listen('pointermove', (e) => this.move(e));
    stage.listen('pointerup', (e) => {
      if (e.pointerType === 'touch') this.leave();
    });
    stage.listen('pointercancel', () => this.leave());
    stage.listen('pointerleave', (e) => {
      if (e.pointerType !== 'touch') this.leave();
    });
  }

  state(el) {
    let s = this.states.get(el);
    if (!s) {
      const motion = { stiffness: 150, damping: 19, epsilon: 0.05 };
      s = {
        x: new Spring(0, motion),
        y: new Spring(0, motion),
        open: new Spring(0, { stiffness: 120, damping: 22, epsilon: 0.004 }),
        power: 1,
      };
      this.states.set(el, s);
    }
    return s;
  }

  find(target, px, py) {
    const stage = this.stage;
    let el = target?.closest?.('[lit]');
    if (el && !stage.source.contains(el)) el = null;
    if (!el && this.current?.isConnected) {
      const [x, y, w, h] = stage.rectOf(this.current);
      if (px >= x && py >= y && px < x + w && py < y + h) el = this.current;
    }
    return el;
  }

  move(e) {
    const stage = this.stage;
    if (!stage.gpu) return;
    const [px, py] = stage.pointOf(e);
    const el = this.find(e.target, px, py);
    if (el !== this.current) this.leave();
    if (!el) return;
    const s = this.state(el);
    s.power = intensity(el);
    const still = stage.reduced;
    if (still || s.open.target === 0 && s.open.x < 0.02) {
      s.x.snap(px);
      s.y.snap(py);
    } else {
      s.x.set(px);
      s.y.set(py);
    }
    if (still) s.open.snap(1);
    else s.open.set(1);
    this.current = el;
    stage.wake();
  }

  leave() {
    const s = this.current && this.states.get(this.current);
    this.current = null;
    if (!s) return;
    if (this.stage.reduced) s.open.snap(0);
    else s.open.set(0);
    this.stage.wake();
  }

  /** The light now shown, for tests and tools: position, openness, intensity, or null. */
  snapshot() {
    const s = this.current && this.states.get(this.current);
    return s ? { x: s.x.x, y: s.y.x, open: s.open.x, power: s.power } : null;
  }

  step(now, dt) {
    let active = false;
    for (const [el, s] of this.states) {
      const moving = s.x.step(dt) | s.y.step(dt) | s.open.step(dt);
      if (moving) active = true;
      else if (el !== this.current && s.open.target === 0) this.states.delete(el);
    }
    return active;
  }

  emit(scene) {
    const stage = this.stage;
    for (const [el, s] of this.states) {
      if (s.open.x < 0.003 || !stage.visible(el)) continue;
      const rect = stage.rectOf(el);
      if (rect[2] <= 0 || rect[3] <= 0) continue;
      stage.draw('lit', scene, {
        el,
        rect,
        point: [s.x.x, s.y.x],
        open: Math.min(Math.max(s.open.x, 0), 1),
        power: s.power,
        // The light reaches farther over a bigger surface.
        reach: Math.min(Math.max(Math.hypot(rect[2], rect[3]) * 0.55, 200), 300),
      });
    }
  }
}
