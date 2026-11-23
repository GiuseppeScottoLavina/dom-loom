import { definePrimitive } from '../core/primitives.js';
import { smoothstep } from '../core/math.js';

// Inside the flat core (up to this share of the radius) the magnification is uniform.
const CORE = 0.85;

/**
 * Where, as a share of the radius, the glass looks at a point that is r of the radius
 * from its centre (twin of loupeProfile in WGSL). Up to CORE it is r / m: a clean,
 * uniform enlargement. Between CORE and the rim a cubic Hermite curve carries it on to
 * the rim (1), leaving the core with the core's slope and meeting the picture outside
 * with its own slope (1): the thin band squeezes the surroundings in (barrel,
 * refraction) and the picture is continuous at the rim.
 */
export function loupeProfile(r, m) {
  if (r <= CORE) return r / m;
  const w = 1 - CORE;
  const t = (r - CORE) / w;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * (CORE / m) + (t3 - 2 * t2 + t) * (w / m) + (-2 * t3 + 3 * t2) + (t3 - t2) * w;
}

/**
 * Where a point of the glass looks, from the glass centre (twin of loupeMap in WGSL).
 * (dx, dy) is the point from the centre; the answer is the source offset, from the
 * glass's focus.
 */
export function loupeMap(dx, dy, radius, mag, open, out = { x: 0, y: 0 }) {
  const dist = Math.hypot(dx, dy);
  const r = dist / radius;
  if (r >= 1) {
    out.x = dx;
    out.y = dy;
    return out;
  }
  const m = 1 + (mag - 1) * open;
  const k = r <= CORE ? 1 / m : loupeProfile(r, m) / r;
  out.x = dx * k;
  out.y = dy * k;
  return out;
}

const scratch = { x: 0, y: 0 };

/**
 * A magnifying glass. Inside the disc the picture comes from nearer its focus
 * (magnified, with barrel distortion and a refracting rim); light adds a rim with
 * chromatic fringe, a specular highlight and a ring of reticle ticks. It moves pixels,
 * so the input mapper runs the same arithmetic (offset.js).
 * h.y: open (0..1, the glass swelling in); h.z: phase of the ticks (rad); h.w: tick
 * strength; r: clip (the disc and its shadow); p: cx, cy, radius, magnification;
 * q: focus relative to the centre (where the glass looks: 0, 0 for a mouse, the finger
 * for touch). The colours are the skin's rim (holo) and hot (signal) roles.
 */
export const LOUPE = definePrimitive({
  kind: 24,
  name: 'loupe',
  functions: /* wgsl */ `
fn loupeProfile(r: f32, m: f32) -> f32 {
  let core = 0.85;
  if (r <= core) { return r / m; }
  let w = 1.0 - core;
  let t = (r - core) / w;
  let t2 = t * t;
  let t3 = t2 * t;
  return (2.0 * t3 - 3.0 * t2 + 1.0) * (core / m) + (t3 - 2.0 * t2 + t) * (w / m) + (-2.0 * t3 + 3.0 * t2) + (t3 - t2) * w;
}
fn loupeMap(d: vec2f, radius: f32, mag: f32, open: f32) -> vec2f {
  let r = length(d) / radius;
  if (r >= 1.0) { return d; }
  let m = 1.0 + (mag - 1.0) * open;
  if (r <= 0.85) { return d / m; }
  return d * (loupeProfile(r, m) / r);
}
// Five taps along the radial direction, spread over what one pixel of the glass covers
// there: the squeezed band is averaged, not aliased.
fn loupeBand(focus: vec2f, dir: vec2f, reach: f32, spread: f32) -> vec3f {
  var acc = vec3f(0.0);
  for (var k = -2; k <= 2; k++) {
    acc += loupeSrc(focus + dir * (reach + f32(k) * spread * 0.5));
  }
  return acc * 0.2;
}
fn loupeSrc(q: vec2f) -> vec3f {
  return sampleSrc(clamp(q, vec2f(0.0), u.view.zw));
}`,
  offset: {
    whole: true,
    wgsl: /* wgsl */ `
      let gd = p - it.p.xy;
      if (length(gd) < it.p.z) {
        o += it.q.xy + loupeMap(gd, it.p.z, it.p.w, it.h.y) - gd;
      }`,
    js(x, y, d, b, out) {
      const radius = d[b + 10];
      const dx = x - d[b + 8];
      const dy = y - d[b + 9];
      if (Math.hypot(dx, dy) >= radius) return;
      const s = loupeMap(dx, dy, radius, d[b + 11], d[b + 1], scratch);
      out.x += d[b + 12] + s.x - dx;
      out.y += d[b + 13] + s.y - dy;
    },
  },
  light: {
    wgsl: /* wgsl */ `
      let gopen = it.h.y;
      let gd = p - it.p.xy;
      let gr = it.p.z;
      let gdist = length(gd);
      if (gopen > 0.001 && gdist < gr + 30.0) {
        let r = gdist / gr;
        let dir = gd / max(gdist, 0.001);
        // The light comes from the upper left: toward it is positive.
        let facing = dot(dir, normalize(vec2f(-0.62, -0.78)));
        if (r >= 1.0) {
          // The glass stands off the page: a soft shadow below it and a dark edge.
          let sd = length(gd - vec2f(3.0, 9.0));
          base *= 1.0 - 0.5 * gopen * (1.0 - smoothstep(gr * 0.92, gr + 26.0, sd));
          let ow = (gdist - gr - 0.8) / 0.9;
          base *= 1.0 - 0.55 * gopen * exp(-ow * ow);
        } else {
          let focus = it.p.xy + it.q.xy;
          let s = loupeMap(gd, gr, it.p.w, gopen);
          // The refracting band: averaged (it squeezes the picture), with a faint dispersion
          // of red and blue that is zero in the flat core and under a pixel at the rim.
          let rimBand = smoothstep(0.85, 1.0, r);
          if (r > 0.85) {
            let m = 1.0 + (it.p.w - 1.0) * gopen;
            let slope = (loupeProfile(min(r + 0.01, 1.0), m) - loupeProfile(r - 0.01, m)) / (min(r + 0.01, 1.0) - r + 0.01);
            let reach = length(s);
            let sdir = s / max(reach, 0.001);
            let spread = max(slope - 1.0, 0.0);
            let disp = gopen * 0.007 * rimBand * rimBand;
            base.g = loupeBand(focus, sdir, reach, spread).g;
            base.r = loupeBand(focus, sdir, reach * (1.0 - disp), spread).r;
            base.b = loupeBand(focus, sdir, reach * (1.0 + disp), spread).b;
          }
          // Glass: a little dark toward the edge, a faint cool haze.
          base *= 1.0 - 0.16 * gopen * r * r * r * r;
          light += u.holo.rgb * 0.025 * gopen;
          // The thin rim: bright toward the light, signal red on the far side.
          let rw = (gdist - (gr - 1.3)) / 1.5;
          let rim = exp(-rw * rw);
          let toward = max(facing, 0.0);
          light += mix(u.holo.rgb, vec3f(1.0), 0.45 + 0.4 * toward) * rim * (0.3 + 0.9 * toward * toward) * gopen;
          light += u.hot.rgb * rim * 0.5 * max(-facing, 0.0) * gopen;
          light += u.holo.rgb * rimBand * (1.0 - smoothstep(0.985, 1.0, r)) * (0.07 + 0.2 * toward) * gopen;
          // The specular highlight, a short arc along the rim toward the light, and its core.
          let he = gd - vec2f(-0.42, -0.52) * gr;
          let tang = vec2f(0.78, -0.62);
          let hu = dot(he, tang) / (0.3 * gr);
          let hv = dot(he, vec2f(-0.62, -0.78)) / (0.09 * gr);
          light += vec3f(1.0, 0.97, 0.98) * (exp(-(hu * hu + hv * hv) * 1.3) * 0.3 + exp(-dot(he, he) / (gr * gr * 0.0035)) * 0.28) * gopen;
          // A cooler glint on the far side.
          let ge = gd - vec2f(0.5, 0.55) * gr;
          light += u.holo.rgb * exp(-dot(ge, ge) / (gr * gr * 0.012)) * 0.12 * gopen;
          // The reticle: a ring of ticks, with a longer one every 30 degrees.
          if (it.h.w > 0.0 && gdist > gr - 20.0 && gdist < gr - 7.0) {
            let tau = 6.28318530718;
            let ta = fract(atan2(gd.y, gd.x) / tau + it.h.z / tau) * 72.0;
            let ti = floor(ta + 0.5);
            let across = (ta - ti) * (tau * gdist / 72.0);
            let major = (u32(ti) % 6u) == 0u;
            let inner = select(gr - 13.0, gr - 18.0, major);
            let band = smoothstep(inner - 0.6, inner + 0.6, gdist) * (1.0 - smoothstep(gr - 9.6, gr - 8.4, gdist));
            let tick = (1.0 - smoothstep(0.35, 0.95, abs(across))) * band;
            light += u.holo.rgb * tick * it.h.w * gopen * select(0.4, 0.8, major);
          }
        }
      }`,
  },
});
