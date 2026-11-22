import { definePrimitive } from '../core/primitives.js';

/** How far inside the opening (x, y) is, in px (negative: still closed). Twin of the WGSL. */
export function apertureDepth(x, y, d, b) {
  const rx = d[b + 4], ry = d[b + 5], rw = d[b + 6], rh = d[b + 7];
  const k = d[b + 8];
  switch (Math.round(d[b + 9])) {
    case 1: return rx + rw * k - x; // from the left
    case 2: return x - (rx + rw * (1 - k)); // from the right
    case 3: return ry + rh * k - y; // from the top
    case 4: return y - (ry + rh * (1 - k)); // from the bottom
    default: return (rh / 2) * k - Math.abs(y - (ry + rh / 2)); // from a line across the middle
  }
}

/**
 * An overlay opening: only the part that is open shows (and takes input); its edges
 * are lines of light. r: the panel; p: open (0..1), from (0 middle, 1 left, 2 right,
 * 3 top, 4 bottom); q: rgb of the edge.
 */
export const APERTURE = definePrimitive({
  kind: 23,
  name: 'aperture',
  post: {
    wgsl: /* wgsl */ `
      let k = it.p.x;
      var d = 0.0;
      let side = u32(it.p.y + 0.5);
      if (side == 1u) { d = it.r.x + it.r.z * k - p.x; }
      else if (side == 2u) { d = p.x - (it.r.x + it.r.z * (1.0 - k)); }
      else if (side == 3u) { d = it.r.y + it.r.w * k - p.y; }
      else if (side == 4u) { d = p.y - (it.r.y + it.r.w * (1.0 - k)); }
      else { d = it.r.w * 0.5 * k - abs(p.y - (it.r.y + it.r.w * 0.5)); }
      let m = smoothstep(-0.75, 0.75, d);
      color *= m;
      alpha *= m;
      // The opening's edge, while it moves: a line of light over the panel's width.
      if (insideR(p, vec4f(it.r.x - 2.0, it.r.y - 2.0, it.r.z + 4.0, it.r.w + 4.0))) {
        let edge = exp(-d * d / 3.0) * (1.0 - smoothstep(0.9, 1.0, k)) * 1.2;
        color += it.q.rgb * edge;
        alpha = max(alpha, min(edge, 1.0));
      }`,
    js(x, y, d, b) {
      return apertureDepth(x, y, d, b) >= 0;
    },
  },
});
