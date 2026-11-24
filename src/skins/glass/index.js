// Glass: liquid glass over live content. A pane is clear in its middle and thick at its
// edge, where what passes under it bends; it keeps the page's colours and lettering. Mark
// panes with the `glass` attribute (dom-loom/glass); the stage draws them over the picture.
import { DENT } from '../../primitives/dent.js';
import { GLASS } from '../../primitives/glass.js';
import { OUTLINE } from '../../primitives/outline.js';
import { OVER } from '../../core/scene.js';
import { clamp01 } from '../../core/spring.js';
import { defineSkin } from '../../core/skin.js';
import { pageAccent, pageBackground, pageIsDark } from '../page.js';

const pad = ([x, y, w, h], p) => [x - p, y - p, w + 2 * p, h + 2 * p];

const draw = {
  // A pane: its rim band and bend follow its size, so a small button and a wide bar read
  // as the same glass.
  glass(scene, { rect, radius }, { colors }) {
    const short = Math.min(rect[2], rect[3]);
    const band = Math.min(16, short * 0.3);
    // The milk of the pane is its CSS background (glass.css), painted under its own lettering;
    // the stage adds what CSS cannot: the bend at the rim, the light on it, the shadow.
    scene.push(GLASS, rect, [radius, band, band * 0.9, 0], [...colors.tint, 1], 0, 0, 1);
  },

  // A press gives like jelly under the finger, pane and all.
  press(scene, { rect, point, depth, strength }) {
    const [cx, cy] = point;
    const size = Math.min(Math.max(rect[2], rect[3]), 180);
    scene.push(DENT, pad(rect, 12), [cx, cy, size * 0.6, depth * strength * 0.7], [0, 0, 9]);
  },

  // Keyboard focus: a thin ring one gap outside the control.
  reticle(scene, { el, rect, alpha }, { colors }) {
    if (alpha < 0.01) return;
    const r = el ? parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 : 0;
    scene.push(OUTLINE, rect, [r + 5, 2, clamp01(alpha), 0], colors.accent, OVER);
  },
};

export const glass = defineSkin({
  name: 'glass',
  tokens: {
    accent: ['--loom-accent', pageAccent],
    bg: ['--loom-bg', pageBackground],
    // The glass takes a little of the light: white on a light page, a deep grey on a dark one.
    tint: ['--loom-glass-tint', (stage) => (pageIsDark(stage) ? '#1c1c22' : '#ffffff')],
  },
  roles: { hot: 'bg', rim: 'accent', bg: 'bg', void: 'bg' },
  shader: { scanlines: 0, chroma: 0, crumble: 0, hatch: 0 },
  boot: null,
  draws: ['focus'],
  reticle: { hover: false },
  draw,
});
