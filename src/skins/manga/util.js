// Helpers shared by manga's draw hooks.
import { PILL } from '../../primitives/pill.js';
import { INK } from '../../core/scene.js';

export const pad = ([x, y, w, h], px, py = px) => [x - px, y - py, w + 2 * px, h + 2 * py];
export const center = ([x, y, w, h]) => [x + w / 2, y + h / 2];

/** The screen angle of the tone: 45°, as most tone sheets are laid. */
export const ANGLE = Math.PI / 4;

/** A seed that changes twelve times a second: focus lines are redrawn on twos, as in animation. */
export const onTwos = (now) => Math.floor(now / 83);

/** An ink border of the given width around a rect, inked with alpha. */
export function frame(scene, [x, y, w, h], width, alpha, color) {
  if (alpha <= 0.003 || width <= 0.05) return;
  const p = [0, 0, 0, alpha];
  scene.push(PILL, [x, y, w, width], p, color, INK);
  scene.push(PILL, [x, y + h - width, w, width], p, color, INK);
  scene.push(PILL, [x, y + width, width, h - 2 * width], p, color, INK);
  scene.push(PILL, [x + w - width, y + width, width, h - 2 * width], p, color, INK);
}
