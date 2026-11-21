import './skins/holo/index.js';
import { LoomStage } from './stage.js';

export { LoomStage };
export { DEFAULT_SKIN, defineSkin, getSkin, skinNames } from './skin.js';
// For skin authors: the scene primitives, their blend modes, and the audio engine.
export {
  ADD, ARC, BEHIND, BEND, BRACKETS, DENT, DIAMOND, GAUGE, GHOST, GLITCH, JITTER, LENS, LIQUID, MATERIALIZE, MORPH, OVER, PILL,
  RING, ROLL, SHIFT, STAR, STRETCH, SWEEP, TILT, VORTEX,
} from './field.js';
export { audio, noise, output, tone } from './audio.js';
export { holo } from './skins/holo/index.js';

if (globalThis.customElements && !customElements.get('loom-stage')) {
  customElements.define('loom-stage', LoomStage);
}
