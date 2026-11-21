import { definePrimitive } from '../core/primitives.js';

/** A ring of light. r: cx, cy, radius, width; p: alpha; q: rgb. */
export const RING = definePrimitive({
  kind: 12,
  name: 'ring',
  light: {
    wgsl: /* wgsl */ `
      let d = abs(length(p - it.r.xy) - it.r.z) / it.r.w;
      light += it.q.rgb * exp(-d * d) * it.p.x;`,
  },
});
