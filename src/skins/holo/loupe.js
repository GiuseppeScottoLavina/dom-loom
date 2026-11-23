// Holo: loupe.
import { extendSkin } from '../../core/skin.js';
import { LOUPE } from '../../primitives/loupe.js';

extendSkin('holo', {
  loupe(scene, { rect, center, focus, radius, mag, open, phase }) {
    // The glass catches the rim colour (holo) and the signal on its far side; the reticle
    // ticks are holo's own: other skins can leave them out (strength 0).
    scene.push(LOUPE, rect, [center[0], center[1], radius, mag], [focus[0], focus[1], 0, 0], open, phase, 1);
  },
});
