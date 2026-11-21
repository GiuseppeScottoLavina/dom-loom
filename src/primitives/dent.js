import { definePrimitive } from '../core/primitives.js';
import { edge } from '../core/math.js';

/** A press: the content squashes toward a point and a ring crest runs out. r: clip; p: cx, cy, radius, depth; q: ring radius, amplitude, width. */
export const DENT = definePrimitive({
  kind: 1,
  name: 'dent',
  offset: {
    wgsl: /* wgsl */ `
      let e = edgeF(p, it.r, 10.0);
      let d = p - it.p.xy;
      let dist = length(d);
      let nn = dist / it.p.z;
      let squash = it.p.w * (0.045 + 0.11 * exp(-2.0 * nn * nn));
      let front = (dist - it.q.x) / it.q.z;
      let crest = exp(-front * front) * it.q.y;
      var inv = 0.0;
      if (dist > 0.001) { inv = 1.0 / dist; }
      o += (d * squash - d * inv * crest) * e;`,
    js(x, y, d, b, out) {
      const cx = d[b + 8], cy = d[b + 9], radius = d[b + 10], depth = d[b + 11];
      const ringR = d[b + 12], ringAmp = d[b + 13], ringW = d[b + 14];
      const e = edge(x, y, d[b + 4], d[b + 5], d[b + 6], d[b + 7], 10);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const n = dist / radius;
      const squash = depth * (0.045 + 0.11 * Math.exp(-2 * n * n));
      const front = (dist - ringR) / ringW;
      const crest = Math.exp(-front * front) * ringAmp;
      const inv = dist > 0.001 ? 1 / dist : 0;
      out.x += (dx * squash - dx * inv * crest) * e;
      out.y += (dy * squash - dy * inv * crest) * e;
    },
  },
});
