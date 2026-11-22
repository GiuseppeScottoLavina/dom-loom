// domloom/table: <table sortable>: rows fly to their new places.
import '../core/index.js';
import { Tables } from '../behaviors/tables.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/table.js';

defineComponent('tables', Tables, 25);
