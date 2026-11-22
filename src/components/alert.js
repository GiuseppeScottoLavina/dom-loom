// dom-loom/alert: role="alert": an impact when one appears or changes.
import '../core/index.js';
import { Notices } from '../behaviors/notices.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/alert.js';

defineComponent('notices', Notices, 31);
