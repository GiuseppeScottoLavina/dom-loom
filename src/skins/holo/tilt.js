// Holo: tilt.
import { extendSkin } from '../../core/skin.js';
import { TILT } from '../../primitives/tilt.js';

extendSkin('holo', {
  tilt(scene, { rect, rotX, rotY, lift, glare }) {
    // Holo cards are foil: the edges of what is on them shine as they turn.
    scene.push(TILT, rect, [rotX, rotY, 900, lift], [1, 1, glare[0], glare[1]], 16);
  },
});
