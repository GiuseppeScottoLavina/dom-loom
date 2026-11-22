
/** Which tone an element asks for: data-tone, or the role of an alert. */
const toneOf = (el) => el.dataset.tone ?? (el.matches('[role=alert]') ? 'bad' : null);

/**
 * Things that change on their own and should be noticed:
 * - [role=alert]: when one appears or its text changes, an impact runs through it;
 * - [badge]: when its number changes, it pings;
 * - [aria-busy="true"]: a shimmer runs over the placeholder while it is busy, and the
 *   content assembles when it is no longer busy.
 */
export class Notices {
  constructor(stage) {
    this.stage = stage;
    this.impacts = [];
    this.pings = [];
    this.badges = new WeakMap();
    this.busy = new Set();
    this.sync();
  }
  sync() {
    for (const badge of this.stage.source.querySelectorAll('[badge]')) {
      if (!this.badges.has(badge)) this.badges.set(badge, badge.textContent.trim());
    }
    const busy = new Set(this.stage.source.querySelectorAll('[aria-busy=true]'));
    for (const region of this.busy) if (!busy.has(region) && region.isConnected) this.stage.reveal(region);
    this.busy = busy;
    this.stage.wake();
  }
  /** @internal The stage hands over the mutations of its content. */
  mutated(records) {
    const touched = new Set();
    let changed = false;
    for (const record of records) {
      const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!node) continue;
      const alert = node.closest('[role=alert]');
      if (alert) touched.add(alert);
      for (const added of record.addedNodes) {
        if (added.nodeType === 1 && added.matches('[role=alert]')) touched.add(added);
      }
      const badge = node.closest('[badge]');
      if (badge) {
        const before = this.badges.get(badge);
        const now = badge.textContent.trim();
        if (before !== undefined && before !== now) {
          changed = true;
          const up = parseFloat(now) > parseFloat(before);
          this.pings.push({ el: badge, start: NaN, up: Number.isNaN(parseFloat(now)) ? true : up });
          this.stage.play(up ? 'ping' : 'tick');
        }
        this.badges.set(badge, now);
      }
    }
    for (const alert of touched) {
      if (!this.stage.visible(alert) || !alert.textContent.trim()) continue;
      changed = true;
      this.impacts.push({ el: alert, start: NaN });
      this.stage.play('alarm', toneOf(alert));
      this.stage.buzz(40);
    }
    if (changed) this.stage.wake();
  }
  step(now) {
    const { burst, ring } = this.stage.skin.durations;
    for (const list of [this.impacts, this.pings]) for (const x of list) if (Number.isNaN(x.start)) x.start = now;
    this.impacts = this.impacts.filter((x) => now - x.start < burst && x.el.isConnected);
    this.pings = this.pings.filter((x) => now - x.start < ring && x.el.isConnected);
    // A busy region shimmers: it needs frames while it is shown.
    const shimmering = this.stage.gpu && !this.stage.reduced && [...this.busy].some((r) => this.stage.visible(r));
    return this.impacts.length > 0 || this.pings.length > 0 || shimmering;
  }
  emit(scene, now) {
    for (const x of this.impacts) {
      if (this.stage.visible(x.el)) this.stage.draw('alert', scene, { el: x.el, rect: this.stage.rectOf(x.el), t: now - x.start, tone: toneOf(x.el) });
    }
    for (const x of this.pings) {
      if (this.stage.visible(x.el)) this.stage.draw('badge', scene, { el: x.el, rect: this.stage.rectOf(x.el), t: now - x.start, up: x.up });
    }
    for (const region of this.busy) {
      if (this.stage.visible(region)) this.stage.draw('busy', scene, { el: region, rect: this.stage.rectOf(region), now });
    }
  }
}
