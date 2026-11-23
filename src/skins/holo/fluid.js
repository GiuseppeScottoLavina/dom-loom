// Holo: fluid.
import { extendSkin } from '../../core/skin.js';
import { FLUID } from '../../primitives/fluid.js';

extendSkin('holo', {
  fluid(scene, { rect, strength }) {
    // The water throws holo caustics and a glint: the glow is the strength of the light it casts.
    scene.push(FLUID, rect, [strength, 1, 0, 0]);
  },
});
