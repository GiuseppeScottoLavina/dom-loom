import { definePrimitive } from '../core/primitives.js';

/**
 * A bar: leaning chips, a fill brightening toward its edge, and a trail between where
 * the value was and where it is. h.y: indeterminate; h.z: trail tone (0 damage, 1
 * gain); r: rect; p: fill, trail, phase, alpha; q: rgb, segments.
 */
export const GAUGE = definePrimitive({
  kind: 16,
  name: 'gauge',
  light: {
    wgsl: /* wgsl */ `
      if (!insideR(p, it.r)) { continue; }
      let lp = p - it.r.xy;
      // Leaning edges; 0 and 1 are fully empty and fully full.
      let lean = it.r.w * 0.3;
      let sx = lp.x - (lp.y - it.r.w * 0.5) * 0.6;
      let x = (sx + lean) / (it.r.z + 2.0 * lean);
      let px = 0.7 / it.r.z;
      var chip = 1.0;
      if (it.q.w > 0.5) {
        let cw = it.r.z / it.q.w;
        let c = fract(sx / cw) * cw;
        chip = smoothstep(1.4, 2.4, c);
      }
      var fillM = 0.0;
      var trailM = 0.0;
      var edgeX = it.p.x;
      if (it.h.y < 0.5) {
        fillM = 1.0 - smoothstep(it.p.x - px, it.p.x + px, x);
        trailM = max(1.0 - smoothstep(it.p.y - px, it.p.y + px, x) - fillM, 0.0);
      } else {
        let c = -0.3 + it.p.z * 1.6;
        fillM = 1.0 - smoothstep(0.16 - px, 0.16 + px, abs(x - c));
        edgeX = c + 0.16;
      }
      let shade = 0.5 + 0.5 * clamp(x / max(edgeX, 0.05), 0.0, 1.0);
      let hatch = 0.86 + 0.14 * step(0.5, fract((p.x + p.y) / 5.0));
      let a = it.p.w;
      base = mix(base, it.q.rgb * shade * hatch, fillM * chip * a);
      var trailC = vec3f(1.0, 0.95, 0.96);
      var trailA = 0.92;
      if (it.h.z > 0.5) { trailC = it.q.rgb * 0.5; trailA = 0.6; }
      base = mix(base, trailC, trailM * chip * a * trailA);
      let edgeLine = exp(-pow((x - edgeX) * it.r.z / 1.4, 2.0)) * step(0.003, edgeX);
      light += it.q.rgb * edgeLine * a * 0.8;
      light += vec3f(0.12) * fillM * chip * (1.0 - smoothstep(0.0, 2.0, lp.y));`,
  },
});
