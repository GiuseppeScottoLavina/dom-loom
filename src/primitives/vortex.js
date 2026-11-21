import { definePrimitive } from '../core/primitives.js';
import { edge } from '../core/math.js';

/** The picture twists around a point. r: clip; p: cx, cy, radius, angle; q: pinch. */
export const VORTEX = definePrimitive({
  kind: 9,
  name: 'vortex',
  offset: {
    wgsl: /* wgsl */ `
      let d = p - it.p.xy;
      let w = exp(-dot(d, d) / (it.p.z * it.p.z)) * edgeF(p, it.r, 12.0);
      let a = it.p.w * w;
      let scale = 1.0 + it.q.x * w;
      let c = cos(a);
      let s = sin(a);
      o += vec2f(c * d.x - s * d.y, s * d.x + c * d.y) * scale - d;`,
    js(x, y, d, b, out) {
      const cx = d[b + 8], cy = d[b + 9], radius = d[b + 10], angle = d[b + 11];
      const dx = x - cx;
      const dy = y - cy;
      const n = (dx * dx + dy * dy) / (radius * radius);
      const w = Math.exp(-n) * edge(x, y, d[b + 4], d[b + 5], d[b + 6], d[b + 7], 12);
      const a = angle * w;
      const scale = 1 + d[b + 12] * w;
      const c = Math.cos(a);
      const s = Math.sin(a);
      out.x += (c * dx - s * dy) * scale - dx;
      out.y += (s * dx + c * dy) * scale - dy;
    },
  },
});
