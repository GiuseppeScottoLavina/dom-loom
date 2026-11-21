import { definePrimitive } from '../core/primitives.js';
import { inside } from '../core/math.js';

/**
 * Where (x, y) falls on the plane of a TILT card, from the card's centre, or null
 * beside the card (twin of tiltLocal in WGSL).
 */
export function tiltLocal(x, y, d, b) {
  const rx = d[b + 4], ry = d[b + 5], rw = d[b + 6], rh = d[b + 7];
  const a = d[b + 8], bb = d[b + 9], eye = d[b + 10], lift = d[b + 11];
  const qx = (x - rx - rw / 2) / lift;
  const qy = (y - ry - rh / 2) / lift;
  const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(bb), cb = Math.cos(bb);
  // The ray from the eye at (0, 0, eye) through (qx, qy, 0) meets the turned plane.
  const nx = sb * ca, ny = -sa, nz = cb * ca;
  const t = (nz * eye) / (nz * eye - nx * qx - ny * qy);
  const X = t * qx, Y = t * qy, Z = eye - t * eye;
  const u = X * cb - Z * sb;
  const v = X * sb * sa + Y * ca + Z * cb * sa;
  if (Math.abs(u) > rw / 2 || Math.abs(v) > rh / 2) return null;
  return { u, v };
}

/**
 * A card turned in perspective, with a shadow, a glare and a foil on the edges of its
 * content. h.y: margin; r: card rect; p: rotX, rotY, eye distance, lift; q: foil,
 * glare, glare x, glare y.
 */
export const TILT = definePrimitive({
  kind: 20,
  name: 'tilt',
  functions: /* wgsl */ `
fn tiltLocal(p: vec2f, it: Item) -> vec3f {
  let q = (p - it.r.xy - it.r.zw * 0.5) / it.p.w;
  let sa = sin(it.p.x);
  let ca = cos(it.p.x);
  let sb = sin(it.p.y);
  let cb = cos(it.p.y);
  let eye = it.p.z;
  let n = vec3f(sb * ca, -sa, cb * ca);
  let t = (n.z * eye) / (n.z * eye - n.x * q.x - n.y * q.y);
  let X = vec3f(t * q.x, t * q.y, eye - t * eye);
  let u = X.x * cb - X.z * sb;
  let v = X.x * sb * sa + X.y * ca + X.z * cb * sa;
  let inside = step(abs(u), it.r.z * 0.5) * step(abs(v), it.r.w * 0.5);
  return vec3f(u, v, inside);
}`,
  picture: {
    name: 'tiltPicture',
    order: 10,
    wgsl: /* wgsl */ `
fn tiltPicture(p: vec2f, light: ptr<function, vec3f>) -> vec4f {
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    if (u32(it.h.x + 0.5) != 20u) { continue; }
    let m = it.h.y;
    if (!insideR(p, vec4f(it.r.xy - vec2f(m), it.r.zw + vec2f(2.0 * m)))) { continue; }
    let l = tiltLocal(p, it);
    let c = it.r.xy + it.r.zw * 0.5;
    if (l.z < 0.5) {
      // The shadow: the flat card, pushed away from the light, blurred.
      let off = vec2f(it.p.y, -it.p.x) * 40.0 + vec2f(0.0, 6.0);
      let d = sdBox(p - c - off, it.r.zw * 0.5, 6.0);
      let shade = exp(-max(d, 0.0) / 9.0) * 0.45 * clamp((abs(it.p.x) + abs(it.p.y)) * 6.0, 0.0, 1.0);
      return vec4f(u.bg.rgb * (1.0 - shade), 1.0);
    }
    let q = c + l.xy;
    var col = livePicture(q);
    // The card's normal against a light up and to the left: the far side dims.
    let sa = sin(it.p.x);
    let ca = cos(it.p.x);
    let sb = sin(it.p.y);
    let cb = cos(it.p.y);
    let nrm = vec3f(sb * ca, -sa, cb * ca);
    let lit = dot(nrm, normalize(vec3f(-0.35, -0.5, 1.0)));
    col *= 0.82 + 0.25 * lit;
    // Glare: a soft hot spot where the pointer is.
    let g = (q - it.q.zw) / max(it.r.zw, vec2f(1.0));
    *light += vec3f(1.0) * exp(-dot(g, g) * 5.0) * 0.16 * it.q.y;
    // Foil: the edges of the content itself shine in colours that shift with the angle.
    if (it.q.x > 0.0) {
      let e = vec2f(1.0, 0.0);
      let f = vec2f(0.0, 1.0);
      let gx = luma(sampleSrc(q + e)) - luma(sampleSrc(q - e));
      let gy = luma(sampleSrc(q + f)) - luma(sampleSrc(q - f));
      let edge = clamp(length(vec2f(gx, gy)) * 2.2, 0.0, 1.0);
      let hue = l.x * 0.004 + l.y * 0.003 + it.p.y * 2.2 - it.p.x * 1.6;
      let rainbow = 0.5 + 0.5 * cos(6.28318530718 * (hue + vec3f(0.0, 0.33, 0.67)));
      let angle = clamp((abs(it.p.x) + abs(it.p.y)) * 5.0, 0.0, 1.0);
      *light += rainbow * edge * angle * 0.75 * it.q.x;
    }
    return vec4f(col, 1.0);
  }
  return vec4f(0.0, 0.0, 0.0, -1.0);
}`,
    js(x, y, d, b) {
      const m = d[b + 1];
      const rx = d[b + 4], ry = d[b + 5], rw = d[b + 6], rh = d[b + 7];
      if (!inside(x, y, rx - m, ry - m, rw + 2 * m, rh + 2 * m)) return undefined;
      const local = tiltLocal(x, y, d, b);
      if (!local) return null;
      return { x: rx + rw / 2 + local.u, y: ry + rh / 2 + local.v };
    },
  },
});
