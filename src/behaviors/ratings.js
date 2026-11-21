
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
