// domloom/current: aria-current in a list: pagination, breadcrumbs, steppers.
import '../core/index.js';
import { Currents } from '../behaviors/currents.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/current.js';

defineBehavior('currents', Currents, 24);
