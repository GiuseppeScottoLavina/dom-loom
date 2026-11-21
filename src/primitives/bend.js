import { definePrimitive } from '../core/primitives.js';

/** A strip curving like film: the middle swells, the sides crowd. r: rect; p: curve (radians), lag (px). */
export const BEND = definePrimitive({
  kind: 21,
  name: 'bend',
  offset: {
    whole: true,
    wgsl: /* wgsl */ `
      let half = it.r.z * 0.5;
      let xn = clamp((p.x - it.r.x - half) / half, -1.0, 1.0);
      if (it.p.x > 1e-4) { o.x += (asin(xn * sin(it.p.x)) / it.p.x - xn) * half; }
      o.x += it.p.y * xn * xn;`,
    js(x, y, d, b, out) {
      const half = d[b + 6] / 2;
      const xn = Math.min(Math.max((x - d[b + 4] - half) / half, -1), 1);
      const curve = d[b + 8];
      if (curve > 1e-4) out.x += (Math.asin(xn * Math.sin(curve)) / curve - xn) * half;
      out.x += d[b + 9] * xn * xn;
    },
  },
});
