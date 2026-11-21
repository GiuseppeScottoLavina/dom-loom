import { definePrimitive } from '../core/primitives.js';

/**
 * A ring gauge: an arc from twelve o'clock, clockwise, with the bar's trail. h.y:
 * indeterminate; h.z: trail tone; r: cx, cy, radius, thickness; p: fill, trail, phase,
 * alpha; q: rgb, segments.
 */
export const ARC = definePrimitive({
  kind: 19,
  name: 'arc',
  light: {
    wgsl: /* wgsl */ `
      let d = p - it.r.xy;
      let ring = abs(length(d) - it.r.z) - it.r.w * 0.5;
      let inRing = 1.0 - smoothstep(-0.6, 0.6, ring);
      var ang = atan2(d.x, -d.y) / 6.28318530718;
      if (ang < 0.0) { ang += 1.0; }
      let px = 0.8 / (6.28318530718 * it.r.z);
      var chip = 1.0;
      if (it.q.w > 0.5) {
        let c = fract(ang * it.q.w);
        chip = smoothstep(0.0, 0.08, c) * (1.0 - smoothstep(0.92, 1.0, c));
      }
      var fillM = 0.0;
      var trailM = 0.0;
      var head = it.p.x;
      if (it.h.y < 0.5) {
        fillM = 1.0 - smoothstep(it.p.x - px, it.p.x + px, ang);
        trailM = max(1.0 - smoothstep(it.p.y - px, it.p.y + px, ang) - fillM, 0.0);
      } else {
        // Indeterminate: a quarter turn chasing round.
        let a = fract(ang - it.p.z);
        fillM = 1.0 - smoothstep(0.28 - px, 0.28 + px, a);
        head = fract(it.p.z + 0.28);
      }
      let a = it.p.w;
      let shade = 0.55 + 0.45 * clamp(ang / max(head, 0.05), 0.0, 1.0);
      base = mix(base, it.q.rgb * shade, fillM * chip * inRing * a);
      var trailC = vec3f(1.0, 0.95, 0.96);
      var trailA = 0.92;
      if (it.h.z > 0.5) { trailC = it.q.rgb * 0.5; trailA = 0.6; }
      base = mix(base, trailC, trailM * chip * inRing * a * trailA);
      // The head of the arc glows.
      let hp = it.r.xy + vec2f(sin(head * 6.28318530718), -cos(head * 6.28318530718)) * it.r.z;
      let hd = length(p - hp);
      light += it.q.rgb * exp(-hd * hd / (it.r.w * it.r.w * 0.8)) * a * step(0.003, head) * 0.9;`,
  },
});
