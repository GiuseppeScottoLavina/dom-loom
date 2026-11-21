// Helpers shared by holo's draw hooks.
export const pad = ([x, y, w, h], px, py = px) => [x - px, y - py, w + 2 * px, h + 2 * py];
export const center = ([x, y, w, h]) => [x + w / 2, y + h / 2];
