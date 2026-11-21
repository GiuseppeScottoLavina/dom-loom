// Holo: badge.
import { extendSkin } from '../../core/skin.js';
import { tone } from '../../core/audio.js';
import { GLITCH } from '../../primitives/glitch.js';
import { PILL } from '../../primitives/pill.js';
import { RING } from '../../primitives/ring.js';
import { ADD } from '../../core/scene.js';
import { clamp01, easeOutCubic } from '../../core/spring.js';
import { pad, center } from './util.js';

extendSkin('holo', {
  badge(scene, { rect, t, up }, { colors, now, durations, reduced }) {
    const k = clamp01(t / durations.ring);
    const color = up ? colors.signal : colors.holo;
    const [cx, cy] = center(rect);
    if (!reduced && k < 0.6) scene.push(GLITCH, pad(rect, 4, 2), [4 * (1 - k / 0.6), 2, Math.floor(now / 40) % 4093]);
    scene.push(RING, [cx, cy, Math.max(rect[2], rect[3]) * (0.6 + 1.4 * easeOutCubic(k)), 1 + 3 * k], [(1 - k) ** 2 * 0.9], color);
    scene.push(PILL, rect, [rect[3] / 2, 0, 10, (1 - k) ** 2 * 0.5], color, ADD);
  },
}, {
  ping: () => {
    tone({ type: 'sine', from: 1760, duration: 0.09, gain: 0.06 });
    tone({ type: 'sine', from: 2640, duration: 0.12, gain: 0.04, delay: 0.05 });
  },
});
