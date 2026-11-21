import { Spring, clamp01 } from '../core/spring.js';
import { center, parseMs, pressable } from './util.js';


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
    // A press can end anywhere, also outside the stage.
    stage.listenGlobal('pointerup', release);
    stage.listenGlobal('pointercancel', release);
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
