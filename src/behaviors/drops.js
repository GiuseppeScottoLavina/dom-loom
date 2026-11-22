import { Spring } from '../core/spring.js';

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
    for (const [zone, s] of this.states) {
      if (!this.stage.source.contains(zone) || !zone.hasAttribute('dropzone')) {
        zone.removeAttribute('data-over');
        this.states.delete(zone);
        continue;
      }
      // While files hover, the vortex keeps turning.
      const moving = s.pull.step(dt);
      const hovering = s.pull.target > 0;
      const bursting = now - s.droppedAt < this.stage.skin.durations.burst;
      if (moving || ((hovering || bursting) && this.stage.gpu && !this.stage.reduced)) active = true;
      if (!moving && !hovering && (!bursting || !this.stage.gpu || this.stage.reduced)) this.states.delete(zone);
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
