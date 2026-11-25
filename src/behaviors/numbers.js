/**
 * <input type="number">: stepping (arrow keys, the wheel over a focused field, or a
 * button with aria-controls pointing at it and data-step="1" / "-1") rolls the digits
 * over: the old value leaves, the new one comes in.
 *
 * A field with a step steps as the browser does: data-step on a button is a number of
 * steps. A field with step="any" has no step of its own: data-step on a button is the
 * amount in the field's units, and data-step-by on the field is the amount of an arrow
 * key or a wheel notch (1 by default). See stepFree.
 */
export class Numbers {
  constructor(stage) {
    this.stage = stage;
    const root = stage.source;
    const isNumber = (el) => el?.matches?.('input[type=number]') && root.contains(el) && !el.disabled && !el.readOnly;
    stage.listen('keydown', (e) => {
      if (!isNumber(e.target) || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const sign = e.key === 'ArrowUp' ? 1 : -1;
      this.stepBy(e.target, sign, sign * stepByOf(e.target));
    });
    stage.listen('wheel', (e) => {
      if (!isNumber(e.target) || document.activeElement !== e.target || !e.deltaY) return;
      e.preventDefault();
      const sign = e.deltaY < 0 ? 1 : -1;
      this.stepBy(e.target, sign, sign * stepByOf(e.target));
    }, { passive: false });
    stage.listen('click', (e) => {
      const button = e.target.closest?.('button[data-step][aria-controls]');
      if (!button || !root.contains(button)) return;
      const el = root.querySelector(`#${CSS.escape(button.getAttribute('aria-controls'))}`);
      if (isNumber(el)) this.stepBy(el, Number(button.dataset.step) || 1);
    });
  }

  /**
   * Steps `el`: `by` steps of its step, or, when it has none (step="any"), `amount` in its
   * units (the same number for a button's data-step).
   */
  stepBy(el, by, amount = by) {
    const update = () => {
      const before = el.value;
      if (!stepNative(el, by)) {
        const min = parseFloat(el.min);
        const max = parseFloat(el.max);
        const next = stepFree(el.valueAsNumber, amount, {
          min: Number.isFinite(min) ? min : -Infinity,
          max: Number.isFinite(max) ? max : Infinity,
          base: Number.isFinite(min) ? min : 0,
        });
        if (Number.isFinite(next)) el.value = String(next);
      }
      if (el.value === before) return false;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    this.stage._change(el, update, 'roll', amount > 0 ? 1 : -1).then((changed) => {
      this.stage.play(changed ? 'tick' : 'error');
    });
  }
  step() {
    return false;
  }
  emit() {}
}

/** The amount of an arrow key or a wheel notch on a field with step="any": data-step-by, else 1. */
function stepByOf(el) {
  return Math.abs(Number(el.dataset.stepBy)) || 1;
}

/**
 * The browser's own stepping, for a field that has an allowed step. False (and nothing
 * done) when it has none: step="any" (the only value that removes it; an invalid step
 * falls back to 1), or the browser refuses.
 */
function stepNative(el, by) {
  if (el.getAttribute('step')?.trim().toLowerCase() === 'any') return false;
  try {
    if (by > 0) el.stepUp(by);
    else el.stepDown(-by);
    return true;
  } catch {
    return false;
  }
}

/** Decimal places of a number as JavaScript writes it (0.25 → 2, 1e-7 → 7). */
function decimals(x) {
  const [mantissa, exponent = '0'] = String(x).toLowerCase().split('e');
  return Math.max(0, (mantissa.split('.')[1] ?? '').length - Number(exponent));
}

/**
 * One step of a field without a step of its own (step="any"): from `value` to the next
 * multiple of `amount` (counted from `base`) in its direction, so 105 + 10 is 110, within
 * `min` and `max`. The result keeps the decimals of `amount` and `base` (0.2 + 0.1 is 0.3).
 * An empty field (NaN) counts as 0 and a value already at or past the limit in the
 * direction of the step stays as it is, as with the browser's stepUp and stepDown.
 * @param {number} value
 * @param {number} amount  signed, in the field's units
 * @param {{min?: number, max?: number, base?: number}} [range]
 * @returns {number}
 */
export function stepFree(value, amount, { min = -Infinity, max = Infinity, base = 0 } = {}) {
  const size = Math.abs(amount);
  if (!(size > 0) || !Number.isFinite(size)) return value;
  const from = Number.isFinite(value) ? value : 0;
  if ((amount > 0 && from >= max) || (amount < 0 && from <= min)) return value;
  const n = (from - base) / size;
  const nearest = Math.round(n);
  const onGrid = Math.abs(n - nearest) < 1e-9 * Math.max(1, Math.abs(n));
  const k = amount > 0 ? (onGrid ? nearest + 1 : Math.ceil(n)) : (onGrid ? nearest - 1 : Math.floor(n));
  const places = Math.min(100, Math.max(decimals(size), decimals(base)));
  const next = Number((base + k * size).toFixed(places));
  return Math.min(max, Math.max(min, next));
}
