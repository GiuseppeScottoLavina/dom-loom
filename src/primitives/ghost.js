import { definePrimitive } from '../core/primitives.js';

/**
 * A rect that shows the picture from before a change (core/shader.js ghostPicture);
 * never an input target. h.y: crumble zone above the bottom edge (px); h.z: crumble
 * progress; h.w: 1 = the live page shows through the gaps.
 */
export const GHOST = definePrimitive({ kind: 6, name: 'ghost' });
