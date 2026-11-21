// Holo: split.
import { extendSkin } from '../../core/skin.js';
import { DIAMOND } from '../../primitives/diamond.js';
import { PILL } from '../../primitives/pill.js';
import { STRETCH } from '../../primitives/stretch.js';
import { ADD } from '../../core/scene.js';

extendSkin('holo', {
  split(scene, { rect, laid, shown, dragging, focused }, { colors }) {
    if (Math.abs(shown - laid) > 0.3) scene.push(STRETCH, rect, [rect[0], rect[0] + rect[2], laid, shown]);
    const strain = Math.min(Math.abs(shown - laid) / 30, 1);
    const color = colors.line.map((c, i) => c + (colors.signal[i] - c) * strain);
    const lit = dragging || focused ? 1 : 0.35;
    scene.push(PILL, [shown - 1, rect[1], 2, rect[3]], [0, 0, 8 * lit, lit], strain > 0.05 ? color : colors.holo, ADD);
    scene.push(DIAMOND, [shown, rect[1] + rect[3] / 2, 6, 0], [5 * lit, lit, dragging ? 1 : 0], strain > 0.05 ? colors.signal : colors.holo);
  },
});
