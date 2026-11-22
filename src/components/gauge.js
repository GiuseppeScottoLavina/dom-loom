// dom-loom/gauge: <meter> and <progress> (bars and [ring]s): damage trails, gain previews, sweeps.
import '../core/index.js';
import { Gauges } from '../behaviors/gauges.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/gauge.js';

defineComponent('gauges', Gauges, 22);
