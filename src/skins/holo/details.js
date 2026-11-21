// Holo: reveal.
import { extendSkin } from '../../core/skin.js';
import { PILL } from '../../primitives/pill.js';
import { ADD } from '../../core/scene.js';

extendSkin('holo', {
  reveal(scene, { column: [cx, cw], line, shown, k, opening }, { colors }) {
    if (opening) scene.push(PILL, [cx, line, cw, shown], [0, 0, 0, 0.05 * (1 - k)], colors.holo, ADD);
    scene.push(PILL, [cx, line + shown - 1, cw, 2], [0, 0, 10, 0.25 + 0.75 * (1 - k)], colors.holo, ADD);
  },
});
