import { definePrimitive } from '../core/primitives.js';
import { sdBox, smoothstep } from '../core/math.js';

/** Distance to the glass of a LENS item (twin of lensSd in WGSL). */
function lensSd(x, y, d, b) {
  const gx = d[b + 12], gy = d[b + 13], gw = d[b + 14], gh = d[b + 15];
  let lx = x - (gx + gw / 2);
  const ly = y - (gy + gh / 2);
  lx += ly * d[b + 11];
  const radius = Math.min(d[b + 8], gw / 2, gh / 2);
  return sdBox(lx, ly, gw / 2, gh / 2, radius);
}

/** Moving glass: inside its edge, the picture comes from farther in. r: clip; p: radius, strength, band, skew; q: glass rect. */
export const LENS = definePrimitive({
  kind: 7,
  name: 'lens',
  functions: /* wgsl */ `
fn lensSd(p: vec2f, it: Item) -> f32 {
  let g = it.q;
  var l = p - (g.xy + g.zw * 0.5);
  l.x += l.y * it.p.w;
  let radius = min(it.p.x, min(g.z * 0.5, g.w * 0.5));
  return sdBox(l, g.zw * 0.5, radius);
}`,
  offset: {
    wgsl: /* wgsl */ `
      let d = lensSd(p, it);
      if (d < 0.0) {
        let e = 0.5;
        var g = vec2f(lensSd(p + vec2f(e, 0.0), it) - lensSd(p - vec2f(e, 0.0), it),
                      lensSd(p + vec2f(0.0, e), it) - lensSd(p - vec2f(0.0, e), it));
        let len = length(g);
        if (len > 1e-4) {
          g = g / len;
          let w = 1.0 - smoothstep(0.0, it.p.z, -d);
          o -= g * it.p.y * w;
        }
      }`,
    js(x, y, d, b, out) {
      const dist = lensSd(x, y, d, b);
      if (dist >= 0) return;
      const e = 0.5;
      let gx = lensSd(x + e, y, d, b) - lensSd(x - e, y, d, b);
      let gy = lensSd(x, y + e, d, b) - lensSd(x, y - e, d, b);
      const len = Math.hypot(gx, gy);
      if (len <= 1e-4) return;
      gx /= len;
      gy /= len;
      const w = 1 - smoothstep(0, d[b + 10], -dist);
      out.x -= gx * d[b + 9] * w;
      out.y -= gy * d[b + 9] * w;
    },
  },
});
