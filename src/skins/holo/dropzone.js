// Holo: drop.
import { extendSkin } from '../../core/skin.js';
import { noise } from '../../core/audio.js';
import { PILL } from '../../primitives/pill.js';
import { RING } from '../../primitives/ring.js';
import { VORTEX } from '../../primitives/vortex.js';
import { ADD } from '../../core/scene.js';
import { easeOutCubic } from '../../core/spring.js';
import { pad } from './util.js';

extendSkin('holo', {
  drop(scene, { rect, point, pull, dropped }, { colors, now, durations, reduced }) {
    const d = dropped / durations.burst;
    const implode = d >= 0 && d < 1 ? (1 - d) ** 2 : 0;
    if (pull < 0.002 && implode === 0) return;
    const [px, py] = point;
    const size = Math.max(rect[2], rect[3]);
    if (!reduced) {
      // The files pull the panel in: a vortex at the pointer that tightens on drop.
      const angle = pull * (1.3 + 0.25 * Math.sin(now * 0.004)) + implode * 2.6;
      scene.push(VORTEX, pad(rect, 10), [px, py, size * 0.34, angle], [pull * 0.3 + implode * 0.7]);
    }
    scene.push(PILL, rect, [2, 0, 14, pull * 0.16 + implode * 0.3], colors.holo, ADD);
    if (implode > 0) scene.push(RING, [px, py, easeOutCubic(d) * size * 0.8, 2 + 8 * d], [implode * 1.1], colors.holo);
  },
}, {
  pull: () => noise({ duration: 0.5, gain: 0.07, from: 160, to: 900, q: 2 }),
});
