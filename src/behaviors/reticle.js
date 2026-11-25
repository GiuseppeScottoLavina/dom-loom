import { RectSpring, Spring } from '../core/spring.js';
import { pad, targetFor } from './util.js';

/** How far inside the stage's edges the reticle keeps its lines (their width and most of their glow). */
const EDGE = 4;

/**
 * What the pointer locks onto: nothing inside reticle="focus" (on the stage, or on any
 * element in it), where the page marks the pointer its own way. Keyboard focus still gets
 * the reticle there: on the GPU path it is the focus indicator.
 */
const hoverTarget = (el, root) => {
  const target = targetFor(el, root);
  return target?.closest('[reticle=focus]') ? null : target;
};

export class Reticle {
  constructor(stage) {
    this.stage = stage;
    this.hover = null;
    this.focus = null;
    this.current = null;
    this.rect = new RectSpring({ stiffness: 420, damping: 25, epsilon: 0.05 });
    this.alpha = new Spring(0, { stiffness: 240, damping: 30, epsilon: 0.003 });
    this.flash = 0;
    this.keyboard = false; // the last input was the keyboard: the reticle follows focus
    const root = stage.source;
    // A skin can keep the reticle on keyboard focus only (reticle: { hover: false }).
    const hovers = () => stage.skin?.reticle?.hover !== false;
    stage.listen('pointerover', (e) => {
      if (e.pointerType === 'touch' || this.keyboard || !hovers()) return;
      this.hover = hoverTarget(e.target, root);
      this.retarget(true);
    });
    stage.listen('pointermove', (e) => {
      if (!this.keyboard || e.pointerType === 'touch') return;
      this.keyboard = false;
      if (!hovers()) return;
      this.hover = hoverTarget(e.target, root);
      this.retarget(true);
    });
    stage.listen('pointerleave', () => {
      this.hover = null;
      this.retarget(false);
    });
    stage.listen('focusin', (e) => {
      const t = targetFor(e.target, root);
      this.focus = t && e.target.matches(':focus-visible') ? t : null;
      this.retarget(false);
    });
    stage.listen('focusout', () => {
      this.focus = null;
      queueMicrotask(() => this.retarget(false));
    });
    stage.listen('keydown', (e) => {
      if (e.key !== 'Tab' && !e.key.startsWith('Arrow')) return;
      // Last input wins, as on a console: keyboard navigation takes the reticle
      // from the pointer until the pointer moves again.
      this.keyboard = true;
      this.hover = null;
      requestAnimationFrame(() => {
        const active = document.activeElement;
        this.focus = active && root.contains(active) ? targetFor(active, root) : null;
        this.retarget(false);
      });
    });
  }
  retarget(byPointer) {
    const next = this.hover ?? this.focus;
    if (next === this.current) return;
    this.current = next;
    if (next) {
      const r = pad(this.stage.rectOf(next), 5);
      if (this.alpha.x < 0.05 || this.stage.reduced) this.rect.snap(this.stage.reduced ? r : pad(r, 14));
      this.rect.set(r);
      this.alpha.set(1);
      this.flash = 1;
      if (byPointer) this.stage.play('hover');
    } else {
      this.alpha.set(0);
    }
    if (this.stage.reduced) this.alpha.snap();
    this.stage.wake();
  }
  step(now, dt) {
    if (this.current?.isConnected) this.rect.set(pad(this.stage.rectOf(this.current), 5));
    const moving = this.rect.step(dt);
    const fading = this.alpha.step(dt);
    this.flash *= Math.exp(-dt * 7);
    if (this.flash < 0.01) this.flash = 0;
    return moving || fading || this.flash > 0;
  }
  emit(scene) {
    if (this.alpha.x < 0.003) return;
    if (this.current && !this.stage.visible(this.current)) {
      this.alpha.set(0);
      this.current = null;
    }
    // Inside the stage: a control at its edge (a link of a bar as tall as the stage) gets its
    // reticle pulled in rather than cut by the canvas.
    const [x, y, w, h] = this.rect.rect;
    const source = this.stage.source;
    const x0 = Math.max(x, EDGE);
    const y0 = Math.max(y, EDGE);
    const x1 = Math.min(x + w, source.offsetWidth - EDGE);
    const y1 = Math.min(y + h, source.offsetHeight - EDGE);
    const rect = [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
    this.stage.draw('reticle', scene, { el: this.current, rect, alpha: this.alpha.x, flash: this.flash });
  }
}
