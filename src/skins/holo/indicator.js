// The tab indicator, shared by tabs and aria-current lists.
import { DIAMOND } from '../../primitives/diamond.js';
import { PILL } from '../../primitives/pill.js';
import { ADD, BEHIND } from '../../core/scene.js';
import { glass } from './glass.js';

export function indicator(scene, { rect, alpha, motion }, { colors, reduced }) {
  const [x, y, w, h] = rect;
  if (!reduced) glass(scene, rect, motion, 0, 0);
  scene.push(PILL, rect, [0, 0, 0, 0.13 * alpha], colors.holo, BEHIND);
  scene.push(PILL, [x + 3, y + h - 3, w - 6, 3], [0.5, 0, 9, alpha], colors.holo, ADD);
  scene.push(DIAMOND, [x + w / 2, y + h - 1.5, 3.5, 0], [4, alpha, 1], colors.holo);
}
