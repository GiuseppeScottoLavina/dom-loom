import { RectSpring, Spring, clamp01 } from '../core/spring.js';

export class Toggles {
  constructor(stage) {
    this.stage = stage;
    this.switches = new Map();
    this.boxes = new Map();
    this.groups = new Map();
    this.rings = [];
    stage.listen('change', (e) => {
      const el = e.target;
      if (el.matches?.('input[type=checkbox]')) this.toggled(el, e.timeStamp);
      else if (el.matches?.('input[type=radio]')) this.selected(el, e.timeStamp);
    });
    this.sync();
  }
  sync() {
    const root = this.stage.source;
    const seen = new Set();
    for (const el of root.querySelectorAll('input[type=checkbox]')) {
      seen.add(el);
      const map = el.matches('[role=switch]') ? this.switches : this.boxes;
      const state = map.get(el);
      if (!state) {
        map.set(el, {
          pos: new Spring(+el.checked, { stiffness: 520, damping: 23, epsilon: 0.002 }),
          on: new Spring(+el.checked, { stiffness: 300, damping: 26, epsilon: 0.002 }),
        });
      } else if (state.pos.target !== +el.checked) {
        state.pos.set(+el.checked);
        state.on.set(+el.checked);
      }
    }
    for (const map of [this.switches, this.boxes]) for (const el of map.keys()) if (!seen.has(el)) map.delete(el);
    const groups = new Map();
    for (const el of root.querySelectorAll('input[type=radio]')) {
      if (el.closest('[rating]')) continue;
      const key = `${el.form?.id ?? ''}|${el.name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
    }
    for (const [key, radios] of groups) {
      let group = this.groups.get(key);
      if (!group) {
        group = { key, radios, rect: new RectSpring({ stiffness: 500, damping: 30, epsilon: 0.05 }), alpha: new Spring(0, { stiffness: 300, damping: 30, epsilon: 0.003 }), current: null };
        this.groups.set(key, group);
      }
      group.radios = radios;
      const checked = radios.find((r) => r.checked) ?? null;
      const label = checked ? (checked.closest('label') ?? checked) : null;
      if (label !== group.current) {
        group.current = label;
        if (label) {
          const r = this.stage.rectOf(label);
          if (group.alpha.x < 0.05) group.rect.snap(r);
          group.rect.set(r);
          group.alpha.set(1);
        } else group.alpha.set(0);
      }
    }
    for (const key of this.groups.keys()) if (!groups.has(key)) this.groups.delete(key);
    this.stage.wake();
  }
  toggled(el, now) {
    const map = el.matches('[role=switch]') ? this.switches : this.boxes;
    if (!map.has(el)) this.sync();
    const state = map.get(el);
    if (!state) return;
    state.pos.set(+el.checked);
    state.on.set(+el.checked);
    if (this.stage.reduced) {
      state.pos.snap();
      state.on.snap();
    }
    this.rings.push({ el, at: now, on: el.checked });
    this.stage.play('toggle', el.checked);
    this.stage.buzz(8);
    this.stage.wake();
  }
  selected(el, now) {
    if (el.closest('[rating]')) return;
    this.sync();
    const key = `${el.form?.id ?? ''}|${el.name}`;
    const group = this.groups.get(key);
    if (!group) return;
    const label = el.closest('label') ?? el;
    const from = group.rect.rect;
    const to = this.stage.rectOf(label);
    // The leading edge runs, the trailing edge follows: the selection stretches.
    const right = to[0] >= from[0];
    const fast = { stiffness: 1100, damping: 30 };
    const slow = { stiffness: 260, damping: 19 };
    Object.assign(group.rect.r, right ? fast : slow);
    Object.assign(group.rect.l, right ? slow : fast);
    group.current = label;
    group.rect.set(to);
    group.alpha.set(1);
    if (this.stage.reduced) group.rect.snap(to);
    this.rings.push({ el: label, at: now, on: true, select: true });
    this.stage.play('select');
    this.stage.buzz(6);
    this.stage.wake();
  }
  step(now, dt) {
    let active = false;
    for (const state of this.switches.values()) active = state.pos.step(dt) | state.on.step(dt) || active;
    for (const state of this.boxes.values()) active = state.pos.step(dt) | state.on.step(dt) || active;
    for (const group of this.groups.values()) {
      if (group.current?.isConnected) group.rect.set(this.stage.rectOf(group.current));
      active = group.rect.step(dt) | group.alpha.step(dt) || active;
    }
    this.rings = this.rings.filter((r) => now - r.at < this.stage.skin.durations.ring);
    return active || this.rings.length > 0;
  }
  emit(scene, now) {
    const stage = this.stage;
    for (const group of this.groups.values()) {
      if (group.alpha.x < 0.003 || !stage.visible(group.current)) continue;
      stage.draw('choice', scene, { el: group.current, rect: group.rect.rect, alpha: group.alpha.x, motion: group.rect });
    }
    for (const [el, s] of this.switches) {
      if (!stage.visible(el)) continue;
      const rect = stage.rectOf(el);
      if (rect[2] < 1) continue;
      stage.draw('switch', scene, { el, rect, position: s.pos.x, velocity: s.pos.v, on: clamp01(s.on.x) });
    }
    for (const [el, s] of this.boxes) {
      if (!stage.visible(el)) continue;
      const rect = stage.rectOf(el);
      if (rect[2] < 1) continue;
      stage.draw('checkbox', scene, { el, rect, amount: Math.max(s.pos.x, 0) });
    }
    for (const ring of this.rings) {
      if (!stage.visible(ring.el)) continue;
      stage.draw('toggled', scene, { el: ring.el, rect: stage.rectOf(ring.el), t: now - ring.at, on: ring.on, select: Boolean(ring.select) });
    }
  }
}
