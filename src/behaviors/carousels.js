import { Spring } from '../core/spring.js';

/**
 * A scroll container with the `carousel` attribute: the mouse can drag it, buttons
 * with aria-controls pointing at it and data-step="1" / "-1" move it a slide, and
 * while it moves it curves like film, the more the faster.
 */
export class Carousels {
  constructor(stage) {
    this.stage = stage;
    this.states = new Map();
    this.drag = null;
    const root = stage.source;
    const state = (el) => {
      let s = this.states.get(el);
      if (!s) {
        s = { speed: new Spring(0, { stiffness: 120, damping: 18, epsilon: 0.002 }), last: el.scrollLeft, at: performance.now() };
        this.states.set(el, s);
      }
      return s;
    };
    stage.listen('scroll', (e) => {
      const el = e.target;
      if (!el.matches?.('[carousel]') || !root.contains(el)) return;
      const s = state(el);
      const now = performance.now();
      const dt = Math.max(now - s.at, 8);
      const v = (el.scrollLeft - s.last) / dt;
      s.last = el.scrollLeft;
      s.at = now;
      s.speed.set(Math.max(-4, Math.min(4, v)));
      stage.wake();
    }, { capture: true });
    stage.listen('pointerdown', (e) => {
      const el = e.target.closest?.('[carousel]');
      if (!el || e.pointerType !== 'mouse' || e.button !== 0 || !root.contains(el)) return;
      this.drag = { el, pointerId: e.pointerId, x: e.clientX, scroll: el.scrollLeft, moved: false };
    });
    stage.listenGlobal('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.pointerId !== e.pointerId || !root.contains(d.el)) return;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 5) return;
      if (!d.moved) {
        d.moved = true;
        d.el.toggleAttribute('data-dragging', true);
        // Snapping would fight the hand; it comes back on release.
        d.el.style.scrollSnapType = 'none';
        d.el.style.scrollBehavior = 'auto';
      }
      d.el.scrollLeft = d.scroll - dx;
    });
    const release = (event) => {
      const d = this.drag;
      if (!d || (event.type !== 'blur' && d.pointerId !== event.pointerId)) return;
      this.drag = null;
      if (!d?.moved) return;
      d.el.removeAttribute('data-dragging');
      d.el.style.scrollBehavior = '';
      const left = d.el.scrollLeft;
      d.el.style.scrollSnapType = '';
      // Re-enabling snapping jumps; glide to the slide it would have snapped to.
      const target = d.el.scrollLeft;
      d.el.scrollLeft = left;
      d.el.scrollTo({ left: target, behavior: stage.reduced ? 'auto' : 'smooth' });
      // A drag is not a click on the slide under the pointer.
      const swallow = (e) => e.stopPropagation();
      stage.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => stage.removeEventListener('click', swallow, { capture: true }));
    };
    stage.listenGlobal('pointerup', release);
    stage.listenGlobal('pointercancel', release);
    stage.listenGlobal('blur', release);
    stage.listen('click', (e) => {
      const button = e.target.closest?.('button[data-step][aria-controls]');
      if (!button || !root.contains(button)) return;
      const el = root.querySelector(`#${CSS.escape(button.getAttribute('aria-controls'))}`);
      if (!el?.matches('[carousel]')) return;
      const slide = el.firstElementChild;
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const by = (slide ? slide.getBoundingClientRect().width + gap : el.clientWidth) * (Number(button.dataset.step) || 1);
      el.scrollBy({ left: by, behavior: stage.reduced ? 'auto' : 'smooth' });
      stage.play('swipe');
    });
  }
  step(now, dt) {
    let active = false;
    const t = performance.now();
    for (const [el, s] of this.states) {
      if (!this.stage.source.contains(el) || !el.hasAttribute('carousel')) {
        this.states.delete(el);
        continue;
      }
      // No scroll for a moment: it has stopped.
      if (t - s.at > 70) s.speed.set(0);
      if (s.speed.step(dt) || Math.abs(s.speed.x) > 0.002) active = true;
    }
    return active;
  }
  emit(scene) {
    for (const [el, s] of this.states) {
      if (!this.stage.visible(el) || Math.abs(s.speed.x) < 0.002) continue;
      this.stage.draw('bend', scene, { el, rect: this.stage.rectOf(el), speed: s.speed.x });
    }
  }
}
