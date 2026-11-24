import { definePrimitive } from '../core/primitives.js';

/**
 * Focus lines (shūchūsen): ink strokes that converge on a point and leave a clear oval
 * around it, as a manga panel stares at its subject. Each line has its own width and its
 * own start beyond the oval, and tapers to a point toward the centre; a new seed redraws
 * the whole set, as an animation changes drawings on its twos. Lines never fade to grey:
 * as the amount drops they thin and draw back from the centre, in full ink.
 * r: clip rect; p: cx, cy, rx, ry (the clear oval); q: rgb, line count;
 * h.y: blend (INK, OVER); h.z: seed; h.w: amount (0..1).
 */
export const FOCUS = definePrimitive({
  kind: 33,
  name: 'focus',
  light: {
    wgsl: /* wgsl */ `
      if (insideR(p, it.r) && it.h.w > 0.0) {
        let fd = p - it.p.xy;
        let fe = length(fd / max(it.p.zw, vec2f(1.0)));
        let fcount = max(it.q.w, 8.0);
        let fa = (atan2(fd.y, fd.x) / 6.2831853 + 0.5) * fcount;
        let fi = u32(floor(fa));
        let ff = abs(fract(fa) - 0.5);
        let seed = u32(it.h.z) * 7919u;
        let h1 = hash01(fi * 3u + seed);
        let h2 = hash01(fi * 3u + seed + 1u);
        let amount = clamp(it.h.w, 0.0, 1.0);
        let start = 1.0 + h2 * h2 * 0.8 + (1.0 - amount) * 1.4;
        // 0 at the tip of the line, 1 once it has its full width.
        let grow = clamp((fe - start) / (0.35 + start * 0.6), 0.0, 1.0);
        let fhalf = (0.05 + 0.4 * h1 * h1) * grow * amount;
        let cellPx = 6.2831853 * length(fd) / fcount;
        let aa = 0.6 / max(cellPx, 0.01);
        let fink = (1.0 - smoothstep(fhalf - aa, fhalf + aa, ff)) * step(start, fe) * step(0.1, h1) * edgeF(p, it.r, 2.0);
        base = paint(base, it.q.rgb, fink, u32(it.h.y + 0.5));
      }`,
  },
});
