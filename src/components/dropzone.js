// domloom/dropzone: [dropzone] with a file input: a vortex pulls the panel toward the files.
import '../core/index.js';
import { Drops } from '../behaviors/drops.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/dropzone.js';

defineBehavior('drops', Drops, 27);
