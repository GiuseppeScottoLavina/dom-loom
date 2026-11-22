// Holo's sounds: short synthetic blips, a charging whine, a deep burst.
import { audio, noise, output, tone } from '../../core/audio.js';

let charge = null;

export const sounds = {
  hover: () => tone({ type: 'triangle', from: 2400, to: 2100, duration: 0.035, gain: 0.035 }),
  press: () => {
    tone({ type: 'sine', from: 190, to: 70, duration: 0.12, gain: 0.32 });
    noise({ duration: 0.04, gain: 0.08, from: 4000, q: 0.7 });
  },
  release: () => tone({ type: 'triangle', from: 900, to: 1400, duration: 0.06, gain: 0.05 }),
  select: () => {
    noise({ duration: 0.09, gain: 0.12, filter: 'highpass', from: 1800, to: 6000, q: 0.5 });
    tone({ type: 'triangle', from: 520, to: 780, duration: 0.08, gain: 0.06 });
  },
  scan: () => noise({ duration: 0.22, gain: 0.05, from: 900, to: 5000, q: 6 }),
  error: () => {
    tone({ type: 'sawtooth', from: 110, duration: 0.16, gain: 0.09 });
    tone({ type: 'sawtooth', from: 116, duration: 0.16, gain: 0.09, delay: 0.02 });
  },
  chargeStart(durationMs) {
    const a = audio();
    if (!a) return;
    sounds.chargeStop();
    const t = a.currentTime;
    const osc = a.createOscillator();
    const f = a.createBiquadFilter();
    const g = a.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + durationMs / 1000);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + durationMs / 1000);
    f.Q.value = 8;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.08);
    osc.connect(f).connect(g).connect(output());
    osc.start(t);
    // The stage may disappear, or the user may mute it, during the hold.
    osc.stop(t + Math.max(0, durationMs / 1000) + 0.14);
    charge = { osc, g, a };
  },
  chargeStop() {
    if (!charge) return;
    const t = charge.a.currentTime;
    charge.g.gain.cancelScheduledValues(t);
    charge.g.gain.setValueAtTime(charge.g.gain.value, t);
    charge.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    charge.osc.stop(t + 0.14);
    charge = null;
  },
  burst: () => {
    tone({ type: 'sine', from: 140, to: 38, duration: 0.5, gain: 0.45 });
    noise({ duration: 0.45, gain: 0.2, filter: 'lowpass', from: 6000, to: 300, q: 0.4 });
    tone({ type: 'triangle', from: 1320, to: 1980, duration: 0.18, gain: 0.05, delay: 0.03 });
  },
  whoosh: () => noise({ duration: 0.55, gain: 0.14, from: 300, to: 7000, q: 1.8 }),
  swipe: () => noise({ duration: 0.26, gain: 0.1, from: 900, to: 6500, q: 1.4 }),
  open: () => {
    noise({ duration: 0.2, gain: 0.08, from: 500, to: 3200, q: 3 });
    tone({ type: 'triangle', from: 300, to: 540, duration: 0.1, gain: 0.05 });
  },
  close: () => {
    noise({ duration: 0.16, gain: 0.07, from: 3200, to: 500, q: 3 });
    tone({ type: 'triangle', from: 540, to: 300, duration: 0.08, gain: 0.045 });
  },
  shuffle: () => {
    for (let i = 0; i < 6; i++) {
      noise({ duration: 0.035, gain: 0.07, filter: 'highpass', from: 2500 + i * 300, q: 0.8, delay: 0.03 + i * 0.045 });
    }
  },
  remove: () => {
    noise({ duration: 0.32, gain: 0.1, filter: 'lowpass', from: 5000, to: 400, q: 0.7 });
    tone({ type: 'triangle', from: 700, to: 260, duration: 0.18, gain: 0.04 });
  },
  appear: () => {
    noise({ duration: 0.25, gain: 0.05, filter: 'highpass', from: 2000, to: 8000, q: 0.6 });
    tone({ type: 'triangle', from: 880, to: 1320, duration: 0.14, gain: 0.04, delay: 0.05 });
  },
  tick: () => tone({ type: 'triangle', from: 1900, to: 1700, duration: 0.025, gain: 0.025 }),
};
