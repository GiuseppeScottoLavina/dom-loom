// Holo: an overlay opening and closing.
import { extendSkin } from '../../core/skin.js';
import { APERTURE } from '../../primitives/aperture.js';

extendSkin('holo', {
  aperture(scene, { rect, open, from }, { colors }) {
    scene.push(APERTURE, rect, [open, from], colors.holo);
  },
});
