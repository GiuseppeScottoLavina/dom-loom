// Holo: lit.
import { extendSkin } from '../../core/skin.js';
import { LIT } from '../../primitives/lit.js';

extendSkin('holo', {
  lit(scene, { rect, point, reach, power, open }) {
    // Holo's light is cool, with a signal rim on the edges that turn away from it.
    scene.push(LIT, rect, [point[0], point[1], reach, power], [reach * 0.45, 0, 0, 0], open);
  },
});
