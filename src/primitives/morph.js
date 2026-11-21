import { definePrimitive } from '../core/primitives.js';

/**
 * An element flying in a transition (drawn by the cut in core/shader.js; the mapper
 * sends a point on it to the element's new place). h.y: dissolve; h.zw: velocity (the
 * streak); r: where it is now; p: its old rect; q: its new rect.
 */
export const MORPH = definePrimitive({ kind: 4, name: 'morph' });
