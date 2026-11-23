// domloom/loupe: [loupe] elements: a magnifying glass that follows the pointer.
import '../core/index.js';
import { Loupes } from '../behaviors/loupes.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/loupe.js';

defineComponent('loupes', Loupes, 60);
