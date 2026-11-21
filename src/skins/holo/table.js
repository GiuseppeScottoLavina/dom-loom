// Holo: sorted.
import { extendSkin } from '../../core/skin.js';
import { SWEEP } from '../../primitives/sweep.js';
import { clamp01, easeOutCubic } from '../../core/spring.js';

extendSkin('holo', {
  sorted(scene, { rect, t }, { colors, durations }) {
    const k = clamp01(t / durations.ring);
    scene.push(SWEEP, rect, [easeOutCubic(k) * 1.1, 1, 0.9 * (1 - k)], colors.holo);
  },
});
