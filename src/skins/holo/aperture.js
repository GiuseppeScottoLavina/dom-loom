// Holo: an overlay opening and closing.
import { extendSkin } from '../../core/skin.js';
import { APERTURE } from '../../primitives/aperture.js';
import { ZOOM } from '../../primitives/zoom.js';

extendSkin('holo', {
  aperture(scene, { rect, open, from }, { colors }) {
    // overlay="zoom": the whole panel grows from 94 % as it fades in (and back as it closes).
    if (from === 5) {
      scene.push(ZOOM, rect, [0.94 + 0.06 * open, Math.min(1, Math.max(0, open))]);
      return;
    }
    scene.push(APERTURE, rect, [open, from], colors.holo);
  },
});
