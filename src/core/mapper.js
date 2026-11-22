// The input mapper: the JavaScript twin of the shader. For a point of the presented
// picture it answers which point of the live content is shown there (or null where
// no element is), with the numbers of the frame that was presented. Each primitive
// brings its own twin (src/primitives/*); this file runs them in the shader's order.
import { inside } from './math.js';
import { mapperTables } from './primitives.js';
import { ITEM_FLOATS, U } from './scene.js';

const MORPH = 4;
const GHOST = 6;

/** Total displacement at (x, y): the source point shown there is (x + ox, y + oy). */
export function offsetAt(x, y, items, count, out = { x: 0, y: 0 }) {
  const { offsets } = mapperTables();
  const acc = { x: 0, y: 0 };
  for (let i = 0; i < count; i++) {
    const b = i * ITEM_FLOATS;
    const js = offsets[Math.round(items[b])];
    if (!js || !inside(x, y, items[b + 4], items[b + 5], items[b + 6], items[b + 7])) continue;
    js(x, y, items, b, acc);
  }
  out.x = acc.x;
  out.y = acc.y;
  return out;
}

function coveredBy(kind, x, y, items, count) {
  for (let i = 0; i < count; i++) {
    const b = i * ITEM_FLOATS;
    if (Math.round(items[b]) === kind && inside(x, y, items[b + 4], items[b + 5], items[b + 6], items[b + 7])) return true;
  }
  return false;
}

/**
 * The source point that the presented pixel (x, y) shows, in canvas CSS px, or null
 * where it shows no live element (the old page of a transition, the unbooted part).
 */
export function mapThrough(x, y, uniforms, items, count) {
  if (uniforms[U.bootActive] > 0.5 && y > uniforms[U.bootLine]) return null;
  // What a post primitive hides (an overlay that is still opening) takes no input.
  for (const def of mapperTables().posts) {
    for (let i = 0; i < count; i++) {
      const b = i * ITEM_FLOATS;
      if (Math.round(items[b]) === def.kind && def.post.js(x, y, items, b) === false) return null;
    }
  }
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
    if (coveredBy(GHOST, x, y, items, count)) return null;
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
    // Pictures that replace the live one, in the shader's order, then ghosts.
    let moved = false;
    for (const def of mapperTables().pictures) {
      for (let i = 0; i < count && !moved; i++) {
        const b = i * ITEM_FLOATS;
        if (Math.round(items[b]) !== def.kind) continue;
        const r = def.picture.js(x, y, items, b);
        if (r === undefined) continue;
        if (r === null) return null;
        if (r.final) return { x: r.x, y: r.y };
        x = r.x;
        y = r.y;
        moved = true;
      }
      if (moved) break;
    }
    if (!moved && coveredBy(GHOST, x, y, items, count)) return null;
  }
  const o = offsetAt(x, y, items, count);
  const sx = x + o.x;
  const sy = y + o.y;
  // Content moved in from beyond the edges is empty space.
  if (sx < -0.5 || sy < -0.5 || sx > w + 0.5 || sy > h + 0.5) return null;
  return { x: Math.min(Math.max(sx, 0), w), y: Math.min(Math.max(sy, 0), h) };
}
