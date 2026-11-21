// Holo: the holo-kinetic skin. Light is projected (it adds, with scan lines), the
// selection is a slanted cut in signal red, focus is a lock-on reticle, hits shake.
import { BRACKETS } from '../../primitives/brackets.js';
import { DENT } from '../../primitives/dent.js';
import { JITTER } from '../../primitives/jitter.js';
import { PILL } from '../../primitives/pill.js';
import { RING } from '../../primitives/ring.js';
import { SWEEP } from '../../primitives/sweep.js';
import { ADD, BEHIND } from '../../core/scene.js';
import { clamp01, easeInOutCubic, easeOutCubic } from '../../core/spring.js';
import { pad, center } from './util.js';
import { defineSkin } from '../../core/skin.js';
import { sounds } from './sounds.js';

// The core's controls (buttons, focus, holds, rolling values, unfolding lists). The
// other controls bring their drawing with their component (./choice.js, ./tabs.js, …).
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

  rolled(scene, { rect, t }, { colors }) {
    const k = clamp01(t / 260);
    scene.push(PILL, rect, [1, 0, 6, (1 - k) * 0.22], colors.holo, ADD);
  },

  unfold(scene, { rect, line, k }, { colors }) {
    scene.push(PILL, [rect[0], line - 1, rect[2], 2], [0, 0, 8, 0.4 + 0.6 * (1 - k)], colors.holo, ADD);
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
