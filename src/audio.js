// A tiny procedural audio engine for skins: oscillators and filtered noise, no files.
let ctx = null;
let noiseBuffer = null;
let master = null;

/** The shared AudioContext (created on first use), or null where there is none. */
export function audio() {
  if (!ctx) {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return null;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Where skins connect their own nodes. */
export function output() {
  audio();
  return master;
}

export function tone({ type = 'sine', from, to = from, duration, gain = 0.2, attack = 0.004, delay = 0 }) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + duration);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export function noise({ duration, gain = 0.15, filter = 'bandpass', from = 2000, to = from, q = 1, delay = 0 }) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer;
  const f = a.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + duration);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + duration + 0.02);
}
