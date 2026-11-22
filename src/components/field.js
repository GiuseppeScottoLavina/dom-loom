// dom-loom/field: Text fields: a scan on focus, a pulse while typing, a glitch when invalid.
import '../core/index.js';
import { Fields } from '../behaviors/fields.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/field.js';

defineComponent('fields', Fields, 40);
