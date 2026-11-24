// Manga: ink on paper. Nothing glows: ink multiplies the page, every grey is a screentone,
// a selection is a reversed panel (white on black), a press throws focus lines, a finished
// hold is an impact panel. One spot colour, as on a two-colour magazine page.
import { DENT } from '../../primitives/dent.js';
import { FOCUS } from '../../primitives/focus.js';
import { JITTER } from '../../primitives/jitter.js';
import { PILL } from '../../primitives/pill.js';
import { TONE } from '../../primitives/tone.js';
import { BEHIND, INK } from '../../core/scene.js';
import { clamp01, easeOutCubic } from '../../core/spring.js';
import { defineSkin } from '../../core/skin.js';
import { center, frame, pad, onTwos, ANGLE } from './util.js';
import './choice.js';
import './field.js';
import './range.js';

const draw = {
  // Focus: a second panel border, a beat away from the control, with a spot tab on its
  // corner. It comes and goes by its weight, never by fading to grey.
  reticle(scene, { rect, alpha, flash }, { colors }) {
    const k = clamp01(alpha);
    if (k < 0.04) return;
    const gap = 4 + 3 * flash;
    frame(scene, pad(rect, gap), 2.5 * k, 1, colors.ink);
    scene.push(PILL, [rect[0] - gap - 1, rect[1] - gap - 6 * k, 18, 5 * k], [0, -0.6, 0, 1], colors.spot, INK);
  },

  // A press dents the paper and lays tone under the finger; the release throws a short
  // ring of focus lines.
  press(scene, { rect, point, depth, t, released, strength }, { colors, durations, now }) {
    const [cx, cy] = point;
    const size = Math.min(Math.max(rect[2], rect[3]), 200);
    scene.push(DENT, pad(rect, 12), [cx, cy, size * 0.55, depth * strength * 0.8], [0, 0, 9]);
    const cover = clamp01(depth) * 0.32 * strength;
    if (cover > 0.01) scene.push(TONE, rect, [0, 0, 5, cover], [...colors.ink, ANGLE], INK, 0, 1);
    if (!released) return;
    const k = clamp01(t / durations.press);
    if (k >= 1) return;
    const [bx, by] = center(rect);
    const reach = 26 + 30 * easeOutCubic(k);
    scene.push(FOCUS, pad(rect, reach), [bx, by, rect[2] / 2 + 6 + 10 * k, rect[3] / 2 + 6 + 10 * k],
      [...colors.ink, 72], INK, onTwos(now), (1 - k) ** 1.6 * strength);
  },

  // Holding: tone fills the button from its leading edge, the button trembles and the
  // focus lines close in. On a button printed in the spot colour the tone is ink that
  // spares the lettering; on paper it is the spot colour.
  charge(scene, { el, rect, progress: p, holding }, { colors, now }) {
    const fill = [rect[0], rect[1], rect[2] * p, rect[3]];
    const printed = el?.matches?.('[type=submit], .loom-primary');
    if (p > 0.004) {
      scene.push(TONE, fill, [0, 0, 4.5, 0.28 + 0.27 * p], [...(printed ? colors.ink : colors.spot), ANGLE], printed ? BEHIND : INK, 0, 1);
    }
    if (holding) scene.push(JITTER, pad(rect, 6), [p * p * 2.4, now * 0.047, now * 0.063]);
    if (p > 0.05) {
      const [cx, cy] = center(rect);
      const reach = 90 - 50 * p;
      scene.push(FOCUS, pad(rect, reach), [cx, cy, rect[2] / 2 + reach * 0.45, rect[3] / 2 + reach * 0.45],
        [...colors.ink, 90], INK, onTwos(now), p * p * 0.9);
    }
  },

  // A finished hold is an impact panel: the paper shocks outward, focus lines fill the
  // panel and fade, the button flashes in the spot colour.
  burst(scene, { rect, t }, { colors, durations, now }) {
    const k = clamp01(t / durations.burst);
    const [cx, cy] = center(rect);
    const size = Math.max(rect[2], rect[3]);
    const ringR = easeOutCubic(k) * size * 1.6;
    scene.push(DENT, pad(rect, 60), [cx, cy, size, 0], [ringR, (1 - k) ** 2 * 6, 16]);
    // The lines run to the edges of the stage (the clip is wider than any panel).
    scene.push(FOCUS, pad(rect, 2400), [cx, cy, rect[2] / 2 + 18 + 40 * k, rect[3] / 2 + 14 + 30 * k],
      [...colors.ink, 150], INK, onTwos(now), (1 - k) ** 1.3);
    scene.push(TONE, rect, [0, 0, 4.5, 0.85], [...colors.ink, ANGLE], BEHIND, 0, (1 - k) ** 2);
  },

  // A refused click: the button shudders and its border flushes red.
  nudge(scene, { rect, t }, { colors, now, durations }) {
    const k = clamp01(t / durations.nudge);
    scene.push(JITTER, pad(rect, 6), [(1 - k) * 4, now * 0.09, now * 0.07]);
    frame(scene, rect, 3.5 * Math.sin(k * Math.PI), 1, colors.spot);
  },

  // A number that rolled: a flash of tone where it changed.
  rolled(scene, { rect, t }, { colors }) {
    const k = clamp01(t / 260);
    if (k < 1) scene.push(TONE, rect, [0, 0, 4, 0.3 * (1 - k)], [...colors.ink, ANGLE], INK, 0, 1);
  },

  // A list unfolding: the ink line that leads it.
  unfold(scene, { rect, line, k }, { colors }) {
    const w = 1.5 + 2 * (1 - k);
    scene.push(PILL, [rect[0], line - w / 2, rect[2], w], [0, 0, 0, 1], colors.ink, INK);
  },
};

export const manga = defineSkin({
  name: 'manga',
  tokens: {
    ink: ['--loom-ink', '#141215'],
    paper: ['--loom-panel', '#f7f5f0'],
    spot: ['--loom-spot', '#e3242b'],
    stock: ['--loom-void', '#d8e1e5'],
  },
  // The compositor's own colours: the cut's band, its edge, empty space.
  roles: { hot: 'spot', rim: 'ink', bg: 'paper', void: 'stock' },
  shader: { scanlines: 0, chroma: 0, crumble: 0, hatch: 1 },
  boot: null,
  draw,
});
