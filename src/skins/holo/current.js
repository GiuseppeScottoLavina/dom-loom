// Holo: current.
import { extendSkin } from '../../core/skin.js';
import { DIAMOND } from '../../primitives/diamond.js';
import { PILL } from '../../primitives/pill.js';
import { ADD } from '../../core/scene.js';
import { indicator } from './indicator.js';

extendSkin('holo', {
  current(scene, { list, value, rect, alpha, motion, items, index }, ctx) {
    const { colors } = ctx;
    if (value === 'step') {
      // A stepper: a beam runs along the track from the first marker to the current
      // one; steps behind are lit, the current one burns.
      const marker = (r) => [r[0] + 7, r[1] + 7];
      const [x0, y0] = marker(items[0] ?? rect);
      const [x1] = marker(rect);
      if (x1 > x0) scene.push(PILL, [x0, y0 - 1, x1 - x0, 2], [1, 0, 8, alpha], colors.holo, ADD);
      for (let i = 0; i < index; i++) {
        const [mx, my] = marker(items[i]);
        scene.push(DIAMOND, [mx, my, 5, 0], [3, alpha * 0.9, 1], colors.holo);
      }
      scene.push(DIAMOND, [x1, y0, 7, 0], [10, alpha, 1], colors.holo);
      return;
    }
    if (list.closest('[current=line]')) {
      // A page's navigation: a line resting on the bottom edge of the current item, inside
      // its box (no glow: it never leaves the canvas, even for an item as tall as the stage).
      scene.push(PILL, [rect[0], rect[1] + rect[3] - 3, rect[2], 3], [0, 0, 0, alpha], colors.holo, ADD);
      return;
    }
    if (list.closest('nav[aria-label="breadcrumb" i]')) {
      // Where you are: a thin trace under the last crumb.
      scene.push(PILL, [rect[0], rect[1] + rect[3] + 1, rect[2], 1.5], [0.5, 0, 6, alpha], colors.holo, ADD);
      return;
    }
    indicator(scene, { rect, alpha, motion }, ctx);
  },
});
