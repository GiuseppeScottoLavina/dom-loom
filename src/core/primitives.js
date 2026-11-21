// The registry of primitives: what the compositor can draw. Each primitive is one
// module (src/primitives/*) with its WGSL and, when it moves the picture, the
// JavaScript twin the input mapper runs. The shader is built from the primitives a
// page actually imports, so an unused effect costs neither bytes nor GPU time.
//
// A primitive:
//   kind      its number in the scene (stable: 1..9 move the picture or replace it,
//             10..19 add light, 20..29 move or replace again)
//   functions WGSL helpers it needs
//   offset    moves the picture: { wgsl, js(x, y, items, b, out), whole }
//             wgsl runs with p, it and `var o` in scope, only where p is in it.r;
//             whole: it moves content without tearing it (no chromatic split)
//   picture   replaces the picture where it covers: { name, order, wgsl, js }
//             wgsl defines fn <name>(p, light) -> vec4f (w < 0: does not cover);
//             js(x, y, items, b) -> undefined (does not cover), null (no input
//             target), { x, y } (map on from there) or { x, y, final: true }
//   light     paints over the picture: { wgsl } with p, it, `var base`, `var light`

const table = new Map();
let version = 0;

/** Registers a primitive (once per kind) and returns its kind, for scene.push(). */
export function definePrimitive(def) {
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

let cached = { version: -1, offsets: [], pictures: [] };

/** The mapper's view of the registry, rebuilt when a primitive is added. */
export function mapperTables() {
  if (cached.version !== version) {
    const offsets = [];
    for (const def of table.values()) if (def.offset?.js) offsets[def.kind] = def.offset.js;
    const pictures = [...table.values()].filter((d) => d.picture?.js).sort((a, b) => a.picture.order - b.picture.order);
    cached = { version, offsets, pictures };
  }
  return cached;
}
