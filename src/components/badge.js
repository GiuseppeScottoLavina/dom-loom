// domloom/badge: [badge]: a ping when its number changes.
import '../core/index.js';
import { Notices } from '../behaviors/notices.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/badge.js';

defineBehavior('notices', Notices, 31);
