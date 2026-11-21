import { definePrimitive } from '../core/primitives.js';

/** A five-pointed star: filled, outlined, glowing. r: cx, cy, radius, inner ratio; p: glow, alpha, fill; q: rgb. */
export const STAR = definePrimitive({
  kind: 17,
  name: 'star',
  functions: /* wgsl */ `
// Inigo Quilez's sdStar5, y up.
fn sdStar5(p0: vec2f, r: f32, rf: f32) -> f32 {
  let k1 = vec2f(0.809016994375, -0.587785252292);
  let k2 = vec2f(-k1.x, k1.y);
  var p = vec2f(abs(p0.x), p0.y);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  let ba = rf * vec2f(-k1.y, k1.x) - vec2f(0.0, 1.0);
  let h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}`,
  light: {
    wgsl: /* wgsl */ `
      let lp = p - it.r.xy;
      let d = sdStar5(vec2f(lp.x, -lp.y), it.r.z, it.r.w);
      let fill = (1.0 - smoothstep(-0.7, 0.7, d)) * it.p.z;
      let line = 1.0 - smoothstep(-0.6, 0.6, abs(d) - 0.7);
      let glow = exp(-max(d, 0.0) / max(it.p.x, 0.01)) * 0.5 * it.p.z;
      base = mix(base, it.q.rgb, fill * it.p.y);
      light += it.q.rgb * (line * 0.5 + glow) * it.p.y;`,
  },
});
