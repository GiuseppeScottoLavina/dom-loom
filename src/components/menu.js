// dom-loom/menu: [role=menu] in a stage inside a popover: focus, keys, a light on the item.
import './popover.js';
import { Menus } from '../behaviors/menus.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/menu.js';

defineComponent('menus', Menus, 28);
