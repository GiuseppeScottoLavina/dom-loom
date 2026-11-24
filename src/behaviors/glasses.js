/**
 * Elements with the `glass` attribute are panes of liquid glass: the skin draws each one
 * (its `glass` hook) over the picture of what lies under it. Pressing a pane swells it.
 */
const radii = new WeakMap();

/** An element's corner radius in css px, read once. */
function radiusOf(el) {
  let r = radii.get(el);
  if (r === undefined) {
    r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    radii.set(el, r);
  }
  return r;
}

export class Glasses {
  constructor(stage) {
    this.stage = stage;
    this.panes = [];
    this.collect();
  }

  collect() {
    this.panes = [...this.stage.source.querySelectorAll('[glass]')];
  }

  mutated(records) {
    // Only a pane arriving, leaving or changing matters: text edits cost nothing here.
    const pane = (node) => node.nodeType === 1 && (node.matches?.('[glass]') || node.querySelector?.('[glass]'));
    const touched = records.some((r) => (r.type === 'attributes' ? r.attributeName === 'glass'
      : [...r.addedNodes].some(pane) || [...r.removedNodes].some((n) => n.nodeType === 1 && this.panes.some((el) => n === el || n.contains?.(el)))));
    if (touched) this.collect();
  }

  step() {
    return false;
  }

  emit(scene) {
    const stage = this.stage;
    for (const el of this.panes) {
      if (!el.isConnected || !stage.visible(el)) continue;
      stage.draw('glass', scene, { el, rect: stage.rectOf(el), radius: radiusOf(el) });
    }
  }
}
