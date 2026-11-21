// Holo: bend.
import { extendSkin } from '../../core/skin.js';
import { BEND } from '../../primitives/bend.js';
import { PILL } from '../../primitives/pill.js';
import { ADD } from '../../core/scene.js';

extendSkin('holo', {
  bend(scene, { rect, speed }, { colors }) {
    const curve = Math.min(Math.abs(speed) * 0.3, 0.85);
    scene.push(BEND, rect, [curve, -speed * 7]);
    // The leading edge catches the light.
    const x = speed > 0 ? rect[0] + rect[2] - 2 : rect[0];
    scene.push(PILL, [x, rect[1], 2, rect[3]], [0, 0, 14, Math.min(Math.abs(speed) * 0.35, 0.7)], colors.holo, ADD);
  },
});
