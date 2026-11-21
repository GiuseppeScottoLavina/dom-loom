// domloom/alert: role="alert": an impact when one appears or changes.
import '../core/index.js';
import { Notices } from '../behaviors/notices.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/alert.js';

defineBehavior('notices', Notices, 31);
