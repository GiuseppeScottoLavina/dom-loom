import { Spring } from '../core/spring.js';

const FROM = { center: 0, left: 1, right: 2, top: 3, bottom: 4 };

/**
 * A stage with the `overlay` attribute inside a <dialog> or a [popover]: it opens from
 * a line of light (overlay="left|right|top|bottom" for a drawer that opens from that
 * edge) and, for a dialog, closes the same way before the dialog does. A dialog is
 * closed with motion by Escape, a <form method="dialog"> or a button with
 * command="close" / "request-close"; dialog.close() from a script closes at once.
 * A popover that is dismissed by a click outside closes at once. A popover opened by a
 * button (popovertarget) is anchored to it: below it, or above when there is no room,
 * and it opens from that side.
 */
export class Overlays {
  constructor(stage) {
    this.stage = stage;
    this.host = stage.overlay ? stage.closest('dialog, [popover]') : null;
    this.open = new Spring(1, { stiffness: 170, damping: 22, epsilon: 0.002 });
    this.after = null;
    this.shown = !this.host || this.isOpen();
    if (!this.host) return;
    const host = this.host;
    if (!this.shown) this.open.snap(0);
    this.invoker = null;
    this.side = null;
    if (host.hasAttribute('popover')) {
      // The button that opens it: its anchor (ToggleEvent.source where there is one).
      stage.listenGlobal('click', (e) => {
        const button = e.target.closest?.('[popovertarget]');
        if (button && button.getAttribute('popovertarget') === host.id) this.invoker = button;
      }, { capture: true });
      stage.listenOn(host, 'beforetoggle', (e) => {
        if (e.newState === 'open' && e.source) this.invoker = e.source;
      });
      const follow = () => {
        if (this.shown) this.anchor();
      };
      stage.listenGlobal('scroll', follow, { capture: true, passive: true });
      stage.listenGlobal('resize', follow);
    }
    stage.listenOn(host, 'toggle', (e) => (e.newState === 'open' ? this.opened() : this.closed()));
    // A dialog shown with showModal() or show(): the open attribute appears.
    new MutationObserver(() => (this.isOpen() ? this.opened() : this.closed())).observe(host, { attributes: true, attributeFilter: ['open'] });
    if (host.localName !== 'dialog') return;
    stage.listenOn(host, 'cancel', (e) => {
      e.preventDefault();
      this.close('');
    });
    stage.listenOn(host, 'submit', (e) => {
      if (e.target.method !== 'dialog' || e.defaultPrevented) return;
      e.preventDefault();
      this.close(e.submitter?.value ?? '');
    });
    stage.listenOn(host, 'command', (e) => {
      if (e.command !== 'close' && e.command !== 'request-close') return;
      e.preventDefault();
      this.close(e.source?.value ?? '');
    });
  }
  isOpen() {
    return this.host.localName === 'dialog' ? this.host.open : this.host.matches(':popover-open');
  }
  /** Places an anchored popover next to its button: below, or above if it does not fit. */
  anchor() {
    const host = this.host;
    if (!this.invoker?.isConnected || !host.hasAttribute('popover') || host.hasAttribute('data-unanchored')) return;
    const a = this.invoker.getBoundingClientRect();
    const box = host.getBoundingClientRect();
    const gap = 6;
    const below = a.bottom + gap + box.height <= innerHeight - 8 || a.top - gap - box.height < 8;
    const top = below ? a.bottom + gap : a.top - gap - box.height;
    const left = Math.min(Math.max(a.left, 8), Math.max(8, innerWidth - box.width - 8));
    Object.assign(host.style, { position: 'fixed', inset: 'auto', margin: '0', top: `${top}px`, left: `${left}px` });
    this.side = below ? 3 : 4; // opens from the edge next to the button
  }
  opened() {
    if (this.shown) return;
    this.anchor();
    this.shown = true;
    this.after = null;
    this.open.snap(0).set(1);
    if (this.stage.reduced) this.open.snap(1);
    this.stage.play('open');
    this.stage.wake();
  }
  closed() {
    this.shown = false;
    this.open.snap(0);
  }
  /** Closes the dialog after the overlay has shut. */
  close(value) {
    if (this.after) return;
    const host = this.host;
    if (this.stage.reduced || !this.stage.gpu) {
      host.close(value);
      return;
    }
    this.after = () => host.close(value);
    this.open.set(0);
    this.stage.play('close');
    this.stage.wake();
  }
  step(now, dt) {
    const moving = this.open.step(dt);
    if (this.after && this.open.x < 0.02) {
      const done = this.after;
      this.after = null;
      // Outside the frame callback: closing changes the page.
      setTimeout(done);
    }
    return moving || Boolean(this.after);
  }
  emit(scene) {
    if (!this.host || !this.shown || this.open.x > 0.999) return;
    this.stage.draw('aperture', scene, {
      el: this.host,
      rect: this.stage.rectOf(this.stage.source),
      open: Math.max(0, Math.min(1, this.open.x)),
      from: FROM[this.stage.getAttribute('overlay')] ?? this.side ?? 0,
      closing: Boolean(this.after),
    });
  }
}
