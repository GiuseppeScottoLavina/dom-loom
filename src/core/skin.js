// Skins. A behaviour knows WHAT a control is doing (where, how far, how fast); a skin
// decides how that looks and sounds: the scene items it draws for each state, its
// colours, its timings, its sounds, its transition and the stage's CSS at rest.
//
//   defineSkin({ name: 'mine', tokens, draw: { press(scene, state, ctx) {...} }, ... })
//   <loom-stage skin="mine">
//
// A draw hook that a skin leaves out draws nothing for that state.

export const DEFAULT_SKIN = 'holo';

/** How long the timed effects last (ms). Behaviours keep frames coming for this long. */
const DURATIONS = {
  press: 560, // the ring after a release
  burst: 800, // a completed hold
  nudge: 380, // a refused click on a hold button
  ring: 520, // a toggle or a selection
  scan: 460, // a field gaining focus
  glitch: 520, // an invalid field
  hit: 950, // a drop in a gauge
  complete: 700, // a progress reaching its end
  reveal: 420, // a details opening
  shut: 320, // a details closing
};

const registry = new Map();
const pending = new Map(); // draw hooks for skins not defined yet

/**
 * Registers a skin. Stages that use its name pick it up at once.
 * @param {object} skin
 * @param {string} skin.name
 * @param {Record<string, [string, string]>} [skin.tokens]  colour name -> [custom property, fallback]
 * @param {Record<string, Function>} [skin.draw]  draw hooks: (scene, state, ctx) => void
 * @param {Record<string, Function>} [skin.sounds]  sound hooks, called after a user gesture with `sound` on
 * @param {object} [skin.shader]  scanlines (0..1), chroma (0..1), crumble (0 | 1), hatch (0..1)
 * @param {object} [skin.transition]  ms, scopedMs, band, slant
 * @param {object|null} [skin.boot]  { ms } of the sweep that reveals a stage, null for none
 * @param {object} [skin.durations]  see DURATIONS
 * @param {object} [skin.disclosure]  crumble: px of a closing body that crumble away
 */
export function defineSkin(skin) {
  if (!skin || typeof skin.name !== 'string' || !skin.name) throw new TypeError('defineSkin: a skin needs a name');
  const full = Object.freeze({
    ...skin,
    tokens: { ...skin.tokens },
    // Hooks added by component modules (extendSkin) join this object.
    draw: { ...registry.get(skin.name)?.draw, ...pending.get(skin.name)?.draw, ...skin.draw },
    sounds: { ...registry.get(skin.name)?.sounds, ...pending.get(skin.name)?.sounds, ...skin.sounds },
    shader: { scanlines: 0, chroma: 0, crumble: 0, hatch: 0, ...skin.shader },
    transition: { ms: 640, scopedMs: 430, band: 0.1, slant: 0.42, ...skin.transition },
    boot: skin.boot === undefined ? { ms: 760 } : skin.boot,
    durations: { ...DURATIONS, ...skin.durations },
    disclosure: { crumble: 0, ...skin.disclosure },
    // Which of its colours the compositor uses for the cut's blade, its rim light,
    // the panel behind moved content, and empty space.
    roles: { hot: 'hot', rim: 'rim', bg: 'bg', void: 'void', ...skin.roles },
  });
  registry.set(full.name, full);
  globalThis.document?.dispatchEvent(new CustomEvent('loom-skin', { detail: { name: full.name } }));
  return full;
}

/**
 * Adds draw hooks (and sounds) to a skin: a component module brings the drawing of its control,
 * so a page pays only for the controls it imports. Works before the skin is defined.
 */
export function extendSkin(name, draw, sounds = null) {
  const skin = registry.get(name);
  if (skin) {
    Object.assign(skin.draw, draw);
    if (sounds) Object.assign(skin.sounds, sounds);
  } else {
    const p = pending.get(name) ?? { draw: {}, sounds: {} };
    Object.assign(p.draw, draw);
    if (sounds) Object.assign(p.sounds, sounds);
    pending.set(name, p);
  }
  globalThis.document?.dispatchEvent(new CustomEvent('loom-skin', { detail: { name } }));
}

/** The skin of that name, or the default one. */
export function getSkin(name) {
  return registry.get(name || DEFAULT_SKIN) ?? registry.get(DEFAULT_SKIN) ?? null;
}

export function skinNames() {
  return [...registry.keys()];
}
