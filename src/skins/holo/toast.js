// Holo: toast.
import { extendSkin } from '../../core/skin.js';
import { PILL } from '../../primitives/pill.js';
import { ADD } from '../../core/scene.js';

extendSkin('holo', {
  toast(scene, { rect, left, paused, tone }, { colors }) {
    // The time left, as a bar of light along the bottom edge.
    const color = { good: colors.holo, warn: colors.warn, bad: colors.signal }[tone] ?? colors.holo;
    scene.push(PILL, [rect[0] + 1, rect[1] + rect[3] - 3, (rect[2] - 2) * left, 2], [0, 0, 6, paused ? 0.45 : 0.9], color, ADD);
  },
});
