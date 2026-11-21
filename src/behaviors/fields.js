import { Spring } from '../core/spring.js';
import { CHOICE, TEXTUAL } from './util.js';

export class Fields {
  constructor(stage) {
    this.stage = stage;
    this.states = new Map();
    this.lastError = -1e9;
    const root = stage.source;
    const state = (el) => {
      let s = this.states.get(el);
      if (!s) {
        s = { scanAt: -1e9, under: new Spring(0, { stiffness: 300, damping: 28, epsilon: 0.003 }), pulse: 0, glitchAt: -1e9 };
        this.states.set(el, s);
      }
      return s;
    };
    stage.listen('focusin', (e) => {
      if (!e.target.matches?.(TEXTUAL) || !root.contains(e.target)) return;
      const s = state(e.target);
      s.scanAt = e.timeStamp;
      s.under.set(1);
      if (stage.reduced) s.under.snap();
      stage.play('scan');
      stage.wake();
    });
    stage.listen('focusout', (e) => {
      const s = this.states.get(e.target);
      if (!s) return;
      s.under.set(0);
      if (stage.reduced) s.under.snap();
      stage.wake();
    });
    stage.listen('input', (e) => {
      if (!e.target.matches?.(TEXTUAL)) return;
      state(e.target).pulse = 1;
      stage.wake();
    });
    stage.listen('invalid', (e) => {
      if (!root.contains(e.target)) return;
      const target = e.target.matches(CHOICE) ? (e.target.closest('label') ?? e.target) : e.target;
      state(target).glitchAt = e.timeStamp;
      if (e.timeStamp - this.lastError > 200) stage.play('error');
      this.lastError = e.timeStamp;
      stage.wake();
    }, { capture: true });
  }
  step(now, dt) {
    let active = false;
    for (const [el, s] of this.states) {
      const moving = s.under.step(dt);
      s.pulse *= Math.exp(-dt * 9);
      if (s.pulse < 0.01) s.pulse = 0;
      const { scan, glitch } = this.stage.skin.durations;
      const busy = moving || s.pulse > 0 || now - s.scanAt < scan || now - s.glitchAt < glitch;
      active = busy || active;
      if (!busy && s.under.x < 0.003 && !el.matches(':user-invalid')) this.states.delete(el);
    }
    return active;
  }
  emit(scene, now) {
    for (const [el, s] of this.states) {
      if (!this.stage.visible(el)) continue;
      const rect = this.stage.rectOf(el);
      if (rect[2] < 1) continue;
      const invalid = Boolean(el.matches(':user-invalid') || el.querySelector?.(':user-invalid'));
      this.stage.draw('field', scene, {
        el, rect, scan: now - s.scanAt, focus: s.under.x, typing: s.pulse, invalid, glitch: now - s.glitchAt,
      });
    }
  }
}
