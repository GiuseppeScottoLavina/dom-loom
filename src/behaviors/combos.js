import { createListElement } from '../core/list-elements.js';
import { RectSpring, Spring } from '../core/spring.js';

let comboIds = 0;

/**
 * <input list="…"> with its <datalist>: instead of the browser's popup (which a
 * canvas cannot draw), a listbox opens under the field inside the stage, filtered
 * as you type, driven by the arrow keys, Enter and Escape (the ARIA combobox
 * pattern). It unfolds and folds with motion.
 */
export class Combos {
  constructor(stage) {
    this.stage = stage;
    this.combos = new Map();
    this.active = null; // the open combo
    this.marker = { el: null, rect: new RectSpring({ stiffness: 700, damping: 34, epsilon: 0.05 }), alpha: new Spring(0, { stiffness: 300, damping: 30, epsilon: 0.003 }) };
    const root = stage.source;
    const comboOf = (el) => this.combos.get(el);
    stage.listen('input', (e) => {
      const c = comboOf(e.target);
      if (c && !c.picking) this.filter(c, true);
    });
    stage.listen('focusin', (e) => {
      const c = comboOf(e.target);
      if (c && e.target.value === '') this.filter(c, true);
    });
    stage.listen('focusout', (e) => {
      const c = comboOf(e.target);
      if (c && !c.list.contains(e.relatedTarget)) this.close(c);
    });
    stage.listen('keydown', (e) => {
      const c = comboOf(e.target);
      if (!c) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!c.open) this.filter(c, true);
        else this.move(c, e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter' && c.open && c.index >= 0) {
        e.preventDefault();
        this.pick(c, c.options[c.index]);
      } else if (e.key === 'Escape' && c.open) {
        e.preventDefault();
        this.close(c);
      }
    });
    // Picking with the pointer must not take the focus from the field.
    stage.listen('pointerdown', (e) => {
      if (e.target.closest?.('.loom-listbox') && root.contains(e.target)) e.preventDefault();
    });
    stage.listen('click', (e) => {
      const option = e.target.closest?.('.loom-listbox [role=option]');
      const c = option && [...this.combos.values()].find((x) => x.list.contains(option));
      if (c) this.pick(c, option);
    });
    stage.listen('pointerover', (e) => {
      const option = e.target.closest?.('.loom-listbox [role=option]');
      const c = option && [...this.combos.values()].find((x) => x.list.contains(option));
      if (c) this.highlight(c, c.options.indexOf(option));
    });
    this.sync();
  }
  sync() {
    for (const input of this.stage.source.querySelectorAll('input[list]')) {
      const datalist = input.list ?? document.getElementById(input.getAttribute('list'));
      if (!datalist) continue;
      // The browser's popup is not drawn into a canvas: the stage shows its own.
      input.dataset.loomList = input.getAttribute('list');
      input.removeAttribute('list');
      const list = createListElement('ul');
      list.className = 'loom-listbox';
      list.id = `loom-listbox-${++comboIds}`;
      list.setAttribute('role', 'listbox');
      list.hidden = true;
      (input.closest('label') ?? input).after(list);
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('aria-controls', list.id);
      input.autocomplete = 'off';
      this.combos.set(input, { input, datalist, list, options: [], index: -1, open: false });
    }
    for (const [input, c] of this.combos) if (!input.isConnected) this.combos.delete(input) && c.list.remove();
  }
  filter(c, openIt) {
    const query = c.input.value.trim().toLowerCase();
    const values = [...c.datalist.options].map((o) => o.value).filter((v) => v.toLowerCase().includes(query) && v.toLowerCase() !== query);
    // Nothing to offer: fold the list as it is (its picture is what folds away).
    if (!values.length) {
      this.close(c);
      return;
    }
    c.list.replaceChildren(...values.map((value, i) => {
      const li = createListElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.id = `${c.list.id}-${i}`;
      li.textContent = value;
      return li;
    }));
    c.options = [...c.list.children];
    c.index = -1;
    c.input.removeAttribute('aria-activedescendant');
    if (openIt && !c.open) this.open(c);
    this.marker.alpha.set(0);
    this.stage.wake();
  }
  place(c) {
    // Under the field, as wide as it; above it when there is no room in the stage.
    const field = this.stage.rectOf(c.input);
    const parent = c.list.offsetParent ?? this.stage.source;
    const origin = parent.getBoundingClientRect();
    const box = c.input.getBoundingClientRect();
    const height = c.list.offsetHeight;
    const room = this.stage.source.getBoundingClientRect().height - (field[1] + field[3]);
    const above = height > room - 8 && field[1] > height + 8;
    Object.assign(c.list.style, {
      left: `${box.left - origin.left}px`,
      top: `${(above ? box.top - height - 4 : box.bottom + 4) - origin.top}px`,
      width: `${box.width}px`,
    });
  }
  open(c) {
    if (this.active && this.active !== c) this.close(this.active);
    c.open = true;
    this.active = c;
    this.stage.play('open');
    this.stage._change(c.list, () => {
      c.list.hidden = false;
      this.place(c);
      c.input.setAttribute('aria-expanded', 'true');
    }, 'unfold');
  }
  close(c) {
    if (!c.open) return;
    c.open = false;
    if (this.active === c) this.active = null;
    this.marker.alpha.set(0);
    this.stage.play('close');
    this.stage._change(c.list, () => {
      c.list.hidden = true;
      c.input.setAttribute('aria-expanded', 'false');
      c.input.removeAttribute('aria-activedescendant');
    }, 'fold');
  }
  highlight(c, index) {
    const option = c.options[index];
    if (!option || c.index === index) return;
    c.options[c.index]?.setAttribute('aria-selected', 'false');
    option.setAttribute('aria-selected', 'true');
    c.index = index;
    c.input.setAttribute('aria-activedescendant', option.id);
    const to = this.stage.rectOf(option);
    if (this.marker.alpha.x < 0.05 || this.marker.el?.parentElement !== c.list) this.marker.rect.snap(to);
    this.marker.rect.set(to);
    this.marker.alpha.set(1);
    this.marker.el = option;
    this.stage.play('hover');
    this.stage.wake();
  }
  move(c, by) {
    const n = c.options.length;
    if (n) this.highlight(c, (c.index + by + n) % n);
  }
  pick(c, option) {
    this.close(c);
    c.picking = true;
    c.input.value = option.textContent;
    c.input.dispatchEvent(new Event('input', { bubbles: true }));
    c.input.dispatchEvent(new Event('change', { bubbles: true }));
    c.picking = false;
    this.stage.play('select');
  }
  step(now, dt) {
    if (this.marker.el?.isConnected && this.marker.alpha.target > 0) this.marker.rect.set(this.stage.rectOf(this.marker.el));
    return this.marker.rect.step(dt) | this.marker.alpha.step(dt);
  }
  emit(scene) {
    const m = this.marker;
    if (m.alpha.x < 0.003 || !this.stage.visible(m.el)) return;
    this.stage.draw('option', scene, { el: m.el, rect: m.rect.rect, alpha: m.alpha.x, motion: m.rect });
  }
}
