import { definePrimitive } from '../core/primitives.js';

/**
 * The outline of a rounded box: a focus ring, a ripple. The stroke is centred on the box
 * edge. h.y: blend (ADD, OVER); r: rect; p: radius, width, alpha, glow (css px of a soft
 * halo outside the stroke); q: rgb.
 */
export const OUTLINE = definePrimitive({
  kind: 34,
  name: 'outline',
  light: {
    wgsl: /* wgsl */ `
      let oc = it.r.xy + it.r.zw * 0.5;
      let ohb = it.r.zw * 0.5;
      let od = sdBox(p - oc, ohb, min(it.p.x, min(ohb.x, ohb.y)));
      let ow = it.p.y * 0.5;
      if (abs(od) < ow + 1.0 + it.p.w * 3.0) {
        let stroke = (1.0 - smoothstep(ow - 0.6, ow + 0.6, abs(od))) * it.p.z;
        var halo = 0.0;
        if (it.p.w > 0.0 && od > ow) { halo = exp(-(od - ow) / it.p.w) * 0.35 * it.p.z; }
        if (u32(it.h.y + 0.5) == 2u) {
          base = mix(base, it.q.rgb, min(stroke + halo * (1.0 - stroke), 1.0));
        } else {
          light += it.q.rgb * (stroke + halo);
        }
      }`,
  },
});
