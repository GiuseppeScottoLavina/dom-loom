// domloom/gauge: <meter> and <progress> (bars and [ring]s): damage trails, gain previews, sweeps.
import '../core/index.js';
import { Gauges } from '../behaviors/gauges.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/gauge.js';

defineBehavior('gauges', Gauges, 22);
