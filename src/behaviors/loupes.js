import { Spring, clamp01 } from '../core/spring.js';

const RADIUS = 104; // CSS px
const HOLD_MS = 300; // a touch must rest this long before the glass shows
const SLOP = 10; // px a finger may drift during that time
const LIFT = 36; // px between a finger and the glass held above it
const SUPPRESS_MS = 700; // a click right after a peek is not a tap

/** The magnification an element asks for: `loupe="3"`, default 2. */
function magnification(el) {
  const m = parseFloat(el.getAttribute('loupe'));
  return Number.isFinite(m) ? Math.min(Math.max(m, 1.2), 8) : 2;
}

/**
 * An element with the `loupe` attribute gets a magnifying glass while the pointer is
 * over it: it follows the pointer with a slight spring lag and fades in and out. The
 * picture inside is really magnified, so the stage maps a press in the glass to the
 * element that is shown there. On touch, resting a finger for a moment shows the glass
 * above it, looking at what the finger covers; a plain tap is left alone.
 */
export class Loupes {
  constructor(stage) {
    this.stage = stage;
    this.states = new Map();
    this.current = null;
    this.hold = null; // a finger resting: { id, el, client: [x, y], at: [x, y], timer }
    this.touchId = null; // the finger whose glass is shown
    this.suppressUntil = 0;
    stage.listen('pointermove', (e) => this.move(e));
    stage.listen('pointerdown', (e) => this.down(e));
    stage.listen('pointerup', (e) => this.up(e));
    stage.listen('pointercancel', (e) => this.up(e));
    stage.listen('pointerleave', (e) => {
      if (e.pointerType !== 'touch') this.leave();
    });
    // While the glass is shown above a finger, moving the finger is not a scroll.
    stage.listen('touchmove', (e) => {
      if (this.touchId !== null && e.cancelable) e.preventDefault();
    }, { passive: false });
    stage.listen('contextmenu', (e) => {
      if (this.hold || this.touchId !== null) e.preventDefault();
    });
    stage.listen('click', (e) => {
      if (performance.now() < this.suppressUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, { capture: true });
  }

  state(el) {
    let s = this.states.get(el);
    if (!s) {
      s = {
        x: new Spring(0, { stiffness: 380, damping: 32, epsilon: 0.04 }),
        y: new Spring(0, { stiffness: 380, damping: 32, epsilon: 0.04 }),
        open: new Spring(0, { stiffness: 260, damping: 26, epsilon: 0.004 }),
        focus: [0, 0],
        mag: 2,
      };
      this.states.set(el, s);
    }
    return s;
  }

  /** The element with a loupe under a point (its stage coordinates), if any. */
  find(target, px, py) {
    const stage = this.stage;
    let el = target?.closest?.('[loupe]');
    if (el && !stage.source.contains(el)) el = null;
    if (!el && this.current?.isConnected) {
      // The target can be a gap or the canvas: stay on the element while the pointer is over it.
      const [x, y, w, h] = stage.rectOf(this.current);
      if (px >= x && py >= y && px < x + w && py < y + h) el = this.current;
    }
    return el;
  }

  /** Puts the glass of `el` at a point: the pointer's, or above a finger. */
  place(el, px, py, touch) {
    const stage = this.stage;
    const s = this.state(el);
    const wasShown = s.open.target > 0;
    s.mag = magnification(el);
    let cx = px;
    let cy = py;
    s.focus = [0, 0];
    if (touch) {
      const [, , sw] = stage.rectOf(stage.source);
      cx = Math.min(Math.max(px, RADIUS * 0.6), Math.max(sw - RADIUS * 0.6, RADIUS * 0.6));
      cy = py - RADIUS - LIFT;
      if (cy - RADIUS < 4) cy = py + RADIUS + LIFT;
      s.focus = [px - cx, py - cy];
    }
    const still = stage.reduced;
    if (still || !wasShown || s.open.x < 0.02) {
      s.x.snap(cx);
      s.y.snap(cy);
    } else {
      s.x.set(cx);
      s.y.set(cy);
    }
    if (still) s.open.snap(1);
    else s.open.set(1);
    this.current = el;
    stage.wake();
  }

  move(e) {
    const stage = this.stage;
    if (!stage.gpu) return;
    const [px, py] = stage.pointOf(e);
    if (e.pointerType === 'touch') {
      const hold = this.hold;
      if (hold?.id === e.pointerId) {
        hold.at = [px, py];
        if (Math.hypot(e.clientX - hold.client[0], e.clientY - hold.client[1]) > SLOP) this.cancelHold();
      } else if (this.touchId === e.pointerId && this.current) {
        this.place(this.current, px, py, true);
      }
      return;
    }
    const el = this.find(e.target, px, py);
    if (el !== this.current) this.leave();
    if (el) this.place(el, px, py, false);
  }

  down(e) {
    if (e.pointerType !== 'touch' || !this.stage.gpu || e.isPrimary === false) return;
    this.cancelHold();
    const el = e.target?.closest?.('[loupe]');
    if (!el || !this.stage.source.contains(el)) return;
    const hold = { id: e.pointerId, el, client: [e.clientX, e.clientY], at: this.stage.pointOf(e), timer: 0 };
    hold.timer = setTimeout(() => {
      if (this.hold !== hold) return;
      this.hold = null;
      if (!this.stage.isConnected || !this.stage.gpu || !this.stage.visible(el)) return;
      this.touchId = hold.id;
      this.place(el, hold.at[0], hold.at[1], true);
    }, HOLD_MS);
    this.hold = hold;
  }

  up(e) {
    if (e.pointerType !== 'touch') return;
    if (this.hold?.id === e.pointerId) this.cancelHold();
    if (this.touchId === e.pointerId) {
      this.touchId = null;
      // The finger only looked: lifting it is not a tap on what it covered.
      if (e.type === 'pointerup') this.suppressUntil = performance.now() + SUPPRESS_MS;
      this.leave();
    }
  }

  cancelHold() {
    if (this.hold) clearTimeout(this.hold.timer);
    this.hold = null;
  }

  leave() {
    const s = this.current && this.states.get(this.current);
    this.current = null;
    if (!s) return;
    if (this.stage.reduced) s.open.snap(0);
    else s.open.set(0);
    this.stage.wake();
  }

  /** The glass now shown, for tests and tools: centre, focus offset, openness, or null. */
  snapshot() {
    const s = this.current && this.states.get(this.current);
    if (!s) return null;
    return { x: s.x.x, y: s.y.x, open: s.open.x, focus: [...s.focus], mag: s.mag, touch: this.touchId !== null };
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
      const open = Math.min(Math.max(s.open.x, 0), 1.06);
      const radius = RADIUS * (0.55 + 0.45 * clamp01(open));
      const [cx, cy] = [s.x.x, s.y.x];
      const pad = radius + 34;
      stage.draw('loupe', scene, {
        el,
        rect: [cx - pad, cy - pad, pad * 2, pad * 2],
        center: [cx, cy],
        focus: s.focus,
        radius,
        mag: s.mag,
        open,
        // The reticle ring turns as the glass travels.
        phase: (cx + cy * 0.6) / RADIUS * 0.9,
      });
    }
  }
}
