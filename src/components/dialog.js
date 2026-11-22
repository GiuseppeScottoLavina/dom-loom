// dom-loom/dialog: a stage with the `overlay` attribute inside a <dialog>: transparent
// around its panel, it opens from a line of light (or from an edge: overlay="right").
import '../core/index.js';
import { Overlays } from '../behaviors/overlays.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/aperture.js';

defineComponent('overlays', Overlays, 200);
