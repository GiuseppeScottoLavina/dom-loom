import { definePrimitive } from '../core/primitives.js';

/** Live content assembling block by block. r: rect; p.x: 1 = not there yet, 0 = whole. */
export const MATERIALIZE = definePrimitive({
  kind: 18,
  name: 'materialize',
  light: {
    wgsl: /* wgsl */ `
      if (!insideR(p, it.r)) { continue; }
      let c = crumbleFrom(p, it.p.x, vec2f(0.0, 22.0), true);
      base = mix(u.bg.rgb, c.rgb, c.w);`,
  },
});
