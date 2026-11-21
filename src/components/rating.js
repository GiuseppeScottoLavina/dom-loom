// domloom/rating: [rating] around a radio group: stars.
import '../core/index.js';
import { Ratings } from '../behaviors/ratings.js';
import { defineBehavior } from '../core/behaviors.js';
import '../skins/holo/rating.js';

defineBehavior('ratings', Ratings, 26);
