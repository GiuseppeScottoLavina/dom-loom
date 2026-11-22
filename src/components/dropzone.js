// dom-loom/dropzone: [dropzone] with a file input: a vortex pulls the panel toward the files.
import '../core/index.js';
import { Drops } from '../behaviors/drops.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/dropzone.js';

defineComponent('drops', Drops, 27);
