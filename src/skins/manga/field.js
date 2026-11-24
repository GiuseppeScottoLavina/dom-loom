// Manga: field.
import { extendSkin } from '../../core/skin.js';
import { JITTER } from '../../primitives/jitter.js';
import { PILL } from '../../primitives/pill.js';
import { TONE } from '../../primitives/tone.js';
import { INK } from '../../core/scene.js';
import { clamp01, easeInOutCubic } from '../../core/spring.js';
import { ANGLE, pad } from './util.js';

extendSkin('manga', {
  // Focus inks the line you write on, from the left; typing lays a light tone under the
  // words; an invalid value is underlined in the spot colour and shudders.
  field(scene, { rect: r, scan, focus, typing, invalid, glitch }, { colors, now, reduced, durations }) {
    const color = invalid ? colors.spot : colors.ink;
    const k = scan / durations.scan;
    const drawn = k >= 0 && k < 1 && !reduced ? easeInOutCubic(k) : clamp01(focus);
    const width = invalid ? r[2] : r[2] * Math.min(drawn, clamp01(focus));
    if (width > 0.5) scene.push(PILL, [r[0], r[1] + r[3] - 3, width, 3], [0, 0, 0, 1], color, INK);
    if (typing > 0.01) scene.push(TONE, r, [0, 0, 4, 0.12 * typing], [...colors.ink, ANGLE], INK, 0, 1);
    const g = glitch / durations.glitch;
    if (g >= 0 && g < 1 && !reduced) scene.push(JITTER, pad(r, 8, 3), [5 * (1 - g) ** 1.3, now * 0.09, now * 0.07]);
  },
});
