import { RectSpring, Spring } from '../core/spring.js';

const ITEM = '[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio]';

/**
 * The ARIA menu pattern ([role=menu] with menuitem, menuitemcheckbox, menuitemradio),
 * in a stage inside a popover: when the popover opens the first item takes the focus;
 * the arrow keys, Home, End and a letter move it; the pointer moves it too; choosing an
 * item (click, Enter, Space) toggles a checkbox or radio item and closes the menu;
 * Escape or Tab closes it; the focus goes back to the button that opened it. A light
 * follows the focused item.
 */
export class Menus {
  constructor(stage) {
    this.stage = stage;
    this.marker = { el: null, rect: new RectSpring({ stiffness: 760, damping: 36, epsilon: 0.05 }), alpha: new Spring(0, { stiffness: 300, damping: 30, epsilon: 0.003 }) };
    const root = stage.source;
    const host = stage.closest('[popover], dialog');
    this.host = host;
    const items = (menu) => [...menu.querySelectorAll(ITEM)].filter((i) => i.closest('[role=menu]') === menu && stage.visible(i)
      && !i.disabled && i.getAttribute('aria-disabled') !== 'true');
    const menuOf = (el) => {
      const menu = el?.closest?.('[role=menu]');
      return menu && root.contains(menu) ? menu : null;
    };
    if (host) {
      stage.listenOn(host, 'toggle', (e) => {
        const menu = root.querySelector('[role=menu]');
        if (!menu) return;
        if (e.newState === 'open') {
          this.invoker = document.querySelector(`[popovertarget="${CSS.escape(host.id)}"]`) ?? document.activeElement;
          requestAnimationFrame(() => items(menu)[0]?.focus({ preventScroll: true }));
        } else {
          this.marker.alpha.set(0);
          // Back to the button, unless the user went somewhere else.
          if (!document.activeElement || document.activeElement === document.body || root.contains(document.activeElement)) {
            this.invoker?.focus({ preventScroll: true });
          }
        }
      });
    }
    const close = () => {
      if (host?.matches(':popover-open')) host.hidePopover();
      else if (host?.localName === 'dialog') host.close();
    };
    stage.listen('keydown', (e) => {
      const menu = menuOf(e.target);
      if (!menu) return;
      const list = items(menu);
      const i = list.indexOf(e.target.closest(ITEM));
      let next = null;
      if (e.key === 'ArrowDown') next = list[(i + 1) % list.length];
      else if (e.key === 'ArrowUp') next = list[(i - 1 + list.length) % list.length];
      else if (e.key === 'Home') next = list[0];
      else if (e.key === 'End') next = list[list.length - 1];
      else if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape') e.preventDefault();
        close();
        return;
      } else if (e.key.length === 1 && /\S/.test(e.key)) {
        // A letter: the next item that starts with it.
        const k = e.key.toLowerCase();
        const order = [...list.slice(i + 1), ...list.slice(0, i + 1)];
        next = order.find((item) => item.textContent.trim().toLowerCase().startsWith(k)) ?? null;
      }
      if (!next) return;
      e.preventDefault();
      next.focus({ preventScroll: true });
    });
    stage.listen('pointerover', (e) => {
      const item = e.target.closest?.(ITEM);
      if (item && menuOf(item) && item !== document.activeElement) item.focus({ preventScroll: true });
    });
    stage.listen('focusin', (e) => {
      const item = e.target.closest?.(ITEM);
      if (item && menuOf(item)) this.indicate(item);
    });
    stage.listen('click', (e) => {
      const item = e.target.closest?.(ITEM);
      if (!item || !menuOf(item) || item.disabled || item.getAttribute('aria-disabled') === 'true') return;
      const role = item.getAttribute('role');
      if (role === 'menuitemcheckbox') {
        item.setAttribute('aria-checked', String(item.getAttribute('aria-checked') !== 'true'));
        stage.play('toggle', item.getAttribute('aria-checked') === 'true');
      } else if (role === 'menuitemradio') {
        const group = item.closest('[role=group]') ?? menuOf(item);
        for (const other of group.querySelectorAll('[role=menuitemradio]')) other.setAttribute('aria-checked', String(other === item));
        stage.play('select');
      } else {
        stage.play('select');
      }
      // After the item's own listeners: the menu closes.
      setTimeout(close);
    });
  }
  indicate(item) {
    const to = this.stage.rectOf(item);
    if (this.marker.alpha.x < 0.05) this.marker.rect.snap(to);
    this.marker.rect.set(to);
    this.marker.alpha.set(1);
    this.marker.el = item;
    this.stage.play('hover');
    this.stage.wake();
  }
  step(now, dt) {
    if (this.marker.el?.isConnected && this.marker.alpha.target > 0) this.marker.rect.set(this.stage.rectOf(this.marker.el));
    return this.marker.rect.step(dt) | this.marker.alpha.step(dt);
  }
  emit(scene) {
    const m = this.marker;
    if (m.alpha.x < 0.003 || !this.stage.visible(m.el)) return;
    this.stage.draw('menuitem', scene, { el: m.el, rect: m.rect.rect, alpha: m.alpha.x, motion: m.rect });
  }
}
