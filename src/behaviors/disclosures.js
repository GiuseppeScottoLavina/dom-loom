
/**
 * <details>: opening slides what is below down and uncovers the content behind a
 * scan line; closing shuts it upward. The stage does the sliding (it owns the
 * picture from before the change); this behaviour decides when.
 */
export class Disclosures {
  constructor(stage) {
    this.stage = stage;
    const root = stage.source;
    stage.listen('click', (e) => {
      const summary = e.target.closest?.('summary');
      const details = summary?.parentElement;
      if (!details || details.localName !== 'details' || !root.contains(details)) return;
      if (details.querySelector(':scope > summary') !== summary) return;
      // A link or a control inside the summary keeps its own click.
      const inner = e.target.closest('a, button, input, select, textarea, label');
      if (inner && summary.contains(inner) && inner !== summary) return;
      if (!stage.gpu || stage.reduced || e.defaultPrevented) return;
      e.preventDefault();
      stage._disclose(details);
    });
  }
  step() {
    return false;
  }
  emit() {}
}
