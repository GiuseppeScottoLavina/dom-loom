// Plain: no look of its own. The page keeps its CSS, its design system, its colours; the
// stage adds only motion that belongs to any material: a focus ring that travels between
// controls, a press that gives, a hold that fills, a refusal that shakes. Colours come
// from the page: its accent-color, its text colour, the background behind the stage.
import { DENT } from '../../primitives/dent.js';
import { JITTER } from '../../primitives/jitter.js';
import { OUTLINE } from '../../primitives/outline.js';
import { PILL } from '../../primitives/pill.js';
import { BEHIND, OVER } from '../../core/scene.js';
import { clamp01, easeOutCubic } from '../../core/spring.js';
import { defineSkin, extendSkin } from '../../core/skin.js';

const pad = ([x, y, w, h], p) => [x - p, y - p, w + 2 * p, h + 2 * p];

/** The first background that is not transparent, from the stage up; the canvas colour without one. */
function pageBackground(stage) {
  for (let el = stage; el; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor;
    const alpha = c.match(/rgba?\([^)]*,\s*([\d.]+)\)$/);
    if (c !== 'transparent' && (!alpha || Number(alpha[1]) > 0.5)) return c;
  }
  return 'Canvas';
}

/**
 * The page's accent: the stage's accent-color, else the one the page gives its controls
 * inside the stage (many frameworks set it on checkboxes, radios and ranges only), else the
 * blue browsers use for form controls.
 */
function pageAccent(stage) {
  const own = getComputedStyle(stage).accentColor;
  if (own && own !== 'auto') return own;
  const control = stage.querySelector('input[type=checkbox], input[type=radio], input[type=range], progress');
  const theirs = control && getComputedStyle(control).accentColor;
  return theirs && theirs !== 'auto' ? theirs : '#0a66ff';
}

/** An element's corner radius in css px (its top-left corner), cached per element. */
const radii = new WeakMap();
function radiusOf(el) {
  if (!el) return 0;
  let r = radii.get(el);
  if (r === undefined) {
    r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    radii.set(el, r);
  }
  return r;
}

const draw = {
  // Focus: a ring one gap outside the control, with its corners; it travels to the next one.
  reticle(scene, { el, rect, alpha, flash }, { colors }) {
    if (alpha < 0.01) return;
    scene.push(OUTLINE, rect, [radiusOf(el) + 5, 2, clamp01(alpha), 5 * flash], colors.accent, OVER);
  },

  // A press gives a little under the finger.
  press(scene, { rect, point, depth, strength }) {
    const [cx, cy] = point;
    const size = Math.min(Math.max(rect[2], rect[3]), 160);
    scene.push(DENT, pad(rect, 10), [cx, cy, size * 0.55, depth * strength * 0.5], [0, 0, 8]);
  },

  // Holding: the accent fills the control from its leading edge (on a dark control it takes
  // the ground and spares the lettering), with a bar along its foot for light controls.
  charge(scene, { el, rect, progress: p }, { colors }) {
    if (p < 0.004) return;
    const radius = radiusOf(el);
    scene.push(PILL, [rect[0], rect[1], rect[2] * p, rect[3]], [radius, 0, 0, 0.9], colors.accent, BEHIND);
    scene.push(PILL, [rect[0], rect[1] + rect[3] - 3, rect[2] * p, 3], [1.5, 0, 0, 1], colors.accent, OVER);
  },

  // A finished hold: a ripple leaves the control's edge and the page gives once.
  burst(scene, { el, rect, t }, { colors, durations }) {
    const k = clamp01(t / durations.burst);
    if (k >= 1) return;
    const grow = easeOutCubic(k) * 22;
    scene.push(OUTLINE, pad(rect, 3 + grow), [radiusOf(el) + 3 + grow, 2, (1 - k) ** 2, 0], colors.accent, OVER);
    const [cx, cy] = [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2];
    scene.push(DENT, pad(rect, 16), [cx, cy, Math.max(rect[2], rect[3]), 0], [easeOutCubic(k) * Math.max(rect[2], rect[3]) * 0.7, (1 - k) ** 2 * 1.6, 10]);
  },

  // A refused click: the control shakes, as a wrong password does.
  nudge(scene, { rect, t }, { now, durations }) {
    const k = clamp01(t / durations.nudge);
    scene.push(JITTER, pad(rect, 6), [(1 - k) * 4, now * 0.09, now * 0.07]);
  },
};

export const plain = defineSkin({
  name: 'plain',
  tokens: {
    accent: ['--loom-accent', pageAccent],
    ink: ['--loom-ink', 'currentColor'],
    bg: ['--loom-bg', pageBackground],
  },
  // The cut's band is the page itself, led by a thin accent edge.
  roles: { hot: 'bg', rim: 'accent', bg: 'bg', void: 'bg' },
  shader: { scanlines: 0, chroma: 0, crumble: 0, hatch: 0 },
  boot: null,
  // Only focus is painted by the stage; ranges, meters and progress keep the page's look.
  draws: ['focus'],
  reticle: { hover: false },
  draw,
});

// A field that turns invalid shakes; its look stays the page's (:user-invalid).
extendSkin('plain', {
  field(scene, { rect, glitch }, { reduced, durations }) {
    const g = glitch / durations.glitch;
    if (g >= 0 && g < 1 && !reduced) scene.push(JITTER, pad(rect, 8), [5 * (1 - g) ** 1.3, g * 40, g * 31]);
  },
});
