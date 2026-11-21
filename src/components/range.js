// domloom/range: <input type="range"> and [interval] pairs: a liquid fill and a diamond thumb.
import '../core/index.js';
import { Ranges } from '../behaviors/ranges.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/range.js';

defineBehavior('ranges', Ranges, 21);
