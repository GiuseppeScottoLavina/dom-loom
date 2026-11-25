// The registry of primitives: what the compositor can draw. Each primitive is one
// module (src/primitives/*) with its WGSL and, when it moves the picture, the
// JavaScript twin the input mapper runs. The shader is built from the primitives a
// page actually imports, so an unused effect costs neither bytes nor GPU time.
//
// A primitive:
//   kind      its number in the scene, 1..63 (stable: 1..9 move the picture or replace
//             it, 10..19 add light, 20 and up came later, of any capability)
//   functions WGSL helpers it needs
//   offset    moves the picture: { wgsl, js(x, y, items, b, out, ctx), whole }
//             wgsl runs with p, it and `var o` in scope, only where p is in it.r;
//             whole: it moves content without tearing it (no chromatic split);
//             ctx = { uniforms, field } are the numbers of the presented frame (the
//             displacement field is null when it is off); most twins ignore it
//   picture   replaces the picture where it covers: { name, order, wgsl, js }
//             wgsl defines fn <name>(p, light) -> vec4f (w < 0: does not cover);
//             js(x, y, items, b) -> undefined (does not cover), null (no input
//             target), { x, y } (map on from there) or { x, y, final: true };
//             transition: true draws it over a transition too (over the cut and
//             the ghosts, mixed by w), and its js is asked first there
//   light     paints over the picture: { wgsl } with p, it, `var base`, `var light`
//   view      moves the whole frame (an overlay's zoom): { wgsl, js(x, y, items, b) -> { x, y } }
//             wgsl runs first, with p, it and `var p` in scope: it sets the point that pixel
//             shows, for the picture, the lights and the posts alike; js is the same for input
//   post      works on the finished pixel: { wgsl, js(x, y, items, b) -> false where
//             the pixel shows nothing } with p, it, `var color`, `var alpha`
//   cut       a style for stage.transition(update, { style: name }), in place of the
//             blade: { wgsl, fn, js }
//             wgsl defines fn <fn>(p: vec2f, sc: vec4f, s: f32, front: f32, dir: f32,
//             light: ptr<function, vec3f>) -> vec3f, the colour of pixel p during the cut.
//             sc is the cut's scope (x, y, w, h: the stage, or the scoped region); s is
//             where p lies along the cut, 0..1 (the blade's own measure); front is the
//             cut's progress (0 up to 1 + band, as the blade); dir is 1 or -1. It may
//             call livePicture(p) and sampleGhost(p) (the new and the old page).
//             js(x, y, sc, s, front, dir, uniforms) is its twin: null where the pixel
//             shows the OLD page (no input target), undefined where it shows the live
//             new page. While the cut waits for the new picture, front is 0: the style
//             must then show the old page everywhere, and its js answer null.
//             pace (optional, default 1) scales the skin's transition time for this style.
//   exit      a way out for the elements a transition removes, in place of the
//             crumble: { name, ms, item(rect, elapsed, { seed, origin, whole }) ->
//             { rect, p, q, h } | null }, chosen by transition/discard({ exit: name });
//             elapsed is the ms since the element left

const table = new Map();
let version = 0;

/** Registers a primitive (once per kind) and returns its kind, for scene.push(). */
export function definePrimitive(def) {
  if (!Number.isInteger(def.kind) || def.kind < 1 || def.kind > 63) {
    throw new RangeError(`DomLoom: primitive kind ${def.kind} of ${def.name} is not in 1..63`);
  }
  const known = table.get(def.kind);
  if (known && known !== def && known.name !== def.name) {
    throw new Error(`DomLoom: primitive kind ${def.kind} is both ${known.name} and ${def.name}`);
  }
  if (known !== def) {
    table.set(def.kind, def);
    version++;
    globalThis.document?.dispatchEvent(new CustomEvent('loom-primitives'));
  }
  return def.kind;
}

export const primitives = {
  get version() {
    return version;
  },
  all() {
    return [...table.values()].sort((a, b) => a.kind - b.kind);
  },
  get(kind) {
    return table.get(kind);
  },
};

let cached = { version: -1, offsets: [], pictures: [], posts: [], cuts: [], views: [] };

/** The mapper's view of the registry, rebuilt when a primitive is added. */
export function mapperTables() {
  if (cached.version !== version) {
    const offsets = [];
    for (const def of table.values()) if (def.offset?.js) offsets[def.kind] = def.offset.js;
    const pictures = [...table.values()].filter((d) => d.picture?.js).sort((a, b) => a.picture.order - b.picture.order);
    const posts = [...table.values()].filter((d) => d.post?.js);
    const views = [...table.values()].filter((d) => d.view?.js);
    const cuts = [];
    for (const def of table.values()) if (def.cut?.js) cuts[def.kind] = def.cut.js;
    cached = { version, offsets, pictures, posts, cuts, views };
  }
  return cached;
}
