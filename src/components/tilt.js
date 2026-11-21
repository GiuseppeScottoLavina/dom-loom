// domloom/tilt: [tilt] cards: perspective, a glare and a foil.
import '../core/index.js';
import { Tilts } from '../behaviors/tilts.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/tilt.js';

defineBehavior('tilts', Tilts, 10);
