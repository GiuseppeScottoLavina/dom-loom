// dom-loom/range: <input type="range"> and [interval] pairs: a liquid fill and a diamond thumb.
import '../core/index.js';
import { Ranges } from '../behaviors/ranges.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/range.js';

defineComponent('ranges', Ranges, 21);
