import { definePrimitive } from '../core/primitives.js';
import { pcg } from '../core/math.js';
import { U } from '../core/scene.js';

// MELT: a style of cut (stage.transition(update, { style: 'melt' })). The old page melts
// downward and the new page is revealed from the top. The drip front of each column
// depends only on the column and on how far the cut has come (so the input mapper knows
// exactly where the old page still is); the look of the old page below it depends on the
// picture: brighter pixels smear into longer streaks, a pixel sort along the column.

const COLUMN = 3; // px per column of the front
const hash = (v) => pcg(v >>> 0) / 4294967296;

function wave(lx, size, salt) {
  const g = lx / size;
  const i = Math.floor(g);
  const f = g - i;
  const t = f * f * (3 - 2 * f);
  const a = hash(Math.imul(i, 2246822519) + salt);
  const b = hash(Math.imul(i + 1, 2246822519) + salt);
  return a + (b - a) * t;
}

/** How deep the front of the column at lx (px from the left of the scope) is, in px, at progress `progress` (0..1). */
function frontAt(lx, h, progress) {
  const col = Math.floor(lx / COLUMN);
  const n = 0.2 * hash(Math.imul(col, 2654435761) + 40503) + 0.45 * wave(lx, 38, 7) + 0.35 * wave(lx, 190, 91);
  // Each column starts at its own moment and all arrive together: the cut is whole at progress 1.
  const w = Math.min(Math.max((progress - 0.3 * (1 - n)) / (1 - 0.3 * (1 - n)), 0), 1);
  return h * (1 + 0.6 * n) * w * Math.sqrt(w);
}

const WGSL = /* wgsl */ `
fn meltWave(lx: f32, size: f32, salt: u32) -> f32 {
  let g = lx / size;
  let i = floor(g);
  let f = g - i;
  let t = f * f * (3.0 - 2.0 * f);
  let iu = u32(i);
  let a = hash01(iu * 2246822519u + salt);
  let b = hash01((iu + 1u) * 2246822519u + salt);
  return a + (b - a) * t;
}

fn meltNoise(lx: f32) -> f32 {
  let col = u32(floor(lx / 3.0));
  return 0.2 * hash01(col * 2654435761u + 40503u) + 0.45 * meltWave(lx, 38.0, 7u) + 0.35 * meltWave(lx, 190.0, 91u);
}

fn meltCut(p: vec2f, sc: vec4f, s: f32, front: f32, dir: f32, light: ptr<function, vec3f>) -> vec3f {
  // Waiting for the new picture: the old page, untouched.
  if (front <= 0.0) { return sampleGhost(p); }
  let progress = clamp(front / (1.0 + u.wipe.z), 0.0, 1.0);
  let lx = p.x - sc.x;
  let ly = p.y - sc.y;
  let n = meltNoise(lx);
  let late = 0.3 * (1.0 - n);
  let w = clamp((progress - late) / (1.0 - late), 0.0, 1.0);
  let reach = sc.w * (1.0 + 0.6 * n) * w * sqrt(w);
  let d = ly - reach;
  if (d < 0.0) {
    // The new page, with the heat of the front just above it.
    *light += u.holo.rgb * exp(d / 5.0) * 0.4 + u.hot.rgb * exp(d / 22.0) * 0.07;
    return livePicture(p);
  }
  // The old page below the front, pulled downward from it: its own colours, stretched.
  let source = sc.y + d * (1.0 - 0.5 * progress);
  let stretched = sampleGhost(vec2f(p.x, source));
  // Bright pixels run: each leaves a thin trail down its own column (no horizontal filter),
  // fading with distance, never brighter than the pixel it comes from. The longer the
  // column's own drip, the longer the trail; it grows as the melt goes on.
  let run = (10.0 + 90.0 * hash01(u32(floor(p.x)) * 668265263u + 5u)) * clamp(progress * 2.5, 0.0, 1.0);
  var trail = vec3f(0.0);
  for (var k = 1u; k <= 10u; k++) {
    let f = f32(k) / 10.0;
    let fall = (1.0 - f) * (1.0 - f);
    trail = max(trail, sampleGhost(vec2f(p.x, source - run * f)) * fall);
  }
  // The trail runs colder the further it is from its glyph.
  let cold = trail * (vec3f(0.55) + u.holo.rgb * 0.6);
  var c = mix(stretched, max(stretched, cold), 0.65);
  // A thin hot edge at the front, glowing a little; a bead at the tip of the longest columns.
  let bead = smoothstep(0.62, 0.85, n) * exp(-pow((d - 3.0) / 4.0, 2.0));
  *light += u.holo.rgb * exp(-d / 1.7) * 1.1 + vec3f(1.0, 0.95, 0.97) * exp(-d / 0.8) * 0.55
    + u.holo.rgb * exp(-d / 9.0) * 0.12 + (u.holo.rgb * 0.5 + vec3f(0.5)) * bead * 0.5
    + u.hot.rgb * exp(-d / 26.0) * 0.12 * (1.0 - progress);
  return c;
}
`;

export const MELT = definePrimitive({
  kind: 28,
  name: 'melt',
  cut: {
    // The drips need time to run: 1.6 times the blade's time.
    pace: 1.6,
    wgsl: WGSL,
    fn: 'meltCut',
    // null where the old page still shows (below the front of its column), undefined above it.
    js(x, y, sc, s, front, dir, uniforms) {
      if (front <= 0) return null;
      const progress = Math.min(Math.max(front / (1 + uniforms[U.wipeBand]), 0), 1);
      return y - sc[1] >= frontAt(x - sc[0], sc[3], progress) ? null : undefined;
    },
  },
});
