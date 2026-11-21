import { definePrimitive } from '../core/primitives.js';
import { pcg } from '../core/math.js';

/** Torn horizontal slices. r: rect; p: strength, slice height, seed. */
export const GLITCH = definePrimitive({
  kind: 3,
  name: 'glitch',
  offset: {
    wgsl: /* wgsl */ `
      let index = u32(floor((p.y - it.r.y) / it.p.y));
      let h = pcg(index * 31u + u32(it.p.z));
      if (f32(h) / 4294967296.0 > 0.55) {
        let h2 = f32(pcg(h + 7u)) / 4294967296.0;
        o.x += (h2 - 0.5) * 2.0 * it.p.x;
      }`,
    js(x, y, d, b, out) {
      const index = Math.floor((y - d[b + 5]) / d[b + 9]) >>> 0;
      const h = pcg((Math.imul(index, 31) + (d[b + 10] >>> 0)) >>> 0);
      if (h / 4294967296 > 0.55) {
        const h2 = pcg((h + 7) >>> 0) / 4294967296;
        out.x += (h2 - 0.5) * 2 * d[b + 8];
      }
    },
  },
});
