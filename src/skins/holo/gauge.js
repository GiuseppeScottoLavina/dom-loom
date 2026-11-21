// Holo: gauge.
import { extendSkin } from '../../core/skin.js';
import { tone, noise } from '../../core/audio.js';
import { ARC } from '../../primitives/arc.js';
import { DENT } from '../../primitives/dent.js';
import { GAUGE } from '../../primitives/gauge.js';
import { JITTER } from '../../primitives/jitter.js';
import { PILL } from '../../primitives/pill.js';
import { RING } from '../../primitives/ring.js';
import { SHIFT } from '../../primitives/shift.js';
import { SWEEP } from '../../primitives/sweep.js';
import { ADD } from '../../core/scene.js';
import { clamp01, easeOutCubic } from '../../core/spring.js';
import { pad } from './util.js';

extendSkin('holo', {
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
}, {
  hit: (amount = 1) => {
    tone({ type: 'sine', from: 130, to: 42, duration: 0.24, gain: 0.25 + 0.2 * amount });
    noise({ duration: 0.14, gain: 0.12 + 0.12 * amount, filter: 'lowpass', from: 3500, to: 350, q: 0.6 });
    tone({ type: 'square', from: 240, to: 180, duration: 0.05, gain: 0.04 });
  },
  heal: () => {
    tone({ type: 'triangle', from: 660, to: 880, duration: 0.12, gain: 0.06 });
    tone({ type: 'triangle', from: 990, to: 1320, duration: 0.16, gain: 0.05, delay: 0.07 });
  },
  complete: () => {
    tone({ type: 'triangle', from: 880, duration: 0.1, gain: 0.07 });
    tone({ type: 'triangle', from: 1320, duration: 0.22, gain: 0.07, delay: 0.08 });
    noise({ duration: 0.3, gain: 0.06, filter: 'highpass', from: 3000, to: 9000, q: 0.5, delay: 0.08 });
  },
});
