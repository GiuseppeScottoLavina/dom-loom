import { isListMutation } from './list-elements.js';
import { scheduleLazyStage } from './lazy-stage.js';
import { behaviorList } from './behaviors.js';
import { createCompositor } from './compositor.js';
import { GHOST } from '../primitives/ghost.js';
import { MATERIALIZE } from '../primitives/materialize.js';
import { MORPH } from '../primitives/morph.js';
import { ROLL } from '../primitives/roll.js';
import { SHIFT } from '../primitives/shift.js';
import { primitives } from './primitives.js';
import { FIELD_COLS, FIELD_ROWS, Scene, U, UNIFORM_FLOATS } from './scene.js';
import { loadRuntime, sharedDevice } from './runtime.js';
import { audio } from './audio.js';
import { getSkin } from './skin.js';
import { clamp01, easeInOutCubic, easeOutBack, easeOutCubic } from './spring.js';

const ElementBase = globalThis.HTMLElement ?? class {};
const BELOW = 1e5;
const VALUE_ATTRIBUTES = new Set(['value', 'max', 'min', 'low', 'high', 'optimum']);
const ZERO4 = [0, 0, 0, 0];

function changesControls(record) {
  if (record.type === 'attributes') return !VALUE_ATTRIBUTES.has(record.attributeName);
  if (record.type !== 'childList') return false;
  for (const node of record.addedNodes) if (node.nodeType === 1) return true;
  for (const node of record.removedNodes) if (node.nodeType === 1) return true;
  return false;
}

function union(rects) {
  if (!rects.length) return null;
  const l = Math.min(...rects.map((r) => r[0]));
  const t = Math.min(...rects.map((r) => r[1]));
  const r = Math.max(...rects.map((r) => r[0] + r[2]));
  const b = Math.max(...rects.map((r) => r[1] + r[3]));
  return [l, t, r - l, b - t];
}

const FLIGHT_MS = 720;
const MAX_KEYED = 12;
const MAX_MOVERS = 48;
const EXIT_MS = 420;
const ARM_MS = 4000;
const ROLL_MS = 260;
const ARRIVE_MS = 520;
const UNFOLD_MS = 240;

/** Where a keyed element is, `ms` into its flight from a to b: an arc, not a line. */
function flight(a, b, index, ms) {
  const k = clamp01(ms / FLIGHT_MS);
  const m = easeOutBack(k, 1.1);
  const r = [0, 1, 2, 3].map((j) => a[j] + (b[j] - a[j]) * m);
  const dx = b[0] + b[2] / 2 - a[0] - a[2] / 2;
  const dy = b[1] + b[3] / 2 - a[1] - a[3] / 2;
  const dist = Math.hypot(dx, dy);
  if (dist > 1) {
    // Alternate sides, so that several flights fan out instead of stacking.
    const lift = Math.sin(Math.PI * clamp01(m)) * Math.min(dist * 0.22, 90) * (index % 2 ? -1 : 1);
    r[0] += (-dy / dist) * lift;
    r[1] += (dx / dist) * lift;
  }
  return r;
}

async function painted(compositor, version, signal, height) {
  if (!(await compositor.waitForSource(version, 600, signal, height)) || signal.aborted) return false;
  // Give the polyfill one more frame to present the new picture.
  return new Promise((resolve) => {
    const id = requestAnimationFrame(() => {
      signal.removeEventListener('abort', abort);
      resolve(true);
    });
    const abort = () => {
      cancelAnimationFrame(id);
      resolve(false);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function parseRgb(value) {
  const m = value.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map((n) => Number(n) / 255) : [1, 1, 1];
}

function moveSource(parent, source, before = null) {
  const root = source.getRootNode();
  if (parent.moveBefore && source.isConnected && parent.isConnected && root === parent.getRootNode()) {
    parent.moveBefore(source, before);
    return;
  }
  let active = root.activeElement;
  if (!active || !source.contains(active)) active = null;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  parent.insertBefore(source, before);
  const doc = source.ownerDocument;
  if (active?.isConnected && (!doc.activeElement || doc.activeElement === doc.body)) active.focus({ preventScroll: true });
}

/**
 * <loom-stage>: a region of ordinary HTML drawn through one WebGPU compositor.
 * The children stay the real, accessible, focusable elements; the stage adds motion
 * and light on top and maps the pointer through whatever the picture does.
 */
export class LoomStage extends ElementBase {
  #source = null;
  #canvas = null;
  #host = null;
  #compositor = null;
  #behaviors = [];
  #instances = new Map();
  #listeners = null;
  #scene = new Scene();
  #uniforms = new Float32Array(UNIFORM_FLOATS);
  #animating = false;
  #domFrame = 0;
  #lastDomFrame = null;
  #transition = null;
  #visual = null;
  #queuedUpdates = 0;
  #reflow = null;
  #armed = null;
  #changes = []; // rolls and overlay unfolds: pictures from before a change, animated
  #arrivals = []; // elements assembling block by block
  #flights = [];
  #boot = null;
  #allowed = null;
  #colors = null;
  #ctx = null;
  #sourceRect = null;
  #scale = { rect: null, x: 1, y: 1 };
  #observers = [];
  #generation = 0;
  #audio = false;
  #syncFrame = 0;
  #fullSync = false;
  #registryWake = null;
  #customSync = [];
  #contentSync = [];
  #dirtyControls = new Map();
  #ready = Promise.resolve('dom');
  #startEnhancement = null;
  #press = null; // the last pointer press: where an exit bursts from
  #motion = null;

  /**
   * A displacement field for behaviours to write: a grid of cols x rows vec2 in CSS px
   * (row by row, x then y) over the whole canvas. While `active` is false the shader
   * ignores it. Call changed() after writing: it uploads the grid and wakes the stage.
   */
  field = {
    cols: FIELD_COLS,
    rows: FIELD_ROWS,
    data: new Float32Array(FIELD_COLS * FIELD_ROWS * 2),
    active: false,
    dirty: true, // @internal: the compositor uploads the grid when this is set
    changed: () => {
      this.field.dirty = true;
      this.wake();
    },
  };

  static get observedAttributes() {
    return ['skin', 'loading'];
  }

  attributeChangedCallback(name) {
    if (name === 'skin' && this.#source) this.#restyle();
    if (name === 'loading' && this.getAttribute('loading') !== 'lazy') this.#startEnhancement?.();
  }

  /** A stage in a dialog or a popover: transparent around its panel (the `overlay` attribute). */
  get overlay() {
    return this.hasAttribute('overlay');
  }

  /**
   * Sets the `overlay` attribute: true or '' for a line of light, 'left', 'right', 'top' or
   * 'bottom' for an edge; false or null removes it. Frameworks that set properties (React 19,
   * Vue) go through here.
   */
  set overlay(value) {
    if (value === false || value == null) this.removeAttribute('overlay');
    else this.setAttribute('overlay', value === true ? '' : String(value));
  }

  /** Adds a listener on another element that is removed with the stage. */
  listenOn(target, type, listener, options = {}) {
    target.addEventListener(type, listener, { ...options, signal: this.#listeners.signal });
  }

  /** @internal Observe a component's host for the lifetime of this connection. */
  observe(target, options, callback) {
    const observer = new MutationObserver(callback);
    observer.observe(target, options);
    this.#observers.push(observer);
  }

  /** The skin that draws this stage: its `skin` attribute, or the default one. */
  get skin() {
    return getSkin(this.getAttribute('skin'));
  }

  /** Sets the `skin` attribute to a skin's name (null removes it: the default skin). */
  set skin(name) {
    if (name == null || name === false || name === '') this.removeAttribute('skin');
    else this.setAttribute('skin', typeof name === 'object' ? name.name : String(name));
  }

  /** The element that holds the stage's content (it moves into the canvas on the GPU path). */
  get source() {
    return this.#source;
  }
  /** Resolves with 'webgpu' once the compositor draws the stage, or 'dom'. */
  get ready() {
    this.#startEnhancement?.();
    return this.#ready;
  }
  get gpu() {
    return Boolean(this.#compositor);
  }
  get reduced() {
    return Boolean(this.#motion?.matches);
  }

  connectedCallback() {
    if (!this.#source) {
      const existing = this.querySelector(':scope > .loom-source, :scope > canvas > .loom-source');
      this.#source = existing ?? document.createElement('div');
      if (!existing) {
        this.#source.className = 'loom-source';
        this.#source.append(...this.childNodes);
        this.append(this.#source);
      }
    }
    this.dataset.renderer = 'dom';
    this.#motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.#listeners = new AbortController();
    this.#readColors();
    this.listenOn(this.#motion, 'change', () => this.wake());

    // A skin registered later, or redefined, applies at once.
    document.addEventListener('loom-skin', (e) => {
      if (e.detail?.name !== this.skin?.name) return;
      if (e.detail.hooksOnly) this.#wakeAfterRegistration();
      else this.#restyle();
    }, { signal: this.#listeners.signal });
    this.listen('pointerdown', (e) => {
      this.#unlockAudio();
      this.#press = { point: this.pointOf(e), at: performance.now() };
    }, { capture: true });
    this.listen('keydown', () => this.#unlockAudio(), { capture: true });
    this.listen('click', (e) => this.#guardHold(e), { capture: true });
    const connection = this.#listeners.signal;
    this.listen('reset', () => setTimeout(() => {
      if (!connection.aborted) this.#sync();
    }), { capture: true });

    this.#instances = new Map();
    this.#behaviors = [];
    this.#customSync = [];
    this.#contentSync = [];
    for (const [name, definition] of behaviorList()) this.#installBehavior(name, definition, this.#behaviors.length);
    // A component imported later (a lazy chunk) joins the stages already running.
    document.addEventListener('loom-behaviors', ({ detail }) => {
      this.#installBehavior(detail.name, detail.definition, detail.index, true);
      this.#wakeAfterRegistration();
    }, { signal: this.#listeners.signal });

    for (const button of this.#source.querySelectorAll('button[hold]')) this.#describeHold(button);
    this.#observe();
    const generation = ++this.#generation;
    if (this.getAttribute('loading') === 'lazy' && typeof this.ownerDocument?.defaultView?.IntersectionObserver === 'function') {
      this.#startEnhancement = scheduleLazyStage(this, () => {
        this.#startEnhancement = null;
        this.#ready = this.#enhance(generation);
      }, connection);
    } else {
      this.#ready = this.#enhance(generation);
    }
  }

  disconnectedCallback() {
    ++this.#generation;
    this.#startEnhancement = null;
    this.#listeners?.abort();
    for (const o of this.#observers) o.disconnect();
    this.#observers = [];
    cancelAnimationFrame(this.#syncFrame);
    this.#syncFrame = 0;
    this.#fullSync = false;
    this.#dirtyControls.clear();
    cancelAnimationFrame(this.#domFrame);
    this.#domFrame = 0;
    this.#lastDomFrame = null;
    this.#release();
  }

  /** Adds a listener on the stage that is removed with it. */
  listen(type, listener, options = {}) {
    this.addEventListener(type, listener, { ...options, signal: this.#listeners.signal });
  }

  /**
   * Adds a listener on the window that is removed with the stage: for the end of a
   * gesture, which may happen outside the stage.
   */
  listenGlobal(type, listener, options = {}) {
    globalThis.addEventListener(type, listener, { ...options, signal: this.#listeners.signal });
  }

  /**
   * Where an element is shown inside the stage, in the canvas's CSS pixels: its
   * layout rect, carried along while it (or an ancestor) flies in a transition.
   */
  rectOf(el) {
    const rect = this.#layoutRect(el);
    for (const f of this.#flights) {
      if (f.el !== el && !f.el.contains(el)) continue;
      const sx = f.now[2] / f.to[2];
      const sy = f.now[3] / f.to[3];
      return [f.now[0] + (rect[0] - f.to[0]) * sx, f.now[1] + (rect[1] - f.to[1]) * sy, rect[2] * sx, rect[3] * sy];
    }
    return rect;
  }

  /** Whether an element of the stage is drawn: connected, rendered, not visibility:hidden. */
  visible(el) {
    if (!el?.isConnected) return false;
    return el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : true;
  }

  /** A pointer event's point as the user sees it, in the canvas's CSS pixels. */
  pointOf(event) {
    const box = (this.#canvas ?? this.#source).getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }

  /** Where a visible point of the stage is in the live content; null over no element. */
  mapPoint(point) {
    if (!this.#host) return { ...point };
    const mapped = this.#host.mapPoint(point);
    return mapped;
  }

  play(name, ...args) {
    if (this.#audio && this.hasAttribute('sound')) this.skin?.sounds[name]?.(...args);
  }

  /** Has the skin draw one state of a control into the scene (behaviours call this). */
  draw(name, scene, state) {
    // While a transition waits for the new picture, the old one is shown: lights of
    // elements that are about to fly would sit at their new places over it.
    const t = this.#transition;
    if (t?.ghosted && t.pending && t.movers && state.el && t.movers.some((m) => m === state.el || m.contains(state.el))) return;
    this.skin?.draw[name]?.(scene, state, this.#ctx);
  }

  buzz(ms) {
    if (this.hasAttribute('haptics')) navigator.vibrate?.(ms);
  }

  /** Clicks a control as the user would, past the hold guard. */
  activate(el) {
    this.#allowed = el;
    try {
      el.click();
    } finally {
      this.#allowed = null;
    }
  }

  /** Asks for frames until every behaviour rests. */
  wake() {
    this.#animating = true;
    if (this.#compositor) {
      this.#compositor.requestRender();
    } else if (!this.#domFrame) {
      this.#domFrame = requestAnimationFrame(this.#domTick);
    }
  }

  /**
   * Changes the content with a cut: like document.startViewTransition(update), but
   * drawn by the compositor, with the content live and clickable while it plays.
   * Elements with the same view-transition-name (or data-morph) before and after
   * fly from the old place to the new one.
   *
   * Options:
   * - scope: an element or a list of them; only that region is cut.
   * - direction: 1 (the blade runs left to right) or -1.
   * - morph: a list of elements that fly from where they were to where they are
   *   (a reorder, a move); with it, the names of the rest of the stage are ignored.
   * - cut: false to have no blade: only the elements fly.
   * - style: the name of a registered primitive with a `cut` capability, drawn in place
   *   of the blade (an unknown name keeps the blade).
   * - exit: the name of a registered exit style (a primitive with an `exit` capability:
   *   'shatter') for the elements of `morph` that the update removes; they crumble by default.
   * - sound: the skin's sound to play.
   */
  async transition(update, { scope = null, direction = 1, morph = null, cut = true, sound = null, style = null, exit = null } = {}) {
    const compositor = this.#compositor;
    this.#finishVisual();
    if (!this.#canPresent()) {
      await this.#withoutVisual(update);
      return;
    }
    const scopes = scope ? [scope].flat().filter(Boolean) : null;
    const movers = morph ? [...morph] : null;
    const measure = () => (movers ? this.#measured(movers) : scopes ? new Map() : this.#keyed());
    const before = measure();
    const scopeBefore = scopes ? this.#rectsOf(scopes) : [];
    const cutStyle = style ? primitives.all().find((d) => d.name === style && d.cut) : null;
    const transition = {
      start: NaN, pending: true, ghosted: false, pairs: [], exits: [], movers, resolve: null, cut: cut !== false,
      exit: exit ? primitives.all().find((d) => d.exit?.name === exit) ?? null : null, exitFx: [],
      scope: null, direction: direction < 0 ? -1 : 1,
      style: cutStyle?.kind ?? 0,
      // A style may run slower than the blade (a page turn needs time to be seen): its pace scales the skin's time.
      ms: (scopes ? this.skin.transition.scopedMs : this.skin.transition.ms) * (cutStyle?.cut.pace ?? 1),
      band: this.skin.transition.band, slant: this.skin.transition.slant,
    };
    const done = new Promise((resolve) => (transition.resolve = resolve));
    const signal = this.#watchVisual();
    this.#transition = transition;
    try {
      const captured = await compositor.captureGhost(signal);
      transition.ghosted = captured && !signal.aborted;
      const version = compositor.sourceVersion;
      if (!transition.ghosted) this.#finishVisual(signal);
      await update?.();
      if (signal.aborted) return;
      if (scopes) {
        const r = union([...scopeBefore, ...this.#rectsOf(scopes)]);
        transition.scope = r ? [r[0] - 2, r[1] - 2, r[2] + 4, r[3] + 4] : null;
      }
      // Map presses to where the moving elements are shown, even while the new
      // picture is in flight.
      const after = measure();
      const most = movers ? MAX_MOVERS : MAX_KEYED;
      for (const [key, a] of before) {
        const b = after.get(key);
        if (b && transition.pairs.length < most) transition.pairs.push({ a: a.rect, b: b.rect, el: b.el });
        else if (!b && movers) {
          transition.exits.push(a.rect);
          // An exit with its own picture breaks from where the pointer pressed, if it did just now.
          const press = this.#press && performance.now() - this.#press.at < 3000 ? this.#press.point : null;
          transition.exitFx.push({ seed: (Math.random() * 65536) | 0, origin: press });
        }
      }
      this.play(sound ?? (!transition.cut ? 'shuffle' : scopes ? 'swipe' : 'whoosh'));
      if (!(await painted(compositor, version, signal, this.#source?.offsetHeight)) || signal.aborted) return;
      transition.pending = false;
      this.#sync();
      this.wake();
      await done;
    } finally {
      this.#finishVisual(signal);
    }
  }

  /**
   * Removes an element with motion (named discard, not remove: an element's own
   * remove() takes the stage itself out): it crumbles where it was, and what comes
   * after it flies into the space it leaves. Resolves once it is gone. A framework that
   * owns the element passes its own `update` (which removes it from its state).
   * `exit` names another way out ('shatter': it breaks into shards).
   */
  async discard(el, update = () => el.remove(), { exit = null } = {}) {
    if (!el?.isConnected) return;
    if (!this.#canPresent() || !this.visible(el)) {
      await this.#withoutVisual(update);
      return;
    }
    // What can move: its siblings, and what follows each of its ancestors.
    const movers = [...el.parentElement.children].filter((c) => c !== el);
    for (let node = el.parentElement; node && node !== this.#source; node = node.parentElement) {
      for (let next = node.nextElementSibling; next; next = next.nextElementSibling) movers.push(next);
    }
    await this.transition(update, { morph: movers.slice(0, MAX_MOVERS - 1).concat(el), cut: false, sound: 'remove', exit });
  }

  /** Has an element (just added) assemble block by block. */
  reveal(el) {
    if (!el?.isConnected || !this.#canPresent()) return;
    this.#arrivals.push({ el, start: NaN });
    this.play('appear');
    this.wake();
  }

  /**
   * @internal Changes the DOM with a picture of the old state kept for an animation
   * over `rect`: 'roll' (a value rolling over, direction 1 up or -1 down), 'unfold'
   * (an overlay appearing top-down), 'fold' (an overlay closing upward).
   */
  async _change(el, update, kind, direction = 1) {
    const compositor = this.#compositor;
    if (this.#transition || this.#reflow) return update() !== false;
    // One picture of the past at a time: earlier changes end now.
    this.#finishVisual();
    if (!this.#canPresent()) {
      return (await this.#withoutVisual(update)) !== false;
    }
    const signal = this.#watchVisual();
    const change = { el, kind, direction, rect: null, pending: true, ghosted: false, start: NaN };
    this.#changes.push(change);
    try {
      if (!(await compositor.captureGhost(signal)) || signal.aborted) return update() !== false;
      const version = compositor.sourceVersion;
      const before = kind === 'fold' ? this.#layoutRect(el) : null;
      if (update() === false) return false;
      if (signal.aborted) return true;
      change.rect = before ?? this.#layoutRect(el);
      change.ghosted = true;
      this.wake();
      if (!(await painted(compositor, version, signal, this.#source?.offsetHeight)) || signal.aborted) return true;
      change.pending = false;
      this.wake();
      return true;
    } finally {
      if (change.pending) this.#finishVisual(signal);
    }
  }

  /**
   * @internal Opens or closes a <details> with motion: the content below the summary
   * slides while the body is uncovered (opening) or shut (closing).
   */
  async _disclose(details) {
    const compositor = this.#compositor;
    const toggle = () => (details.open = !details.open);
    if (this.#transition) {
      toggle();
      return;
    }
    const open = !(this.#reflow?.details === details ? this.#reflow.open : details.open);
    this.#finishVisual();
    if (!this.#canPresent()) {
      await this.#withoutVisual(toggle);
      return;
    }
    // An exclusive accordion closes another one at the same time: cut the group.
    const group = details.name && open
      ? [...this.#source.querySelectorAll('details[open]')].find((d) => d !== details && d.name === details.name)
      : null;
    if (group) {
      this.play('open');
      await this.transition(toggle, { scope: [details, group], sound: 'swipe' });
      return;
    }
    const reflow = { details, open, pending: true, ghosted: false, start: NaN, line: 0, column: null, height: 0 };
    const signal = this.#watchVisual();
    this.#reflow = reflow;
    try {
      if (!(await compositor.captureGhost(signal)) || signal.aborted) {
        toggle();
        return;
      }
      const summary = details.querySelector(':scope > summary');
      if (!summary) {
        toggle();
        return;
      }
      const s = this.#source.getBoundingClientRect();
      reflow.line = summary.getBoundingClientRect().bottom - s.top;
      reflow.column = this.#columnOf(details);
      reflow.ghosted = true;
      const version = compositor.sourceVersion;
      const before = details.getBoundingClientRect().height;
      reflow.open = toggle();
      reflow.height = Math.abs(details.getBoundingClientRect().height - before);
      this.play(reflow.open ? 'open' : 'close');
      if (!(await painted(compositor, version, signal, this.#source?.offsetHeight)) || signal.aborted) return;
      reflow.pending = false;
      this.wake();
    } finally {
      if (reflow.pending) this.#finishVisual(signal);
    }
  }

  // ---------------------------------------------------------------- internals

  #describeHold(button) {
    if (!button.hasAttribute('aria-description')) {
      button.setAttribute('aria-description', 'Press and hold, or activate twice, to confirm');
    }
  }

  #guardHold(event) {
    const button = event.target.closest?.('button[hold]');
    if (!button || !this.#source.contains(button) || button.disabled) return;
    if (button === this.#allowed) return;
    const presses = this.#instances.get('presses');
    // A click that nobody pressed (a screen reader's activation, Enter in a field) cannot
    // hold: the first one arms the button, a second one soon after confirms. Pointer and
    // key presses on the button keep needing the hold.
    const pressed = presses?.list.some((p) => p.el === button);
    if (event.detail === 0 && !pressed) {
      if (this.#armed?.el === button && event.timeStamp - this.#armed.at < ARM_MS) {
        this.#armed = null;
        this.#announce('');
        return;
      }
      this.#armed = { el: button, at: event.timeStamp };
      this.#announce(`${button.textContent.trim()}: activate again to confirm`);
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (presses && !presses.holding(button)) presses.nudge(button, event.timeStamp);
  }

  /** Says something to screen readers, from a live region of the stage. */
  #announce(text) {
    let live = this.#source.querySelector(':scope > .loom-live');
    if (!live) {
      live = document.createElement('div');
      live.className = 'loom-live';
      live.setAttribute('aria-live', 'assertive');
      this.#source.append(live);
    }
    live.textContent = text;
  }

  #unlockAudio() {
    if (this.#audio || !this.hasAttribute('sound')) return;
    audio();
    this.#audio = true;
  }

  #readColors() {
    // The native parts this skin paints itself (base.css hides them on the GPU path).
    this.dataset.draws = (this.skin?.draws ?? ['focus', 'thumbs', 'gauges']).join(' ');
    const probes = Object.entries(this.skin?.tokens ?? {}).map(([name, [property, fallback]]) => {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
      // A function fallback reads the page around the stage (its background, its accent colour).
      const value = typeof fallback === 'function' ? fallback(this) : fallback;
      probe.style.color = `var(${property}, ${value})`;
      return [name, probe];
    });
    // Resolve every token against the same stage, with no style writes between reads.
    this.#source.append(...probes.map(([, probe]) => probe));
    const colors = {};
    for (const [name, probe] of probes) colors[name] = parseRgb(getComputedStyle(probe).color);
    for (const [, probe] of probes) probe.remove();
    this.#colors = colors;
  }

  #restyle() {
    this.#readColors();
    this.wake();
  }


  #observe() {
    // Children that a framework or a script adds to the stage join the content.
    const adopt = new MutationObserver(() => {
      for (const node of [...this.childNodes]) {
        if (node === this.#source || node === this.#canvas) continue;
        if (node.nodeType === 1 && node.localName === 'hic-layer') continue;
        this.#source.append(node);
      }
    });
    adopt.observe(this, { childList: true });
    const content = new MutationObserver((records) => {
      // Chips (and anything marked removable) that arrive assemble block by block.
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && node.matches('[removable], [toasts] > *') && this.#source.contains(node)) {
            requestAnimationFrame(() => this.reveal(node));
          }
        }
      }
      for (const behavior of this.#behaviors) behavior.mutated?.(records);
      this.#queueSync(records);
      // Before the frame: the renderer learns a canvas size in the frame it changes.
      this.#fitCanvas();
    });
    content.observe(this.#source, {
      childList: true, subtree: true, attributes: true, characterData: true,
      attributeFilter: ['hidden', 'class', 'hold', 'open', 'value', 'max', 'min', 'low', 'high', 'optimum', 'aria-selected', 'aria-current', 'segments', 'sortable', 'removable', 'list', 'aria-busy', 'ring', 'role', 'type', 'checked', 'name', 'rating', 'badge', 'toasts', 'split', 'multiple', 'size', 'nosort'],
    });
    this.#observers.push(adopt, content);
  }

  /**
   * Sizes the canvas to its content. Run from a mutation, before the frame, it lets the
   * renderer's own ResizeObserver see the new size in that frame; run from a
   * ResizeObserver, only in the next one.
   */
  #fitCanvas() {
    const canvas = this.#canvas;
    if (!canvas) return;
    const height = this.#source.offsetHeight;
    const h = `${height}px`;
    if (canvas.style.height === h) return;
    // The frame being drawn still has the old size. Until one of the new size is drawn,
    // the old picture keeps its scale, pinned to the top (base.css): cut when the stage
    // shrinks, short when it grows, never squashed.
    canvas.style.objectFit = height < parseFloat(canvas.style.height) ? 'cover' : 'contain';
    canvas.style.height = h;
  }

  // Text and reflected values can change every frame. Only structural changes
  // need discovery. Custom behaviours retain their full sync() notification.
  #queueSync(records) {
    for (const record of records) {
      if (this.#fullSync) break;
      if (isListMutation(record)) continue;
      if (changesControls(record)) {
        this.#fullSync = true;
        break;
      }
      const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const kind = record.type === 'attributes' ? 'valueSelector' : 'textSelector';
      for (const behavior of this.#contentSync) {
        const selector = behavior.constructor[kind];
        const control = selector && node?.closest(selector);
        if (!control) continue;
        let dirty = this.#dirtyControls.get(behavior);
        if (!dirty) this.#dirtyControls.set(behavior, dirty = new Set());
        dirty.add(control);
      }
    }
    if (this.#syncFrame || !(this.#fullSync || this.#dirtyControls.size || this.#customSync.length)) return;
    this.#syncFrame = requestAnimationFrame(() => {
      this.#syncFrame = 0;
      if (this.#fullSync) this.#sync();
      else {
        for (const [behavior, controls] of this.#dirtyControls) {
          for (const el of controls) if (this.#source.contains(el)) behavior.syncControl(el);
        }
        for (const behavior of this.#customSync) behavior.sync();
        this.wake();
      }
      this.#fullSync = false;
      this.#dirtyControls.clear();
    });
  }

  #sync() {
    if (!this.#source) return;
    for (const button of this.#source.querySelectorAll('button[hold]')) this.#describeHold(button);
    for (const behavior of this.#behaviors) behavior.sync?.();
    this.wake();
  }

  #wakeAfterRegistration() {
    const signal = this.#listeners.signal;
    if (this.#registryWake === signal) return;
    this.#registryWake = signal;
    queueMicrotask(() => {
      if (this.#registryWake !== signal) return;
      this.#registryWake = null;
      if (!signal.aborted) this.wake();
    });
  }

  #installBehavior(name, { Class, component }, index, late = false) {
    let behavior = this.#instances.get(name);
    if (behavior) {
      this.#behaviors.splice(this.#behaviors.indexOf(behavior), 1);
    } else {
      behavior = new Class(this);
      this.#instances.set(name, behavior);
      if (component && behavior.syncControl) this.#contentSync.push(behavior);
      if (!component && behavior.sync) {
        this.#customSync.push(behavior);
        if (late) behavior.sync();
      }
    }
    this.#behaviors.splice(index, 0, behavior);
  }

  /** The instance of a registered behaviour (for tests and tools). */
  behavior(name) {
    return this.#instances.get(name) ?? null;
  }

  #rectsOf(elements) {
    return elements.filter((el) => this.visible(el)).map((el) => this.rectOf(el)).filter((r) => r[2] > 0 && r[3] > 0);
  }

  /** The horizontal band that moves with an element: its column, or the whole stage. */
  #columnOf(el) {
    let node = el;
    while (node.parentElement && node.parentElement !== this.#source) {
      const r = node.getBoundingClientRect();
      const beside = [...node.parentElement.children].some((other) => {
        if (other === node) return false;
        const o = other.getBoundingClientRect();
        if (o.width < 1 || o.height < 1) return false;
        const apart = o.right <= r.left + 1 || o.left >= r.right - 1;
        return apart && o.top < r.bottom && o.bottom > r.top;
      });
      if (beside) {
        const [x, , w] = this.rectOf(node);
        return [x, w];
      }
      node = node.parentElement;
    }
    return [0, this.#source.getBoundingClientRect().width];
  }

  #canPresent() {
    const target = this.#canvas ?? this;
    if (!this.#compositor || this.reduced || !this.isConnected || this.ownerDocument.hidden || !this.visible(target)) return false;
    const box = target.getBoundingClientRect();
    const view = this.ownerDocument.defaultView;
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0
      && box.top < view.innerHeight && box.left < view.innerWidth;
  }

  // Normally a DOM-only change is synchronous. If a cancelled capture still
  // has its update queued, later changes start in the same microtask order.
  #withoutVisual(update) {
    if (!this.#queuedUpdates) return update?.();
    this.#queuedUpdates++;
    return Promise.resolve().then(() => {
      this.#queuedUpdates--;
      return update?.();
    });
  }

  // A stage shares one ghost texture across cuts, rolls, folds and disclosures.
  // Keep its ownership from the capture request through the last displayed frame.
  #watchVisual() {
    const controller = new AbortController();
    const { signal } = controller;
    this.#visual = controller;
    const doc = this.ownerDocument;
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) this.#finishVisual(signal);
    }, { signal });
    this.#motion?.addEventListener('change', () => {
      if (this.reduced) this.#finishVisual(signal);
    }, { signal });
    const Observer = doc.defaultView.IntersectionObserver;
    if (Observer) {
      const observer = new Observer((entries) => {
        if (entries.at(-1)?.isIntersecting === false) this.#finishVisual(signal);
      });
      observer.observe(this.#canvas ?? this);
      signal.addEventListener('abort', () => observer.disconnect(), { once: true });
    }
    return signal;
  }

  #finishVisual(signal = this.#visual?.signal, repaint = true) {
    if (!this.#visual || this.#visual.signal !== signal) return;
    const controller = this.#visual;
    this.#visual = null;
    const capturing = this.#transition?.ghosted === false || this.#reflow?.ghosted === false
      || this.#changes.some(c => !c.ghosted);
    // A paint received while waiting for the new source could have left the
    // held ghost onscreen. Present the live source when that wait is cancelled.
    if (repaint && (this.#transition?.ghosted || this.#reflow?.ghosted || this.#changes.some(c => c.ghosted))) {
      this.#compositor?.requestRender();
    }
    this.#transition?.resolve();
    this.#transition = null;
    this.#reflow = null;
    this.#changes = [];
    this.#flights = [];
    controller.abort();
    if (capturing) {
      this.#queuedUpdates++;
      queueMicrotask(() => this.#queuedUpdates--);
    }
  }

  #keyed() {
    const map = new Map();
    let origin;
    for (const el of this.#source.querySelectorAll('*')) {
      const name = el.dataset.morph || getComputedStyle(el).viewTransitionName;
      if (!name || name === 'none' || map.has(name)) continue;
      if (!this.visible(el)) continue;
      origin ??= this.#source.getBoundingClientRect();
      const rect = this.#layoutRect(el, origin);
      if (rect[2] < 1 || rect[3] < 1) continue;
      map.set(name, { el, rect });
    }
    return map;
  }

  /** Elements keyed by themselves, with their layout rects. */
  #measured(elements) {
    const map = new Map();
    let origin;
    for (const el of elements) {
      if (!this.visible(el)) continue;
      origin ??= this.#source.getBoundingClientRect();
      const rect = this.#layoutRect(el, origin);
      if (rect[2] >= 1 && rect[3] >= 1) map.set(el, { el, rect });
    }
    return map;
  }

  /** Where an element is in the layout, ignoring any flight it is on. */
  #layoutRect(el, s = this.#sourceRect ?? this.#source.getBoundingClientRect()) {
    // In the content's own px. The content can be scaled on screen: by a page that scales
    // the stage, or by the polyfill, which matches it to a picture of an older size until
    // the new one is ready.
    if (this.#scale.rect !== s) {
      const source = this.#source;
      const x = source.offsetWidth > 0 ? s.width / source.offsetWidth : 1;
      const y = source.offsetHeight > 0 ? s.height / source.offsetHeight : 1;
      // offsetWidth and offsetHeight are rounded: a fraction of a pixel is not a scale.
      this.#scale = { rect: s, x: Math.abs(x - 1) < 0.005 ? 1 : x, y: Math.abs(y - 1) < 0.005 ? 1 : y };
    }
    const { x, y } = this.#scale;
    const r = el.getBoundingClientRect();
    return [(r.left - s.left) / x, (r.top - s.top) / y, r.width / x, r.height / y];
  }

  #domTick = (now) => {
    this.#domFrame = 0;
    if (this.#compositor || !this.isConnected) {
      this.#lastDomFrame = null;
      return;
    }
    const dt = this.#lastDomFrame === null ? 0 : Math.max(0, (now - this.#lastDomFrame) / 1000);
    this.#animating = this.#stepBehaviors(now, dt);
    this.#lastDomFrame = this.#animating ? now : null;
    if (this.#animating && !this.#domFrame) this.#domFrame = requestAnimationFrame(this.#domTick);
  };

  #stepBehaviors(now, dt) {
    let active = false;
    for (const behavior of this.#behaviors) active = behavior.step(now, dt) || active;
    return active;
  }

  /** @internal Called by the compositor once per frame. */
  _step(now, dt) {
    return this.#step(now, dt);
  }

  #step(now, dt) {
    const scene = this.#scene;
    const u = this.#uniforms;
    scene.reset();
    u.fill(0);
    const sourceRect = this.#source.getBoundingClientRect();
    this.#sourceRect = sourceRect;
    this.#flights = [];
    let active = this.#stepBehaviors(now, dt);

    const skin = this.skin;
    const colors = this.#colors;
    const role = (name, fallback) => colors[skin.roles?.[name]] ?? fallback;
    u.set(role('bg', [0, 0, 0]), U.bg);
    u.set(role('hot', [1, 1, 1]), U.hot);
    u.set(role('rim', [1, 1, 1]), U.holo);
    u.set(role('void', role('bg', [0, 0, 0])), U.void);
    u.set([skin.shader.scanlines, skin.shader.chroma, skin.shader.crumble, skin.shader.hatch], U.style);
    u[U.wipeDir] = 1;
    u[U.alpha] = this.overlay ? 1 : 0;
    const whole = [0, 0, sourceRect.width, sourceRect.height];
    this.#ctx = { colors, now, reduced: this.reduced, whole, durations: skin.durations, stage: this };

    if (this.#boot) {
      if (Number.isNaN(this.#boot.start)) this.#boot.start = now;
      const k = (now - this.#boot.start) / (skin.boot?.ms ?? 1);
      if (k >= 1) this.#boot = null;
      else {
        u[U.bootActive] = 1;
        u[U.bootLine] = easeInOutCubic(clamp01(k)) * (sourceRect.height + 6) - 2;
        active = true;
      }
    }

    const t = this.#transition;
    if (t?.ghosted) {
      u[U.wipeActive] = 1;
      u[U.wipeBand] = t.band;
      u[U.wipeSlant] = t.slant;
      // Pending visuals hold a still picture. Source paints and the callback
      // settling will wake the compositor when there is something new to draw.
      if (!t.pending) active = true;
      u[U.wipeDir] = t.direction;
      u[U.wipeStyle] = t.style;
      if (t.scope) u.set(t.scope, U.scope);
      if (t.pending) {
        u[U.wipeFront] = 0;
        // Waiting for the new picture: everything stands where it was.
        for (const rect of t.exits) scene.push(GHOST, rect, ZERO4, ZERO4, 0, 0, 1);
        for (const { a, b, el } of t.pairs) {
          scene.push(MORPH, a, a, b, 0, 0, 0);
          if (el) this.#flights.push({ el, to: b, now: a });
        }
      } else {
        if (Number.isNaN(t.start)) t.start = now;
        const e = now - t.start;
        // Without a cut the whole new page is there at once; only the elements fly.
        u[U.wipeFront] = t.cut ? easeInOutCubic(clamp01(e / t.ms)) * (1 + t.band) : 1 + t.band;
        let end = t.cut ? t.ms : 0;
        t.exits.forEach((rect, i) => {
          if (t.exit) {
            // An exit of its own (core/primitives.js: `exit`): the shards of the old picture.
            const it = t.exit.exit.item(rect, e, { ...t.exitFx[i], whole });
            if (it) scene.push(t.exit.kind, it.rect, it.p, it.q, ...it.h);
            end = Math.max(end, t.exit.exit.ms);
            return;
          }
          const k = clamp01(e / EXIT_MS);
          // Fast at first: what is removed starts to go at once.
          if (k < 1) scene.push(GHOST, rect, ZERO4, ZERO4, 0, Math.sqrt(k), 1);
          end = Math.max(end, EXIT_MS);
        });
        t.pairs.forEach(({ a, b, el }, i) => {
          const delay = t.cut ? 40 + i * 35 : 20 + Math.min(i, 14) * 24;
          const r = flight(a, b, i, e - delay);
          // The streak: where the element was ~90 ms ago, as a vector toward it.
          const r0 = flight(a, b, i, e - delay - 16);
          let vx = (r[0] + r[2] / 2 - r0[0] - r0[2] / 2) * (90 / 16);
          let vy = (r[1] + r[3] / 2 - r0[1] - r0[3] / 2) * (90 / 16);
          const speed = Math.hypot(vx, vy);
          if (speed > 160) {
            vx *= 160 / speed;
            vy *= 160 / speed;
          }
          const dissolve = clamp01((e - delay - 140) / 480);
          // The trail looks back along the motion: from a point behind, ahead is the element.
          scene.push(MORPH, r, a, b, dissolve, vx, vy);
          if (el) this.#flights.push({ el, to: b, now: r });
          end = Math.max(end, delay + FLIGHT_MS);
        });
        if (e > end + 16) {
          // The last frame of the transition is the plain live page.
          scene.reset();
          this.#flights = [];
          u[U.wipeActive] = 0;
          this.#finishVisual(this.#visual.signal, false);
        }
      }
    }

    if (!t) {
      for (const c of this.#changes) {
        if (!c.pending) active = true;
        const rect = c.kind === 'roll' && c.rect ? [c.rect[0] + 1, c.rect[1] + 1, c.rect[2] - 2, c.rect[3] - 2] : c.rect;
        if (!rect) continue;
        if (c.pending) {
          if (c.ghosted) scene.push(GHOST, rect);
          continue;
        }
        if (Number.isNaN(c.start)) c.start = now;
        const ms = c.kind === 'roll' ? ROLL_MS : UNFOLD_MS;
        const k = clamp01((now - c.start) / ms);
        if (c.kind === 'roll') {
          scene.push(ROLL, rect, [easeOutCubic(k), c.direction]);
          this.draw('rolled', scene, { el: c.el, rect, t: now - c.start, direction: c.direction });
        } else {
          // unfold: the new picture is uncovered top-down; fold: the old one shuts upward.
          const shown = rect[3] * (c.kind === 'unfold' ? easeOutCubic(k) : 1 - easeOutCubic(k));
          if (c.kind === 'unfold') scene.push(GHOST, [rect[0], rect[1] + shown, rect[2], rect[3] - shown]);
          else scene.push(GHOST, [rect[0], rect[1], rect[2], shown]);
          this.draw('unfold', scene, { el: c.el, rect, line: rect[1] + shown, k, opening: c.kind === 'unfold' });
        }
        if (k >= 1) c.done = true;
      }
      this.#changes = this.#changes.filter((c) => !c.done);
    }
    this.#arrivals = this.#arrivals.filter((a) => a.el.isConnected);
    for (const a of this.#arrivals) {
      active = true;
      if (Number.isNaN(a.start)) a.start = now;
      const k = clamp01((now - a.start) / ARRIVE_MS);
      if (this.visible(a.el)) scene.push(MATERIALIZE, this.rectOf(a.el), [1 - easeOutCubic(k)]);
      if (k >= 1) a.done = true;
    }
    this.#arrivals = this.#arrivals.filter((a) => !a.done);

    const r = this.#reflow;
    if (r && !t) {
      if (!r.pending) active = true;
      const [cx, cw] = r.column ?? [0, 0];
      if (r.pending) {
        // Until the new picture is on the GPU, below the summary shows the old one.
        if (r.ghosted) scene.push(GHOST, [cx, r.line, cw, BELOW]);
      } else {
        if (Number.isNaN(r.start)) r.start = now;
        const k = clamp01((now - r.start) / (r.open ? skin.durations.reveal : skin.durations.shut));
        const H = r.height;
        // h: how much of the body is shown now.
        const h = r.open ? H * easeOutCubic(k) : H * (1 - easeInOutCubic(k));
        if (r.open) {
          scene.push(SHIFT, [cx, r.line + h, cw, BELOW], [0, H - h]);
        } else {
          // The body shuts upward; the skin may have its lowest rows crumble away.
          scene.push(GHOST, [cx, r.line, cw, h], ZERO4, ZERO4, Math.min(skin.disclosure.crumble, H * 0.5));
          scene.push(SHIFT, [cx, r.line + h, cw, BELOW], [0, -h]);
        }
        this.draw('reveal', scene, { el: r.details, column: [cx, cw], line: r.line, shown: h, k, opening: r.open });
        if (k >= 1) this.#reflow = null;
      }
    }

    if (!this.#transition && !this.#reflow && !this.#changes.length) this.#finishVisual();
    for (const behavior of this.#behaviors) behavior.emit(scene, now);
    this.#sourceRect = null;
    this.#animating = active;
    return { data: scene.data, count: scene.count, mask: scene.mask, maskHi: scene.maskHi, uniforms: u };
  }

  /** @internal */
  _needsFrames() {
    return Boolean(this.#animating || this.#boot || this.#arrivals.length);
  }

  /** @internal A frame drawn at the canvas's size: its picture fills it again. */
  _sized(cssWidth, cssHeight) {
    const canvas = this.#canvas;
    if (!canvas?.style.objectFit) return;
    if (Math.abs(cssHeight - parseFloat(canvas.style.height)) < 1 && Math.abs(cssWidth - canvas.clientWidth) < 1) {
      canvas.style.objectFit = '';
    }
  }

  /** @internal */
  _attachCompositor(compositor, canvas = this.#canvas) {
    if (canvas === this.#canvas) this.#compositor = compositor;
  }

  /** @internal */
  _detachCompositor(compositor) {
    if (this.#compositor === compositor) {
      this.#compositor = null;
      this.#finishVisual();
    }
  }

  async #enhance(generation) {
    try {
      if (!navigator.gpu || matchMedia('(forced-colors: active)').matches || this.hasAttribute('static')) return 'dom';
      const runtime = await loadRuntime();
      await document.fonts?.ready;
      if (generation !== this.#generation || !this.isConnected) return 'dom';

      const source = this.#source;
      const canvas = document.createElement('canvas');
      canvas.className = 'loom-canvas';
      const height = source.offsetHeight;
      canvas.style.height = `${height}px`;
      source.style.width = `${this.clientWidth}px`;
      source.setAttribute('drawable', '');
      this.insertBefore(canvas, source);
      // On a connected canvas this mounts the polyfill's empty live layer
      // synchronously, so the focused subtree moves directly to its final parent.
      canvas.setAttribute('content', 'drawable');
      moveSource(canvas, source);
      this.#canvas = canvas;
      this.dataset.renderer = 'loading';

      // The polyfill finds new drawable canvases from a MutationObserver.
      await Promise.resolve();
      // An overlay stage (in a dialog, a popover) is transparent around its panel.
      const alphaMode = this.overlay ? 'premultiplied' : 'opaque';
      const host = await runtime.api.createHost(canvas, source, { maxDpr: 2, interposer: true, device: sharedDevice, alphaMode });
      if (generation !== this.#generation) {
        host.destroy();
        return 'dom';
      }
      this.#host = host;
      // An overlay opens with its own motion (dom-loom/dialog), not with the boot sweep.
      this.#boot = this.reduced || !this.skin.boot || this.overlay ? null : { start: NaN };
      await host.addPlugin(createCompositor(runtime, this), {});
      if (generation !== this.#generation) return 'dom';

      const resize = new ResizeObserver(() => {
        const width = `${this.clientWidth}px`;
        if (source.style.width !== width) source.style.width = width;
        this.#fitCanvas();
        this.wake();
      });
      resize.observe(this);
      resize.observe(source);
      this.#observers.push(resize);

      canvas.addEventListener('effecterror', (event) => this.#fallback(generation, event.detail?.error));
      this.dataset.renderer = 'webgpu';
      this.dataset.mode = runtime.mode;
      this.play('scan');
      this.wake();
      return 'webgpu';
    } catch (error) {
      this.#fallback(generation, error);
      return 'dom';
    }
  }

  #fallback(generation, error) {
    if (generation !== this.#generation) return;
    this.#release();
    this.dataset.renderer = 'dom';
    delete this.dataset.mode;
    if (error) {
      this.dispatchEvent(new CustomEvent('loom-fallback', { bubbles: true, detail: { error } }));
    }
  }

  #release() {
    this.#host?.destroy();
    this.#host = null;
    this.#compositor = null;
    this.#finishVisual();
    this.#arrivals = [];
    this.#boot = null;
    const canvas = this.#canvas;
    this.#canvas = null;
    if (canvas && this.#source) {
      this.#source.removeAttribute('drawable');
      this.#source.style.width = '';
      moveSource(this, this.#source, canvas.parentNode === this ? canvas : null);
      canvas.remove();
    }
    if (this.isConnected) this.dataset.renderer = 'dom';
    delete this.dataset.mode;
  }
}
