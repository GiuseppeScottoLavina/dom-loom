import { definePrimitive } from '../core/primitives.js';

/**
 * A point light over a surface. The shader reads the live picture as a height field
 * (the luminance, Sobel at two scales), derives normals and shades them: text, borders
 * and icons emboss: a thin bright edge on the side that faces the light, with a crisp
 * specular, a thin dark one on the far side, only on pixels that are themselves part of
 * the relief (nothing is shifted or redrawn). A holo-tinted pool brightens the surface
 * around the light. No pixel moves, so there is no input twin.
 * h.y: open (0..1, the light fading); r: the surface (the light stays inside it);
 * p: light x, y, reach (px), intensity; q: light height (px).
 * The colour is the skin's rim role (holo).
 */
export const LIT = definePrimitive({
  kind: 25,
  name: 'lit',
  functions: /* wgsl */ `
fn litHeight(q: vec2f) -> f32 {
  return luma(livePicture(q));
}
// The slope of the height field at p over a step of e px (a Sobel kernel); z: the lowest
// height among the eight neighbours.
fn litSlope(p: vec2f, e: f32) -> vec3f {
  let tl = litHeight(p + vec2f(-e, -e));
  let tc = litHeight(p + vec2f(0.0, -e));
  let tr = litHeight(p + vec2f(e, -e));
  let ml = litHeight(p + vec2f(-e, 0.0));
  let mr = litHeight(p + vec2f(e, 0.0));
  let bl = litHeight(p + vec2f(-e, e));
  let bc = litHeight(p + vec2f(0.0, e));
  let br = litHeight(p + vec2f(e, e));
  let gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  let gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  let low = min(min(min(tl, tc), min(tr, ml)), min(min(mr, bl), min(bc, br)));
  return vec3f(gx / (8.0 * e), gy / (8.0 * e), low);
}`,
  light: {
    wgsl: /* wgsl */ `
      let lopen = it.h.y;
      let toLight = it.p.xy - p;
      let ldist = length(toLight);
      if (lopen > 0.001 && insideR(p, it.r) && ldist < it.p.z) {
        let reach = it.p.z;
        let gain = it.p.w * lopen;
        // Falls off smoothly to nothing at the reach.
        let fall = 1.0 - smoothstep(0.0, reach, ldist);
        let att = fall * fall;
        let s1 = litSlope(p, 1.0);
        let s2 = litSlope(p, 2.0);
        let slope = s1.xy + s2.xy * 0.3;
        // The relief only changes the brightness of pixels that are themselves part of it
        // (a glyph, a border): the weight is how far this pixel rises above its neighbours.
        let own = litHeight(p);
        let part = clamp((own - s1.z) * 5.0, 0.0, 1.0);
        let nrm = normalize(vec3f(-slope * 2.2, 1.0));
        let ldir = normalize(vec3f(toLight, it.q.x));
        let hlf = normalize(ldir + vec3f(0.0, 0.0, 1.0));
        let diffuse = dot(nrm, ldir) - ldir.z;
        let spec = max(pow(max(dot(nrm, hlf), 0.0), 70.0) - pow(hlf.z, 70.0), 0.0);
        let toward = max(diffuse, 0.0);
        let away = max(-diffuse, 0.0);
        let tint = mix(vec3f(1.0, 0.97, 0.98), u.holo.rgb, 0.45);
        // The pool: the surface brightens and takes the holo tint around the light.
        base *= 1.0 + 0.3 * att * gain;
        light += u.holo.rgb * att * gain * 0.2;
        light += tint * exp(-ldist * ldist / (reach * reach * 0.012)) * gain * 0.2;
        let pr = (ldist - reach * 0.9) / 1.4;
        light += u.holo.rgb * exp(-pr * pr) * gain * 0.07 * (1.0 - fall);
        // Edges that face the light catch it; edges that face away darken. Only existing pixels change.
        base *= 1.0 - clamp(away * 1.8, 0.0, 0.6) * att * gain * part;
        light += tint * toward * att * gain * part * 4.0;
        light += mix(vec3f(1.0), u.holo.rgb, 0.25) * spec * att * gain * part * 9.0;
      }`,
  },
});
