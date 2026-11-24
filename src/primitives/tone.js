import { definePrimitive } from '../core/primitives.js';

/**
 * Screentone: a dot screen cut to a rounded, optionally slanted box, as on a manga page.
 * The dots follow the print's Euclidean spot: round dots at low cover, a checkerboard at
 * half, round holes of paper at high cover, so animating the cover never jumps. The
 * screen is fixed to the paper (page coordinates), like tone laid on the board.
 * r: rect; p: radius, skew, period (css px between dots), cover (0..1);
 * q: rgb, angle (rad, 0.785 is the usual 45°); h.y: blend (INK, BEHIND, OVER, INVERT: the dots reverse the picture);
 * h.z: gradation (0: flat; 1: the cover fades to nothing toward the bottom, -1: toward the top);
 * h.w: amount (0..1): it scales the cover, so tone that comes and goes grows and shrinks its
 * dots and never turns grey. BEHIND (1) inks only the darker parts of the picture: lettering
 * lighter than its ground stays clean, as words in a balloon over tone.
 */
export const TONE = definePrimitive({
  kind: 32,
  name: 'tone',
  functions: /* wgsl */ `
fn toneScreen(p: vec2f, period: f32, angle: f32, cover: f32) -> f32 {
  if (cover <= 0.001) { return 0.0; }
  if (cover >= 0.999) { return 1.0; }
  let cs = vec2f(cos(angle), sin(angle));
  let q = vec2f(p.x * cs.x + p.y * cs.y, p.y * cs.x - p.x * cs.y) / period;
  // Euclidean spot: 1 at the dot centres, -1 between them.
  let spot = 0.5 * (cos(6.2831853 * q.x) + cos(6.2831853 * q.y));
  let threshold = 1.0 - 2.0 * cover;
  // The spot changes by up to pi / period per css px: about one px of antialiasing.
  let w = 2.4 / period;
  return smoothstep(threshold - w, threshold + w, spot);
}`,
  light: {
    wgsl: /* wgsl */ `
      let tc = it.r.xy + it.r.zw * 0.5;
      let thb = it.r.zw * 0.5;
      var tp = p - tc;
      tp.x += tp.y * it.p.y;
      let tin = 1.0 - smoothstep(-0.7, 0.7, sdBox(tp, thb, min(it.p.x, min(thb.x, thb.y))));
      if (tin > 0.0 && it.h.w > 0.0) {
        var cover = it.p.w * clamp(it.h.w, 0.0, 1.0);
        let ty = clamp((p.y - it.r.y) / max(it.r.w, 1.0), 0.0, 1.0);
        if (it.h.z > 0.0) { cover *= mix(1.0, 1.0 - ty, it.h.z); }
        if (it.h.z < 0.0) { cover *= mix(1.0, ty, -it.h.z); }
        var ink = toneScreen(p, max(it.p.z, 2.0), it.q.w, cover) * tin;
        var mode = u32(it.h.y + 0.5);
        if (mode == 1u) {
          ink *= 1.0 - smoothstep(0.55, 0.85, luma(base));
          mode = 3u;
        }
        base = paint(base, it.q.rgb, ink, mode);
      }`,
  },
});
