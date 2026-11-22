import { createListElement } from '../core/list-elements.js';
import { RectSpring, Spring } from '../core/spring.js';

let selectIds = 0;

/**
 * <select> (one value, no size): a pointer opens a listbox under it inside the stage
 * instead of the browser's popup, which a canvas cannot draw. The keyboard and screen
 * readers keep the select's own behaviour and popup, which are fully accessible;
 * while the stage's list is open, the arrow keys, Enter and Escape drive it.
 */
export class Selects {
  constructor(stage) {
    this.stage = stage;
    this.lists = new Map();
    this.active = null;
    this.marker = { el: null, rect: new RectSpring({ stiffness: 700, damping: 34, epsilon: 0.05 }), alpha: new Spring(0, { stiffness: 300, damping: 30, epsilon: 0.003 }) };
    const root = stage.source;
    const own = (el) => this.lists.get(el);
    stage.listen('pointerdown', (e) => {
      const select = e.target.closest?.('select');
      const s = own(select);
      if (!s || e.button !== 0 || select.disabled) return;
      // The browser's popup would open on this press: the stage's list opens instead.
      e.preventDefault();
      select.focus({ preventScroll: true });
      if (s.open) this.close(s);
      else this.open(s);
    });
    stage.listen('keydown', (e) => {
      const s = own(e.target);
      if (!s?.open) return;
      const n = s.options.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.highlight(s, (s.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.pick(s, s.options[s.index]);
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape') e.preventDefault();
        this.close(s);
      }
    });
    stage.listen('focusout', (e) => {
      const s = own(e.target);
      if (s?.open && !s.list.contains(e.relatedTarget)) this.close(s);
    });
    stage.listen('pointerdown', (e) => {
      if (e.target.closest?.('.loom-listbox[data-for-select]') && root.contains(e.target)) e.preventDefault();
    });
    stage.listen('click', (e) => {
      const option = e.target.closest?.('.loom-listbox[data-for-select] [role=option]');
      const s = option && [...this.lists.values()].find((x) => x.list.contains(option));
      if (s && option.getAttribute('aria-disabled') !== 'true') this.pick(s, option);
    });
    stage.listen('pointerover', (e) => {
      const option = e.target.closest?.('.loom-listbox[data-for-select] [role=option]');
      const s = option && [...this.lists.values()].find((x) => x.list.contains(option));
      if (s) this.highlight(s, s.options.indexOf(option));
    });
    this.sync();
  }
  sync() {
    for (const select of this.stage.source.querySelectorAll('select:not([multiple])')) {
      if (this.lists.has(select) || select.size > 1) continue;
      const list = createListElement('ul');
      list.className = 'loom-listbox';
      list.id = `loom-select-${++selectIds}`;
      list.dataset.forSelect = '';
      // The keyboard and screen readers use the select itself: this list is the pointer's.
      list.setAttribute('aria-hidden', 'true');
      list.hidden = true;
      (select.closest('label') ?? select).after(list);
      this.lists.set(select, { select, list, options: [], index: -1, open: false });
    }
    for (const [select, s] of this.lists) if (!select.isConnected) this.lists.delete(select) && s.list.remove();
  }
  render(s) {
    s.list.replaceChildren(...[...s.select.options].map((o) => {
      const li = createListElement('li');
      li.setAttribute('role', 'option');
      li.textContent = o.label;
      li.dataset.value = o.value;
      if (o.disabled) li.setAttribute('aria-disabled', 'true');
      if (o.selected) li.setAttribute('aria-selected', 'true');
      return li;
    }));
    s.options = [...s.list.children];
    s.index = s.select.selectedIndex;
  }
  place(s) {
    const parent = s.list.offsetParent ?? this.stage.source;
    const origin = parent.getBoundingClientRect();
    const box = s.select.getBoundingClientRect();
    const height = s.list.offsetHeight;
    const room = this.stage.source.getBoundingClientRect().bottom - box.bottom;
    const above = height > room - 8 && box.top - this.stage.source.getBoundingClientRect().top > height + 8;
    Object.assign(s.list.style, {
      left: `${box.left - origin.left}px`,
      top: `${(above ? box.top - height - 4 : box.bottom + 4) - origin.top}px`,
      width: `${box.width}px`,
    });
  }
  open(s) {
    if (this.active && this.active !== s) this.close(this.active);
    s.open = true;
    this.active = s;
    this.render(s);
    this.stage.play('open');
    this.stage._change(s.list, () => {
      s.list.hidden = false;
      this.place(s);
    }, 'unfold').then(() => this.highlight(s, s.index));
  }
  close(s) {
    if (!s.open) return;
    s.open = false;
    if (this.active === s) this.active = null;
    this.marker.alpha.set(0);
    this.stage.play('close');
    this.stage._change(s.list, () => {
      s.list.hidden = true;
    }, 'fold');
  }
  highlight(s, index) {
    const option = s.options[index];
    if (!option || !s.open) return;
    s.index = index;
    const to = this.stage.rectOf(option);
    if (this.marker.alpha.x < 0.05 || this.marker.el?.parentElement !== s.list) this.marker.rect.snap(to);
    this.marker.rect.set(to);
    this.marker.alpha.set(1);
    this.marker.el = option;
    this.stage.wake();
  }
  pick(s, option) {
    if (!option) return;
    const changed = s.select.value !== option.dataset.value;
    s.select.value = option.dataset.value;
    this.close(s);
    if (changed) {
      s.select.dispatchEvent(new Event('input', { bubbles: true }));
      s.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
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
