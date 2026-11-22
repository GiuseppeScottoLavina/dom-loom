// Holo: the focused item of a menu, a light that slides from item to item.
import { extendSkin } from '../../core/skin.js';
import { PILL } from '../../primitives/pill.js';
import { ADD, BEHIND } from '../../core/scene.js';
import { glass } from './glass.js';

extendSkin('holo', {
  menuitem(scene, { rect, alpha, motion }, { colors, reduced }) {
    if (!reduced) glass(scene, rect, motion, 0, 0);
    scene.push(PILL, rect, [0, 0, 0, 0.16 * alpha], colors.holo, BEHIND);
    scene.push(PILL, [rect[0], rect[1] + 4, 2, rect[3] - 8], [0, 0, 7, alpha], colors.holo, ADD);
  },
});
