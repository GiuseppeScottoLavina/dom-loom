// domloom/busy: aria-busy="true": a scan over the placeholder, then the content assembles.
import '../core/index.js';
import { Notices } from '../behaviors/notices.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/busy.js';

defineBehavior('notices', Notices, 31);
