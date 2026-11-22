// domloom/menu: [role=menu] in a stage inside a popover: focus, keys, a light on the item.
import './popover.js';
import { Menus } from '../behaviors/menus.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/menu.js';

defineBehavior('menus', Menus, 28);
