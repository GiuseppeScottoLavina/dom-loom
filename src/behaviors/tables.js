
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** A cell's text as a number when it is one ("1,200 m", "-4.5 %", "82"), else NaN. */
const asNumber = (text) => (/^[^\p{L}]*\d[^\p{L}]*$/u.test(text) ? parseFloat(text.replace(/[^\d.-]/g, '')) : NaN);

/**
 * <table sortable>: each header of the first <thead> row sorts the rows of the first
 * <tbody> (by the cells' data-value, or their text; numbers as numbers). The rows fly
 * to their new places. `loom-sort` (cancelable) fires first: cancel it to sort
 * yourself; `loom-sorted` fires once the rows are in their new order.
 */
export class Tables {
  constructor(stage) {
    this.stage = stage;
    this.sorted = [];
    stage.listen('click', (e) => {
      const button = e.target.closest?.('button.loom-sort');
      if (button && stage.source.contains(button)) this.sort(button.closest('th'));
    });
    this.sync();
  }
  sync() {
    for (const table of this.stage.source.querySelectorAll('table[sortable]')) {
      const row = table.tHead?.rows[0];
      if (!row) continue;
      for (const th of row.cells) {
        if (th.hasAttribute('nosort') || th.querySelector(':scope > button.loom-sort')) continue;
        // Sortable headers are buttons: focusable, announced, activated by keyboard.
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'loom-sort';
        button.append(...th.childNodes);
        th.append(button);
      }
    }
  }
  sort(th) {
    const table = th?.closest('table');
    const body = table?.tBodies[0];
    if (!body) return;
    const column = th.cellIndex;
    const direction = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
    const detail = { column, direction, header: th };
    if (!table.dispatchEvent(new CustomEvent('loom-sort', { bubbles: true, cancelable: true, detail }))) return;
    const rows = [...body.rows];
    const key = (row) => {
      const cell = row.cells[column];
      return cell ? (cell.dataset.value ?? cell.textContent.trim()) : '';
    };
    const keys = new Map(rows.map((row) => [row, key(row)]));
    const numbers = rows.every((row) => !Number.isNaN(asNumber(keys.get(row))));
    const sign = direction === 'ascending' ? 1 : -1;
    const order = rows.slice().sort((a, b) => sign * (numbers
      ? asNumber(keys.get(a)) - asNumber(keys.get(b))
      : collator.compare(keys.get(a), keys.get(b))));
    const update = () => {
      for (const other of th.parentElement.cells) if (other !== th) other.removeAttribute('aria-sort');
      th.setAttribute('aria-sort', direction);
      body.append(...order);
      table.dispatchEvent(new CustomEvent('loom-sorted', { bubbles: true, detail: { ...detail, rows: order } }));
    };
    this.sorted.push({ el: th, at: performance.now(), direction });
    this.stage.play('select');
    this.stage.wake();
    this.stage.transition(update, { morph: rows, cut: false });
  }
  step(now) {
    this.sorted = this.sorted.filter((s) => now - s.at < this.stage.skin.durations.ring);
    return this.sorted.length > 0;
  }
  emit(scene, now) {
    for (const s of this.sorted) {
      if (this.stage.visible(s.el)) this.stage.draw('sorted', scene, { el: s.el, rect: this.stage.rectOf(s.el), t: now - s.at, direction: s.direction });
    }
  }
}
