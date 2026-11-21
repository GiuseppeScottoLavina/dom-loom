// Holo: choice, switch, checkbox, toggled.
import { extendSkin } from '../../core/skin.js';
import { tone } from '../../core/audio.js';
import { PILL } from '../../primitives/pill.js';
import { RING } from '../../primitives/ring.js';
import { BEHIND, OVER } from '../../core/scene.js';
import { clamp01, easeOutCubic } from '../../core/spring.js';
import { center } from './util.js';
import { glass } from './glass.js';

extendSkin('holo', {
  choice(scene, { rect, alpha, motion }, { colors, reduced }) {
    const pill = [rect[0] + 3, rect[1], rect[2] - 6, rect[3]];
    if (!reduced) glass(scene, pill, motion, -0.2);
    scene.push(PILL, pill, [1, -0.2, 10, alpha], colors.signal, BEHIND);
  },

  switch(scene, { rect: r, position, velocity, on }, { colors }) {
    const knob = r[3] - 8;
    const travel = r[2] - 8 - knob;
    const stretch = Math.min(Math.abs(velocity) * 0.012, 0.8) * knob;
    const x = r[0] + 4 + clamp01(position) * travel - (velocity > 0 ? stretch : 0);
    scene.push(PILL, r, [r[3] / 2, 0, 8 * on, on * 0.92], colors.holo, BEHIND);
    const knobColor = colors.line.map((c, i) => c + (colors.bg[i] - c) * on);
    scene.push(PILL, [x, r[1] + 4, knob + stretch, knob], [knob / 2, 0, 0, 1], knobColor, OVER);
  },

  checkbox(scene, { rect: r, amount: k }, { colors }) {
    if (k <= 0.01) return;
    const inner = [r[0] + r[2] / 2 - (r[2] / 2 - 2) * k, r[1] + r[3] / 2 - (r[3] / 2 - 2) * k, (r[2] - 4) * k, (r[3] - 4) * k];
    scene.push(PILL, inner, [1.5, 0, 6 * k, 0.5], colors.holo, BEHIND);
  },

  toggled(scene, { rect, t, on, select }, { colors, durations }) {
    const k = clamp01(t / durations.ring);
    const [cx, cy] = center(rect);
    const radius = easeOutCubic(k) * Math.max(rect[2], rect[3]) * (select ? 0.75 : 1.1);
    scene.push(RING, [cx, cy, radius, 1.2 + 3 * k], [(1 - k) ** 2 * (on ? 0.9 : 0.35)], select ? colors.signal : colors.holo);
  },
}, {
  toggle: (on) => {
    tone({ type: 'square', from: on ? 660 : 990, duration: 0.05, gain: 0.04 });
    tone({ type: 'square', from: on ? 990 : 660, duration: 0.07, gain: 0.04, delay: 0.045 });
  },
});
