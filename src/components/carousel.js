// domloom/carousel: [carousel] strips: drag, arrows, a bend with speed.
import '../core/index.js';
import { Carousels } from '../behaviors/carousels.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/carousel.js';

defineBehavior('carousels', Carousels, 11);
