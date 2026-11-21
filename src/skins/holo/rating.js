// Holo: rating.
import { extendSkin } from '../../core/skin.js';
import { tone } from '../../core/audio.js';
import { RING } from '../../primitives/ring.js';
import { STAR } from '../../primitives/star.js';
import { clamp01, easeOutBack, easeOutCubic } from '../../core/spring.js';

extendSkin('holo', {
  rating(scene, { stars, value, hover, lit }, { colors, durations, reduced }) {
    stars.forEach((r, i) => {
      const cx = r[0] + r[2] / 2;
      const cy = r[1] + r[3] / 2 + 0.5;
      const radius = Math.min(r[2], r[3]) * 0.44;
      const on = i <= value;
      const t = lit[i];
      if (on) {
        // Each star lights after the one before; it pops, then settles.
        const k = clamp01(t / durations.ring);
        const fill = t < 0 ? 0 : clamp01(t / 90);
        const pop = reduced || t < 0 ? 1 : easeOutBack(clamp01(t / 260), 3);
        scene.push(STAR, [cx, cy, radius * pop, 0.46], [6, 1, fill], colors.warn);
        if (t >= 0 && k < 1 && !reduced) scene.push(RING, [cx, cy, radius * (1 + 1.6 * easeOutCubic(k)), 1 + 3 * k], [(1 - k) ** 2 * 0.8], colors.warn);
      } else if (hover >= 0 && i <= hover) {
        scene.push(STAR, [cx, cy, radius, 0.46], [3, 0.8, 0.3], colors.holo);
      }
    });
  },
}, {
  rate: (n = 1) => {
    for (let i = 0; i < n; i++) tone({ type: 'triangle', from: 660 * 2 ** (i / 6), duration: 0.1, gain: 0.05, delay: i * 0.055 });
  },
});
