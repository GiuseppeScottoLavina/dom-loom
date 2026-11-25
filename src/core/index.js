// dom-loom/core: <loom-stage>, transitions, buttons and hold-to-confirm, the focus
// reticle and the holo skin's base. Every component module (dom-loom/tabs, …) imports
// this; import it alone to build on the stage with your own behaviours.
import { Presses } from '../behaviors/presses.js';
import { Reticle } from '../behaviors/reticle.js';
import '../skins/holo/index.js';
import { defineComponent } from './behaviors.js';
import { LoomStage } from './stage.js';

// Focus must stay visible on the GPU path (the outline is off there): the reticle is core.
defineComponent('presses', Presses, 50);
defineComponent('reticle', Reticle, 100);

if (globalThis.customElements && !customElements.get('loom-stage')) {
  customElements.define('loom-stage', LoomStage);
}

export { LoomStage };
export { defineBehavior } from './behaviors.js';
export { definePrimitive } from './primitives.js';
export { defineStrings } from './strings.js';
export { DEFAULT_SKIN, defineSkin, extendSkin, getSkin, skinNames } from './skin.js';
export { ADD, BEHIND, INK, INVERT, OVER } from './scene.js';
export { audio, noise, output, tone } from './audio.js';
export { holo } from '../skins/holo/index.js';
