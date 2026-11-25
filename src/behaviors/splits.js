import { Spring } from '../core/spring.js';
import { wordFor } from '../core/strings.js';

let splitIds = 0;

/**
 * An element with the `split` attribute holding a pane, an <hr> and a pane: the <hr>
 * is a window splitter (focusable, arrow keys, Home and End, aria-valuenow in %),
 * with aria-valuemin and aria-valuemax as limits. Dragged past a limit, the panes
 * stretch like rubber and spring back.
 */
export class Splits {
  constructor(stage) {
    this.stage = stage;
    this.states = new Map();
    this.drag = null;
    const root = stage.source;
    stage.listen('pointerdown', (e) => {
      const hr = e.target.closest?.('[split] > hr');
      if (!hr || e.button !== 0 || this.drag || !root.contains(hr)) return;
      if (!this.states.has(hr.parentElement)) this.sync();
      e.preventDefault();
      hr.focus({ preventScroll: true });
      this.drag = { el: hr.parentElement, pointerId: e.pointerId };
      this.stage.play('press');
    });
    stage.listenGlobal('pointermove', (e) => {
      if (!this.drag || this.drag.pointerId !== e.pointerId) return;
      const { el } = this.drag;
      const s = this.states.get(el);
      if (!s || !root.contains(el)) return;
      const [x, , w] = stage.rectOf(el);
      if (!w) return;
      this.moveTo(el, ((stage.pointOf(e)[0] - x) / w) * 100, true);
      s.dragging = true;
    });
    const release = (e) => {
      if (!this.drag || (e.type !== 'blur' && this.drag.pointerId !== e.pointerId)) return;
      const s = this.states.get(this.drag.el);
      this.drag = null;
      if (!s) return;
      s.dragging = false;
      s.raw = s.value;
      stage.wake();
    };
    stage.listenGlobal('pointerup', release);
    stage.listenGlobal('pointercancel', release);
    stage.listenGlobal('blur', release);
    stage.listen('keydown', (e) => {
      const hr = e.target.closest?.('[split] > hr');
      if (!hr || !root.contains(hr)) return;
      if (!this.states.has(hr.parentElement)) this.sync();
      const s = this.states.get(hr.parentElement);
      const by = { ArrowLeft: -2, ArrowRight: 2, ArrowUp: 2, ArrowDown: -2 }[e.key];
      if (by) this.moveTo(hr.parentElement, s.value + by, false);
      else if (e.key === 'Home') this.moveTo(hr.parentElement, s.min, false);
      else if (e.key === 'End') this.moveTo(hr.parentElement, s.max, false);
      else return;
      e.preventDefault();
    });
    this.sync();
  }
  sync() {
    for (const el of this.stage.source.querySelectorAll('[split]')) {
      const hr = el.querySelector(':scope > hr');
      if (!hr || this.states.get(el)?.hr === hr) continue;
      const first = hr.previousElementSibling;
      if (first && !first.id) first.id = `loom-pane-${++splitIds}`;
      const min = Number(hr.getAttribute('aria-valuemin') ?? 10);
      const max = Number(hr.getAttribute('aria-valuemax') ?? 90);
      const value = Number(hr.getAttribute('aria-valuenow') ?? 50);
      hr.tabIndex = 0;
      hr.setAttribute('aria-orientation', 'vertical');
      hr.setAttribute('aria-valuemin', String(min));
      hr.setAttribute('aria-valuemax', String(max));
      if (first) hr.setAttribute('aria-controls', first.id);
      if (!hr.hasAttribute('aria-label')) hr.setAttribute('aria-label', wordFor(hr, 'resizePanes'));
      const s = { hr, min, max, value, raw: value, dragging: false, shown: new Spring(0, { stiffness: 260, damping: 15, epsilon: 0.05 }) };
      this.states.set(el, s);
      this.apply(el, value);
    }
  }
  apply(el, value) {
    const s = this.states.get(el);
    s.value = value;
    el.style.setProperty('--loom-split', `${value}%`);
    s.hr.setAttribute('aria-valuenow', String(Math.round(value)));
  }
  moveTo(el, raw, byPointer) {
    const s = this.states.get(el);
    const value = Math.min(s.max, Math.max(s.min, raw));
    s.raw = byPointer ? raw : value;
    if (Math.abs(value - s.value) > 0.01) this.apply(el, value);
    else if (byPointer && raw !== value && !s.limit) this.stage.play('error');
    s.limit = raw !== value;
    this.stage.wake();
  }
  step(now, dt) {
    let active = false;
    for (const [el, s] of this.states) {
      if (!this.stage.source.contains(el) || !el.hasAttribute('split') || s.hr.parentElement !== el) {
        if (this.drag?.el === el) this.drag = null;
        this.states.delete(el);
        continue;
      }
      const w = this.stage.rectOf(el)[2];
      const laid = this.laid(s);
      // Past a limit the hand still pulls, against growing resistance.
      const over = s.raw - s.value;
      const target = laid + (Math.sign(over) * Math.min(Math.abs(over), 40) * 0.45 * w) / 100;
      if (Math.abs(s.shown.target - target) > 0.01) s.shown.set(target);
      if (s.shown.x === 0 && s.shown.target === target && !s.seen) {
        s.shown.snap(target);
        s.seen = true;
      }
      if (this.stage.reduced) s.shown.snap(target);
      if (s.shown.step(dt)) active = true;
    }
    return active;
  }
  laid(s) {
    const r = this.stage.rectOf(s.hr);
    return r[0] + r[2] / 2;
  }
  emit(scene) {
    for (const [el, s] of this.states) {
      if (!this.stage.visible(el)) continue;
      const laid = this.laid(s);
      const shown = s.shown.x || laid;
      this.stage.draw('split', scene, {
        el, rect: this.stage.rectOf(el), laid, shown, dragging: Boolean(s.dragging), focused: s.hr.matches(':focus-visible'),
      });
    }
  }
}
