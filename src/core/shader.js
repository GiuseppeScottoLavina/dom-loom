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
  wipe2: vec4f, // direction
  style: vec4f, // the skin's look: scan lines, chroma, crumble, hatch
  present: vec4f, // the kinds in the scene, as a bit mask
  alpha: vec4f,   // 1: a transparent canvas; the output is premultiplied
}
struct Item { h: vec4f, r: vec4f, p: vec4f, q: vec4f }

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> items: array<Item>;
@group(0) @binding(4) var ghostTex: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[i], 0.0, 1.0);
}

fn present(mask: u32) -> bool { return (u32(u.present.x) & mask) != 0u; }

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

fn sampleSrc(p: vec2f) -> vec3f {
  return textureSampleLevel(src, samp, p / u.view.zw, 0.0).rgb;
}
fn sampleGhost(p: vec2f) -> vec3f {
  if (u.ghost.z < 0.5) { return u.bg.rgb; }
  if (p.x > u.ghost.x + 0.5 || p.y > u.ghost.y + 0.5) { return u.bg.rgb; }
  return textureSampleLevel(ghostTex, samp, p / u.ghost.xy, 0.0).rgb;
}
`;

const CORE = /* wgsl */ `
// The live picture at p, displaced, with a chromatic split along the deformation.
fn livePicture(p: vec2f) -> vec3f {
  if (!present(SPATIAL)) { return sampleSrc(p); }
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
  if (present(SPATIAL)) { q = p + offsetAt(p); }
  if (q.x < -0.5 || q.y < -0.5 || q.x > u.view.z + 0.5 || q.y > u.view.w + 0.5) { return 0.0; }
  return textureSampleLevel(src, samp, clamp(q, vec2f(0.0), u.view.zw) / u.view.zw, 0.0).a;
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
  if (!present(1u << 6u)) { return vec4f(0.0, 0.0, 0.0, -1.0); }
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
  if (!present(1u << 4u)) { return false; }
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    if (u32(it.h.x + 0.5) == 4u && insideR(p, it.r)) { return true; }
  }
  return false;
}

// The holographic streak that a flying element leaves behind it (w: its weight).
fn morphTrail(p: vec2f) -> vec4f {
  if (!present(1u << 4u)) { return vec4f(0.0); }
  var acc = vec3f(0.0);
  var weight = 0.0;
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    if (u32(it.h.x + 0.5) != 4u) { continue; }
    let v = it.h.zw;
    if (length(v) < 3.0) { continue; }
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
  if (!present(1u << 4u)) { return false; }
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
  return c;
}

fn composeCut(p: vec2f, light: ptr<function, vec3f>) -> vec3f {
  if (present(1u << 4u)) {
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

const maskOf = (defs) => defs.reduce((m, d) => m | (1 << d.kind), 0) >>> 0;

const chain = (defs, body) =>
  defs.map((d, i) => `${i ? ' else ' : '    '}if (kind == ${d.kind}u) {${body(d)}\n    }`).join('');

/** The WGSL of the compositor for these primitives. */
export function buildShader(defs) {
  const offsets = defs.filter((d) => d.offset);
  const whole = offsets.filter((d) => d.offset.whole);
  const pictures = defs.filter((d) => d.picture).sort((a, b) => a.picture.order - b.picture.order);
  const lights = defs.filter((d) => d.light);
  const posts = defs.filter((d) => d.post);
  const spatial = maskOf(offsets);

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
  if (!present(${maskOf(whole)}u)) { return o; }
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

  const pictureCalls = pictures.map((d) => /* wgsl */ `
    if (!done && present(${(1 << d.kind) >>> 0}u)) {
      let r = ${d.picture.name}(p, &light);
      if (r.w >= 0.0) {
        base = r.rgb;
        done = true;
      }
    }`).join('');

  const fs = /* wgsl */ `
@fragment fn fs(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let p = pixel.xy / u.view.xy * u.view.zw;
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

  if (present(${maskOf(lights)}u)) {
    let n = u32(u.misc.x);
    for (var i = 0u; i < n; i++) {
      let it = items[i];
      let kind = u32(it.h.x + 0.5);
${chain(lights, (d) => d.light.wgsl)}
    }
  }
`;

  const functions = defs.map((d) => d.functions).filter(Boolean).join('\n');
  const pictureFns = pictures.map((d) => d.picture.wgsl).join('\n');
  return [
    HEAD,
    `const SPATIAL: u32 = ${spatial}u;`,
    functions,
    offsetAt,
    CORE,
    pictureFns,
    fs + TAIL.replace('/*POST*/', posts.length ? /* wgsl */ `
  if (present(${maskOf(posts)}u)) {
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
