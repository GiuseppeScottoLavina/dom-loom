import { definePrimitive } from '../core/primitives.js';

/**
 * An overlay opening or closing at scale (overlay="zoom"): the whole frame (the panel, its
 * lights, its input) is drawn smaller about the panel's centre and faded. r: the panel;
 * p: scale (about 0.94 to 1), fade (0..1).
 */
export const ZOOM = definePrimitive({
  kind: 36,
  name: 'zoom',
  view: {
    // From the pixel shown to the point of the panel it shows: c + (p - c) / scale.
    wgsl: /* wgsl */ `
      let zc = it.r.xy + it.r.zw * 0.5;
      p = zc + (p - zc) / max(it.p.x, 0.01);`,
    js(x, y, d, b) {
      const s = Math.max(d[b + 8], 0.01);
      const cx = d[b + 4] + d[b + 6] / 2;
      const cy = d[b + 5] + d[b + 7] / 2;
      return { x: cx + (x - cx) / s, y: cy + (y - cy) / s };
    },
  },
  post: {
    // Faded, and nothing past the panel's edge (p is the panel's point already).
    wgsl: /* wgsl */ `
      var zm = it.p.y;
      if (!insideR(p, it.r)) { zm = 0.0; }
      color *= zm;
      alpha *= zm;`,
    js(x, y, d, b) {
      return d[b + 9] > 0.05 && x >= d[b + 4] && x <= d[b + 4] + d[b + 6] && y >= d[b + 5] && y <= d[b + 5] + d[b + 7];
    },
  },
});
