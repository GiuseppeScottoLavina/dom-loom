// domloom/toast: [toasts] regions: toasts that count down and crumble.
import '../core/index.js';
import './removable.js';
import { Toasts } from '../behaviors/toasts.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/toast.js';

defineBehavior('toasts', Toasts, 34);
