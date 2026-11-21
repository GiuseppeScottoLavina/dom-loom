import { definePrimitive } from '../core/primitives.js';

/** A rounded, optionally slanted box of light or paint. h.y: blend (ADD, BEHIND, OVER); r: rect; p: radius, skew, glow, alpha; q: rgb. */
export const PILL = definePrimitive({
  kind: 11,
  name: 'pill',
  light: {
    wgsl: /* wgsl */ `
      let c = it.r.xy + it.r.zw * 0.5;
      let hb = it.r.zw * 0.5;
      var lp = p - c;
      lp.x += lp.y * it.p.y;
      let d = sdBox(lp, hb, min(it.p.x, min(hb.x, hb.y)));
      let fill = (1.0 - smoothstep(-0.7, 0.7, d)) * it.p.w;
      var glow = 0.0;
      if (it.p.z > 0.0) { glow = exp(-max(d, 0.0) / it.p.z) * 0.5 * it.p.w; }
      let mode = u32(it.h.y + 0.5);
      if (mode == 1u) {
        base = mix(base, it.q.rgb, fill * (1.0 - smoothstep(0.35, 0.8, luma(base))));
        light += it.q.rgb * glow * (1.0 - fill);
      } else if (mode == 2u) {
        base = mix(base, it.q.rgb, fill);
        light += it.q.rgb * glow * (1.0 - fill);
      } else {
        light += it.q.rgb * (fill + glow);
      }`,
  },
});
