// Holo: busy.
import { extendSkin } from '../../core/skin.js';
import { SWEEP } from '../../primitives/sweep.js';

extendSkin('holo', {
  busy(scene, { rect, now }, { colors, reduced }) {
    if (reduced) return;
    // A scan passes over the placeholder again and again.
    const phase = (now % 1400) / 1400;
    scene.push(SWEEP, rect, [phase * 1.3 - 0.1, 1, 0.55], colors.holo);
  },
});
