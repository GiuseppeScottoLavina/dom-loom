// domloom/split: [split] with an <hr>: a window splitter whose panes stretch like rubber.
import '../core/index.js';
import { Splits } from '../behaviors/splits.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/split.js';

defineBehavior('splits', Splits, 12);
