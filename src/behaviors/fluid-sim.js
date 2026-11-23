// A small fluid on the stage's displacement grid (COLS x ROWS cells over the whole canvas).
//
// Two fields live on the grid. The velocity of the water, v (px/s), is stirred by the pointer
// and kept divergence free by a projection, so the water swirls instead of piling up. The
// field the picture is read through, o (px), is the "back map": the pixel p shows the content
// that was at p + o(p). It is carried by the flow (o'(p) = o(p - v dt) - v dt), so content
// swirls with the water, and it relaxes toward zero and is pulled back by a weak elastic force,
// so the picture wobbles and settles. Semi-Lagrangian advection is stable for any step.
//
// The sim writes o straight into `data` (the stage's field: x then y, row by row).

const DAMPING = 2.6; // 1/s: how fast the water forgets its motion
const RELAX = 2.4; // 1/s: how fast the picture comes back
const SPRING = 46; // 1/s^2: the elastic pull that makes the picture wobble
const ITERATIONS = 20; // Jacobi iterations of the projection (the pressure is kept between steps)
const MAX_SPEED = 1400; // px/s
const GAIN = 0.5; // how much of the finger's speed the water takes
const MAX_SHIFT = 44; // px: the largest displacement of the picture
const SIGMA = 30; // px: the reach of a finger

export const REST = 0.05; // px: below this the picture is back at rest

export class FluidSim {
  /** @param {Float32Array} data  the grid o is written to (cols * rows * 2) */
  constructor(cols, rows, data = new Float32Array(cols * rows * 2)) {
    this.cols = cols;
    this.rows = rows;
    this.data = data;
    const n = cols * rows;
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.ty = new Float32Array(n);
    this.pressure = new Float32Array(n);
    this.next = new Float32Array(n);
    this.div = new Float32Array(n);
    this.to = new Float32Array(n * 2);
    this.width = 0;
    this.height = 0;
    this.cw = 1; // cell size in px
    this.ch = 1;
    this.maxShift = 0;
    this.maxSpeed = 0;
  }

  /** The size of the canvas in CSS px: a different size restarts the water. */
  resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.cw = width / this.cols;
    this.ch = height / this.rows;
    this.reset();
  }

  reset() {
    this.vx.fill(0);
    this.vy.fill(0);
    this.pressure.fill(0);
    this.data.fill(0);
    this.maxShift = 0;
    this.maxSpeed = 0;
  }

  get resting() {
    return this.maxShift < REST && this.maxSpeed < 1;
  }

  /** A finger at (x, y) px dragging the water at (vx, vy) px/s. */
  splat(x, y, vx, vy, sigma = SIGMA) {
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_SPEED) {
      vx *= MAX_SPEED / speed;
      vy *= MAX_SPEED / speed;
    }
    vx *= GAIN;
    vy *= GAIN;
    const { cols, rows, cw, ch } = this;
    const reach = sigma * 2.4;
    const c0 = Math.max(0, Math.floor((x - reach) / cw)), c1 = Math.min(cols - 1, Math.ceil((x + reach) / cw));
    const r0 = Math.max(0, Math.floor((y - reach) / ch)), r1 = Math.min(rows - 1, Math.ceil((y + reach) / ch));
    const k = 1 / (2 * sigma * sigma);
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * ch - y;
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cw - x;
        const w = 0.6 * Math.exp(-(dx * dx + dy * dy) * k);
        const i = r * cols + c;
        this.vx[i] += (vx - this.vx[i]) * w;
        this.vy[i] += (vy - this.vy[i]) * w;
      }
    }
  }

  /** Advances the water by dt seconds (one step, whatever dt is). Returns the largest shift (px). */
  step(dt) {
    dt = Math.min(Math.max(dt, 1 / 240), 1 / 30);
    const { cols, rows, cw, ch, vx, vy, data } = this;
    const n = cols * rows;
    const damp = Math.exp(-DAMPING * dt);

    // The elastic pull: the picture wants to be where it was.
    for (let i = 0; i < n; i++) {
      vx[i] = (vx[i] + data[i * 2] * SPRING * dt) * damp;
      vy[i] = (vy[i] + data[i * 2 + 1] * SPRING * dt) * damp;
    }

    // The water carries itself.
    this.advectScalar(vx, this.tx, dt);
    this.advectScalar(vy, this.ty, dt);
    vx.set(this.tx);
    vy.set(this.ty);

    this.project();

    // The water carries the picture, which also relaxes (faster the closer it is to rest).
    const to = this.to;
    const relax = Math.exp(-RELAX * (1 + 2 * (1 - Math.min(1, this.maxShift / 2))) * dt);
    let maxShift = 0;
    let maxSpeed = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const dx = vx[i] * dt;
        const dy = vy[i] * dt;
        const gx = c - dx / cw;
        const gy = r - dy / ch;
        const o = this.sample2(data, gx, gy);
        let ox = (o[0] - dx) * relax;
        let oy = (o[1] - dy) * relax;
        const m = Math.hypot(ox, oy);
        if (m > MAX_SHIFT) {
          ox *= MAX_SHIFT / m;
          oy *= MAX_SHIFT / m;
        }
        to[i * 2] = ox;
        to[i * 2 + 1] = oy;
        const a = ox * ox + oy * oy;
        if (a > maxShift) maxShift = a;
        const s = vx[i] * vx[i] + vy[i] * vy[i];
        if (s > maxSpeed) maxSpeed = s;
      }
    }
    this.maxShift = Math.sqrt(maxShift);
    this.maxSpeed = Math.sqrt(maxSpeed);
    if (this.resting) {
      vx.fill(0);
      vy.fill(0);
      this.pressure.fill(0);
      data.fill(0);
      this.maxShift = 0;
      this.maxSpeed = 0;
    } else {
      data.set(to);
    }
    return this.maxShift;
  }

  // Bilinear sample of a vec2 grid at cell coordinates, clamped to the grid. Returns a shared pair.
  sample2(grid, gx, gy) {
    const { cols, rows } = this;
    gx = gx < 0 ? 0 : gx > cols - 1 ? cols - 1 : gx;
    gy = gy < 0 ? 0 : gy > rows - 1 ? rows - 1 : gy;
    const x0 = gx | 0, y0 = gy | 0;
    const x1 = x0 + 1 < cols ? x0 + 1 : x0, y1 = y0 + 1 < rows ? y0 + 1 : y0;
    const fx = gx - x0, fy = gy - y0;
    const a = (y0 * cols + x0) * 2, b = (y0 * cols + x1) * 2, c = (y1 * cols + x0) * 2, d = (y1 * cols + x1) * 2;
    const out = (this.pair ??= [0, 0]);
    for (let k = 0; k < 2; k++) {
      const top = grid[a + k] + (grid[b + k] - grid[a + k]) * fx;
      const bottom = grid[c + k] + (grid[d + k] - grid[c + k]) * fx;
      out[k] = top + (bottom - top) * fy;
    }
    return out;
  }

  // Semi-Lagrangian advection of a scalar grid by the velocity: out(p) = q(p - v dt).
  advectScalar(q, out, dt) {
    const { cols, rows, cw, ch, vx, vy } = this;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        let gx = c - (vx[i] * dt) / cw;
        let gy = r - (vy[i] * dt) / ch;
        gx = gx < 0 ? 0 : gx > cols - 1 ? cols - 1 : gx;
        gy = gy < 0 ? 0 : gy > rows - 1 ? rows - 1 : gy;
        const x0 = gx | 0, y0 = gy | 0;
        const x1 = x0 + 1 < cols ? x0 + 1 : x0, y1 = y0 + 1 < rows ? y0 + 1 : y0;
        const fx = gx - x0, fy = gy - y0;
        const a = q[y0 * cols + x0], b = q[y0 * cols + x1], cc = q[y1 * cols + x0], d = q[y1 * cols + x1];
        const top = a + (b - a) * fx;
        out[i] = top + (cc + (d - cc) * fx - top) * fy;
      }
    }
  }

  // Makes the velocity divergence free: solve laplacian(p) = div(v), subtract grad(p). Walls: no flow through.
  project() {
    const { cols, rows, cw, ch, vx, vy, div } = this;
    let p = this.pressure;
    let q = this.next;
    // Normal velocity at the walls is zero.
    for (let r = 0; r < rows; r++) {
      vx[r * cols] = 0;
      vx[r * cols + cols - 1] = 0;
    }
    for (let c = 0; c < cols; c++) {
      vy[c] = 0;
      vy[(rows - 1) * cols + c] = 0;
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const l = c > 0 ? vx[i - 1] : 0, rr = c < cols - 1 ? vx[i + 1] : 0;
        const u = r > 0 ? vy[i - cols] : 0, d = r < rows - 1 ? vy[i + cols] : 0;
        div[i] = (rr - l) / (2 * cw) + (d - u) / (2 * ch);
      }
    }
    const ix = 1 / (cw * cw);
    const iy = 1 / (ch * ch);
    const inv = 1 / (2 * ix + 2 * iy);
    for (let it = 0; it < ITERATIONS; it++) {
      for (let r = 0; r < rows; r++) {
        const up = r > 0 ? -cols : 0, down = r < rows - 1 ? cols : 0;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const left = c > 0 ? -1 : 0, right = c < cols - 1 ? 1 : 0;
          q[i] = ((p[i + left] + p[i + right]) * ix + (p[i + up] + p[i + down]) * iy - div[i]) * inv;
        }
      }
      const t = p;
      p = q;
      q = t;
    }
    this.pressure = p;
    this.next = q;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const l = c > 0 ? p[i - 1] : p[i], rr = c < cols - 1 ? p[i + 1] : p[i];
        const u = r > 0 ? p[i - cols] : p[i], d = r < rows - 1 ? p[i + cols] : p[i];
        vx[i] -= (rr - l) / (2 * cw);
        vy[i] -= (d - u) / (2 * ch);
      }
    }
  }
}
