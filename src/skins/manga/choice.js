// Manga: choice, switch, checkbox, toggled.
import { extendSkin } from '../../core/skin.js';
import { FOCUS } from '../../primitives/focus.js';
import { PILL } from '../../primitives/pill.js';
import { TONE } from '../../primitives/tone.js';
import { INK, INVERT, OVER } from '../../core/scene.js';
import { clamp01, easeOutCubic } from '../../core/spring.js';
import { ANGLE, center, onTwos, pad } from './util.js';

extendSkin('manga', {
  // The selected option is a reversed panel: its label turns paper-white on ink, and the
  // labels it slides over reverse as it passes.
  // It appears by growing from its middle line, never by fading.
  choice(scene, { rect, alpha }) {
    const k = clamp01(alpha);
    if (k < 0.02) return;
    const inset = (1 - k) * rect[3] / 2;
    scene.push(PILL, [rect[0] + 2, rect[1] + inset, rect[2] - 4, rect[3] - 2 * inset], [0, -0.14, 0, 1], [0, 0, 0], INVERT);
  },

  switch(scene, { rect: r, position, velocity, on }, { colors }) {
    const knob = r[3] - 8;
    const travel = r[2] - 8 - knob;
    const stretch = Math.min(Math.abs(velocity) * 0.012, 0.8) * knob;
    const x = r[0] + 4 + clamp01(position) * travel - (velocity > 0 ? stretch : 0);
    if (on > 0.01) scene.push(TONE, pad(r, -2), [r[3] / 2 - 2, 0, 4, 0.35 + 0.5 * on], [...colors.ink, ANGLE], INK, 0, on);
    scene.push(PILL, [x - 1, r[1] + 3, knob + stretch + 2, knob + 2], [knob / 2 + 1, 0, 0, 1], colors.ink, OVER);
    scene.push(PILL, [x + 1.5, r[1] + 5.5, knob + stretch - 3, knob - 3], [knob / 2, 0, 0, 1], colors.paper, OVER);
  },

  checkbox(scene, { rect: r, amount: k }, { colors }) {
    if (k <= 0.01) return;
    const s = (r[2] / 2 - 3) * k;
    const [cx, cy] = center(r);
    scene.push(TONE, [cx - s, cy - s, 2 * s, 2 * s], [0, 0, 4, 0.55], [...colors.spot, ANGLE], INK, 0, 1);
  },

  // Turning something on pops: a small ring of focus lines around it.
  toggled(scene, { rect, t, on }, { colors, durations, now }) {
    if (!on) return;
    const k = clamp01(t / durations.ring);
    if (k >= 1) return;
    const [cx, cy] = center(rect);
    const clear = Math.max(rect[2], rect[3]) / 2 + 3 + 8 * easeOutCubic(k);
    scene.push(FOCUS, pad(rect, 26), [cx, cy, clear, clear], [...colors.ink, 28], INK, onTwos(now), (1 - k) ** 1.5);
  },
});
