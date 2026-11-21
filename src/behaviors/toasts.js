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
    const pause = (e, on) => {
      const toast = e.target.closest?.('[toasts] > *');
      const item = toast && this.items.get(toast);
      if (item && !(e.type === 'pointerout' && toast.contains(e.relatedTarget))) item.paused = on;
    };
    stage.listen('pointerover', (e) => pause(e, true));
    stage.listen('pointerout', (e) => pause(e, false));
    stage.listen('focusin', (e) => pause(e, true));
    stage.listen('focusout', (e) => pause(e, false));
    this.sync();
  }
  sync() {
    for (const region of this.stage.source.querySelectorAll('[toasts]')) {
      if (!region.hasAttribute('aria-live')) region.setAttribute('aria-live', 'polite');
      for (const toast of region.children) {
        if (this.items.has(toast)) continue;
        if (!toast.hasAttribute('removable')) toast.setAttribute('removable', '');
        const ms = parseMs(toast.dataset.timeout ?? region.dataset.timeout, 5000);
        this.items.set(toast, { ms, elapsed: 0, paused: false, leaving: false });
      }
    }
    for (const toast of this.items.keys()) if (!toast.isConnected) this.items.delete(toast);
    this.stage.wake();
  }
  step(now, dt) {
    for (const [toast, item] of this.items) {
      if (!toast.isConnected) {
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
          if (toast.dispatchEvent(new CustomEvent('loom-remove', { bubbles: true, cancelable: true }))) this.stage.discard(toast);
        });
      }
    }
    // A toast counts down on screen: it needs frames while it is there.
    return this.items.size > 0;
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
