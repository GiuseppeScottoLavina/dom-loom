// The scene that the compositor draws, as plain numbers, and the JavaScript twin of
// every function of the shader that MOVES pixels.
//
// The fragment shader maps backwards: for each presented pixel it asks which source
// point to show. The input mapper of the effects host asks the same question for a
// pointer, so it is the same function, evaluated in JavaScript. Every line below has
// a twin in shader.js; test/field.test.mjs and the browser test keep them together.

export const ITEM_FLOATS = 16; // header, rect, p, q: 4 x vec4f
export const MAX_ITEMS = 128;
export const UNIFORM_FLOATS = 48; // 12 x vec4f

// Spatial kinds: they displace the picture, so the mapper follows them.
export const DENT = 1; // r: clip rect; p: cx, cy, radius, depth; q: ringRadius, ringAmp, ringWidth
export const JITTER = 2; // r: rect; p: amp, phaseA, phaseB
export const GLITCH = 3; // r: rect; p: strength, sliceHeight, seed
export const MORPH = 4; // h.y: dissolve; h.zw: velocity (px, the streak's length); r: current rect; p: ghost rect; q: live rect
export const SHIFT = 5; // r: rect; p: dx, dy (the content shown there comes from (x + dx, y + dy))
export const GHOST = 6; // h.y: crumble zone (px above the bottom edge); h.z: crumble progress; h.w: 1 = the live page shows through. r: rect of the picture from before a change; no input target
export const ROLL = 8; // r: rect; p: progress (0..1), direction (1: up, -1: down). Old picture rolls out, new rolls in; maps as itself
export const VORTEX = 9; // r: clip rect; p: cx, cy, radius, angle; q: pinch. Twists the picture around a point
export const TILT = 20; // h.y: margin; r: card rect; p: rotX, rotY, eye distance, lift; q: foil, glare, glare x, glare y. The card turns in perspective
export const BEND = 21; // r: rect; p: curve (radians), lag (px). A strip curves like film
export const STRETCH = 22; // r: rect; p: left, right, divider in the layout, divider shown. Content stretches between them
export const LENS = 7; // r: clip rect; p: radius, strength, band, skew; q: glass rect. Refracts what is under the glass edge

// Light kinds: they add light or paint over the picture and move nothing.
export const BRACKETS = 10; // r: rect; p: arm, thickness, glow, alpha; q: rgb, flash
export const PILL = 11; // h.y: blend; r: rect; p: radius, skew, glow, alpha; q: rgb
export const RING = 12; // r: cx, cy, radius, width; p: alpha; q: rgb
export const SWEEP = 13; // h.y: blend; r: rect; p: progress, mode (0 fill, 1 scan), alpha; q: rgb
export const DIAMOND = 14; // r: cx, cy, size; p: glow, alpha, core; q: rgb
export const LIQUID = 15; // r: rect; p: fillWidth, amp, phase, alpha; q: rgb
export const STAR = 17; // r: cx, cy, radius, inner ratio; p: glow, alpha, fill, _; q: rgb
export const MATERIALIZE = 18; // r: rect; p: gone (1 = not there yet, 0 = whole). Live content assembles block by block
export const ARC = 19; // h.y: indeterminate; h.z: trail tone (0 damage, 1 gain); r: cx, cy, radius, thickness; p: fill, trail, phase, alpha; q: rgb, segments
export const GAUGE = 16; // h.y: indeterminate; h.z: trail tone (0 damage, 1 gain); r: rect; p: fill, trail, phase, alpha; q: rgb, segments

// Blend modes of PILL and SWEEP.
export const ADD = 0; // light added on top
export const BEHIND = 1; // paints the dark parts only: text and bright lines stay on top
export const OVER = 2; // ordinary alpha blend

// Uniform slots (floats).
export const U = {
  viewport: 0, // backing w, h, css w, h
  count: 4, time: 5, dpr: 6,
  wipeActive: 8, wipeFront: 9, wipeBand: 10, wipeSlant: 11,
  bg: 12, // rgb
  ghostCss: 16, // w, h, ready
  hot: 20, // rgb
  bootActive: 24, bootLine: 25,
  holo: 28, // rgb
  void: 32, // rgb: shown where no content is (beyond the edges)
  scope: 36, // x, y, w, h of a scoped transition (w = 0: the whole stage)
  wipeDir: 40, // 1: the blade runs left to right, -1: right to left
  style: 44, // the skin's look: scan lines (0..1), chroma (0..1), crumble (0 | 1), hatch (0..1)
};

export function pcg(v) {
  const state = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

function edge(x, y, rx, ry, rw, rh, soft) {
  const d = Math.min(x - rx, rx + rw - x, y - ry, ry + rh - y);
  return Math.min(Math.max(d / soft, 0), 1);
}

function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Signed distance to a rounded box (twin of sdBox in the shader). */
function sdBox(px, py, bx, by, radius) {
  const qx = Math.abs(px) - bx + radius;
  const qy = Math.abs(py) - by + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Distance to the glass of a LENS item at (x, y), with its skew (twin of lensSd). */
function lensSd(x, y, items, b) {
  const gx = items[b + 12], gy = items[b + 13], gw = items[b + 14], gh = items[b + 15];
  let lx = x - (gx + gw / 2);
  const ly = y - (gy + gh / 2);
  lx += ly * items[b + 11];
  const radius = Math.min(items[b + 8], gw / 2, gh / 2);
  return sdBox(lx, ly, gw / 2, gh / 2, radius);
}

function inside(x, y, rx, ry, rw, rh) {
  return x >= rx && y >= ry && x < rx + rw && y < ry + rh;
}

/** Total displacement at (x, y): the source point shown there is (x + ox, y + oy). */
export function offsetAt(x, y, items, count, out = { x: 0, y: 0 }) {
  let ox = 0;
  let oy = 0;
  for (let i = 0; i < count; i++) {
    const b = i * ITEM_FLOATS;
    const kind = Math.round(items[b]);
    if (kind === 0 || kind === MORPH || kind === GHOST || kind === ROLL) continue;
    if (kind > VORTEX && kind !== BEND && kind !== STRETCH) continue;
    const rx = items[b + 4], ry = items[b + 5], rw = items[b + 6], rh = items[b + 7];
    if (!inside(x, y, rx, ry, rw, rh)) continue;
    if (kind === DENT) {
      const cx = items[b + 8], cy = items[b + 9], radius = items[b + 10], depth = items[b + 11];
      const ringR = items[b + 12], ringAmp = items[b + 13], ringW = items[b + 14];
      const e = edge(x, y, rx, ry, rw, rh, 10);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const n = dist / radius;
      const squash = depth * (0.045 + 0.11 * Math.exp(-2 * n * n));
      const front = (dist - ringR) / ringW;
      const crest = Math.exp(-front * front) * ringAmp;
      const inv = dist > 0.001 ? 1 / dist : 0;
      ox += (dx * squash - dx * inv * crest) * e;
      oy += (dy * squash - dy * inv * crest) * e;
    } else if (kind === JITTER) {
      const amp = items[b + 8], pa = items[b + 9], pb = items[b + 10];
      const e = edge(x, y, rx, ry, rw, rh, 4);
      ox += amp * Math.sin(pa + y * 0.35) * e;
      oy += amp * 0.4 * Math.sin(pb + x * 0.09) * e;
    } else if (kind === SHIFT) {
      ox += items[b + 8];
      oy += items[b + 9];
    } else if (kind === BEND) {
      // A cylinder seen from outside: the middle swells, the sides crowd together.
      const half = rw / 2;
      const xn = Math.min(Math.max((x - rx - half) / half, -1), 1);
      const curve = items[b + 8];
      if (curve > 1e-4) ox += (Math.asin(xn * Math.sin(curve)) / curve - xn) * half;
      ox += items[b + 9] * xn * xn;
    } else if (kind === STRETCH) {
      const left = items[b + 8], right = items[b + 9], laid = items[b + 10], shown = items[b + 11];
      let sx = x;
      if (x <= shown) sx = left + (x - left) * (laid - left) / Math.max(shown - left, 1e-3);
      else sx = laid + (x - shown) * (right - laid) / Math.max(right - shown, 1e-3);
      ox += sx - x;
    } else if (kind === VORTEX) {
      // The picture twists around (cx, cy): strongest at the centre, fading with distance.
      const cx = items[b + 8], cy = items[b + 9], radius = items[b + 10], angle = items[b + 11];
      const dx = x - cx;
      const dy = y - cy;
      const n = (dx * dx + dy * dy) / (radius * radius);
      const w = Math.exp(-n) * edge(x, y, rx, ry, rw, rh, 12);
      const a = angle * w;
      const scale = 1 + items[b + 12] * w;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ox += (c * dx - s * dy) * scale - dx;
      oy += (s * dx + c * dy) * scale - dy;
    } else if (kind === LENS) {
      // Inside the glass, near its edge, the picture comes from farther in.
      const d = lensSd(x, y, items, b);
      if (d < 0) {
        const e = 0.5;
        let gx = lensSd(x + e, y, items, b) - lensSd(x - e, y, items, b);
        let gy = lensSd(x, y + e, items, b) - lensSd(x, y - e, items, b);
        const len = Math.hypot(gx, gy);
        if (len > 1e-4) {
          gx /= len;
          gy /= len;
          const w = 1 - smoothstep(0, items[b + 10], -d);
          ox -= gx * items[b + 9] * w;
          oy -= gy * items[b + 9] * w;
        }
      }
    } else {
      const strength = items[b + 8], slice = items[b + 9], seed = items[b + 10];
      const index = Math.floor((y - ry) / slice) >>> 0;
      const h = pcg((Math.imul(index, 31) + (seed >>> 0)) >>> 0);
      if (h / 4294967296 > 0.55) {
        const h2 = pcg((h + 7) >>> 0) / 4294967296;
        ox += (h2 - 0.5) * 2 * strength;
      }
    }
  }
  out.x = ox;
  out.y = oy;
  return out;
}

/**
 * Where the pixel (x, y) falls on the plane of a TILT card, in the card's flat
 * coordinates from its centre, or null beside the card (twin of tiltLocal).
 */
export function tiltLocal(x, y, items, b) {
  const rx = items[b + 4], ry = items[b + 5], rw = items[b + 6], rh = items[b + 7];
  const a = items[b + 8], bb = items[b + 9], eye = items[b + 10], lift = items[b + 11];
  const qx = (x - rx - rw / 2) / lift;
  const qy = (y - ry - rh / 2) / lift;
  const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(bb), cb = Math.cos(bb);
  // The ray from the eye at (0, 0, eye) through (qx, qy, 0) meets the turned plane.
  const nx = sb * ca, ny = -sa, nz = cb * ca;
  const t = (nz * eye) / (nz * eye - nx * qx - ny * qy);
  const X = t * qx, Y = t * qy, Z = eye - t * eye;
  const u = X * cb - Z * sb;
  const v = X * sb * sa + Y * ca + Z * cb * sa;
  if (Math.abs(u) > rw / 2 || Math.abs(v) > rh / 2) return null;
  return { u, v };
}

/**
 * The source point that the presented pixel (x, y) shows, in canvas CSS px, or null
 * where it shows no live element (the old page of a transition, the unbooted part).
 */
export function mapThrough(x, y, uniforms, items, count) {
  // (x, y) may move onto a tilted card's plane below.
  if (uniforms[U.bootActive] > 0.5 && y > uniforms[U.bootLine]) return null;
  const w = uniforms[U.viewport + 2];
  const h = uniforms[U.viewport + 3];
  if (uniforms[U.wipeActive] > 0.5) {
    for (let i = 0; i < count; i++) {
      const b = i * ITEM_FLOATS;
      if (Math.round(items[b]) !== MORPH) continue;
      const rx = items[b + 4], ry = items[b + 5], rw = items[b + 6], rh = items[b + 7];
      if (!inside(x, y, rx, ry, rw, rh)) continue;
      const u = (x - rx) / rw;
      const v = (y - ry) / rh;
      return { x: items[b + 12] + u * items[b + 14], y: items[b + 13] + v * items[b + 15] };
    }
    // Under the flights, what has left the page (still crumbling) takes no input.
    for (let i = 0; i < count; i++) {
      const b = i * ITEM_FLOATS;
      if (Math.round(items[b]) !== GHOST) continue;
      if (inside(x, y, items[b + 4], items[b + 5], items[b + 6], items[b + 7])) return null;
    }
    const scoped = uniforms[U.scope + 2] > 0;
    const sx = scoped ? uniforms[U.scope] : 0;
    const sy = scoped ? uniforms[U.scope + 1] : 0;
    const sw = scoped ? uniforms[U.scope + 2] : w;
    const sh = scoped ? uniforms[U.scope + 3] : h;
    if (inside(x, y, sx, sy, sw, sh)) {
      const slant = uniforms[U.wipeSlant];
      const lx = uniforms[U.wipeDir] < 0 ? sw - (x - sx) : x - sx;
      const s = (lx + (y - sy) * slant) / (sw + sh * slant);
      if (s > uniforms[U.wipeFront]) return null;
    }
  } else {
    for (let i = 0; i < count; i++) {
      const b = i * ITEM_FLOATS;
      if (Math.round(items[b]) !== GHOST) continue;
      if (inside(x, y, items[b + 4], items[b + 5], items[b + 6], items[b + 7])) return null;
    }
  }
  // A tilted card: the point of the card's plane under the pixel, or nothing beside it.
  // (Not during a cut: the shader draws no tilt there.)
  for (let i = 0; i < count && uniforms[U.wipeActive] < 0.5; i++) {
    const b = i * ITEM_FLOATS;
    if (Math.round(items[b]) !== TILT) continue;
    const m = items[b + 1];
    const rx = items[b + 4], ry = items[b + 5], rw = items[b + 6], rh = items[b + 7];
    if (!inside(x, y, rx - m, ry - m, rw + 2 * m, rh + 2 * m)) continue;
    const local = tiltLocal(x, y, items, b);
    if (!local) return null;
    x = rx + rw / 2 + local.u;
    y = ry + rh / 2 + local.v;
    break;
  }
  const o = offsetAt(x, y, items, count);
  const sx = x + o.x;
  const sy = y + o.y;
  // Content moved in from beyond the edges is empty space.
  if (sx < -0.5 || sy < -0.5 || sx > w + 0.5 || sy > h + 0.5) return null;
  return { x: Math.min(Math.max(sx, 0), w), y: Math.min(Math.max(sy, 0), h) };
}

/** Fixed-size scene buffer that behaviours fill every frame. */
export class Scene {
  constructor(max = MAX_ITEMS) {
    this.data = new Float32Array(max * ITEM_FLOATS);
    this.max = max;
    this.count = 0;
  }
  reset() {
    this.count = 0;
  }
  push(kind, rect, p = ZERO, q = ZERO, h1 = 0, h2 = 0, h3 = 0) {
    if (this.count >= this.max) return;
    const b = this.count++ * ITEM_FLOATS;
    const d = this.data;
    d[b] = kind; d[b + 1] = h1; d[b + 2] = h2; d[b + 3] = h3;
    d[b + 4] = rect[0]; d[b + 5] = rect[1]; d[b + 6] = rect[2]; d[b + 7] = rect[3];
    d[b + 8] = p[0] ?? 0; d[b + 9] = p[1] ?? 0; d[b + 10] = p[2] ?? 0; d[b + 11] = p[3] ?? 0;
    d[b + 12] = q[0] ?? 0; d[b + 13] = q[1] ?? 0; d[b + 14] = q[2] ?? 0; d[b + 15] = q[3] ?? 0;
  }
}

const ZERO = [0, 0, 0, 0];
