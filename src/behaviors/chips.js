
/**
 * Elements with the `removable` attribute (tags, chips, list items) get a remove
 * button. Removing crumbles the element and the rest closes the gap; `loom-remove`
 * fires first on the element (cancelable). New removable elements assemble.
 */
export class Chips {
  constructor(stage) {
    this.stage = stage;
    const root = stage.source;
    const removeFrom = (button) => {
      const chip = button.closest('[removable]');
      if (!chip || !root.contains(chip)) return;
      if (!chip.dispatchEvent(new CustomEvent('loom-remove', { bubbles: true, cancelable: true }))) return;
      // Focus goes to the next chip, or the previous one, so the keyboard stays in the list.
      const peers = [...chip.parentElement.querySelectorAll(':scope > [removable]')];
      const i = peers.indexOf(chip);
      const next = peers[i + 1] ?? peers[i - 1];
      if (chip.contains(document.activeElement)) next?.querySelector('button.loom-remove')?.focus({ preventScroll: true });
      stage.remove(chip);
    };
    stage.listen('click', (e) => {
      const button = e.target.closest?.('button.loom-remove');
      if (button) removeFrom(button);
    });
    stage.listen('keydown', (e) => {
      const button = e.target.closest?.('button.loom-remove');
      if (button && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault();
        removeFrom(button);
      }
    });
    this.sync();
  }
  sync() {
    for (const chip of this.stage.source.querySelectorAll('[removable]')) {
      if (chip.querySelector(':scope > button.loom-remove')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'loom-remove';
      button.setAttribute('aria-label', chip.closest('[toasts]') ? 'Dismiss' : `Remove ${chip.textContent.trim()}`);
      chip.append(button);
    }
  }
  step() {
    return false;
  }
  emit() {}
}
