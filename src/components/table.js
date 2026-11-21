// domloom/table: <table sortable>: rows fly to their new places.
import '../core/index.js';
import { Tables } from '../behaviors/tables.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/table.js';

defineBehavior('tables', Tables, 25);
