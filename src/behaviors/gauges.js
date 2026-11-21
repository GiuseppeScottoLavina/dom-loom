import { Spring, clamp01 } from '../core/spring.js';

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
      // Without the compositor, CSS draws ring gauges from this.
      if (!stage.gpu) el.style.setProperty('--loom-value', String(f ?? 0));
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
        ring: el.hasAttribute('ring'),
        indeterminate: s.f === null,
        hit: now - s.hitAt < hit ? { amount: s.hit, t: now - s.hitAt, from: s.hitSpan?.[0] ?? 0, to: s.hitSpan?.[1] ?? 0 } : null,
        complete: now - s.completeAt < complete ? now - s.completeAt : null,
      });
    }
  }
}
