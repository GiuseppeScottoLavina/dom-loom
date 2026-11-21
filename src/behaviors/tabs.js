import { RectSpring, Spring } from '../core/spring.js';

/**
 * The ARIA tabs pattern ([role=tablist] > [role=tab][aria-controls] and
 * [role=tabpanel]) made to work: click and arrow keys select, panels are shown with
 * `hidden`, and the panel change is a cut that runs the way you moved.
 */
export class Tabs {
  constructor(stage) {
    this.stage = stage;
    this.lists = new Map();
    const root = stage.source;
    stage.listen('click', (e) => {
      const tab = e.target.closest?.('[role=tab]');
      if (tab && root.contains(tab) && !this.disabled(tab)) this.select(tab);
    });
    stage.listen('keydown', (e) => {
      const tab = e.target.closest?.('[role=tab]');
      if (!tab || !root.contains(tab)) return;
      const list = tab.closest('[role=tablist]');
      const tabs = this.tabsOf(list).filter((t) => !this.disabled(t));
      const vertical = list.getAttribute('aria-orientation') === 'vertical';
      const i = tabs.indexOf(tab);
      const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
      let next = null;
      if (e.key === keys[0]) next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === keys[1]) next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      next.focus();
      this.select(next);
    });
    this.sync();
  }
  disabled(tab) {
    return tab.disabled || tab.getAttribute('aria-disabled') === 'true';
  }
  tabsOf(list) {
    return [...list.querySelectorAll('[role=tab]')].filter((t) => t.closest('[role=tablist]') === list);
  }
  panelOf(tab) {
    const id = tab.getAttribute('aria-controls');
    return id ? this.stage.source.querySelector(`#${CSS.escape(id)}`) : null;
  }
  selectedOf(tabs) {
    return tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs.find((t) => !this.disabled(t)) ?? null;
  }
  apply(tabs, selected) {
    for (const tab of tabs) {
      const on = tab === selected;
      if (tab.getAttribute('aria-selected') !== String(on)) tab.setAttribute('aria-selected', String(on));
      // Only real changes: every write to the DOM makes the stage capture it again.
      if (tab.tabIndex !== (on ? 0 : -1)) tab.tabIndex = on ? 0 : -1;
      const panel = this.panelOf(tab);
      if (panel && panel.hidden === on) panel.hidden = !on;
    }
  }
  sync() {
    const seen = new Set();
    for (const list of this.stage.source.querySelectorAll('[role=tablist]')) {
      seen.add(list);
      const tabs = this.tabsOf(list);
      const selected = this.selectedOf(tabs);
      this.apply(tabs, selected);
      let state = this.lists.get(list);
      if (!state) {
        state = {
          current: null,
          rect: new RectSpring({ stiffness: 500, damping: 30, epsilon: 0.05 }),
          alpha: new Spring(0, { stiffness: 300, damping: 30, epsilon: 0.003 }),
        };
        this.lists.set(list, state);
      }
      if (selected && selected !== state.current) this.indicate(state, selected, false);
    }
    for (const list of this.lists.keys()) if (!seen.has(list)) this.lists.delete(list);
    this.stage.wake();
  }
  indicate(state, tab, stretch) {
    const to = this.stage.rectOf(tab);
    if (stretch) {
      const from = state.rect.rect;
      const right = to[0] >= from[0];
      const fast = { stiffness: 1100, damping: 30 };
      const slow = { stiffness: 240, damping: 19 };
      Object.assign(state.rect.r, right ? fast : slow);
      Object.assign(state.rect.l, right ? slow : fast);
    }
    if (state.alpha.x < 0.05 || !stretch || this.stage.reduced) state.rect.snap(to);
    state.rect.set(to);
    state.alpha.set(1);
    state.current = tab;
  }
  select(tab) {
    const list = tab.closest('[role=tablist]');
    if (!list) return;
    const tabs = this.tabsOf(list);
    const current = this.selectedOf(tabs);
    if (tab === current) return;
    const state = this.lists.get(list);
    if (state) this.indicate(state, tab, true);
    const direction = tabs.indexOf(tab) >= tabs.indexOf(current) ? 1 : -1;
    const scope = [current && this.panelOf(current), this.panelOf(tab)].filter(Boolean);
    this.stage.play('select');
    this.stage.buzz(6);
    this.stage.wake();
    this.stage.transition(() => this.apply(tabs, tab), { scope, direction, sound: 'swipe' });
  }
  step(now, dt) {
    let active = false;
    for (const state of this.lists.values()) {
      if (state.current?.isConnected) state.rect.set(this.stage.rectOf(state.current));
      active = state.rect.step(dt) | state.alpha.step(dt) || active;
    }
    return active;
  }
  emit(scene) {
    for (const [list, state] of this.lists) {
      if (state.alpha.x < 0.003 || !this.stage.visible(state.current)) continue;
      this.stage.draw('indicator', scene, { el: state.current, list, rect: state.rect.rect, alpha: state.alpha.x, motion: state.rect });
    }
  }
}
