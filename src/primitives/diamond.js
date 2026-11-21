import { definePrimitive } from '../core/primitives.js';

/** A diamond: outline, core, glow. r: cx, cy, size; p: glow, alpha, core; q: rgb. */
export const DIAMOND = definePrimitive({
  kind: 14,
  name: 'diamond',
  light: {
    wgsl: /* wgsl */ `
      let lp = abs(p - it.r.xy);
      let d = (lp.x + lp.y) * 0.7071 - it.r.z * 0.7071;
      let line = 1.0 - smoothstep(-0.7, 0.7, abs(d) - 0.9);
      let core = (1.0 - smoothstep(-0.7, 0.7, d + 3.0)) * it.p.z;
      let glow = exp(-max(d, 0.0) / it.p.x) * 0.6;
      base = mix(base, it.q.rgb * 0.18 + u.bg.rgb * 0.5, (1.0 - smoothstep(-0.7, 0.7, d)) * it.p.y);
      light += it.q.rgb * (line + core + glow) * it.p.y;`,
  },
});
