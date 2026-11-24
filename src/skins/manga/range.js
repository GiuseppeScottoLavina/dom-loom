// Manga: range, interval.
import { extendSkin } from '../../core/skin.js';
import { FOCUS } from '../../primitives/focus.js';
import { PILL } from '../../primitives/pill.js';
import { TONE } from '../../primitives/tone.js';
import { INK, OVER } from '../../core/scene.js';
import { clamp01 } from '../../core/spring.js';
import { ANGLE, onTwos } from './util.js';

const HALF = 9;

/** The thumb: an ink disc with a paper eye; dragging it throws focus lines. */
function thumb(scene, x, cy, drag, colors, now) {
  const r = 8 + drag * 2;
  if (drag > 0.02) {
    scene.push(FOCUS, [x - 46, cy - 46, 92, 92], [x, cy, r + 4, r + 4], [...colors.ink, 40], INK, onTwos(now), drag * 0.8);
  }
  scene.push(PILL, [x - r, cy - r, 2 * r, 2 * r], [r, 0, 0, 1], colors.ink, OVER);
  scene.push(PILL, [x - 3, cy - 3, 6, 6], [3, 0, 0, 1], colors.paper, OVER);
}

extendSkin('manga', {
  range(scene, { rect: r, value, drag }, { colors, now }) {
    const cy = r[1] + r[3] / 2;
    const tx = r[0] + HALF + clamp01(value) * (r[2] - 2 * HALF);
    scene.push(TONE, [r[0], cy - 5, tx - r[0], 10], [0, 0, 4, 0.62], [...colors.ink, ANGLE], INK, 0, 1);
    thumb(scene, tx, cy, drag, colors, now);
  },

  interval(scene, { rect: r, low, high, drag }, { colors, now }) {
    const cy = r[1] + r[3] / 2;
    const x0 = r[0] + HALF + clamp01(low) * (r[2] - 2 * HALF);
    const x1 = r[0] + HALF + clamp01(high) * (r[2] - 2 * HALF);
    scene.push(TONE, [x0, cy - 5, x1 - x0, 10], [0, 0, 4, 0.62], [...colors.ink, ANGLE], INK, 0, 1);
    thumb(scene, x0, cy, drag[0], colors, now);
    thumb(scene, x1, cy, drag[1], colors, now);
  },
});
