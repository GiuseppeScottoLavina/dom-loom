import { definePrimitive } from '../core/primitives.js';

/** Moves the content of a rect whole. r: rect; p: dx, dy (the content shown comes from (x + dx, y + dy)). */
export const SHIFT = definePrimitive({
  kind: 5,
  name: 'shift',
  offset: {
    whole: true,
    wgsl: /* wgsl */ `o += it.p.xy;`,
    js(x, y, d, b, out) {
      out.x += d[b + 8];
      out.y += d[b + 9];
    },
  },
});
