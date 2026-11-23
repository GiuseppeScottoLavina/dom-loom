import { definePrimitive } from '../core/primitives.js';
import { edge, fieldAt } from '../core/math.js';

const SOFT = 16; // px: the stir fades out toward the edge of the element, so nothing tears

const TMP = { x: 0, y: 0 };

/**
 * Water under the finger: the picture moves by the stage's displacement field (written by
 * the fluid behaviour), only inside the element, fading toward its edge. Where the water
 * bends the picture hard the colours split a little, and where its flow converges it
 * throws caustic light and a glint. r: the element; p: strength, glow.
 */
export const FLUID = definePrimitive({
  kind: 26,
  name: 'fluid',
  functions: /* wgsl */ `
fn fluidAt(p: vec2f, it: Item) -> vec2f {
  return fieldAt(p) * it.p.x * edgeF(p, it.r, ${SOFT}.0);
}`,
  offset: {
    // The split along the deformation is the light pass's own (it follows the gradient).
    whole: true,
    wgsl: /* wgsl */ `
      o += fluidAt(p, it);`,
    js(x, y, d, b, out, ctx) {
      const f = fieldAt(x, y, ctx.uniforms, ctx.field, TMP);
      const k = d[b + 8] * edge(x, y, d[b + 4], d[b + 5], d[b + 6], d[b + 7], SOFT);
      out.x += f.x * k;
      out.y += f.y * k;
    },
  },
  light: {
    wgsl: /* wgsl */ `
      if (!insideR(p, it.r) || u.wipe.x > 0.5 || u.field.z < 0.5) { continue; }
      let cell = u.view.zw / u.field.xy;
      let o = fluidAt(p, it);
      // The picture's map through the water, q = p + o, and its Jacobian by differences one cell apart.
      // (Of the water itself: the fade at the element's edge is not a current.)
      let ox = (fieldAt(p + vec2f(cell.x, 0.0)) - fieldAt(p - vec2f(cell.x, 0.0))) * it.p.x / (2.0 * cell.x);
      let oy = (fieldAt(p + vec2f(0.0, cell.y)) - fieldAt(p - vec2f(0.0, cell.y))) * it.p.x / (2.0 * cell.y);
      // The light folds sooner than the picture does: it is the water's own, exaggerated.
      let kx = ox * 5.0;
      let ky = oy * 5.0;
      let fdet = (1.0 + kx.x) * (1.0 + ky.y) - ky.x * kx.y;
      let bend = length(vec2f(ox.x, oy.y)) + length(vec2f(ox.y, oy.x));
      let m = length(o);
      // Refraction: where the water bends the picture hard, red and blue part along the flow.
      let split = min(bend * 4.0, 1.25) * u.style.y;
      if (split > 0.05 && m > 0.05) {
        let dir = o / m;
        let sp = clamp(p + o, vec2f(0.0), u.view.zw);
        let r = sampleSrc(clamp(sp + dir * split, vec2f(0.0), u.view.zw)).r;
        let b = sampleSrc(clamp(sp - dir * split, vec2f(0.0), u.view.zw)).b;
        base = vec3f(r, base.g, b);
      }
      // Caustics: where the flow converges (the picture is drawn together) it throws light, in thin
      // bright lines where the map folds. A glint rides the slopes that face the light.
      let converge = smoothstep(0.015, 0.16, -(ox.x + oy.y));
      let fold = exp(-pow(fdet / 0.3, 2.0));
      let n = normalize(vec3f(o.x, o.y, 20.0));
      let lightDir = normalize(vec3f(-0.5, -0.65, 0.58));
      let half = normalize(lightDir + vec3f(0.0, 0.0, 1.0));
      let glint = max(pow(max(dot(n, half), 0.0), 90.0) - pow(half.z, 90.0), 0.0);
      let caustic = clamp(converge * 0.5 + fold * 0.7, 0.0, 1.0);
      light += (u.holo.rgb * caustic * 0.6 + vec3f(0.85, 0.95, 1.0) * glint * 0.8) * it.p.y * edgeF(p, it.r, ${SOFT}.0);`,
  },
});

/** Its offset as the mapper computes it (for tests). */
export const fluidShift = (x, y, rect, strength, uniforms, field, out = { x: 0, y: 0 }) => {
  const f = fieldAt(x, y, uniforms, field, TMP);
  const k = strength * edge(x, y, rect[0], rect[1], rect[2], rect[3], SOFT);
  out.x = f.x * k;
  out.y = f.y * k;
  return out;
};
