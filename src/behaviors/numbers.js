
/**
 * <input type="number">: stepping (arrow keys, the wheel over a focused field, or a
 * button with aria-controls pointing at it and data-step="1" / "-1") rolls the digits
 * over: the old value leaves, the new one comes in.
 */
export class Numbers {
  constructor(stage) {
    this.stage = stage;
    const root = stage.source;
    const isNumber = (el) => el?.matches?.('input[type=number]') && root.contains(el) && !el.disabled && !el.readOnly;
    stage.listen('keydown', (e) => {
      if (!isNumber(e.target) || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      this.stepBy(e.target, e.key === 'ArrowUp' ? 1 : -1);
    });
    stage.listen('wheel', (e) => {
      if (!isNumber(e.target) || document.activeElement !== e.target || !e.deltaY) return;
      e.preventDefault();
      this.stepBy(e.target, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    stage.listen('click', (e) => {
      const button = e.target.closest?.('button[data-step][aria-controls]');
      if (!button || !root.contains(button)) return;
      const el = root.querySelector(`#${CSS.escape(button.getAttribute('aria-controls'))}`);
      if (isNumber(el)) this.stepBy(el, Number(button.dataset.step) || 1);
    });
  }
  stepBy(el, by) {
    const update = () => {
      const before = el.value;
      if (by > 0) el.stepUp(by);
      else el.stepDown(-by);
      if (el.value === before) return false;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    this.stage._change(el, update, 'roll', by > 0 ? 1 : -1).then((changed) => {
      this.stage.play(changed ? 'tick' : 'error');
    });
  }
  step() {
    return false;
  }
  emit() {}
}
