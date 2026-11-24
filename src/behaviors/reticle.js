import { RectSpring, Spring } from '../core/spring.js';
import { pad, targetFor } from './util.js';

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
      this.hover = targetFor(e.target, root);
      this.retarget(true);
    });
    stage.listen('pointermove', (e) => {
      if (!this.keyboard || e.pointerType === 'touch') return;
      this.keyboard = false;
      if (!hovers()) return;
      this.hover = targetFor(e.target, root);
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
    this.stage.draw('reticle', scene, { el: this.current, rect: this.rect.rect, alpha: this.alpha.x, flash: this.flash });
  }
}
