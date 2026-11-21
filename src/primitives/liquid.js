import { definePrimitive } from '../core/primitives.js';

/** A liquid fill whose leading edge sloshes. r: rect; p: fill width, amplitude, phase, alpha; q: rgb. */
export const LIQUID = definePrimitive({
  kind: 15,
  name: 'liquid',
  light: {
    wgsl: /* wgsl */ `
      if (p.y < it.r.y || p.y > it.r.y + it.r.w || p.x < it.r.x) { continue; }
      let yy = p.y - it.r.y;
      let edgeX = it.r.x + it.p.x + it.p.y * (sin(yy * 0.9 + it.p.z) * 0.7 + sin(yy * 0.37 - it.p.z * 1.7) * 0.3);
      let d = p.x - edgeX;
      let fill = 1.0 - smoothstep(-0.6, 0.6, d);
      let toward = clamp((p.x - it.r.x) / max(it.p.x, 1.0), 0.0, 1.0);
      let shade = 0.45 + 0.55 * toward * toward;
      base = mix(base, it.q.rgb * shade, fill * it.p.w * (1.0 - smoothstep(0.4, 0.85, luma(base))));
      light += it.q.rgb * exp(-pow(d / 1.4, 2.0)) * it.p.w * 0.9;`,
  },
});
