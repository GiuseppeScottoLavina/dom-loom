// The compositor's shader, built from the registered primitives (core/primitives.js).
// The fixed part draws transitions, ghosts and the boot sweep; each primitive adds its
// helpers and its branch. A pass runs only when this frame's scene holds a kind that
// needs it (the `present` mask), so a page at rest with a reticle pays for the reticle.

const HEAD = /* wgsl */ `
struct Uniforms {
  view: vec4f,  // backing w, h, css w, h
  misc: vec4f,  // count, time (s), dpr, _
  wipe: vec4f,  // active, front, band, slant
  bg: vec4f,    // rgb
  ghost: vec4f, // css w, h, ready
  hot: vec4f,   // rgb
  boot: vec4f,  // active, line y (css px)
  holo: vec4f,  // rgb
  voidc: vec4f, // rgb
  scope: vec4f, // x, y, w, h of a scoped transition (w = 0: the whole stage)
  wipe2: vec4f, // direction, the cut's style (a primitive kind; 0: the blade)
  style: vec4f, // the skin's look: scan lines, chroma, crumble, hatch
  present: vec4f, // the kinds in the scene, as a bit mask, 16 bits a slot: kinds 0..15 in x, .. 48..63 in w
  alpha: vec4f,   // 1: a transparent canvas; the output is premultiplied
  field: vec4f,   // displacement field: cols, rows, active
  source: vec4f,  // css w, h of the live picture
}
struct Item { h: vec4f, r: vec4f, p: vec4f, q: vec4f }

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> items: array<Item>;
@group(0) @binding(4) var ghostTex: texture_2d<f32>;
@group(0) @binding(5) var<storage, read> fieldBuf: array<vec2f>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[i], 0.0, 1.0);
}

// A float holds integers exactly only up to 2^24: the mask comes 16 bits a slot. lo: kinds
// 0..31, hi: kinds 32..63.
fn present(lo: u32, hi: u32) -> bool {
  let a = u32(u.present.x) | (u32(u.present.y) << 16u);
  let b = u32(u.present.z) | (u32(u.present.w) << 16u);
  return ((a & lo) | (b & hi)) != 0u;
}

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn hash01(v: u32) -> f32 { return f32(pcg(v)) / 4294967296.0; }

fn edgeF(p: vec2f, r: vec4f, soft: f32) -> f32 {
  let d = min(min(p.x - r.x, r.x + r.z - p.x), min(p.y - r.y, r.y + r.w - p.y));
  return clamp(d / soft, 0.0, 1.0);
}
fn insideR(p: vec2f, r: vec4f) -> bool {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.z && p.y < r.y + r.w;
}
fn sdBox(p: vec2f, b: vec2f, radius: f32) -> f32 {
  let q = abs(p) - b + vec2f(radius);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
// Paint on the picture with coverage a: INK (3) multiplies, so black stays black and paper
// takes the colour; INVERT (4) reverses the picture, ink to paper and paper to ink; any
// other mode lays the colour over.
fn paint(base: vec3f, rgb: vec3f, a: f32, mode: u32) -> vec3f {
  if (mode == 3u) { return base * mix(vec3f(1.0), rgb, a); }
  if (mode == 4u) { return mix(base, vec3f(1.0) - base, a); }
  return mix(base, rgb, a);
}

// The displacement field at the canvas css point p: a bilinear sample of the grid
// (cell centres spread over the canvas), clamped at its edges. Twin: fieldAt in core/math.js.
fn fieldAt(p: vec2f) -> vec2f {
  if (u.field.z < 0.5) { return vec2f(0.0); }
  let cols = u32(u.field.x + 0.5);
  let rows = u32(u.field.y + 0.5);
  let g = clamp(p / u.view.zw * u.field.xy - vec2f(0.5), vec2f(0.0), u.field.xy - vec2f(1.0));
  let c0 = vec2u(floor(g));
  let c1 = min(c0 + vec2u(1u), vec2u(cols - 1u, rows - 1u));
  let f = g - floor(g);
  let a = fieldBuf[c0.y * cols + c0.x];
  let b = fieldBuf[c0.y * cols + c1.x];
  let c = fieldBuf[c1.y * cols + c0.x];
  let d = fieldBuf[c1.y * cols + c1.x];
  let top = a + (b - a) * f.x;
  let bottom = c + (d - c) * f.x;
  return top + (bottom - top) * f.y;
}

// The pictures are premultiplied. On an opaque canvas what the page leaves transparent shows
// the stage's background (a page whose own CSS paints no panel); a transparent canvas keeps it.
fn overBg(c: vec4f) -> vec3f {
  if (u.alpha.x > 0.5) { return c.rgb; }
  return c.rgb + u.bg.rgb * (1.0 - c.a);
}
// The live picture keeps its own size: just after the stage changes height it can be
// the older picture for a few frames, shown at its scale and empty past its edge.
fn sampleSrc(p: vec2f) -> vec3f {
  if (p.x > u.source.x + 0.5 || p.y > u.source.y + 0.5) { return overBg(vec4f(0.0)); }
  return overBg(textureSampleLevel(src, samp, p / u.source.xy, 0.0));
}
fn sampleGhost(p: vec2f) -> vec3f {
  if (u.ghost.z < 0.5) { return u.bg.rgb; }
  if (p.x > u.ghost.x + 0.5 || p.y > u.ghost.y + 0.5) { return u.bg.rgb; }
  return overBg(textureSampleLevel(ghostTex, samp, p / u.ghost.xy, 0.0));
}
`;

const CORE = /* wgsl */ `
// The live picture at p, displaced, with a chromatic split along the deformation.
fn livePicture(p: vec2f) -> vec3f {
  if (!present(SPATIAL, SPATIAL_HI)) { return sampleSrc(p); }
  let o = offsetAt(p);
  let raw = p + o;
  // Content moved in from beyond the edges is empty space (twin of mapThrough).
  if (raw.x < -0.5 || raw.y < -0.5 || raw.x > u.view.z + 0.5 || raw.y > u.view.w + 0.5) { return u.voidc.rgb; }
  let sp = clamp(raw, vec2f(0.0), u.view.zw);
  let warp = o - shiftAt(p);
  let mag = length(warp);
  if (mag < 0.05) { return sampleSrc(sp); }
  let dir = warp / mag;
  let k = min(mag * 0.16, 3.0) * u.style.y;
  let g = sampleSrc(sp);
  let r = sampleSrc(clamp(sp + dir * k, vec2f(0.0), u.view.zw)).r;
  let b = sampleSrc(clamp(sp - dir * k, vec2f(0.0), u.view.zw)).b;
  return vec3f(r, g.g, b);
}

// How opaque the live picture is at p (a transparent canvas only).
fn liveAlpha(p: vec2f) -> f32 {
  var q = p;
  if (present(SPATIAL, SPATIAL_HI)) { q = p + offsetAt(p); }
  if (q.x < -0.5 || q.y < -0.5 || q.x > u.source.x + 0.5 || q.y > u.source.y + 0.5) { return 0.0; }
  return textureSampleLevel(src, samp, clamp(q, vec2f(0.0), u.source.xy) / u.source.xy, 0.0).a;
}

// The old picture breaking into 4 px blocks: t = 0 whole, 1 gone. Each block leaves
// at its own moment and drifts along drift (px at the end). w: what is left.
fn crumble(p: vec2f, t: f32, drift: vec2f) -> vec4f {
  return crumbleFrom(p, t, drift, false);
}

fn crumbleFrom(p: vec2f, t: f32, drift: vec2f, live: bool) -> vec4f {
  let cell = vec2u(vec2i(floor(p / 4.0) + vec2f(4096.0)));
  let h = hash01((cell.x * 73856093u) ^ (cell.y * 19349663u));
  let h2 = hash01(cell.x * 2654435761u + cell.y * 83492791u);
  let tt = clamp(t * 1.5 - h * 0.5, 0.0, 1.0);
  if (tt >= 1.0) { return vec4f(0.0); }
  let q = p - drift * tt * tt * (0.4 + h2);
  var c: vec3f;
  if (live) { c = sampleSrc(clamp(q, vec2f(0.0), u.view.zw)); } else { c = sampleGhost(q); }
  return vec4f(mix(c, u.holo.rgb, tt * 0.55), 1.0 - tt * tt);
}

// The picture from before a change where a GHOST item covers p: rgb and how much
// of it is left (w), or w = -1 where no item covers p. A ghost crumbles near its
// bottom edge (h.y: zone in px) and as a whole (h.z: 0..1). What shows through the
// gaps is the panel (h.w = 0) or the live page (h.w = 1: the caller blends).
fn ghostPicture(p: vec2f) -> vec4f {
  if (!present(1u << 6u, 0u)) { return vec4f(0.0, 0.0, 0.0, -1.0); }
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    if (u32(it.h.x + 0.5) != 6u || !insideR(p, it.r)) { continue; }
    let dist = it.r.y + it.r.w - p.y;
    var t = it.h.z;
    if (it.h.y > 0.0 && dist < it.h.y) { t = max(t, 1.0 - dist / it.h.y); }
    var c = vec4f(sampleGhost(p), 1.0);
    if (t > 0.0) {
      c = crumble(p, t, select(vec2f(0.0, -26.0), vec2f(36.0, -18.0), it.h.w > 0.5));
    }
    if (it.h.w > 0.5) { return c; }
    return vec4f(mix(u.bg.rgb, c.rgb, c.w), 1.0);
  }
  return vec4f(0.0, 0.0, 0.0, -1.0);
}

fn inMorphNow(p: vec2f) -> bool {
  if (!present(1u << 4u, 0u)) { return false; }
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    if (u32(it.h.x + 0.5) == 4u && insideR(p, it.r)) { return true; }
  }
  return false;
}

// The holographic streak that a flying element leaves behind it (w: its weight).
fn morphTrail(p: vec2f) -> vec4f {
  if (!present(1u << 4u, 0u)) { return vec4f(0.0); }
  var acc = vec3f(0.0);
  var weight = 0.0;
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    if (u32(it.h.x + 0.5) != 4u) { continue; }
    let v = it.h.zw;
    if (length(v) < 3.0) { continue; }
    // All samples p + v*f lie on the segment f ∈ [0, 1]. Keep one CSS pixel
    // of slack at the edges for floating-point rounding.
    let lo = it.r.xy - max(v, vec2f(0.0)) - 1.0;
    let hi = it.r.xy + it.r.zw - min(v, vec2f(0.0)) + 1.0;
    if (any(p < lo) || any(p > hi)) { continue; }
    // Dithered samples along the motion: a smooth smear, not a stack of copies.
    let jitter = hash01(u32(p.x) * 1973u + u32(p.y) * 9277u);
    for (var k = 0u; k < 12u; k++) {
      let f = (f32(k) + jitter) / 12.0;
      let q = p + v * f;
      if (!insideR(q, it.r)) { continue; }
      let uv = (q - it.r.xy) / it.r.zw;
      let c = mix(sampleGhost(it.p.xy + uv * it.p.zw), sampleSrc(it.q.xy + uv * it.q.zw), it.h.y);
      let w = 1.0 - f * 0.85;
      acc += c * w;
      weight += w;
    }
  }
  if (weight <= 0.0) { return vec4f(0.0); }
  return vec4f(acc / weight, clamp(weight / 4.5, 0.0, 0.75));
}

fn inMorphDest(p: vec2f, ghostSide: bool) -> bool {
  if (!present(1u << 4u, 0u)) { return false; }
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    if (u32(it.h.x + 0.5) != 4u) { continue; }
    if (it.h.y >= 0.999) { continue; }
    if (ghostSide && insideR(p, it.p)) { return true; }
    if (!ghostSide && insideR(p, it.q)) { return true; }
  }
  return false;
}

fn composeTransition(p: vec2f, light: ptr<function, vec3f>) -> vec3f {
  var c = composeCut(p, light);
  // Elements that left: their old picture crumbles over the page (under the flights).
  if (!inMorphNow(p)) {
    let g = ghostPicture(p);
    if (g.w >= 0.0) { c = mix(c, g.rgb, g.w); }
  }
  let trail = morphTrail(p);
  if (trail.w > 0.0) {
    c = mix(c, trail.rgb * 0.8 + u.holo.rgb * 0.18, trail.w);
  }
/*TRANSITION*/
  return c;
}

fn composeCut(p: vec2f, light: ptr<function, vec3f>) -> vec3f {
  if (present(1u << 4u, 0u)) {
    let n = u32(u.misc.x);
    for (var i = 0u; i < n; i++) {
      let it = items[i];
      if (u32(it.h.x + 0.5) != 4u) { continue; }
      if (!insideR(p, it.r)) { continue; }
      let uv = (p - it.r.xy) / it.r.zw;
      let live = sampleSrc(it.q.xy + uv * it.q.zw);
      let ghost = sampleGhost(it.p.xy + uv * it.p.zw);
      // Reassemble in interlaced rows, left to right, each row a little early or late.
      let row = u32(floor(p.y / 2.0));
      let noise = hash01(row * 7919u + i * 13u) * 0.5 + uv.x * 0.5;
      let m = it.h.y * 1.3 - 0.15;
      let k = smoothstep(noise - 0.03, noise + 0.03, m);
      let rim = exp(-pow((m - noise) / 0.025, 2.0)) * step(0.001, it.h.y) * step(it.h.y, 0.999);
      *light += u.holo.rgb * rim * 0.8;
      return mix(ghost, live, k);
    }
  }
  // The cut runs over the scope: the whole stage, or one region of it (twin of mapThrough).
  var sc = vec4f(0.0, 0.0, u.view.z, u.view.w);
  if (u.scope.z > 0.0) { sc = u.scope; }
  if (!insideR(p, sc)) { return livePicture(p); }
  let w = sc.z;
  let h = sc.w;
  let slant = u.wipe.w;
  let dir = select(1.0, -1.0, u.wipe2.x < 0.0);
  var lx = p.x - sc.x;
  if (dir < 0.0) { lx = w - lx; }
  let s = (lx + (p.y - sc.y) * slant) / (w + h * slant);
  let front = u.wipe.y;
  let band = u.wipe.z;
/*CUTS*/
  if (s > front) {
    // The old page, pushed along the cut as the blade arrives.
    let push = clamp(1.0 - (s - front) / 0.25, 0.0, 1.0) * step(1e-4, front);
    let gp = p + vec2f(push * push * 18.0 * dir, 0.0);
    if (inMorphDest(gp, true)) { return u.bg.rgb; }
    // Just ahead of the blade the old page breaks up and is blown away.
    let ahead = (s - front) / 0.13;
    // (Not while the cut waits for the new picture: the blade has not left yet.)
    if (ahead < 1.0 && u.style.z > 0.5 && front > 0.0) {
      let c = crumble(gp, 1.0 - ahead, vec2f(80.0 * dir, -30.0));
      return mix(u.bg.rgb, c.rgb, c.w) * (1.0 - push * 0.35);
    }
    return sampleGhost(gp) * (1.0 - push * 0.35);
  }
  var live = u.bg.rgb;
  if (!inMorphDest(p, false)) { live = livePicture(p); }
  let behind = (front - s) / band;
  if (behind < 1.0) {
    // The blade: a hot band with a bright leading edge and a hatch, then the
    // revealed page with a chromatic tear that heals.
    let hatch = step(0.5, fract((p.x - p.y * dir) / 7.0));
    let blade = mix(u.hot.rgb, u.hot.rgb * 0.72, hatch * 0.5 * u.style.w);
    let lead = exp(-pow((front - s) * (w + h * slant) / 1.6, 2.0));
    let solid = 1.0 - smoothstep(0.55, 0.62, behind);
    *light += vec3f(1.0, 0.95, 0.97) * lead * 0.9;
    return mix(live, blade, solid);
  }
  return live;
}
`;

const TAIL = /* wgsl */ `
  // Light is projected: faint scan lines run through it.
  let scan = 1.0 - u.style.x + u.style.x * step(0.5, fract(p.y / 3.0));
  var color = base + light * scan;
  // On a transparent canvas the picture's own alpha holds, and light makes its own.
  let transparent = u.alpha.x > 0.5;
  var alpha = 1.0;
  if (transparent) {
    alpha = max(liveAlpha(p), clamp(max(max(light.r, light.g), light.b) * scan, 0.0, 1.0));
  }

  if (u.boot.x > 0.5) {
    let dy = p.y - u.boot.y;
    if (dy > 0.0) { color = u.bg.rgb; }
    color += u.holo.rgb * exp(-pow(dy / 1.3, 2.0)) * 0.9;
    color += u.holo.rgb * exp(-abs(min(dy, 0.0)) / 40.0) * 0.12 * scan;
  }
/*POST*/
  if (transparent) {
    let a = clamp(alpha, 0.0, 1.0);
    return vec4f(min(color, vec3f(a)), a);
  }
  return vec4f(min(color, vec3f(1.0)), 1.0);
}`;

// The kinds of these primitives as two 32-bit words: kinds 0..31, then 32..63.
const words = (defs) => {
  let lo = 0;
  let hi = 0;
  for (const d of defs) {
    if (d.kind < 32) lo |= 1 << d.kind;
    else hi |= 1 << (d.kind - 32);
  }
  return [lo >>> 0, hi >>> 0];
};
// The same, as the arguments of present(lo, hi) in WGSL.
const maskOf = (defs) => words(defs).map((w) => `${w}u`).join(', ');

const chain = (defs, body) =>
  defs.map((d, i) => `${i ? ' else ' : '    '}if (kind == ${d.kind}u) {${body(d)}\n    }`).join('');

/** The WGSL of the compositor for these primitives. */
export function buildShader(defs) {
  const offsets = defs.filter((d) => d.offset);
  const whole = offsets.filter((d) => d.offset.whole);
  const views = defs.filter((d) => d.view);
  const pictures = defs.filter((d) => d.picture).sort((a, b) => a.picture.order - b.picture.order);
  // Pictures that are also drawn over a transition, with their opacity (w).
  const overCut = pictures.filter((d) => d.picture.transition);
  const lights = defs.filter((d) => d.light);
  const posts = defs.filter((d) => d.post);
  const [spatial, spatialHi] = words(offsets);
  const cuts = defs.filter((d) => d.cut);

  const offsetAt = /* wgsl */ `
// The sum of what the primitives that move the picture do at p (twins in their JS).
fn offsetAt(p: vec2f) -> vec2f {
  var o = vec2f(0.0);
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    let kind = u32(it.h.x + 0.5);
    if (!insideR(p, it.r)) { continue; }
${chain(offsets, (d) => d.offset.wgsl)}
  }
  return o;
}

// The part of it that moves content whole, without tearing it (no chromatic split).
fn shiftAt(p: vec2f) -> vec2f {
  var o = vec2f(0.0);
  if (!present(${maskOf(whole)})) { return o; }
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    let kind = u32(it.h.x + 0.5);
    if (!insideR(p, it.r)) { continue; }
${chain(whole, (d) => d.offset.wgsl)}
  }
  return o;
}
`;

  const pictureCalls = pictures.filter((d) => !d.picture.transition).map((d) => /* wgsl */ `
    if (!done && present(${maskOf([d])})) {
      let r = ${d.picture.name}(p, &light);
      if (r.w >= 0.0) {
        base = r.rgb;
        done = true;
      }
    }`).join('');

  const fs = /* wgsl */ `
@fragment fn fs(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  ${views.length ? 'var' : 'let'} p = pixel.xy / u.view.xy * u.view.zw;${views.length ? /* wgsl */ `
  // A view (an overlay's zoom) moves the whole frame: the picture, its lights and its posts.
  if (present(${maskOf(views)})) {
    let n = u32(u.misc.x);
    for (var i = 0u; i < n; i++) {
      let it = items[i];
      let kind = u32(it.h.x + 0.5);
${chain(views, (d) => d.view.wgsl)}
    }
  }` : ''}
  var light = vec3f(0.0);
  var base = vec3f(0.0);
  if (u.wipe.x > 0.5) {
    base = composeTransition(p, &light);
  } else {
    var done = false;${pictureCalls}
    if (!done) {
      let g = ghostPicture(p);
      if (g.w >= 1.0) {
        base = g.rgb;
      } else if (g.w >= 0.0) {
        base = mix(livePicture(p), g.rgb, g.w);
      } else {
        base = livePicture(p);
      }
    }
  }

  if (present(${maskOf(lights)})) {
    let n = u32(u.misc.x);
    for (var i = 0u; i < n; i++) {
      let it = items[i];
      let kind = u32(it.h.x + 0.5);
${chain(lights, (d) => d.light.wgsl)}
    }
  }
`;

  // The styles of the cut, in place of the blade; a style that is not registered falls through to it.
  const cutChain = cuts.length ? /* wgsl */ `
  let style = u32(u.wipe2.y + 0.5);
  if (style != 0u) {
${cuts.map((d) => `    if (style == ${d.kind}u) { return ${d.cut.fn}(p, sc, s, front, dir, light); }`).join('\n')}
  }` : '';
  const functions = defs.map((d) => [d.functions, d.cut?.wgsl]).flat().filter(Boolean).join('\n');
  const pictureFns = pictures.map((d) => d.picture.wgsl).join('\n');
  return [
    HEAD,
    `const SPATIAL: u32 = ${spatial}u;\nconst SPATIAL_HI: u32 = ${spatialHi}u;`,
    functions,
    offsetAt,
    CORE.replace('/*CUTS*/', cutChain).replace('/*TRANSITION*/', overCut.map((d) => /* wgsl */ `
  if (present(${maskOf([d])})) {
    let over = ${d.picture.name}(p, light);
    if (over.w >= 0.0) { c = mix(c, over.rgb, over.w); }
  }`).join('')),
    pictureFns,
    fs + TAIL.replace('/*POST*/', posts.length ? /* wgsl */ `
  if (present(${maskOf(posts)})) {
    let n = u32(u.misc.x);
    for (var i = 0u; i < n; i++) {
      let it = items[i];
      let kind = u32(it.h.x + 0.5);
${chain(posts, (d) => d.post.wgsl)}
    }
  }` : ''),
  ].join('\n');
}

// Copies the source picture into the ghost texture before a transition changes the DOM.
export const BLIT_WGSL = /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(src));
  return textureSampleLevel(src, samp, pixel.xy / dims, 0.0);
}`;
