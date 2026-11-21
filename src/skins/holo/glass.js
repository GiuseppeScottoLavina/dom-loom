// Moving selections are glass (holo's radio group and tab indicator).
import { LENS } from '../../primitives/lens.js';

/**
 * A moving selection is glass: the labels it slides over bend at its edges. The
 * strength follows the speed of its edges, so a selection at rest refracts nothing.
 */
export function glass(scene, rect, motion, skew = 0, radius = 1) {
  const speed = Math.max(Math.abs(motion.l.v), Math.abs(motion.r.v), Math.abs(motion.t.v), Math.abs(motion.b.v));
  const strength = Math.min(speed * 0.005, 6);
  if (strength < 0.3) return;
  const lean = Math.abs(skew) * rect[3] / 2 + 1;
  scene.push(LENS, [rect[0] - lean, rect[1] - 1, rect[2] + 2 * lean, rect[3] + 2], [radius, strength, 22, skew], rect);
}
