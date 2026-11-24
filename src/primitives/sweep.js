import { definePrimitive } from '../core/primitives.js';

/**
 * A fill behind a label (charge) or a scan line crossing a rect. The fill always paints the
 * dark parts only, so the label stays on top; it takes no blend. r: rect; p: progress,
 * mode (0 fill, 1 scan), alpha; q: rgb.
 */
export const SWEEP = definePrimitive({
  kind: 13,
  name: 'sweep',
  light: {
    wgsl: /* wgsl */ `
      if (!insideR(p, it.r)) { continue; }
      let x = (p.x - it.r.x) / it.r.z;
      let prog = it.p.x;
      if (it.p.y < 0.5) {
        // Charge: fill behind the label, bright moving edge, hatch on the fill.
        let fill = 1.0 - smoothstep(prog - 0.004, prog + 0.004, x);
        let hatch = 0.82 + 0.18 * step(0.5, fract((p.x + p.y) / 6.0));
        let k = fill * it.p.z * (1.0 - smoothstep(0.35, 0.8, luma(base)));
        base = mix(base, it.q.rgb * hatch, k);
        let edgeLine = exp(-pow((x - prog) * it.r.z / 1.5, 2.0)) * step(0.002, prog);
        light += vec3f(1.0, 0.92, 0.95) * edgeLine * it.p.z;
      } else {
        // Scan: a vertical line crossing the field with a fading trail.
        let dx = (prog - x) * it.r.z;
        var trail = 0.0;
        if (dx >= 0.0) { trail = exp(-dx / 26.0) * 0.18; }
        let lineV = exp(-pow(dx / 1.2, 2.0));
        light += it.q.rgb * (lineV + trail) * it.p.z;
      }`,
  },
});
