// Holo: range, interval.
import { extendSkin } from '../../core/skin.js';
import { DIAMOND } from '../../primitives/diamond.js';
import { LIQUID } from '../../primitives/liquid.js';
import { clamp01 } from '../../core/spring.js';

extendSkin('holo', {
  range(scene, { rect: r, value, drag, slosh }, { colors, now }) {
    const half = 9;
    const cy = r[1] + r[3] / 2;
    const tx = r[0] + half + clamp01(value) * (r[2] - 2 * half);
    scene.push(LIQUID, [r[0], cy - 4, r[2], 8], [tx - r[0], slosh, now * 0.014, 0.95], colors.holo);
    scene.push(DIAMOND, [tx, cy, 8 + drag * 2.5, 0], [5 + drag * 9, 1, drag], colors.holo);
  },

  interval(scene, { rect: r, low, high, drag, slosh }, { colors, now }) {
    const half = 9;
    const cy = r[1] + r[3] / 2;
    const x0 = r[0] + half + clamp01(low) * (r[2] - 2 * half);
    const x1 = r[0] + half + clamp01(high) * (r[2] - 2 * half);
    scene.push(LIQUID, [x0, cy - 4, r[0] + r[2] - x0, 8], [x1 - x0, slosh, now * 0.014, 0.95], colors.holo);
    scene.push(DIAMOND, [x0, cy, 8 + drag[0] * 2.5, 0], [5 + drag[0] * 9, 1, drag[0]], colors.holo);
    scene.push(DIAMOND, [x1, cy, 8 + drag[1] * 2.5, 0], [5 + drag[1] * 9, 1, drag[1]], colors.holo);
  },
});
