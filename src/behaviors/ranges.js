import { Spring, clamp01 } from '../core/spring.js';

export class Ranges {
  static valueSelector = 'input[type=range]';
  constructor(stage) {
    this.stage = stage;
    this.states = new Map();
    this.dragging = null;
    stage.listen('input', (e) => {
      if (!e.target.matches?.('input[type=range]')) return;
      // In an interval the moved end cannot pass the other one.
      const ends = e.target.closest('[interval]')?.querySelectorAll('input[type=range]');
      if (ends?.length === 2) {
        const [lo, hi] = ends;
        if (Number(lo.value) > Number(hi.value)) {
          if (e.target === lo) lo.value = hi.value;
          else hi.value = lo.value;
        }
      }
      this.changed(e.target);
    });
    stage.listen('pointerdown', (e) => {
      const el = e.target.closest?.('input[type=range]');
      if (!el) return;
      this.dragging = el;
      this.state(el)?.drag.set(1);
      this.stage.wake();
    });
    const up = () => {
      if (!this.dragging) return;
      this.state(this.dragging)?.drag.set(0);
      this.dragging = null;
      this.stage.wake();
    };
    stage.listenGlobal('pointerup', up);
    stage.listenGlobal('pointercancel', up);
    this.sync();
  }
  fraction(el) {
    const min = parseFloat(el.min || '0');
    const max = parseFloat(el.max || '100');
    return max > min ? clamp01((parseFloat(el.value) - min) / (max - min)) : 0;
  }
  state(el) {
    let s = this.states.get(el);
    if (!s && el.isConnected) {
      const f = this.fraction(el);
      s = {
        val: new Spring(f, { stiffness: 700, damping: 36, epsilon: 0.0005 }),
        drag: new Spring(0, { stiffness: 400, damping: 30, epsilon: 0.003 }),
        amp: new Spring(0, { stiffness: 140, damping: 9, epsilon: 0.02 }),
      };
      this.states.set(el, s);
    }
    return s;
  }
  sync() {
    const seen = new Set(this.stage.source.querySelectorAll('input[type=range]'));
    for (const el of seen) this.syncControl(el);
    for (const el of this.states.keys()) if (!seen.has(el)) this.states.delete(el);
    this.stage.wake();
  }
  syncControl(el) {
    const s = this.state(el);
    if (!s) return;
    const f = this.fraction(el);
    if (!this.stage.gpu) el.style.setProperty('--loom-fill', `${(f * 100).toFixed(2)}%`);
    if (s.val.target !== f) s.val.set(f);
    if (this.stage.reduced) s.val.snap();
  }
  changed(el) {
    this.syncControl(el);
    this.stage.wake();
  }
  step(now, dt) {
    let active = false;
    for (const [el, s] of this.states) {
      const moving = s.val.step(dt);
      let slosh = 0;
      if (s.val.v && !this.stage.reduced && el.isConnected) {
        const track = Math.max(0, this.stage.rectOf(el)[2] - 18);
        slosh = Math.min(Math.abs(s.val.v) * track * 0.012, 5);
      }
      s.amp.set(slosh);
      active = moving | s.drag.step(dt) | s.amp.step(dt) || active;
    }
    return active;
  }
  emit(scene) {
    const pairs = new Map();
    for (const [el, s] of this.states) {
      if (!this.stage.visible(el)) continue;
      const rect = this.stage.rectOf(el);
      if (rect[2] < 1) continue;
      // Two ranges inside an element with the interval attribute are one control.
      const interval = el.closest('[interval]');
      if (interval) {
        if (!pairs.has(interval)) pairs.set(interval, []);
        pairs.get(interval).push({ el, rect, s });
        continue;
      }
      this.stage.draw('range', scene, { el, rect, value: s.val.x, drag: clamp01(s.drag.x), slosh: s.amp.x });
    }
    for (const [el, ends] of pairs) {
      if (ends.length !== 2) continue;
      const [a, b] = ends[0].s.val.x <= ends[1].s.val.x ? ends : [ends[1], ends[0]];
      this.stage.draw('interval', scene, {
        el, rect: a.rect, low: a.s.val.x, high: b.s.val.x,
        drag: [clamp01(a.s.drag.x), clamp01(b.s.drag.x)], slosh: Math.max(a.s.amp.x, b.s.amp.x),
      });
    }
  }

}
