import { definePrimitive } from '../core/primitives.js';

/**
 * A point light over a surface. The shader reads the live picture as a height field
 * (the luminance, Sobel at two scales), derives normals and shades them: text, borders
 * and icons emboss, edges toward the light catch a specular, edges away from it sink
 * and take a signal rim, and a soft diffuse pool falls off around the light. No pixel
 * moves, so there is no input twin.
 * h.y: open (0..1, the light fading); r: the surface (the light stays inside it);
 * p: light x, y, reach (px), intensity; q: light height (px).
 * The colours are the skin's rim (holo) and hot (signal) roles.
 */
export const LIT = definePrimitive({
  kind: 25,
  name: 'lit',
  functions: /* wgsl */ `
fn litHeight(q: vec2f) -> f32 {
  return luma(livePicture(q));
}
// The slope of the height field at p over a step of e px (a Sobel kernel).
fn litSlope(p: vec2f, e: f32) -> vec2f {
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
  return vec2f(gx, gy) / (8.0 * e);
}`,
  light: {
    wgsl: /* wgsl */ `
      let lopen = it.h.y;
      let toLight = it.p.xy - p;
      let ldist = length(toLight);
      if (lopen > 0.001 && insideR(p, it.r) && ldist < it.p.z * 1.7) {
        let reach = it.p.z;
        let gain = it.p.w * lopen;
        let slope = litSlope(p, 0.75) * 0.9 + litSlope(p, 1.5) * 0.3;
        let nrm = normalize(vec3f(-slope * 1.5, 1.0));
        let ldir = normalize(vec3f(toLight, it.q.x));
        let hlf = normalize(ldir + vec3f(0.0, 0.0, 1.0));
        // How much the relief changes the shading of a flat surface.
        let diffuse = dot(nrm, ldir) - ldir.z;
        let spec = max(pow(max(dot(nrm, hlf), 0.0), 34.0) - pow(hlf.z, 34.0), 0.0);
        let att = (1.0 / (1.0 + pow(ldist / (reach * 0.5), 2.0))) * (1.0 - smoothstep(reach * 0.95, reach * 1.7, ldist));
        let toward = max(diffuse, 0.0);
        let away = max(-diffuse, 0.0);
        let tint = mix(vec3f(1.0, 0.97, 0.98), u.holo.rgb, 0.5);
        // Edges facing the light brighten and glint; edges facing away sink and take a rim of signal.
        base *= 1.0 - clamp(away * 1.1, 0.0, 0.55) * att * gain;
        light += tint * toward * att * gain * 2.8;
        light += mix(vec3f(1.0), u.holo.rgb, 0.3) * spec * att * gain * 4.2;
        light += u.hot.rgb * away * att * gain * 0.32;
        // The source itself: a small hot bloom, the diffuse pool around it and its faint rim.
        light += tint * exp(-ldist * ldist / (reach * reach * 0.02)) * gain * 0.17;
        light += u.holo.rgb * att * gain * 0.15;
        let pr = (ldist - reach * 0.92) / 1.5;
        light += u.holo.rgb * exp(-pr * pr) * gain * 0.05;
      }`,
  },
});
