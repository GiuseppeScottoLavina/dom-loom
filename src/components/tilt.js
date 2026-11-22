// dom-loom/tilt: [tilt] cards: perspective, a glare and a foil.
import '../core/index.js';
import { Tilts } from '../behaviors/tilts.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/tilt.js';

defineComponent('tilts', Tilts, 10);
