import { Spring, clamp01 } from '../core/spring.js';

const TILT_MAX = 0.16; // radians, about nine degrees

/**
 * An element with the `tilt` attribute (a card) turns toward the pointer in
 * perspective, with a glare where the pointer is. Its content stays live: a click
 * lands on what is drawn under the pointer.
 */
export class Tilts {
  constructor(stage) {
    this.stage = stage;
    this.states = new Map();
    this.current = null;
    stage.listen('pointermove', (e) => {
      if (e.pointerType === 'touch' || stage.reduced) return;
      const card = e.target.closest?.('[tilt]');
      if (card !== this.current) this.leave();
      if (!card || !stage.source.contains(card)) return;
      this.current = card;
      const s = this.state(card);
      const [x, y, w, h] = stage.rectOf(card);
      const [px, py] = stage.pointOf(e);
      const nx = clamp01((px - x) / w) * 2 - 1;
      const ny = clamp01((py - y) / h) * 2 - 1;
      s.rx.set(-ny * TILT_MAX);
      s.ry.set(nx * TILT_MAX);
      s.lift.set(1.025);
      s.glare = [px, py];
      stage.wake();
    });
    stage.listen('pointerleave', () => this.leave());
  }
  state(card) {
    let s = this.states.get(card);
    if (!s) {
      const o = { stiffness: 170, damping: 17, epsilon: 0.0005 };
      s = { rx: new Spring(0, o), ry: new Spring(0, o), lift: new Spring(1, o), glare: [0, 0] };
      this.states.set(card, s);
    }
    return s;
  }
  leave() {
    const s = this.current && this.states.get(this.current);
    this.current = null;
    if (!s) return;
    s.rx.set(0);
    s.ry.set(0);
    s.lift.set(1);
    this.stage.wake();
  }
  step(now, dt) {
    let active = false;
    for (const [card, s] of this.states) {
      const moving = s.rx.step(dt) | s.ry.step(dt) | s.lift.step(dt);
      if (moving) active = true;
      else if (card !== this.current && s.lift.x === 1) this.states.delete(card);
    }
    return active;
  }
  emit(scene) {
    for (const [card, s] of this.states) {
      if (!this.stage.visible(card)) continue;
      if (Math.abs(s.rx.x) < 1e-4 && Math.abs(s.ry.x) < 1e-4 && Math.abs(s.lift.x - 1) < 1e-4) continue;
      this.stage.draw('tilt', scene, { el: card, rect: this.stage.rectOf(card), rotX: s.rx.x, rotY: s.ry.x, lift: s.lift.x, glare: s.glare });
    }
  }
}
