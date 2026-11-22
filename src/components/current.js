// domloom/current: aria-current in a list: pagination, breadcrumbs, steppers.
import '../core/index.js';
import { Currents } from '../behaviors/currents.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/current.js';

defineComponent('currents', Currents, 24);
