// domloom/tabs: The ARIA tabs pattern, made to work: selection, keyboard, panels, a scoped cut.
import '../core/index.js';
import { Tabs } from '../behaviors/tabs.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/tabs.js';

defineComponent('tabs', Tabs, 23);
