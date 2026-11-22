// JavaScript twins of the shader's helpers (core/shader.js). The input mapper runs the
// same arithmetic as the shader, so these must stay exactly equal to their WGSL.
import { U } from './scene.js';

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

/**
 * The displacement field at the canvas CSS point (x, y), in CSS px: a bilinear sample of
 * the grid (cell centres spread over the canvas CSS width and height), clamped at the
 * grid edges. Zero where the field is off. Twin of fieldAt in WGSL.
 */
export function fieldAt(x, y, uniforms, field, out = { x: 0, y: 0 }) {
  out.x = 0;
  out.y = 0;
  if (!field || uniforms[U.field + 2] < 0.5) return out;
  const cols = Math.round(uniforms[U.field]);
  const rows = Math.round(uniforms[U.field + 1]);
  const gx = Math.min(Math.max((x / uniforms[U.viewport + 2]) * cols - 0.5, 0), cols - 1);
  const gy = Math.min(Math.max((y / uniforms[U.viewport + 3]) * rows - 0.5, 0), rows - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, cols - 1);
  const y1 = Math.min(y0 + 1, rows - 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const at = (cx, cy, k) => field[(cy * cols + cx) * 2 + k];
  for (let k = 0; k < 2; k++) {
    const top = at(x0, y0, k) + (at(x1, y0, k) - at(x0, y0, k)) * fx;
    const bottom = at(x0, y1, k) + (at(x1, y1, k) - at(x0, y1, k)) * fx;
    const v = top + (bottom - top) * fy;
    if (k === 0) out.x = v;
    else out.y = v;
  }
  return out;
}
