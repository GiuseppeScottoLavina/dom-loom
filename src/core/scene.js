// The scene the compositor draws, as plain numbers: items of 16 floats and a block of
// uniforms. Behaviours (through the skin) fill it every frame; the shader and the
// input mapper read the same numbers.

export const ITEM_FLOATS = 16; // header, rect, p, q: 4 x vec4f
export const INITIAL_ITEM_CAPACITY = 128;
export const UNIFORM_FLOATS = 60; // 15 x vec4f

// The displacement field: a grid of vec2 displacements (CSS px) over the whole canvas.
// Cell centres are spread over the canvas CSS width and height (core/math.js: fieldAt).
export const FIELD_COLS = 64;
export const FIELD_ROWS = 40;

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
  wipeStyle: 41, // the kind of the primitive that styles the cut (0: the blade)
  style: 44, // the skin's look: scan lines (0..1), chroma (0..1), crumble (0 | 1), hatch (0..1)
  present: 48, // the kinds in this frame's scene, as a bit mask: passes for absent kinds are skipped.
  // A float holds integers exactly only up to 2^24, so the mask takes two slots: bits 0..15, then bits 16..31.
  alpha: 52, // 1: the canvas is transparent (an overlay stage); the shader writes premultiplied alpha
  field: 56, // cols, rows, active (1: the displacement field is in use)
};

const ZERO = [0, 0, 0, 0];

/** Reusable scene buffer that grows as behaviours emit more primitives. */
export class Scene {
  constructor(capacity = INITIAL_ITEM_CAPACITY) {
    this.data = new Float32Array(capacity * ITEM_FLOATS);
    this.max = capacity;
    this.count = 0;
    this.mask = 0;
  }
  reset() {
    this.count = 0;
    this.mask = 0;
  }
  push(kind, rect, p = ZERO, q = ZERO, h1 = 0, h2 = 0, h3 = 0) {
    if (!kind) return;
    if (this.count === this.max) {
      const capacity = Math.max(1, this.max * 2);
      const grown = new Float32Array(capacity * ITEM_FLOATS);
      grown.set(this.data);
      this.data = grown;
      this.max = capacity;
    }
    const b = this.count++ * ITEM_FLOATS;
    const d = this.data;
    this.mask |= 1 << kind;
    d[b] = kind; d[b + 1] = h1; d[b + 2] = h2; d[b + 3] = h3;
    d[b + 4] = rect[0]; d[b + 5] = rect[1]; d[b + 6] = rect[2]; d[b + 7] = rect[3];
    d[b + 8] = p[0] ?? 0; d[b + 9] = p[1] ?? 0; d[b + 10] = p[2] ?? 0; d[b + 11] = p[3] ?? 0;
    d[b + 12] = q[0] ?? 0; d[b + 13] = q[1] ?? 0; d[b + 14] = q[2] ?? 0; d[b + 15] = q[3] ?? 0;
  }
}
