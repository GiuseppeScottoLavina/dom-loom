import { clamp01 } from '../core/spring.js';
import { parseMs } from './util.js';

/**
 * The children of an element with the `toasts` attribute are toasts: they assemble
 * when they arrive, count down (`data-timeout`, ms or s, on the toast or the region;
 * 5 s by default), pause while pointed at or focused, and crumble when the time is up
 * or when dismissed. The region is a polite live region.
 */
export class Toasts {
  constructor(stage) {
    this.stage = stage;
    this.items = new Map();
    const pause = (e, reason, on) => {
      const toast = e.target.closest?.('[toasts] > *');
      const item = toast && this.items.get(toast);
      if (!item || (e.relatedTarget?.nodeType && toast.contains(e.relatedTarget))) return;
      item[reason] = on;
      const paused = item.hovered || item.focused;
      if (paused === item.paused) return;
      item.paused = paused;
      stage.wake();
    };
    stage.listen('pointerover', (e) => pause(e, 'hovered', true));
    stage.listen('pointerout', (e) => pause(e, 'hovered', false));
    stage.listen('focusin', (e) => pause(e, 'focused', true));
    stage.listen('focusout', (e) => pause(e, 'focused', false));
    this.sync();
  }
  sync() {
    for (const region of this.stage.source.querySelectorAll('[toasts]')) {
      if (!region.hasAttribute('aria-live')) region.setAttribute('aria-live', 'polite');
      for (const toast of region.children) {
        if (this.items.has(toast)) continue;
        if (!toast.hasAttribute('removable')) toast.setAttribute('removable', '');
        const ms = parseMs(toast.dataset.timeout ?? region.dataset.timeout, 5000);
        const focused = toast.contains(toast.ownerDocument.activeElement);
        const hovered = toast.matches(':hover');
        this.items.set(toast, { ms, elapsed: 0, hovered, focused, paused: hovered || focused, leaving: false });
      }
    }
    for (const toast of this.items.keys()) if (!this.owns(toast)) this.items.delete(toast);
    this.stage.wake();
  }
  owns(toast) {
    return this.stage.source.contains(toast) && toast.parentElement?.hasAttribute('toasts');
  }
  step(now, dt) {
    let running = false;
    for (const [toast, item] of this.items) {
      if (!this.owns(toast)) {
        this.items.delete(toast);
        continue;
      }
      if (item.paused || item.leaving) continue;
      item.elapsed += dt * 1000;
      if (item.elapsed >= item.ms) {
        item.leaving = true;
        // Outside the frame callback: removing starts a transition that measures the page.
        // `loom-remove` first: a framework that owns the toast removes it itself.
        setTimeout(() => {
          if (this.owns(toast) && toast.dispatchEvent(new CustomEvent('loom-remove', { bubbles: true, cancelable: true }))) this.stage.discard(toast);
        });
      } else running = true;
    }
    // A toast counts down on screen: it needs frames while it is there.
    return running;
  }
  emit(scene) {
    for (const [toast, item] of this.items) {
      if (!this.stage.visible(toast)) continue;
      this.stage.draw('toast', scene, {
        el: toast, rect: this.stage.rectOf(toast), left: clamp01(1 - item.elapsed / item.ms), paused: item.paused, tone: toast.dataset.tone ?? null,
      });
    }
  }
}
