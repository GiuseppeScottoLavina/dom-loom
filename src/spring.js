const STEP = 1 / 240;

/** A damped spring integrated in fixed substeps, so it moves the same at any frame rate. */
export class Spring {
  constructor(value = 0, { stiffness = 320, damping = 26, epsilon = 0.01 } = {}) {
    this.x = value;
    this.v = 0;
    this.target = value;
    this.stiffness = stiffness;
    this.damping = damping;
    this.epsilon = epsilon;
  }
  set(target) {
    this.target = target;
    return this;
  }
  snap(value = this.target) {
    this.x = this.target = value;
    this.v = 0;
    return this;
  }
  kick(velocity) {
    this.v += velocity;
    return this;
  }
  get settled() {
    return Math.abs(this.x - this.target) < this.epsilon && Math.abs(this.v) < this.epsilon * 4;
  }
  step(dt) {
    if (this.settled) {
      this.x = this.target;
      this.v = 0;
      return false;
    }
    let remaining = dt;
    while (remaining > 1e-6) {
      const h = Math.min(STEP, remaining);
      const a = -this.stiffness * (this.x - this.target) - this.damping * this.v;
      this.v += a * h;
      this.x += this.v * h;
      remaining -= h;
    }
    return true;
  }
}

/** Four springs that move a rectangle; each edge can have its own stiffness. */
export class RectSpring {
  constructor(options) {
    this.l = new Spring(0, options);
    this.t = new Spring(0, options);
    this.r = new Spring(0, options);
    this.b = new Spring(0, options);
  }
  set([x, y, w, h]) {
    this.l.set(x);
    this.t.set(y);
    this.r.set(x + w);
    this.b.set(y + h);
  }
  snap([x, y, w, h]) {
    this.l.snap(x);
    this.t.snap(y);
    this.r.snap(x + w);
    this.b.snap(y + h);
  }
  step(dt) {
    const a = this.l.step(dt);
    const b = this.t.step(dt);
    const c = this.r.step(dt);
    const d = this.b.step(dt);
    return a || b || c || d;
  }
  get rect() {
    return [this.l.x, this.t.x, this.r.x - this.l.x, this.b.x - this.t.x];
  }
}

export const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutBack = (t, s = 1.4) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
