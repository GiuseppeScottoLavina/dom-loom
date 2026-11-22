// dom-loom/rating: [rating] around a radio group: stars.
import '../core/index.js';
import { Ratings } from '../behaviors/ratings.js';
import { defineComponent } from '../core/behaviors.js';
import '../skins/holo/rating.js';

defineComponent('ratings', Ratings, 26);
