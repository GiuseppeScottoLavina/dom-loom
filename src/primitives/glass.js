import { definePrimitive } from '../core/primitives.js';

/**
 * A pane of liquid glass: a rounded box, clear in its middle, thick at its edge. Through
 * the rim band the picture bends: it shows, squeezed, what lies just past the edge, with a
 * faint dispersion of red and blue. A light tint, a specular rim toward the light, a darker
 * inner edge away from it, and a soft shadow below give it thickness. The bend is light,
 * not displacement: input stays with the layout (a press on the rim is a press on the pane).
 * r: rect; p: radius, rim band (css px), bend (css px at the very edge), tint alpha (in the middle;
 * a quarter of it in the rim);
 * q: tint rgb, shadow strength; h.z: swell (0..1, a press thickens it); h.w: presence (0..1).
 */
export const GLASS = definePrimitive({
  kind: 35,
  name: 'glass',
  functions: /* wgsl */ `
fn glassSd(p: vec2f, it: Item) -> f32 {
  let hb = it.r.zw * 0.5;
  return sdBox(p - (it.r.xy + hb), hb, min(it.p.x, min(hb.x, hb.y)));
}`,
  light: {
    wgsl: /* wgsl */ `
      let gpres = clamp(it.h.w, 0.0, 1.0);
      let gd = glassSd(p, it);
      if (gpres > 0.001 && gd < 28.0) {
        if (gd >= 0.0) {
          // The pane stands off the page: a soft shadow, a little below it.
          var sit = it;
          sit.r.y += 7.0;
          let sd = glassSd(p, sit);
          base *= 1.0 - it.q.w * gpres * 0.35 * (1.0 - smoothstep(-6.0, 22.0, sd));
        } else {
          let ge = 0.5;
          var gn = vec2f(glassSd(p + vec2f(ge, 0.0), it) - glassSd(p - vec2f(ge, 0.0), it),
                         glassSd(p + vec2f(0.0, ge), it) - glassSd(p - vec2f(0.0, ge), it));
          gn = gn / max(length(gn), 1e-4);
          let band = max(it.p.y * (1.0 + 0.35 * it.h.z), 1.0);
          let gk = 1.0 - clamp(-gd / band, 0.0, 1.0);
          if (gk > 0.0) {
            // The rim shows what lies past the edge, squeezed into the band.
            let bend = it.p.z * (1.0 + 0.6 * it.h.z) * gpres * gk * gk;
            let off = gn * bend;
            base = vec3f(sampleSrc(p + off * 1.1).r, sampleSrc(p + off).g, sampleSrc(p + off * 0.9).b);
          }
          // Milky in the middle, where the pane's own lettering sits; clear in the rim, where
          // the bend shows.
          base = mix(base, it.q.rgb, mix(it.p.w, it.p.w * 0.25, gk) * gpres);
          // Light from above, a little to the left.
          let facing = dot(gn, vec2f(-0.45, -0.89));
          let rw = (gd + 0.9) / 0.9;
          let rim = exp(-rw * rw);
          light += vec3f(1.0) * rim * (0.18 + 0.6 * max(facing, 0.0)) * gpres;
          light += vec3f(1.0) * gk * gk * max(facing, 0.0) * 0.14 * gpres;
          base *= 1.0 - gk * gk * max(-facing, 0.0) * 0.16 * gpres;
        }
      }`,
  },
});
