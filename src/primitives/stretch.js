import { definePrimitive } from '../core/primitives.js';

/** Panes stretching like rubber. r: rect; p: left, right, divider in the layout, divider shown. */
export const STRETCH = definePrimitive({
  kind: 22,
  name: 'stretch',
  offset: {
    whole: true,
    wgsl: /* wgsl */ `
      var sx = p.x;
      if (p.x <= it.p.w) { sx = it.p.x + (p.x - it.p.x) * (it.p.z - it.p.x) / max(it.p.w - it.p.x, 1e-3); }
      else { sx = it.p.z + (p.x - it.p.w) * (it.p.y - it.p.z) / max(it.p.y - it.p.w, 1e-3); }
      o.x += sx - p.x;`,
    js(x, y, d, b, out) {
      const left = d[b + 8], right = d[b + 9], laid = d[b + 10], shown = d[b + 11];
      const sx = x <= shown
        ? left + (x - left) * (laid - left) / Math.max(shown - left, 1e-3)
        : laid + (x - shown) * (right - laid) / Math.max(right - shown, 1e-3);
      out.x += sx - x;
    },
  },
});
