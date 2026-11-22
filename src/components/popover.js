// domloom/popover: a stage with the `overlay` attribute inside a <div popover>: transparent
// around its panel, it opens from a line of light (or from an edge: overlay="right").
import '../core/index.js';
import { Overlays } from '../behaviors/overlays.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/aperture.js';

defineBehavior('overlays', Overlays, 200);
