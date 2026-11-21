// Holo: the holo-kinetic skin. Light is projected (it adds, with scan lines), the
// selection is a slanted cut in signal red, focus is a lock-on reticle, hits shake.
import {
  ADD, ARC, BEHIND, BRACKETS, DENT, DIAMOND, GAUGE, GLITCH, JITTER, LENS, LIQUID, OVER, PILL, RING, SHIFT, STAR, SWEEP, VORTEX,
} from '../../field.js';
import { defineSkin } from '../../skin.js';
import { clamp01, easeInOutCubic, easeOutBack, easeOutCubic } from '../../spring.js';
import { sounds } from './sounds.js';

const pad = ([x, y, w, h], px, py = px) => [x - px, y - py, w + 2 * px, h + 2 * py];
const center = ([x, y, w, h]) => [x + w / 2, y + h / 2];

/**
 * A moving selection is glass: the labels it slides over bend at its edges. The
 * strength follows the speed of its edges, so a selection at rest refracts nothing.
 */
function glass(scene, rect, motion, skew = 0, radius = 1) {
  const speed = Math.max(Math.abs(motion.l.v), Math.abs(motion.r.v), Math.abs(motion.t.v), Math.abs(motion.b.v));
  const strength = Math.min(speed * 0.005, 6);
  if (strength < 0.3) return;
  const lean = Math.abs(skew) * rect[3] / 2 + 1;
  scene.push(LENS, [rect[0] - lean, rect[1] - 1, rect[2] + 2 * lean, rect[3] + 2], [radius, strength, 22, skew], rect);
}

const draw = {
  reticle(scene, { rect, alpha, flash }, { colors }) {
    const arm = Math.min(10, rect[2] * 0.3, rect[3] * 0.38);
    scene.push(BRACKETS, rect, [arm, 1.6, 2.6, alpha], [...colors.holo, flash]);
  },

  press(scene, { rect, point, depth, t, released, strength }, { colors, durations }) {
    const [cx, cy] = point;
    // Wide rows (a summary, a long label) ring like a button, not like a wall.
    const size = Math.min(Math.max(rect[2], rect[3]), 200);
    const k = released ? clamp01(t / durations.press) : 0;
    const ringR = easeOutCubic(k) * size * 0.95;
    const ringAmp = released ? (1 - k) ** 2 * 3.2 * strength : 0;
    scene.push(DENT, pad(rect, 12), [cx, cy, size * 0.55, depth * strength], [ringR, ringAmp, 9]);
    if (released && k < 1) scene.push(RING, [cx, cy, ringR, 1.4 + 5 * k], [(1 - k) ** 1.5 * 0.85 * strength], colors.holo);
    const lit = clamp01(depth) * 0.1 * strength;
    if (lit > 0.002) scene.push(PILL, rect, [2, 0, 0, lit], colors.holo, ADD);
  },

  charge(scene, { rect, progress: p, holding }, { colors, now }) {
    scene.push(SWEEP, rect, [easeInOutCubic(p) * 0.92 + p * 0.08, 0, 0.96], colors.signal, BEHIND);
    if (holding) scene.push(JITTER, pad(rect, 6), [p * p * 1.9, now * 0.047, now * 0.063]);
    scene.push(PILL, rect, [2, 0, 4 + p * 14, p * 0.16], colors.signal, ADD);
  },

  burst(scene, { rect, t }, { colors, durations }) {
    const [cx, cy] = center(rect);
    const k = clamp01(t / durations.burst);
    const size = Math.max(rect[2], rect[3]);
    const ringR = easeOutCubic(k) * size * 1.5;
    scene.push(DENT, pad(rect, 40), [cx, cy, size, 0], [ringR, (1 - k) ** 2 * 7, 14]);
    scene.push(RING, [cx, cy, ringR, 2 + 10 * k], [(1 - k) ** 2 * 1.2], colors.signal);
    scene.push(RING, [cx, cy, ringR * 0.7, 1 + 3 * k], [(1 - k) ** 3], colors.ink);
    scene.push(SWEEP, rect, [1, 0, (1 - k) ** 1.5], colors.signal, BEHIND);
    scene.push(PILL, rect, [2, 0, 20, (1 - k) ** 3 * 0.5], colors.ink, ADD);
  },

  nudge(scene, { rect, t }, { colors, now, durations }) {
    const k = clamp01(t / durations.nudge);
    scene.push(JITTER, pad(rect, 6), [(1 - k) * 3.5, now * 0.09, now * 0.07]);
    scene.push(SWEEP, rect, [0.18 * Math.sin(k * Math.PI), 0, 0.9], colors.signal, BEHIND);
  },

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

  range(scene, { rect: r, value, drag, slosh }, { colors, now }) {
    const half = 9;
    const cy = r[1] + r[3] / 2;
    const tx = r[0] + half + clamp01(value) * (r[2] - 2 * half);
    scene.push(LIQUID, [r[0], cy - 4, r[2], 8], [tx - r[0], slosh, now * 0.014, 0.95], colors.holo);
    scene.push(DIAMOND, [tx, cy, 8 + drag * 2.5, 0], [5 + drag * 9, 1, drag], colors.holo);
  },

  field(scene, { rect: r, scan, focus, typing, invalid, glitch }, { colors, now, reduced, durations }) {
    const color = invalid ? colors.signal : colors.holo;
    const k = scan / durations.scan;
    if (k >= 0 && k < 1 && !reduced) {
      scene.push(SWEEP, r, [easeInOutCubic(k) * 1.08, 1, 0.9 * (1 - k * 0.5)], colors.holo);
    }
    const width = invalid ? r[2] : r[2] * clamp01(focus);
    if (width > 0.5) {
      scene.push(PILL, [r[0], r[1] + r[3] - 2, width, 2], [1, 0, 5 + typing * 6, 0.8 + typing * 0.6], color, ADD);
    }
    const g = glitch / durations.glitch;
    if (g >= 0 && g < 1 && !reduced) {
      const strength = 8 * (1 - g) ** 1.3;
      scene.push(GLITCH, pad(r, 8, 3), [strength, 3 + ((now / 60) % 3), Math.floor(now / 45) % 4093]);
      scene.push(PILL, r, [2, 0, 6, (1 - g) * 0.22], colors.signal, ADD);
    }
  },

  gauge(scene, s, { colors, now, reduced, whole, durations }) {
    const r = s.rect;
    const inner = [r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4];
    const segments = s.segments ?? (s.kind === 'meter' ? Math.max(4, Math.round(inner[2] / 14)) : 0);
    const color = [colors.holo, colors.warn, colors.signal][s.tone];
    if (s.ring) {
      const radius = Math.min(r[2], r[3]) / 2 - 4;
      scene.push(ARC, [r[0] + r[2] / 2, r[1] + r[3] / 2, radius, Math.max(3, radius * 0.16)],
        [s.fill, Math.max(s.trail, s.fill), (now / 1100) % 1, 1], [...color, s.segments ?? 0], s.indeterminate ? 1 : 0, s.gaining ? 1 : 0);
    } else {
      scene.push(GAUGE, inner, [s.fill, Math.max(s.trail, s.fill), (now / 1300) % 1, 1], [...color, segments],
        s.indeterminate ? 1 : 0, s.gaining ? 1 : 0);
    }
    if (s.hit && !reduced) {
      const { amount, t, from, to } = s.hit;
      const jolt = t / 360;
      if (jolt < 1) {
        scene.push(JITTER, pad(r, 4), [amount * 3.2 * (1 - jolt) ** 2, now * 0.09, now * 0.05]);
        scene.push(PILL, r, [1, 0, 12, (1 - jolt) ** 2 * 0.4 * amount], colors.signal, ADD);
      }
      // The hit travels through the whole panel: a shock front that bends every
      // line it crosses, and a short shake of the stage.
      const wave = t / durations.hit;
      if (wave < 1) {
        const cx = inner[0] + inner[2] * (from + to) / 2;
        const cy = inner[1] + inner[3] / 2;
        const front = wave ** 0.75 * Math.hypot(whole[2], whole[3]) * 0.95;
        scene.push(DENT, whole, [cx, cy, 100, 0], [front, (1 - wave) ** 2 * 9 * amount, 22]);
        scene.push(RING, [cx, cy, front, 3 + 14 * wave], [(1 - wave) ** 2 * 0.5 * amount], colors.signal);
        const shake = (1 - clamp01(t / 320)) ** 2 * amount;
        if (shake > 0.01) scene.push(SHIFT, whole, [4 * shake * Math.sin(now * 0.13), 3 * shake * Math.cos(now * 0.171)]);
      }
    }
    if (s.complete !== null) {
      const done = s.complete / durations.complete;
      if (done < 1) {
        scene.push(PILL, r, [1, 0, 16, (1 - done) ** 2 * 0.55], colors.ink, ADD);
        scene.push(SWEEP, pad(r, 0, 6), [easeOutCubic(done) * 1.1, 1, 1 - done], colors.holo);
      }
    }
  },

  indicator(scene, { rect, alpha, motion }, { colors, reduced }) {
    const [x, y, w, h] = rect;
    if (!reduced) glass(scene, rect, motion, 0, 0);
    scene.push(PILL, rect, [0, 0, 0, 0.13 * alpha], colors.holo, BEHIND);
    scene.push(PILL, [x + 3, y + h - 3, w - 6, 3], [0.5, 0, 9, alpha], colors.holo, ADD);
    scene.push(DIAMOND, [x + w / 2, y + h - 1.5, 3.5, 0], [4, alpha, 1], colors.holo);
  },

  current(scene, { list, value, rect, alpha, motion, items, index }, ctx) {
    const { colors } = ctx;
    if (value === 'step') {
      // A stepper: a beam runs along the track from the first marker to the current
      // one; steps behind are lit, the current one burns.
      const marker = (r) => [r[0] + 7, r[1] + 7];
      const [x0, y0] = marker(items[0] ?? rect);
      const [x1] = marker(rect);
      if (x1 > x0) scene.push(PILL, [x0, y0 - 1, x1 - x0, 2], [1, 0, 8, alpha], colors.holo, ADD);
      for (let i = 0; i < index; i++) {
        const [mx, my] = marker(items[i]);
        scene.push(DIAMOND, [mx, my, 5, 0], [3, alpha * 0.9, 1], colors.holo);
      }
      scene.push(DIAMOND, [x1, y0, 7, 0], [10, alpha, 1], colors.holo);
      return;
    }
    if (list.closest('nav[aria-label="breadcrumb" i]')) {
      // Where you are: a thin trace under the last crumb.
      scene.push(PILL, [rect[0], rect[1] + rect[3] + 1, rect[2], 1.5], [0.5, 0, 6, alpha], colors.holo, ADD);
      return;
    }
    draw.indicator(scene, { rect, alpha, motion }, ctx);
  },

  sorted(scene, { rect, t }, { colors, durations }) {
    const k = clamp01(t / durations.ring);
    scene.push(SWEEP, rect, [easeOutCubic(k) * 1.1, 1, 0.9 * (1 - k)], colors.holo);
  },

  rolled(scene, { rect, t }, { colors }) {
    const k = clamp01(t / 260);
    scene.push(PILL, rect, [1, 0, 6, (1 - k) * 0.22], colors.holo, ADD);
  },

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

  drop(scene, { rect, point, pull, dropped }, { colors, now, durations, reduced }) {
    const d = dropped / durations.burst;
    const implode = d >= 0 && d < 1 ? (1 - d) ** 2 : 0;
    if (pull < 0.002 && implode === 0) return;
    const [px, py] = point;
    const size = Math.max(rect[2], rect[3]);
    if (!reduced) {
      // The files pull the panel in: a vortex at the pointer that tightens on drop.
      const angle = pull * (1.3 + 0.25 * Math.sin(now * 0.004)) + implode * 2.6;
      scene.push(VORTEX, pad(rect, 10), [px, py, size * 0.34, angle], [pull * 0.3 + implode * 0.7]);
    }
    scene.push(PILL, rect, [2, 0, 14, pull * 0.16 + implode * 0.3], colors.holo, ADD);
    if (implode > 0) scene.push(RING, [px, py, easeOutCubic(d) * size * 0.8, 2 + 8 * d], [implode * 1.1], colors.holo);
  },

  interval(scene, { rect: r, low, high, drag, slosh }, { colors, now }) {
    const half = 9;
    const cy = r[1] + r[3] / 2;
    const x0 = r[0] + half + clamp01(low) * (r[2] - 2 * half);
    const x1 = r[0] + half + clamp01(high) * (r[2] - 2 * half);
    scene.push(LIQUID, [x0, cy - 4, r[0] + r[2] - x0, 8], [x1 - x0, slosh, now * 0.014, 0.95], colors.holo);
    scene.push(DIAMOND, [x0, cy, 8 + drag[0] * 2.5, 0], [5 + drag[0] * 9, 1, drag[0]], colors.holo);
    scene.push(DIAMOND, [x1, cy, 8 + drag[1] * 2.5, 0], [5 + drag[1] * 9, 1, drag[1]], colors.holo);
  },

  option(scene, { rect, alpha }, { colors }) {
    scene.push(PILL, rect, [0, 0, 0, 0.16 * alpha], colors.holo, BEHIND);
    scene.push(PILL, [rect[0], rect[1] + 3, 2, rect[3] - 6], [0, 0, 6, alpha], colors.holo, ADD);
  },

  unfold(scene, { rect, line, k }, { colors }) {
    scene.push(PILL, [rect[0], line - 1, rect[2], 2], [0, 0, 8, 0.4 + 0.6 * (1 - k)], colors.holo, ADD);
  },

  toast(scene, { rect, left, paused, tone }, { colors }) {
    // The time left, as a bar of light along the bottom edge.
    const color = { good: colors.holo, warn: colors.warn, bad: colors.signal }[tone] ?? colors.holo;
    scene.push(PILL, [rect[0] + 1, rect[1] + rect[3] - 3, (rect[2] - 2) * left, 2], [0, 0, 6, paused ? 0.45 : 0.9], color, ADD);
  },

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

  badge(scene, { rect, t, up }, { colors, now, durations, reduced }) {
    const k = clamp01(t / durations.ring);
    const color = up ? colors.signal : colors.holo;
    const [cx, cy] = center(rect);
    if (!reduced && k < 0.6) scene.push(GLITCH, pad(rect, 4, 2), [4 * (1 - k / 0.6), 2, Math.floor(now / 40) % 4093]);
    scene.push(RING, [cx, cy, Math.max(rect[2], rect[3]) * (0.6 + 1.4 * easeOutCubic(k)), 1 + 3 * k], [(1 - k) ** 2 * 0.9], color);
    scene.push(PILL, rect, [rect[3] / 2, 0, 10, (1 - k) ** 2 * 0.5], color, ADD);
  },

  busy(scene, { rect, now }, { colors, reduced }) {
    if (reduced) return;
    // A scan passes over the placeholder again and again.
    const phase = (now % 1400) / 1400;
    scene.push(SWEEP, rect, [phase * 1.3 - 0.1, 1, 0.55], colors.holo);
  },

  reveal(scene, { column: [cx, cw], line, shown, k, opening }, { colors }) {
    if (opening) scene.push(PILL, [cx, line, cw, shown], [0, 0, 0, 0.05 * (1 - k)], colors.holo, ADD);
    scene.push(PILL, [cx, line + shown - 1, cw, 2], [0, 0, 10, 0.25 + 0.75 * (1 - k)], colors.holo, ADD);
  },
};

export const holo = defineSkin({
  name: 'holo',
  tokens: {
    holo: ['--loom-holo', '#7ff0ff'],
    signal: ['--loom-signal', '#ff3d6e'],
    warn: ['--loom-warn', '#ffc857'],
    ink: ['--loom-ink', '#e8f4ff'],
    line: ['--loom-line', '#2b3766'],
    bg: ['--loom-panel', '#111735'],
    void: ['--loom-void', '#0a0e24'],
  },
  // Colours the compositor itself uses: the cut's blade, its rim light, empty space.
  roles: { hot: 'signal', rim: 'holo', bg: 'bg', void: 'void' },
  shader: { scanlines: 0.22, chroma: 1, crumble: 1, hatch: 1 },
  transition: { ms: 640, scopedMs: 430, band: 0.1, slant: 0.42 },
  boot: { ms: 760 },
  disclosure: { crumble: 26 },
  draw,
  sounds,
});
