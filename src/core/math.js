// JavaScript twins of the shader's helpers (core/shader.js). The input mapper runs the
// same arithmetic as the shader, so these must stay exactly equal to their WGSL.

/** PCG hash on u32, with WGSL's wrap-around. */
export function pcg(v) {
  const state = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** 0 at the edge of a rect, 1 `soft` px inside it (edgeF). */
export function edge(x, y, rx, ry, rw, rh, soft) {
  const d = Math.min(x - rx, rx + rw - x, y - ry, ry + rh - y);
  return Math.min(Math.max(d / soft, 0), 1);
}

export function inside(x, y, rx, ry, rw, rh) {
  return x >= rx && y >= ry && x < rx + rw && y < ry + rh;
}

export function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Signed distance to a rounded box centred at the origin. */
export function sdBox(px, py, bx, by, radius) {
  const qx = Math.abs(px) - bx + radius;
  const qy = Math.abs(py) - by + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}
