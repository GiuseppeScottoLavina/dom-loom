// Holo: field.
import { extendSkin } from '../../core/skin.js';
import { GLITCH } from '../../primitives/glitch.js';
import { PILL } from '../../primitives/pill.js';
import { SWEEP } from '../../primitives/sweep.js';
import { ADD } from '../../core/scene.js';
import { clamp01, easeInOutCubic } from '../../core/spring.js';
import { pad } from './util.js';

extendSkin('holo', {
  field(scene, { rect: r, scan, focus, typing, invalid, glitch }, { colors, now, reduced, durations }) {
    const color = invalid ? colors.signal : colors.holo;
    const k = scan / durations.scan;
    if (k >= 0 && k < 1 && !reduced) {
      scene.push(SWEEP, r, [easeInOutCubic(k) * 1.08, 1, 0.9 * (1 - k * 0.5)], colors.holo);
    }
    const width = invalid ? r[2] : r[2] * clamp01(focus);
    if (width > 0.5) {
      scene.push(PILL, [r[0], r[1] + r[3] - 2, width, 2], [1, 0, 5 + typing * 6, 0.8 + typing * 0.6], color, ADD);
    }
    const g = glitch / durations.glitch;
    if (g >= 0 && g < 1 && !reduced) {
      const strength = 8 * (1 - g) ** 1.3;
      scene.push(GLITCH, pad(r, 8, 3), [strength, 3 + ((now / 60) % 3), Math.floor(now / 45) % 4093]);
      scene.push(PILL, r, [2, 0, 6, (1 - g) * 0.22], colors.signal, ADD);
    }
  },
});
