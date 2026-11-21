import { definePrimitive } from '../core/primitives.js';
import { inside } from '../core/math.js';

/** A value rolling over. r: rect; p: progress (0..1), direction (1: up, -1: down). Maps as itself. */
export const ROLL = definePrimitive({
  kind: 8,
  name: 'roll',
  picture: {
    name: 'rollPicture',
    order: 20,
    wgsl: /* wgsl */ `
// The old picture leaves one way, the new one comes in behind it.
fn rollPicture(p: vec2f, light: ptr<function, vec3f>) -> vec4f {
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    if (u32(it.h.x + 0.5) != 8u || !insideR(p, it.r)) { continue; }
    let k = it.p.x;
    let h = it.r.w;
    if (it.p.y > 0.0) {
      let split = it.r.y + (1.0 - k) * h;
      if (p.y >= split) { return vec4f(sampleSrc(p - vec2f(0.0, (1.0 - k) * h)), 1.0); }
      return vec4f(sampleGhost(p + vec2f(0.0, k * h)), 1.0);
    }
    let split = it.r.y + k * h;
    if (p.y < split) { return vec4f(sampleSrc(p + vec2f(0.0, (1.0 - k) * h)), 1.0); }
    return vec4f(sampleGhost(p - vec2f(0.0, k * h)), 1.0);
  }
  return vec4f(0.0, 0.0, 0.0, -1.0);
}`,
    js(x, y, d, b) {
      if (!inside(x, y, d[b + 4], d[b + 5], d[b + 6], d[b + 7])) return undefined;
      return { x, y, final: true };
    },
  },
});
