// Holo: option.
import { extendSkin } from '../../core/skin.js';
import { PILL } from '../../primitives/pill.js';
import { ADD, BEHIND } from '../../core/scene.js';

extendSkin('holo', {
  option(scene, { rect, alpha }, { colors }) {
    scene.push(PILL, rect, [0, 0, 0, 0.16 * alpha], colors.holo, BEHIND);
    scene.push(PILL, [rect[0], rect[1] + 3, 2, rect[3] - 6], [0, 0, 6, alpha], colors.holo, ADD);
  },
});
