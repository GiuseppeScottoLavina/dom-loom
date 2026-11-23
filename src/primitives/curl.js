import { definePrimitive } from '../core/primitives.js';
import { U } from '../core/scene.js';

// CURL: a cut style (stage.transition(update, { style: 'curl' })). The old page is a sheet
// that peels away from the side the cut starts on and rolls over a cylinder of radius r;
// what is peeled comes back on top as the sheet's back, mirrored, and lies over the
// part that is still flat. Everything is measured along the cut's normal n = (dir, slant)
// / |.|: x is where a pixel lies (0 at the starting edge), A is where the cylinder touches
// the flat sheet, so the sheet's first A px have left it:
//
//   x >= A            the flat old page, under the back of the turned part, which lies
//                     at x in [A, 2A - PI r]: it shows the paper at u = 2A - PI r - x
//   x in [A-r, A)     the cylinder seen from above: its upper half (the back, on top) shows
//                     the paper at u = A - r (PI - f), its lower half (the front, seen
//                     inside the curl while the sheet is short) the paper at u = A - r f,
//                     with f = asin((A - x) / r)
//   x < A - r         the new page, shadowed by what rolls over it
//
// A paper point u lands on p + n (u - x) of the old picture; where that is outside the
// scope there is no sheet (that is how the corners of the scope fold). The WGSL and
// the JS twin share this arithmetic; the twin only answers where the old page covers.

const PI = Math.PI;

/** r, the cylinder radius (px), from the scope size. */
export function curlRadius(sc) {
  return Math.min(70, Math.max(40, 0.11 * Math.min(sc[2], sc[3])));
}

/**
 * The geometry of the curl for a scope (x, y, w, h), at progress `front` (0..1 + band).
 * n: the cut's unit normal, len: the sheet's length along it, r: radius, A: where the
 * cylinder touches the flat sheet (0 at the start, len + r + 2 at the end).
 */
export function curlGeometry(sc, front, dir, slant, band) {
  const k = Math.hypot(1, slant);
  const len = (sc[2] + sc[3] * slant) / k;
  const r = curlRadius(sc);
  return { nx: dir / k, ny: slant / k, len, r, A: Math.min(front / (1 + band), 1) * (len + r + 2) };
}

const within = (x, y, sc) => x >= sc[0] && y >= sc[1] && x < sc[0] + sc[2] && y < sc[1] + sc[3];

/**
 * Does the old page (flat, rolled or turned back) cover the pixel at (x, y), whose
 * place along the cut is t = x-coordinate along n? Answer for the geometry g.
 */
export function curlCovers(x, y, t, g, sc) {
  if (t >= g.A) return true;
  if (t < g.A - g.r) return false;
  const f = Math.asin(Math.min(Math.max((g.A - t) / g.r, 0), 1));
  const lower = g.A - g.r * f - t;
  const upper = g.A - g.r * (PI - f) - t;
  return within(x + g.nx * lower, y + g.ny * lower, sc) || within(x + g.nx * upper, y + g.ny * upper, sc);
}

// The back of a turned part and the cylinder cover what is behind them; the flat page is
// everything at x >= A inside the scope, which is why the turned back needs no test here.
export const CURL = definePrimitive({
  kind: 29,
  name: 'curl',
  cut: {
    fn: 'curlCut',
    wgsl: /* wgsl */ `
const CURL_PI: f32 = 3.14159265;

// How much of the sheet is at q (a source point): 0..1 across a 1 px edge. Twin of insideR.
fn curlSd(q: vec2f, sc: vec4f) -> f32 {
  return min(min(q.x - sc.x, sc.x + sc.z - q.x), min(q.y - sc.y, sc.y + sc.w - q.y));
}
fn curlRect(q: vec2f, sc: vec4f) -> f32 { return clamp(curlSd(q, sc) + 0.5, 0.0, 1.0); }

// Does a rolled or turned part of the old page lie at t = xp on the line of p (x is p's t)?
fn curlOver(p: vec2f, n: vec2f, x: f32, xp: f32, A: f32, r: f32, sc: vec4f) -> f32 {
  if (xp >= A) {
    return curlRect(p + n * (2.0 * A - CURL_PI * r - x - xp), sc);
  }
  if (xp < A - r) { return 0.0; }
  let f = asin(clamp((A - xp) / r, 0.0, 1.0));
  let q = p + n * (xp - x);
  let su = q + n * (A - r * (CURL_PI - f) - xp);
  let sl = q + n * (A - r * f - xp);
  return max(curlRect(su, sc), curlRect(sl, sc));
}

// The old page sampled over a span of du px along n (a sheet seen edge-on is minified).
fn curlGhost(q: vec2f, n: vec2f, du: f32) -> vec3f {
  return (sampleGhost(q) * 2.0 + sampleGhost(q + n * du * 0.34) + sampleGhost(q - n * du * 0.34)) * 0.25;
}

// The back of the sheet: paper washed toward the holo palette, the print showing
// faintly through, scan lines.
fn curlBack(g: vec3f, p: vec2f) -> vec3f {
  let l = luma(g);
  let paper = mix(u.bg.rgb, u.holo.rgb, 0.20) * 1.5 + vec3f(0.06);
  let print = mix(vec3f(l), g, 0.5);
  let scan = 0.92 + 0.08 * step(0.5, fract(p.y / 3.0));
  return (mix(paper, print, 0.30) + u.holo.rgb * (0.04 + 0.16 * l)) * scan;
}

fn curlCut(p: vec2f, sc: vec4f, s: f32, front: f32, dir: f32, light: ptr<function, vec3f>) -> vec3f {
  if (front <= 0.0) { return sampleGhost(p); }
  let slant = u.wipe.w;
  let k = sqrt(1.0 + slant * slant);
  let n = vec2f(dir, slant) / k;
  let len = (sc.z + sc.w * slant) / k;
  let r = clamp(0.11 * min(sc.z, sc.w), 40.0, 70.0);
  let A = min(front / (1.0 + u.wipe.z), 1.0) * (len + r + 2.0);
  let x = s * len;
  let st = r / 50.0;
  let jit = hash01(u32(p.x) * 1973u + u32(p.y) * 9277u);
  // Shadows fade out toward the scope's edges: beyond them the page is not shaded.
  let fade = smoothstep(0.0, 14.0, curlSd(p, sc));
  // Light from the new page's side, above: (t, z). H is the half vector toward the eye.
  let L = normalize(vec2f(-0.5, 0.86));
  let H = normalize(L + vec2f(0.0, 1.0));
  let tint = mix(vec3f(1.0, 0.96, 0.98), u.holo.rgb, 0.35);
  var c = vec3f(0.0);

  if (x >= A) {
    // The flat old page, with the shadow the turned part casts ahead of its edge.
    c = sampleGhost(p);
    // (Only within reach of the turned part: beyond it nothing is shaded.)
    if (x < max(A, 2.0 * A - CURL_PI * r) + 100.0 * st) {
      var occF = 0.0;
      var wsumF = 0.0;
      for (var i = 0u; i < 16u; i++) {
        let q = (f32(i) + jit) / 16.0;
        let w = (1.0 - q) * (1.0 - q);
        occF += w * curlOver(p, n, x, x - (4.0 + q * 96.0) * st, A, r, sc);
        wsumF += w;
      }
      c *= 1.0 - 0.6 * fade * occF / wsumF;
    }
    // The back of the turned part, flat on top.
    let sb = p + n * (2.0 * A - CURL_PI * r - 2.0 * x);
    let cb = curlRect(sb, sc);
    if (cb > 0.0) {
      let back = curlBack(curlGhost(sb, n, 1.0), p);
      c = mix(c, back, cb);
      let e = curlSd(sb, sc);
      *light += u.holo.rgb * exp(-pow(e / 1.6, 2.0)) * 0.55 * cb;
    }
    return c;
  }

  // The new page, in the shade of the roll.
  c = livePicture(p);
  if (x < A - r - 82.0 * st) { return c; }
  var occ = 0.0;
  var wsum = 0.0;
  for (var i = 0u; i < 20u; i++) {
    let q = (f32(i) + jit) / 20.0;
    let w = (1.0 - q) * (1.0 - q);
    occ += w * curlOver(p, n, x, x + (2.0 + q * 78.0) * st, A, r, sc);
    wsum += w;
  }
  c *= 1.0 - 0.7 * fade * occ / wsum;
  if (x <= A - r - 1.0) { return c; }

  let sil = clamp(x - (A - r) + 0.5, 0.0, 1.0);
  let sn = clamp((A - x) / r, 0.0, 1.0);
  let f = asin(sn);
  let cf = sqrt(max(1.0 - sn * sn, 0.0));
  let span = 1.0 / max(cf, 0.12);

  // The lower half: the front of the page, seen inside the curl (only while the sheet is short).
  let s1 = p + n * (A - r * f - x);
  let c1 = curlRect(s1, sc) * sil;
  if (c1 > 0.0) {
    let g = curlGhost(s1, n, span);
    let diff = max(-0.5 * sn + 0.86 * cf, 0.0);
    let inner = g * (0.16 + 0.84 * diff) * (0.4 + 0.6 * cf);
    c = mix(c, inner, c1);
    *light += u.holo.rgb * exp(-pow(curlSd(s1, sc) / 1.6, 2.0)) * 0.5 * c1;
  }

  // The upper half: the back of the page, lit like a cylinder, with a specular streak.
  let s2 = p + n * (A - r * (CURL_PI - f) - x);
  let c2 = curlRect(s2, sc) * sil;
  if (c2 > 0.0) {
    let g = curlGhost(s2, n, span);
    let nrm = vec2f(-sn, cf);
    let diff = max(dot(nrm, L), 0.0);
    var shade = (0.3 + 0.8 * diff) / (0.3 + 0.8 * 0.86);
    shade *= 0.55 + 0.45 * smoothstep(0.0, 0.5, cf);
    let nh = max(dot(nrm, H), 0.0);
    let spec = pow(nh, 220.0) * 1.1 + pow(nh, 32.0) * 0.22;
    let rim = pow(1.0 - cf, 3.0);
    c = mix(c, curlBack(g, p) * shade, c2);
    *light += (tint * spec + u.holo.rgb * rim * 0.7) * c2;
    *light += u.holo.rgb * exp(-pow(curlSd(s2, sc) / 1.6, 2.0)) * 0.55 * c2;
  }
  return c;
}`,
    // null where the old page shows, in whatever shape (flat, rolled, turned); undefined on the new page.
    js(x, y, sc, s, front, dir, uniforms) {
      if (!(front > 0)) return null;
      const g = curlGeometry(sc, front, dir, uniforms[U.wipeSlant], uniforms[U.wipeBand]);
      return curlCovers(x, y, s * g.len, g, sc) ? null : undefined;
    },
  },
});
