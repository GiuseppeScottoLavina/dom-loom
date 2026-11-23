import { definePrimitive } from '../core/primitives.js';
import { smoothstep } from '../core/math.js';

/**
 * Where a point of the glass looks, from the glass centre (twin of loupeMap in WGSL).
 * (dx, dy) is the point from the centre; the answer is the source offset, from the
 * glass's focus. Magnification is highest in the middle and falls toward the rim
 * (barrel distortion); right at the rim a band of the surroundings is squeezed in,
 * which is the glass edge refracting. At the rim itself the picture is continuous.
 */
export function loupeMap(dx, dy, radius, mag, open, out = { x: 0, y: 0 }) {
  const r = Math.hypot(dx, dy) / radius;
  if (r >= 1) {
    out.x = dx;
    out.y = dy;
    return out;
  }
  const m = 1 + (mag - 1) * open;
  const g = 1 / m + (1 - 1 / m) * r * r * r;
  const bulge = 1 + 0.1 * open * Math.sin(Math.PI * smoothstep(0.8, 1, r));
  out.x = dx * g * bulge;
  out.y = dy * g * bulge;
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
fn loupeMap(d: vec2f, radius: f32, mag: f32, open: f32) -> vec2f {
  let r = length(d) / radius;
  if (r >= 1.0) { return d; }
  let m = 1.0 + (mag - 1.0) * open;
  let g = 1.0 / m + (1.0 - 1.0 / m) * r * r * r;
  let bulge = 1.0 + 0.1 * open * sin(3.14159265358979 * smoothstep(0.8, 1.0, r));
  return d * g * bulge;
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
          // Dispersion: red and blue look from a little nearer and farther, most at the rim.
          let rimBand = smoothstep(0.84, 1.0, r);
          let disp = gopen * (0.012 * r * r + 0.035 * rimBand);
          base.r = loupeSrc(focus + s * (1.0 - disp)).r;
          base.b = loupeSrc(focus + s * (1.0 + disp)).b;
          // Glass: a little dark toward the edge, a faint cool haze.
          base *= 1.0 - 0.2 * gopen * r * r * r;
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
