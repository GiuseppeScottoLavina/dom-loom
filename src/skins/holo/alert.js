// Holo: alert.
import { extendSkin } from '../../core/skin.js';
import { tone, noise } from '../../core/audio.js';
import { DENT } from '../../primitives/dent.js';
import { GLITCH } from '../../primitives/glitch.js';
import { PILL } from '../../primitives/pill.js';
import { SWEEP } from '../../primitives/sweep.js';
import { ADD } from '../../core/scene.js';
import { clamp01, easeOutCubic } from '../../core/spring.js';
import { pad } from './util.js';

extendSkin('holo', {
  alert(scene, { rect, t, tone }, { colors, now, durations, reduced }) {
    const color = { good: colors.holo, warn: colors.warn, bad: colors.signal }[tone] ?? colors.signal;
    const k = clamp01(t / durations.burst);
    const cx = rect[0] + 10;
    const cy = rect[1] + rect[3] / 2;
    if (!reduced) {
      // The alert lands: a shock from its edge, its text tears for a moment.
      scene.push(DENT, pad(rect, 24), [cx, cy, 80, 0], [easeOutCubic(k) * rect[2] * 1.1, (1 - k) ** 2 * 6, 16]);
      const g = clamp01(t / 380);
      if (g < 1) scene.push(GLITCH, pad(rect, 6, 2), [7 * (1 - g) ** 1.4, 2 + ((now / 50) % 3), Math.floor(now / 40) % 4093]);
    }
    scene.push(SWEEP, rect, [easeOutCubic(k) * 1.1, 1, 0.8 * (1 - k)], color);
    scene.push(PILL, rect, [1, 0, 14, (1 - k) ** 2 * 0.35], color, ADD);
  },
}, {
  alarm: (tone_ = 'bad') => {
    const base = tone_ === 'bad' ? 220 : tone_ === 'warn' ? 330 : 520;
    for (let i = 0; i < 2; i++) {
      tone({ type: 'square', from: base, to: base * 1.5, duration: 0.11, gain: 0.05, delay: i * 0.14 });
    }
    noise({ duration: 0.18, gain: 0.08, filter: 'lowpass', from: 2400, to: 300, q: 0.7 });
  },
});
