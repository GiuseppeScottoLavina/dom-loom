import { RectSpring, Spring } from '../core/spring.js';

/**
 * aria-current: the current page of a pagination, the place in a breadcrumb, the
 * step of a stepper. When it moves to another item of the same list, the marker
 * stretches over to it.
 */
export class Currents {
  constructor(stage) {
    this.stage = stage;
    this.lists = new Map();
    this.sync();
  }
  listOf(el) {
    return el.closest('ol, ul, nav, [role=list]') ?? el.parentElement;
  }
  sync() {
    const seen = new Set();
    for (const el of this.stage.source.querySelectorAll('[aria-current]:not([aria-current=false])')) {
      const list = this.listOf(el);
      if (!list || seen.has(list)) continue;
      seen.add(list);
      let state = this.lists.get(list);
      if (!state) {
        state = {
          current: null,
          rect: new RectSpring({ stiffness: 480, damping: 30, epsilon: 0.05 }),
          alpha: new Spring(0, { stiffness: 300, damping: 30, epsilon: 0.003 }),
        };
        this.lists.set(list, state);
      }
      if (el === state.current) continue;
      const to = this.stage.rectOf(el);
      if (state.current && state.alpha.x > 0.05 && !this.stage.reduced) {
        const from = state.rect.rect;
        const forward = to[0] + to[1] >= from[0] + from[1];
        const fast = { stiffness: 1000, damping: 30 };
        const slow = { stiffness: 230, damping: 19 };
        for (const [edge, lead] of [['l', !forward], ['t', !forward], ['r', forward], ['b', forward]]) {
          Object.assign(state.rect[edge], lead ? fast : slow);
        }
        this.stage.play('select');
      } else state.rect.snap(to);
      state.rect.set(to);
      state.alpha.set(1);
      state.current = el;
    }
    for (const [list, state] of this.lists) {
      if (seen.has(list)) continue;
      state.alpha.set(0);
      if (state.alpha.x < 0.003) this.lists.delete(list);
    }
    this.stage.wake();
  }
  step(now, dt) {
    let active = false;
    for (const state of this.lists.values()) {
      if (state.current?.isConnected && state.alpha.target > 0) state.rect.set(this.stage.rectOf(state.current));
      active = state.rect.step(dt) | state.alpha.step(dt) || active;
    }
    return active;
  }
  emit(scene) {
    for (const [list, state] of this.lists) {
      if (state.alpha.x < 0.003 || !this.stage.visible(state.current)) continue;
      const items = [...list.children].filter((c) => this.stage.visible(c));
      const item = items.find((c) => c === state.current || c.contains(state.current));
      this.stage.draw('current', scene, {
        el: state.current,
        list,
        value: state.current.getAttribute('aria-current'),
        rect: state.rect.rect,
        alpha: state.alpha.x,
        motion: state.rect,
        items: items.map((c) => this.stage.rectOf(c)),
        index: items.indexOf(item),
      });
    }
  }
}
