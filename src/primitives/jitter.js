import { definePrimitive } from '../core/primitives.js';
import { edge } from '../core/math.js';

/** A shake. r: rect; p: amplitude, phase a, phase b. */
export const JITTER = definePrimitive({
  kind: 2,
  name: 'jitter',
  offset: {
    wgsl: /* wgsl */ `
      let e = edgeF(p, it.r, 4.0);
      o.x += it.p.x * sin(it.p.y + p.y * 0.35) * e;
      o.y += it.p.x * 0.4 * sin(it.p.z + p.x * 0.09) * e;`,
    js(x, y, d, b, out) {
      const e = edge(x, y, d[b + 4], d[b + 5], d[b + 6], d[b + 7], 4);
      out.x += d[b + 8] * Math.sin(d[b + 9] + y * 0.35) * e;
      out.y += d[b + 8] * 0.4 * Math.sin(d[b + 10] + x * 0.09) * e;
    },
  },
});
