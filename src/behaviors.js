// What each kind of control is doing. A behaviour listens to the real DOM events,
// keeps a few springs, and every frame hands its state to the stage's skin, which
// draws it (skins/*). The DOM never animates: it changes only with the control's state.
import { RectSpring, Spring, clamp01 } from './spring.js';

const pad = ([x, y, w, h], px, py = px) => [x - px, y - py, w + 2 * px, h + 2 * py];
const center = ([x, y, w, h]) => [x + w / 2, y + h / 2];

const CHOICE = 'input[type=radio], input[type=checkbox]';

const TEXTUAL =
  'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button])' +
  ':not([type=submit]):not([type=reset]):not([type=hidden]):not([type=color]):not([type=file]), textarea, select';

/** The element the reticle locks onto for something under the pointer or focused. */
export function targetFor(node, root) {
  const hit = node?.closest?.('button, a[href], select, textarea, summary, input, label, [tabindex]');
  if (!hit || !root.contains(hit) || hit === root) return null;
  if (hit.matches('input[type=hidden], [tabindex="-1"]') || hit.disabled) return null;
  if (hit.matches(CHOICE)) return hit.closest('label') ?? hit;
  if (hit.matches('label')) {
    const control = hit.control;
    if (!control || control.disabled) return null;
    return control.matches(CHOICE) ? hit : control;
  }
  return hit;
}

function pressable(node, root) {
  const hit = node?.closest?.('button, summary, a[href], label');
  if (!hit || !root.contains(hit) || hit.disabled) return null;
  if (hit.matches('label') && !hit.control?.matches(CHOICE)) return null;
  return hit;
}

/* ------------------------------------------------------------------ reticle */

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
    stage.listen('pointerover', (e) => {
      if (e.pointerType === 'touch' || this.keyboard) return;
      this.hover = targetFor(e.target, root);
      this.retarget(true);
    });
    stage.listen('pointermove', (e) => {
      if (!this.keyboard || e.pointerType === 'touch') return;
      this.keyboard = false;
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

/* ------------------------------------------------------------ press & hold */

function parseMs(value, fallback) {
  if (!value) return fallback;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return value.trim().endsWith('ms') || !value.trim().endsWith('s') ? n : n * 1000;
}

export class Presses {
  constructor(stage) {
    this.stage = stage;
    this.list = [];
    this.hold = null;
    this.drain = null;
    this.bursts = [];
    this.nudges = [];
    const root = stage.source;
    stage.listen('pointerdown', (e) => {
      if (e.button !== 0) return;
      const el = pressable(e.target, root);
      if (!el) return;
      this.start(el, stage.pointOf(e), e.timeStamp);
    });
    const release = (e) => this.release(e.timeStamp);
    stage.listen('pointerup', release);
    stage.listen('pointercancel', release);
    stage.listen('keydown', (e) => {
      if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return;
      const el = e.target.closest?.('button, summary');
      if (!el || !root.contains(el) || el.disabled) return;
      this.start(el, center(stage.rectOf(el)), e.timeStamp);
    });
    stage.listen('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') this.release(e.timeStamp);
    });
  }
  start(el, point, now) {
    const press = {
      el,
      point,
      depth: new Spring(0, { stiffness: 900, damping: 21, epsilon: 0.002 }),
      releasedAt: NaN,
      strength: el.matches('label') ? 0.55 : 1,
    };
    press.depth.set(1);
    if (this.stage.reduced) press.depth.snap();
    this.list.push(press);
    this.stage.play('press');
    if (el.matches('button[hold]')) this.startHold(el, now);
    this.stage.wake();
  }
  release(now) {
    for (const press of this.list) {
      if (!Number.isNaN(press.releasedAt)) continue;
      press.releasedAt = now;
      press.depth.set(0);
      if (this.stage.reduced) press.depth.snap();
      this.stage.play('release');
    }
    if (this.hold && !this.hold.done) this.cancelHold();
    this.stage.wake();
  }
  holding(el) {
    return this.hold?.el === el && !this.hold.done;
  }
  startHold(el, now) {
    this.hold = { el, start: now, ms: parseMs(el.getAttribute('hold'), 900), progress: 0, done: false };
    this.drain = null;
    this.stage.play('chargeStart', this.hold.ms);
  }
  cancelHold() {
    const { el, progress } = this.hold;
    this.drain = { el, spring: new Spring(progress, { stiffness: 160, damping: 26, epsilon: 0.003 }).set(0) };
    this.hold = null;
    this.stage.play('chargeStop');
  }
  completeHold(now) {
    const { el } = this.hold;
    this.hold.done = true;
    this.hold = null;
    this.bursts.push({ el, at: now });
    this.stage.play('chargeStop');
    this.stage.play('burst');
    this.stage.buzz(35);
    // Outside the frame callback: the click may submit a form and start a transition.
    setTimeout(() => this.stage.activate(el));
  }
  /** A blocked click on a hold button that is not being held: show that it needs a hold. */
  nudge(el, now) {
    this.nudges.push({ el, at: now });
    this.stage.play('error');
    this.stage.wake();
  }
  step(now, dt) {
    let active = false;
    for (const press of this.list) {
      press.depth.step(dt);
      const k = Number.isNaN(press.releasedAt) ? 0 : (now - press.releasedAt) / this.stage.skin.durations.press;
      press.k = clamp01(k);
      press.done = !Number.isNaN(press.releasedAt) && k >= 1 && press.depth.settled;
    }
    this.list = this.list.filter((p) => !p.done && p.el.isConnected);
    if (this.list.length) active = true;
    if (this.hold) {
      this.hold.progress = clamp01((now - this.hold.start) / this.hold.ms);
      if (!this.stage.gpu) this.hold.el.style.setProperty('--loom-charge', this.hold.progress.toFixed(3));
      if (this.hold.progress >= 1) this.completeHold(now);
      active = true;
    }
    if (this.drain) {
      const moving = this.drain.spring.step(dt);
      if (!this.stage.gpu) this.drain.el.style.setProperty('--loom-charge', Math.max(this.drain.spring.x, 0).toFixed(3));
      if (!moving) this.drain = null;
      else active = true;
    }
    const { burst, nudge } = this.stage.skin.durations;
    this.bursts = this.bursts.filter((b) => now - b.at < burst);
    this.nudges = this.nudges.filter((b) => now - b.at < nudge);
    if (!this.stage.gpu) {
      for (const b of this.bursts) b.el.style.setProperty('--loom-charge', '0');
    }
    return active || this.bursts.length > 0 || this.nudges.length > 0;
  }
  emit(scene, now) {
    const stage = this.stage;
    for (const press of this.list) {
      if (!stage.visible(press.el)) continue;
      const released = !Number.isNaN(press.releasedAt);
      stage.draw('press', scene, {
        el: press.el, rect: stage.rectOf(press.el), point: press.point, depth: press.depth.x,
        released, t: released ? now - press.releasedAt : 0, strength: press.strength,
      });
    }
    const charge = this.hold ?? (this.drain && { el: this.drain.el, progress: Math.max(this.drain.spring.x, 0) });
    if (charge && stage.visible(charge.el)) {
      stage.draw('charge', scene, { el: charge.el, rect: stage.rectOf(charge.el), progress: charge.progress, holding: Boolean(this.hold) });
    }
    for (const b of this.bursts) {
      if (stage.visible(b.el)) stage.draw('burst', scene, { el: b.el, rect: stage.rectOf(b.el), t: now - b.at });
    }
    for (const n of this.nudges) {
      if (stage.visible(n.el)) stage.draw('nudge', scene, { el: n.el, rect: stage.rectOf(n.el), t: now - n.at });
    }
  }
}

/* ----------------------------------------------------------------- toggles */

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

/* ------------------------------------------------------------------ ranges */

export class Ranges {
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
    stage.listen('pointerup', up);
    stage.listen('pointercancel', up);
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
    for (const el of seen) {
      if (!this.stage.gpu) el.style.setProperty('--loom-fill', `${(this.fraction(el) * 100).toFixed(2)}%`);
      const s = this.state(el);
      if (s.val.target !== this.fraction(el)) s.val.set(this.fraction(el));
    }
    for (const el of this.states.keys()) if (!seen.has(el)) this.states.delete(el);
    this.stage.wake();
  }
  changed(el) {
    const s = this.state(el);
    if (!s) return;
    if (!this.stage.gpu) el.style.setProperty('--loom-fill', `${(this.fraction(el) * 100).toFixed(2)}%`);
    s.val.set(this.fraction(el));
    if (this.stage.reduced) s.val.snap();
    this.stage.wake();
  }
  step(now, dt) {
    let active = false;
    for (const [el, s] of this.states) {
      const moving = s.val.step(dt);
      const r = el.isConnected ? this.stage.rectOf(el) : [0, 0, 100, 0];
      const speed = Math.abs(s.val.v) * (r[2] - 18);
      s.amp.set(this.stage.reduced ? 0 : Math.min(speed * 0.012, 5));
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

/* ------------------------------------------------------------ text fields */

export class Fields {
  constructor(stage) {
    this.stage = stage;
    this.states = new Map();
    this.lastError = -1e9;
    const root = stage.source;
    const state = (el) => {
      let s = this.states.get(el);
      if (!s) {
        s = { scanAt: -1e9, under: new Spring(0, { stiffness: 300, damping: 28, epsilon: 0.003 }), pulse: 0, glitchAt: -1e9 };
        this.states.set(el, s);
      }
      return s;
    };
    stage.listen('focusin', (e) => {
      if (!e.target.matches?.(TEXTUAL) || !root.contains(e.target)) return;
      const s = state(e.target);
      s.scanAt = e.timeStamp;
      s.under.set(1);
      if (stage.reduced) s.under.snap();
      stage.play('scan');
      stage.wake();
    });
    stage.listen('focusout', (e) => {
      const s = this.states.get(e.target);
      if (!s) return;
      s.under.set(0);
      if (stage.reduced) s.under.snap();
      stage.wake();
    });
    stage.listen('input', (e) => {
      if (!e.target.matches?.(TEXTUAL)) return;
      state(e.target).pulse = 1;
      stage.wake();
    });
    stage.listen('invalid', (e) => {
      if (!root.contains(e.target)) return;
      const target = e.target.matches(CHOICE) ? (e.target.closest('label') ?? e.target) : e.target;
      state(target).glitchAt = e.timeStamp;
      if (e.timeStamp - this.lastError > 200) stage.play('error');
      this.lastError = e.timeStamp;
      stage.wake();
    }, { capture: true });
  }
  step(now, dt) {
    let active = false;
    for (const [el, s] of this.states) {
      const moving = s.under.step(dt);
      s.pulse *= Math.exp(-dt * 9);
      if (s.pulse < 0.01) s.pulse = 0;
      const { scan, glitch } = this.stage.skin.durations;
      const busy = moving || s.pulse > 0 || now - s.scanAt < scan || now - s.glitchAt < glitch;
      active = busy || active;
      if (!busy && s.under.x < 0.003 && !el.matches(':user-invalid')) this.states.delete(el);
    }
    return active;
  }
  emit(scene, now) {
    for (const [el, s] of this.states) {
      if (!this.stage.visible(el)) continue;
      const rect = this.stage.rectOf(el);
      if (rect[2] < 1) continue;
      const invalid = Boolean(el.matches(':user-invalid') || el.querySelector?.(':user-invalid'));
      this.stage.draw('field', scene, {
        el, rect, scan: now - s.scanAt, focus: s.under.x, typing: s.pulse, invalid, glitch: now - s.glitchAt,
      });
    }
  }
}

/* ----------------------------------------------------------------- gauges */

const DAMAGE = 0;
const GAIN = 1;

/** Where a <meter>'s value is against its optimum: 0 good, 1 caution, 2 bad (HTML's three regions). */
function meterTone(el) {
  const region = (v) => (v < el.low ? 0 : v > el.high ? 2 : 1);
  return Math.min(Math.abs(region(el.optimum) - region(el.value)), 2);
}

/**
 * <progress> and <meter> as game bars. A drop cuts the bar at once and leaves a white
 * trail that drains after a beat, with a hit; a gain shows where the bar is going and
 * fills toward it. A progress without a value sweeps.
 */
export class Gauges {
  constructor(stage) {
    this.stage = stage;
    this.states = new Map();
    this.sync();
  }
  read(el) {
    if (el.localName === 'progress') return { f: el.position < 0 ? null : clamp01(el.position), tone: 0 };
    const span = el.max - el.min;
    return { f: span > 0 ? clamp01((el.value - el.min) / span) : 0, tone: meterTone(el) };
  }
  sync(now = performance.now()) {
    const stage = this.stage;
    const seen = new Set(stage.source.querySelectorAll('progress, meter'));
    for (const el of seen) {
      const { f, tone } = this.read(el);
      let s = this.states.get(el);
      if (!s) {
        s = {
          f,
          tone,
          mode: GAIN,
          fill: new Spring(f ?? 0, { stiffness: 900, damping: 38, epsilon: 0.0008 }),
          trail: new Spring(f ?? 0, { stiffness: 70, damping: 17, epsilon: 0.0008 }),
          holdUntil: 0,
          hitAt: -1e9,
          hit: 0,
          completeAt: -1e9,
        };
        this.states.set(el, s);
        continue;
      }
      s.tone = tone;
      if (f === null) {
        s.f = null;
        continue;
      }
      const prev = s.f ?? 0;
      if (s.f !== null && Math.abs(f - prev) < 1e-4) continue;
      s.f = f;
      if (f < prev) {
        // Damage: the bar is cut now; the trail holds where it was, then drains.
        s.mode = DAMAGE;
        s.trail.snap(Math.max(s.trail.x, s.fill.x));
        Object.assign(s.fill, { stiffness: 900, damping: 38 });
        s.fill.set(f);
        s.holdUntil = now + 420;
        if (prev - f > 0.015) {
          s.hitAt = now;
          s.hit = Math.min((prev - f) * 5, 1);
          s.hitSpan = [f, prev];
          stage.play('hit', s.hit);
          stage.buzz(18);
        }
      } else {
        // Gain: the trail shows where the bar is going; the fill catches up.
        s.mode = GAIN;
        s.trail.snap(f);
        Object.assign(s.fill, { stiffness: 120, damping: 20 });
        s.fill.set(f);
        if (el.localName === 'progress' && f >= 1) {
          s.completeAt = now;
          stage.play('complete');
          stage.buzz(25);
        } else if (el.localName === 'meter' && f - prev > 0.015) stage.play('heal');
        else stage.play('tick');
      }
      if (stage.reduced) {
        s.fill.snap();
        s.trail.snap(f);
      }
    }
    for (const el of this.states.keys()) if (!seen.has(el)) this.states.delete(el);
    stage.wake();
  }
  step(now, dt) {
    let active = false;
    for (const [el, s] of this.states) {
      if (s.mode === DAMAGE && now >= s.holdUntil && s.trail.target !== s.fill.target) s.trail.set(s.fill.target);
      const moving = s.fill.step(dt) | s.trail.step(dt);
      const holding = s.mode === DAMAGE && now < s.holdUntil;
      const sweeping = s.f === null && this.stage.visible(el);
      const { hit, complete } = this.stage.skin.durations;
      active = moving || holding || sweeping || now - s.hitAt < hit || now - s.completeAt < complete || active;
    }
    return active;
  }
  emit(scene, now) {
    const stage = this.stage;
    const { hit, complete } = stage.skin.durations;
    for (const [el, s] of this.states) {
      if (!stage.visible(el)) continue;
      const rect = stage.rectOf(el);
      if (rect[2] < 6 || rect[3] < 4) continue;
      const attr = el.getAttribute('segments');
      const fill = clamp01(s.fill.x);
      stage.draw('gauge', scene, {
        el,
        kind: el.localName,
        rect,
        fill,
        trail: Math.max(clamp01(s.trail.x), fill),
        gaining: s.mode === GAIN,
        tone: s.tone,
        segments: attr === null ? null : Math.max(0, parseInt(attr, 10) || 0),
        indeterminate: s.f === null,
        hit: now - s.hitAt < hit ? { amount: s.hit, t: now - s.hitAt, from: s.hitSpan?.[0] ?? 0, to: s.hitSpan?.[1] ?? 0 } : null,
        complete: now - s.completeAt < complete ? now - s.completeAt : null,
      });
    }
  }
}

/* ------------------------------------------------------------------- tabs */

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

/* ------------------------------------------------------------ disclosures */

/**
 * <details>: opening slides what is below down and uncovers the content behind a
 * scan line; closing shuts it upward. The stage does the sliding (it owns the
 * picture from before the change); this behaviour decides when.
 */
export class Disclosures {
  constructor(stage) {
    this.stage = stage;
    const root = stage.source;
    stage.listen('click', (e) => {
      const summary = e.target.closest?.('summary');
      const details = summary?.parentElement;
      if (!details || details.localName !== 'details' || !root.contains(details)) return;
      if (details.querySelector(':scope > summary') !== summary) return;
      // A link or a control inside the summary keeps its own click.
      const inner = e.target.closest('a, button, input, select, textarea, label');
      if (inner && summary.contains(inner) && inner !== summary) return;
      if (!stage.gpu || stage.reduced || e.defaultPrevented) return;
      e.preventDefault();
      stage._disclose(details);
    });
  }
  step() {
    return false;
  }
  emit() {}
}

/* ----------------------------------------------------------------- tables */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** A cell's text as a number when it is one ("1,200 m", "-4.5 %", "82"), else NaN. */
const asNumber = (text) => (/^[^\p{L}]*\d[^\p{L}]*$/u.test(text) ? parseFloat(text.replace(/[^\d.-]/g, '')) : NaN);

/**
 * <table sortable>: each header of the first <thead> row sorts the rows of the first
 * <tbody> (by the cells' data-value, or their text; numbers as numbers). The rows fly
 * to their new places. `loom-sort` (cancelable) fires first: cancel it to sort
 * yourself; `loom-sorted` fires once the rows are in their new order.
 */
export class Tables {
  constructor(stage) {
    this.stage = stage;
    this.sorted = [];
    stage.listen('click', (e) => {
      const button = e.target.closest?.('button.loom-sort');
      if (button && stage.source.contains(button)) this.sort(button.closest('th'));
    });
    this.sync();
  }
  sync() {
    for (const table of this.stage.source.querySelectorAll('table[sortable]')) {
      const row = table.tHead?.rows[0];
      if (!row) continue;
      for (const th of row.cells) {
        if (th.hasAttribute('nosort') || th.querySelector(':scope > button.loom-sort')) continue;
        // Sortable headers are buttons: focusable, announced, activated by keyboard.
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'loom-sort';
        button.append(...th.childNodes);
        th.append(button);
      }
    }
  }
  sort(th) {
    const table = th?.closest('table');
    const body = table?.tBodies[0];
    if (!body) return;
    const column = th.cellIndex;
    const direction = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
    const detail = { column, direction, header: th };
    if (!table.dispatchEvent(new CustomEvent('loom-sort', { bubbles: true, cancelable: true, detail }))) return;
    const rows = [...body.rows];
    const key = (row) => {
      const cell = row.cells[column];
      return cell ? (cell.dataset.value ?? cell.textContent.trim()) : '';
    };
    const keys = new Map(rows.map((row) => [row, key(row)]));
    const numbers = rows.every((row) => !Number.isNaN(asNumber(keys.get(row))));
    const sign = direction === 'ascending' ? 1 : -1;
    const order = rows.slice().sort((a, b) => sign * (numbers
      ? asNumber(keys.get(a)) - asNumber(keys.get(b))
      : collator.compare(keys.get(a), keys.get(b))));
    const update = () => {
      for (const other of th.parentElement.cells) if (other !== th) other.removeAttribute('aria-sort');
      th.setAttribute('aria-sort', direction);
      body.append(...order);
      table.dispatchEvent(new CustomEvent('loom-sorted', { bubbles: true, detail: { ...detail, rows: order } }));
    };
    this.sorted.push({ el: th, at: performance.now(), direction });
    this.stage.play('select');
    this.stage.wake();
    this.stage.transition(update, { morph: rows, cut: false });
  }
  step(now) {
    this.sorted = this.sorted.filter((s) => now - s.at < this.stage.skin.durations.ring);
    return this.sorted.length > 0;
  }
  emit(scene, now) {
    for (const s of this.sorted) {
      if (this.stage.visible(s.el)) this.stage.draw('sorted', scene, { el: s.el, rect: this.stage.rectOf(s.el), t: now - s.at, direction: s.direction });
    }
  }
}

/* --------------------------------------------------------------- currents */

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

/* ---------------------------------------------------------------- numbers */

/**
 * <input type="number">: stepping (arrow keys, the wheel over a focused field, or a
 * button with aria-controls pointing at it and data-step="1" / "-1") rolls the digits
 * over: the old value leaves, the new one comes in.
 */
export class Numbers {
  constructor(stage) {
    this.stage = stage;
    const root = stage.source;
    const isNumber = (el) => el?.matches?.('input[type=number]') && root.contains(el) && !el.disabled && !el.readOnly;
    stage.listen('keydown', (e) => {
      if (!isNumber(e.target) || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      this.stepBy(e.target, e.key === 'ArrowUp' ? 1 : -1);
    });
    stage.listen('wheel', (e) => {
      if (!isNumber(e.target) || document.activeElement !== e.target || !e.deltaY) return;
      e.preventDefault();
      this.stepBy(e.target, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    stage.listen('click', (e) => {
      const button = e.target.closest?.('button[data-step][aria-controls]');
      if (!button || !root.contains(button)) return;
      const el = root.querySelector(`#${CSS.escape(button.getAttribute('aria-controls'))}`);
      if (isNumber(el)) this.stepBy(el, Number(button.dataset.step) || 1);
    });
  }
  stepBy(el, by) {
    const update = () => {
      const before = el.value;
      if (by > 0) el.stepUp(by);
      else el.stepDown(-by);
      if (el.value === before) return false;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    this.stage._change(el, update, 'roll', by > 0 ? 1 : -1).then((changed) => {
      this.stage.play(changed ? 'tick' : 'error');
    });
  }
  step() {
    return false;
  }
  emit() {}
}

/* ---------------------------------------------------------------- ratings */

/**
 * A radio group inside an element with the `rating` attribute is a row of stars:
 * pointing previews, choosing lights them up one after another.
 */
const STAR_STAGGER = 55;

export class Ratings {
  constructor(stage) {
    this.stage = stage;
    this.states = new Map();
    queueMicrotask(() => this.sync());
    const root = stage.source;
    const starOf = (node) => {
      const label = node?.closest?.('[rating] label');
      return label && root.contains(label) ? label : null;
    };
    stage.listen('pointerover', (e) => {
      const label = starOf(e.target);
      if (!label) return;
      const s = this.state(label.closest('[rating]'));
      s.hover = s.labels.indexOf(label);
      stage.wake();
    });
    stage.listen('pointerout', (e) => {
      const label = starOf(e.target);
      if (!label || label.contains(e.relatedTarget)) return;
      const s = this.state(label.closest('[rating]'));
      if (s.labels.includes(e.relatedTarget?.closest?.('label'))) return;
      s.hover = -1;
      stage.wake();
    });
    stage.listen('change', (e) => {
      const group = e.target.closest?.('[rating]');
      if (!group || !root.contains(group)) return;
      const s = this.state(group);
      const value = s.labels.findIndex((l) => l.control?.checked);
      // The stars light up one after the other, up to the chosen one (from the next frame).
      s.ignite = { start: NaN };
      s.value = value;
      stage.play('rate', value + 1);
      stage.buzz(10);
      stage.wake();
    });
  }
  state(group) {
    let s = this.states.get(group);
    if (!s) {
      const labels = [...group.querySelectorAll('label')].filter((l) => l.control?.type === 'radio');
      s = { labels, hover: -1, value: labels.findIndex((l) => l.control.checked), ignite: null };
      this.states.set(group, s);
    }
    return s;
  }
  sync() {
    for (const group of this.stage.source.querySelectorAll('[rating]')) {
      const s = this.state(group);
      s.labels = [...group.querySelectorAll('label')].filter((l) => l.control?.type === 'radio');
      s.value = s.labels.findIndex((l) => l.control.checked);
    }
    for (const group of this.states.keys()) if (!group.isConnected) this.states.delete(group);
    this.stage.wake();
  }
  step(now) {
    let active = false;
    for (const s of this.states.values()) {
      if (!s.ignite) continue;
      if (Number.isNaN(s.ignite.start)) s.ignite.start = now;
      if (now - s.ignite.start < STAR_STAGGER * (s.value + 1) + this.stage.skin.durations.ring) active = true;
      else s.ignite = null;
    }
    return active;
  }
  emit(scene, now) {
    for (const [group, s] of this.states) {
      if (!this.stage.visible(group)) continue;
      this.stage.draw('rating', scene, {
        el: group,
        stars: s.labels.map((l) => this.stage.rectOf(l)),
        value: s.value,
        hover: s.hover,
        // ms since each star lit (negative: not yet); stars that were already lit: long ago.
        lit: s.labels.map((_, i) => (s.ignite && !Number.isNaN(s.ignite.start) ? now - s.ignite.start - i * STAR_STAGGER : 1e9)),
      });
    }
  }
}

/* -------------------------------------------------------------- dropzones */

/**
 * An element with the `dropzone` attribute that holds an <input type="file">:
 * files dragged over it are pulled in by a vortex at the pointer; dropped, they go
 * to the input (its change event fires) and the vortex collapses.
 */
export class Drops {
  constructor(stage) {
    this.stage = stage;
    this.states = new Map();
    const root = stage.source;
    const zoneOf = (node) => {
      const zone = node?.closest?.('[dropzone]');
      return zone && root.contains(zone) && zone.querySelector('input[type=file]') ? zone : null;
    };
    const carriesFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const state = (zone) => {
      let s = this.states.get(zone);
      if (!s) {
        s = { pull: new Spring(0, { stiffness: 140, damping: 16, epsilon: 0.002 }), point: [0, 0], droppedAt: -1e9, files: 0 };
        this.states.set(zone, s);
      }
      return s;
    };
    stage.listen('dragover', (e) => {
      const zone = zoneOf(e.target);
      if (!zone || !carriesFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const s = state(zone);
      if (s.pull.target !== 1) stage.play('pull');
      s.pull.set(1);
      if (stage.reduced) s.pull.snap();
      s.point = stage.pointOf(e);
      zone.toggleAttribute('data-over', true);
      stage.wake();
    });
    stage.listen('dragleave', (e) => {
      const zone = zoneOf(e.target);
      if (!zone || zone.contains(e.relatedTarget)) return;
      state(zone).pull.set(0);
      zone.removeAttribute('data-over');
      stage.wake();
    });
    stage.listen('drop', (e) => {
      const zone = zoneOf(e.target);
      if (!zone || !carriesFiles(e)) return;
      e.preventDefault();
      const input = zone.querySelector('input[type=file]');
      const files = e.dataTransfer.files;
      if (!input.multiple && files.length > 1) {
        const one = new DataTransfer();
        one.items.add(files[0]);
        input.files = one.files;
      } else input.files = files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const s = state(zone);
      s.point = stage.pointOf(e);
      s.droppedAt = performance.now();
      s.files = input.files.length;
      s.pull.set(0);
      zone.removeAttribute('data-over');
      stage.play('burst');
      stage.buzz(30);
      stage.wake();
    });
  }
  step(now, dt) {
    let active = false;
    for (const s of this.states.values()) {
      // While files hover, the vortex keeps turning.
      active = s.pull.step(dt) || s.pull.x > 0.002 || now - s.droppedAt < this.stage.skin.durations.burst || active;
    }
    return active;
  }
  emit(scene, now) {
    for (const [zone, s] of this.states) {
      if (!this.stage.visible(zone)) continue;
      this.stage.draw('drop', scene, {
        el: zone, rect: this.stage.rectOf(zone), point: s.point, pull: Math.max(s.pull.x, 0), dropped: now - s.droppedAt, files: s.files,
      });
    }
  }
}

/* ------------------------------------------------------------------- chips */

/**
 * Elements with the `removable` attribute (tags, chips, list items) get a remove
 * button. Removing crumbles the element and the rest closes the gap; `loom-remove`
 * fires first on the element (cancelable). New removable elements assemble.
 */
export class Chips {
  constructor(stage) {
    this.stage = stage;
    const root = stage.source;
    const removeFrom = (button) => {
      const chip = button.closest('[removable]');
      if (!chip || !root.contains(chip)) return;
      if (!chip.dispatchEvent(new CustomEvent('loom-remove', { bubbles: true, cancelable: true }))) return;
      // Focus goes to the next chip, or the previous one, so the keyboard stays in the list.
      const peers = [...chip.parentElement.querySelectorAll(':scope > [removable]')];
      const i = peers.indexOf(chip);
      const next = peers[i + 1] ?? peers[i - 1];
      if (chip.contains(document.activeElement)) next?.querySelector('button.loom-remove')?.focus({ preventScroll: true });
      stage.remove(chip);
    };
    stage.listen('click', (e) => {
      const button = e.target.closest?.('button.loom-remove');
      if (button) removeFrom(button);
    });
    stage.listen('keydown', (e) => {
      const button = e.target.closest?.('button.loom-remove');
      if (button && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault();
        removeFrom(button);
      }
    });
    this.sync();
  }
  sync() {
    for (const chip of this.stage.source.querySelectorAll('[removable]')) {
      if (chip.querySelector(':scope > button.loom-remove')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'loom-remove';
      button.setAttribute('aria-label', `Remove ${chip.textContent.trim()}`);
      chip.append(button);
    }
  }
  step() {
    return false;
  }
  emit() {}
}

/* ---------------------------------------------------------------- combobox */

let comboIds = 0;

/**
 * <input list="…"> with its <datalist>: instead of the browser's popup (which a
 * canvas cannot draw), a listbox opens under the field inside the stage, filtered
 * as you type, driven by the arrow keys, Enter and Escape (the ARIA combobox
 * pattern). It unfolds and folds with motion.
 */
export class Combos {
  constructor(stage) {
    this.stage = stage;
    this.combos = new Map();
    this.active = null; // the open combo
    this.marker = { el: null, rect: new RectSpring({ stiffness: 700, damping: 34, epsilon: 0.05 }), alpha: new Spring(0, { stiffness: 300, damping: 30, epsilon: 0.003 }) };
    const root = stage.source;
    const comboOf = (el) => this.combos.get(el);
    stage.listen('input', (e) => {
      const c = comboOf(e.target);
      if (c && !c.picking) this.filter(c, true);
    });
    stage.listen('focusin', (e) => {
      const c = comboOf(e.target);
      if (c && e.target.value === '') this.filter(c, true);
    });
    stage.listen('focusout', (e) => {
      const c = comboOf(e.target);
      if (c && !c.list.contains(e.relatedTarget)) this.close(c);
    });
    stage.listen('keydown', (e) => {
      const c = comboOf(e.target);
      if (!c) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!c.open) this.filter(c, true);
        else this.move(c, e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter' && c.open && c.index >= 0) {
        e.preventDefault();
        this.pick(c, c.options[c.index]);
      } else if (e.key === 'Escape' && c.open) {
        e.preventDefault();
        this.close(c);
      }
    });
    // Picking with the pointer must not take the focus from the field.
    stage.listen('pointerdown', (e) => {
      if (e.target.closest?.('.loom-listbox') && root.contains(e.target)) e.preventDefault();
    });
    stage.listen('click', (e) => {
      const option = e.target.closest?.('.loom-listbox [role=option]');
      const c = option && [...this.combos.values()].find((x) => x.list.contains(option));
      if (c) this.pick(c, option);
    });
    stage.listen('pointerover', (e) => {
      const option = e.target.closest?.('.loom-listbox [role=option]');
      const c = option && [...this.combos.values()].find((x) => x.list.contains(option));
      if (c) this.highlight(c, c.options.indexOf(option));
    });
    this.sync();
  }
  sync() {
    for (const input of this.stage.source.querySelectorAll('input[list]')) {
      const datalist = input.list ?? document.getElementById(input.getAttribute('list'));
      if (!datalist) continue;
      // The browser's popup is not drawn into a canvas: the stage shows its own.
      input.dataset.loomList = input.getAttribute('list');
      input.removeAttribute('list');
      const list = document.createElement('ul');
      list.className = 'loom-listbox';
      list.id = `loom-listbox-${++comboIds}`;
      list.setAttribute('role', 'listbox');
      list.hidden = true;
      (input.closest('label') ?? input).after(list);
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('aria-controls', list.id);
      input.autocomplete = 'off';
      this.combos.set(input, { input, datalist, list, options: [], index: -1, open: false });
    }
    for (const [input, c] of this.combos) if (!input.isConnected) this.combos.delete(input) && c.list.remove();
  }
  filter(c, openIt) {
    const query = c.input.value.trim().toLowerCase();
    const values = [...c.datalist.options].map((o) => o.value).filter((v) => v.toLowerCase().includes(query) && v.toLowerCase() !== query);
    // Nothing to offer: fold the list as it is (its picture is what folds away).
    if (!values.length) {
      this.close(c);
      return;
    }
    c.list.replaceChildren(...values.map((value, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = `${c.list.id}-${i}`;
      li.textContent = value;
      return li;
    }));
    c.options = [...c.list.children];
    c.index = -1;
    c.input.removeAttribute('aria-activedescendant');
    if (openIt && !c.open) this.open(c);
    this.marker.alpha.set(0);
    this.stage.wake();
  }
  place(c) {
    // Under the field, as wide as it; above it when there is no room in the stage.
    const field = this.stage.rectOf(c.input);
    const parent = c.list.offsetParent ?? this.stage.source;
    const origin = parent.getBoundingClientRect();
    const box = c.input.getBoundingClientRect();
    const height = c.list.offsetHeight;
    const room = this.stage.source.getBoundingClientRect().height - (field[1] + field[3]);
    const above = height > room - 8 && field[1] > height + 8;
    Object.assign(c.list.style, {
      left: `${box.left - origin.left}px`,
      top: `${(above ? box.top - height - 4 : box.bottom + 4) - origin.top}px`,
      width: `${box.width}px`,
    });
  }
  open(c) {
    if (this.active && this.active !== c) this.close(this.active);
    c.open = true;
    this.active = c;
    this.stage.play('open');
    this.stage._change(c.list, () => {
      c.list.hidden = false;
      this.place(c);
      c.input.setAttribute('aria-expanded', 'true');
    }, 'unfold');
  }
  close(c) {
    if (!c.open) return;
    c.open = false;
    if (this.active === c) this.active = null;
    this.marker.alpha.set(0);
    this.stage.play('close');
    this.stage._change(c.list, () => {
      c.list.hidden = true;
      c.input.setAttribute('aria-expanded', 'false');
      c.input.removeAttribute('aria-activedescendant');
    }, 'fold');
  }
  highlight(c, index) {
    for (const [i, o] of c.options.entries()) o.setAttribute('aria-selected', String(i === index));
    c.index = index;
    const option = c.options[index];
    if (!option) return;
    c.input.setAttribute('aria-activedescendant', option.id);
    const to = this.stage.rectOf(option);
    if (this.marker.alpha.x < 0.05 || this.marker.el?.parentElement !== c.list) this.marker.rect.snap(to);
    this.marker.rect.set(to);
    this.marker.alpha.set(1);
    this.marker.el = option;
    this.stage.play('hover');
    this.stage.wake();
  }
  move(c, by) {
    const n = c.options.length;
    if (n) this.highlight(c, (c.index + by + n) % n);
  }
  pick(c, option) {
    this.close(c);
    c.picking = true;
    c.input.value = option.textContent;
    c.input.dispatchEvent(new Event('input', { bubbles: true }));
    c.input.dispatchEvent(new Event('change', { bubbles: true }));
    c.picking = false;
    this.stage.play('select');
  }
  step(now, dt) {
    if (this.marker.el?.isConnected && this.marker.alpha.target > 0) this.marker.rect.set(this.stage.rectOf(this.marker.el));
    return this.marker.rect.step(dt) | this.marker.alpha.step(dt);
  }
  emit(scene) {
    const m = this.marker;
    if (m.alpha.x < 0.003 || !this.stage.visible(m.el)) return;
    this.stage.draw('option', scene, { el: m.el, rect: m.rect.rect, alpha: m.alpha.x, motion: m.rect });
  }
}
