// The compositor: one pass over the whole stage. Spatial items move the picture
// (twins in field.js), light items paint SDF shapes over it, and the transition
// state cuts between the ghost of the old page and the live one.
export const COMPOSITOR_WGSL = /* wgsl */ `
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
// Twin of lensSd() in field.js.
fn lensSd(p: vec2f, it: Item) -> f32 {
  let g = it.q;
  var l = p - (g.xy + g.zw * 0.5);
  l.x += l.y * it.p.w;
  let radius = min(it.p.x, min(g.z * 0.5, g.w * 0.5));
  return sdBox(l, g.zw * 0.5, radius);
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

// Twin of offsetAt() in field.js.
fn offsetAt(p: vec2f) -> vec2f {
  var o = vec2f(0.0);
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    let kind = u32(it.h.x + 0.5);
    if (kind == 0u || kind == 4u || kind == 6u || kind == 8u || kind > 9u) { continue; }
    if (!insideR(p, it.r)) { continue; }
    if (kind == 1u) {
      let e = edgeF(p, it.r, 10.0);
      let d = p - it.p.xy;
      let dist = length(d);
      let nn = dist / it.p.z;
      let squash = it.p.w * (0.045 + 0.11 * exp(-2.0 * nn * nn));
      let front = (dist - it.q.x) / it.q.z;
      let crest = exp(-front * front) * it.q.y;
      var inv = 0.0;
      if (dist > 0.001) { inv = 1.0 / dist; }
      o += (d * squash - d * inv * crest) * e;
    } else if (kind == 2u) {
      let e = edgeF(p, it.r, 4.0);
      o.x += it.p.x * sin(it.p.y + p.y * 0.35) * e;
      o.y += it.p.x * 0.4 * sin(it.p.z + p.x * 0.09) * e;
    } else if (kind == 5u) {
      o += it.p.xy;
    } else if (kind == 9u) {
      let d = p - it.p.xy;
      let w = exp(-dot(d, d) / (it.p.z * it.p.z)) * edgeF(p, it.r, 12.0);
      let a = it.p.w * w;
      let scale = 1.0 + it.q.x * w;
      let c = cos(a);
      let s = sin(a);
      o += vec2f(c * d.x - s * d.y, s * d.x + c * d.y) * scale - d;
    } else if (kind == 7u) {
      let d = lensSd(p, it);
      if (d < 0.0) {
        let e = 0.5;
        var g = vec2f(lensSd(p + vec2f(e, 0.0), it) - lensSd(p - vec2f(e, 0.0), it),
                      lensSd(p + vec2f(0.0, e), it) - lensSd(p - vec2f(0.0, e), it));
        let len = length(g);
        if (len > 1e-4) {
          g = g / len;
          let w = 1.0 - smoothstep(0.0, it.p.z, -d);
          o -= g * it.p.y * w;
        }
      }
    } else {
      let index = u32(floor((p.y - it.r.y) / it.p.y));
      let h = pcg(index * 31u + u32(it.p.z));
      if (f32(h) / 4294967296.0 > 0.55) {
        let h2 = f32(pcg(h + 7u)) / 4294967296.0;
        o.x += (h2 - 0.5) * 2.0 * it.p.x;
      }
    }
  }
  return o;
}

// The part of the displacement that slides content whole (no chromatic split).
fn shiftAt(p: vec2f) -> vec2f {
  var o = vec2f(0.0);
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    if (u32(it.h.x + 0.5) == 5u && insideR(p, it.r)) { o += it.p.xy; }
  }
  return o;
}

// The live picture at p, displaced, with a chromatic split along the deformation.
fn livePicture(p: vec2f) -> vec3f {
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

// A value rolling over: the old picture leaves one way, the new one comes in behind it.
fn rollPicture(p: vec2f) -> vec4f {
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    if (u32(it.h.x + 0.5) != 8u || !insideR(p, it.r)) { continue; }
    let k = it.p.x;
    let h = it.r.w;
    if (it.p.y > 0.0) {
      let split = it.r.y + (1.0 - k) * h;
      if (p.y >= split) { return vec4f(sampleSrc(p - vec2f(0.0, (1.0 - k) * h)), 1.0); }
      return vec4f(sampleGhost(p + vec2f(0.0, k * h)), 1.0);
    }
    let split = it.r.y + k * h;
    if (p.y < split) { return vec4f(sampleSrc(p + vec2f(0.0, (1.0 - k) * h)), 1.0); }
    return vec4f(sampleGhost(p - vec2f(0.0, k * h)), 1.0);
  }
  return vec4f(0.0, 0.0, 0.0, -1.0);
}

// Twin of sdStar5 (Inigo Quilez): a five-pointed star, y up.
fn sdStar5(p0: vec2f, r: f32, rf: f32) -> f32 {
  let k1 = vec2f(0.809016994375, -0.587785252292);
  let k2 = vec2f(-k1.x, k1.y);
  var p = vec2f(abs(p0.x), p0.y);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  let ba = rf * vec2f(-k1.y, k1.x) - vec2f(0.0, 1.0);
  let h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

fn inMorphNow(p: vec2f) -> bool {
  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    if (u32(it.h.x + 0.5) == 4u && insideR(p, it.r)) { return true; }
  }
  return false;
}

// The holographic streak that a flying element leaves behind it (w: its weight).
fn morphTrail(p: vec2f) -> vec4f {
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

@fragment fn fs(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let p = pixel.xy / u.view.xy * u.view.zw;
  var light = vec3f(0.0);
  var base: vec3f;
  if (u.wipe.x > 0.5) {
    base = composeTransition(p, &light);
  } else {
    let g = ghostPicture(p);
    let rl = rollPicture(p);
    if (rl.w >= 0.0) {
      base = rl.rgb;
    } else if (g.w >= 1.0) {
      base = g.rgb;
    } else if (g.w >= 0.0) {
      base = mix(livePicture(p), g.rgb, g.w);
    } else {
      base = livePicture(p);
    }
  }

  let n = u32(u.misc.x);
  for (var i = 0u; i < n; i++) {
    let it = items[i];
    let kind = u32(it.h.x + 0.5);
    if (kind < 10u) { continue; }
    if (kind == 10u) {
      // Lock-on brackets: four corners of a rounded box, a glow, a flash inside.
      let c = it.r.xy + it.r.zw * 0.5;
      let hb = it.r.zw * 0.5;
      let lp = p - c;
      let box = sdBox(lp, hb, 3.0);
      let d = abs(box) - it.p.y * 0.5;
      let a = abs(lp);
      let arm = it.p.x;
      let corner = smoothstep(hb.x - arm - 0.8, hb.x - arm + 0.8, a.x) *
                   smoothstep(hb.y - arm - 0.8, hb.y - arm + 0.8, a.y);
      let line = 1.0 - smoothstep(-0.6, 0.6, d);
      let glow = exp(-max(d, 0.0) / it.p.z) * 0.35;
      let inner = (1.0 - smoothstep(-0.8, 0.8, box)) * (0.035 + 0.22 * it.q.w);
      light += it.q.rgb * it.p.w * ((line + glow) * corner + inner);
    } else if (kind == 11u) {
      let c = it.r.xy + it.r.zw * 0.5;
      let hb = it.r.zw * 0.5;
      var lp = p - c;
      lp.x += lp.y * it.p.y;
      let d = sdBox(lp, hb, min(it.p.x, min(hb.x, hb.y)));
      let fill = (1.0 - smoothstep(-0.7, 0.7, d)) * it.p.w;
      var glow = 0.0;
      if (it.p.z > 0.0) { glow = exp(-max(d, 0.0) / it.p.z) * 0.5 * it.p.w; }
      let mode = u32(it.h.y + 0.5);
      if (mode == 1u) {
        base = mix(base, it.q.rgb, fill * (1.0 - smoothstep(0.35, 0.8, luma(base))));
        light += it.q.rgb * glow * (1.0 - fill);
      } else if (mode == 2u) {
        base = mix(base, it.q.rgb, fill);
        light += it.q.rgb * glow * (1.0 - fill);
      } else {
        light += it.q.rgb * (fill + glow);
      }
    } else if (kind == 12u) {
      let d = abs(length(p - it.r.xy) - it.r.z) / it.r.w;
      light += it.q.rgb * exp(-d * d) * it.p.x;
    } else if (kind == 13u) {
      if (!insideR(p, it.r)) { continue; }
      let x = (p.x - it.r.x) / it.r.z;
      let prog = it.p.x;
      if (it.p.y < 0.5) {
        // Charge: fill behind the label, bright moving edge, hatch on the fill.
        let fill = 1.0 - smoothstep(prog - 0.004, prog + 0.004, x);
        let hatch = 0.82 + 0.18 * step(0.5, fract((p.x + p.y) / 6.0));
        let k = fill * it.p.z * (1.0 - smoothstep(0.35, 0.8, luma(base)));
        base = mix(base, it.q.rgb * hatch, k);
        let edgeLine = exp(-pow((x - prog) * it.r.z / 1.5, 2.0)) * step(0.002, prog);
        light += vec3f(1.0, 0.92, 0.95) * edgeLine * it.p.z;
      } else {
        // Scan: a vertical line crossing the field with a fading trail.
        let dx = (prog - x) * it.r.z;
        var trail = 0.0;
        if (dx >= 0.0) { trail = exp(-dx / 26.0) * 0.18; }
        let lineV = exp(-pow(dx / 1.2, 2.0));
        light += it.q.rgb * (lineV + trail) * it.p.z;
      }
    } else if (kind == 14u) {
      let lp = abs(p - it.r.xy);
      let d = (lp.x + lp.y) * 0.7071 - it.r.z * 0.7071;
      let line = 1.0 - smoothstep(-0.7, 0.7, abs(d) - 0.9);
      let core = (1.0 - smoothstep(-0.7, 0.7, d + 3.0)) * it.p.z;
      let glow = exp(-max(d, 0.0) / it.p.x) * 0.6;
      base = mix(base, it.q.rgb * 0.18 + u.bg.rgb * 0.5, (1.0 - smoothstep(-0.7, 0.7, d)) * it.p.y);
      light += it.q.rgb * (line + core + glow) * it.p.y;
    } else if (kind == 15u) {
      // Liquid fill: the leading edge sloshes with the thumb's speed.
      if (p.y < it.r.y || p.y > it.r.y + it.r.w || p.x < it.r.x) { continue; }
      let yy = p.y - it.r.y;
      let edgeX = it.r.x + it.p.x + it.p.y * (sin(yy * 0.9 + it.p.z) * 0.7 + sin(yy * 0.37 - it.p.z * 1.7) * 0.3);
      let d = p.x - edgeX;
      let fill = 1.0 - smoothstep(-0.6, 0.6, d);
      let toward = clamp((p.x - it.r.x) / max(it.p.x, 1.0), 0.0, 1.0);
      let shade = 0.45 + 0.55 * toward * toward;
      base = mix(base, it.q.rgb * shade, fill * it.p.w * (1.0 - smoothstep(0.4, 0.85, luma(base))));
      light += it.q.rgb * exp(-pow(d / 1.4, 2.0)) * it.p.w * 0.9;
    } else if (kind == 17u) {
      // A star: filled by p.z, outlined, glowing.
      let lp = p - it.r.xy;
      let d = sdStar5(vec2f(lp.x, -lp.y), it.r.z, it.r.w);
      let fill = (1.0 - smoothstep(-0.7, 0.7, d)) * it.p.z;
      let line = 1.0 - smoothstep(-0.6, 0.6, abs(d) - 0.7);
      let glow = exp(-max(d, 0.0) / max(it.p.x, 0.01)) * 0.5 * it.p.z;
      base = mix(base, it.q.rgb, fill * it.p.y);
      light += it.q.rgb * (line * 0.5 + glow) * it.p.y;
    } else if (kind == 18u) {
      // Live content assembling block by block (p.x: 1 = not there yet).
      if (!insideR(p, it.r)) { continue; }
      let c = crumbleFrom(p, it.p.x, vec2f(0.0, 22.0), true);
      base = mix(u.bg.rgb, c.rgb, c.w);
    } else if (kind == 19u) {
      // A ring gauge: an arc from twelve o'clock, clockwise, with the same trail as a bar.
      let d = p - it.r.xy;
      let ring = abs(length(d) - it.r.z) - it.r.w * 0.5;
      let inRing = 1.0 - smoothstep(-0.6, 0.6, ring);
      var ang = atan2(d.x, -d.y) / 6.28318530718;
      if (ang < 0.0) { ang += 1.0; }
      let px = 0.8 / (6.28318530718 * it.r.z);
      var chip = 1.0;
      if (it.q.w > 0.5) {
        let c = fract(ang * it.q.w);
        chip = smoothstep(0.0, 0.08, c) * (1.0 - smoothstep(0.92, 1.0, c));
      }
      var fillM = 0.0;
      var trailM = 0.0;
      var head = it.p.x;
      if (it.h.y < 0.5) {
        fillM = 1.0 - smoothstep(it.p.x - px, it.p.x + px, ang);
        trailM = max(1.0 - smoothstep(it.p.y - px, it.p.y + px, ang) - fillM, 0.0);
      } else {
        // Indeterminate: a quarter turn chasing round.
        let a = fract(ang - it.p.z);
        fillM = 1.0 - smoothstep(0.28 - px, 0.28 + px, a);
        head = fract(it.p.z + 0.28);
      }
      let a = it.p.w;
      let shade = 0.55 + 0.45 * clamp(ang / max(head, 0.05), 0.0, 1.0);
      base = mix(base, it.q.rgb * shade, fillM * chip * inRing * a);
      var trailC = vec3f(1.0, 0.95, 0.96);
      var trailA = 0.92;
      if (it.h.z > 0.5) { trailC = it.q.rgb * 0.5; trailA = 0.6; }
      base = mix(base, trailC, trailM * chip * inRing * a * trailA);
      // The head of the arc glows.
      let hp = it.r.xy + vec2f(sin(head * 6.28318530718), -cos(head * 6.28318530718)) * it.r.z;
      let hd = length(p - hp);
      light += it.q.rgb * exp(-hd * hd / (it.r.w * it.r.w * 0.8)) * a * step(0.003, head) * 0.9;
    } else if (kind == 16u) {
      // Gauge: leaning chips, a fill that brightens toward its edge, and a trail
      // between where the value was and where it is (white when it drops).
      if (!insideR(p, it.r)) { continue; }
      let lp = p - it.r.xy;
      // Leaning edges; 0 and 1 are fully empty and fully full.
      let lean = it.r.w * 0.3;
      let sx = lp.x - (lp.y - it.r.w * 0.5) * 0.6;
      let x = (sx + lean) / (it.r.z + 2.0 * lean);
      let px = 0.7 / it.r.z;
      var chip = 1.0;
      if (it.q.w > 0.5) {
        let cw = it.r.z / it.q.w;
        let c = fract(sx / cw) * cw;
        chip = smoothstep(1.4, 2.4, c);
      }
      var fillM = 0.0;
      var trailM = 0.0;
      var edgeX = it.p.x;
      if (it.h.y < 0.5) {
        fillM = 1.0 - smoothstep(it.p.x - px, it.p.x + px, x);
        trailM = max(1.0 - smoothstep(it.p.y - px, it.p.y + px, x) - fillM, 0.0);
      } else {
        let c = -0.3 + it.p.z * 1.6;
        fillM = 1.0 - smoothstep(0.16 - px, 0.16 + px, abs(x - c));
        edgeX = c + 0.16;
      }
      let shade = 0.5 + 0.5 * clamp(x / max(edgeX, 0.05), 0.0, 1.0);
      let hatch = 0.86 + 0.14 * step(0.5, fract((p.x + p.y) / 5.0));
      let a = it.p.w;
      base = mix(base, it.q.rgb * shade * hatch, fillM * chip * a);
      var trailC = vec3f(1.0, 0.95, 0.96);
      var trailA = 0.92;
      if (it.h.z > 0.5) { trailC = it.q.rgb * 0.5; trailA = 0.6; }
      base = mix(base, trailC, trailM * chip * a * trailA);
      let edgeLine = exp(-pow((x - edgeX) * it.r.z / 1.4, 2.0)) * step(0.003, edgeX);
      light += it.q.rgb * edgeLine * a * 0.8;
      light += vec3f(0.12) * fillM * chip * (1.0 - smoothstep(0.0, 2.0, lp.y));
    }
  }

  // Light is projected: faint scan lines run through it.
  let scan = 1.0 - u.style.x + u.style.x * step(0.5, fract(p.y / 3.0));
  var color = base + light * scan;

  if (u.boot.x > 0.5) {
    let dy = p.y - u.boot.y;
    if (dy > 0.0) { color = u.bg.rgb; }
    color += u.holo.rgb * exp(-pow(dy / 1.3, 2.0)) * 0.9;
    color += u.holo.rgb * exp(-abs(min(dy, 0.0)) / 40.0) * 0.12 * scan;
  }
  return vec4f(min(color, vec3f(1.0)), 1.0);
}`;

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
