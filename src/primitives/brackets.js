import { definePrimitive } from '../core/primitives.js';

/** Lock-on brackets: four corners of a box, a glow, a flash inside. r: rect; p: arm, thickness, glow, alpha; q: rgb, flash. */
export const BRACKETS = definePrimitive({
  kind: 10,
  name: 'brackets',
  light: {
    wgsl: /* wgsl */ `
      let c = it.r.xy + it.r.zw * 0.5;
      let hb = it.r.zw * 0.5;
      let lp = p - c;
      let box = sdBox(lp, hb, 3.0);
      let d = abs(box) - it.p.y * 0.5;
      let a = abs(lp);
      let arm = it.p.x;
      let corner = smoothstep(hb.x - arm - 0.8, hb.x - arm + 0.8, a.x) *
                   smoothstep(hb.y - arm - 0.8, hb.y - arm + 0.8, a.y);
      let line = 1.0 - smoothstep(-0.6, 0.6, d);
      let glow = exp(-max(d, 0.0) / it.p.z) * 0.35;
      let inner = (1.0 - smoothstep(-0.8, 0.8, box)) * (0.035 + 0.22 * it.q.w);
      light += it.q.rgb * it.p.w * ((line + glow) * corner + inner);`,
  },
});
