// Helpers shared by the behaviours.

export const pad = ([x, y, w, h], px, py = px) => [x - px, y - py, w + 2 * px, h + 2 * py];
export const center = ([x, y, w, h]) => [x + w / 2, y + h / 2];

export const CHOICE = 'input[type=radio], input[type=checkbox]';

export const TEXTUAL =
  'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button])' +
  ':not([type=submit]):not([type=reset]):not([type=hidden]):not([type=color]):not([type=file]), textarea, select';

/** The element the reticle locks onto for something under the pointer or focused. */
export function targetFor(node, root) {
  const hit = node?.closest?.('button, a[href], select, textarea, summary, input, label, [tabindex]');
  if (!hit || !root.contains(hit) || hit === root) return null;
  if (hit.matches('input[type=hidden], [tabindex="-1"]') || hit.disabled) return null;
  if (hit.matches(CHOICE)) return hit.closest('label') ?? hit;
  if (hit.matches('label')) {
    const control = hit.control;
    if (!control || control.disabled) return null;
    return control.matches(CHOICE) ? hit : control;
  }
  return hit;
}

export function pressable(node, root) {
  const hit = node?.closest?.('button, summary, a[href], label');
  if (!hit || !root.contains(hit) || hit.disabled) return null;
  if (hit.matches('label') && !hit.control?.matches(CHOICE)) return null;
  return hit;
}

/** "900ms", "1.2s" or "900" (ms) as ms. */
export function parseMs(value, fallback) {
  if (!value) return fallback;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return value.trim().endsWith('ms') || !value.trim().endsWith('s') ? n : n * 1000;
}
