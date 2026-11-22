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
const ZERO4 = [0, 0, 0, 0];

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

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function parseRgb(value) {
  const m = value.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map((n) => Number(n) / 255) : [1, 1, 1];
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
  #transition = null;
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
  #observers = [];
  #generation = 0;
  #audio = false;
  #syncQueued = false;
  #ready = Promise.resolve('dom');
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
    return ['skin'];
  }

  attributeChangedCallback(name) {
    if (name === 'skin' && this.#source) this.#restyle();
  }

  /** A stage in a dialog or a popover: transparent around its panel (the `overlay` attribute). */
  get overlay() {
    return this.hasAttribute('overlay');
  }

  /** Adds a listener on another element that is removed with the stage. */
  listenOn(target, type, listener, options = {}) {
    target.addEventListener(type, listener, { ...options, signal: this.#listeners.signal });
  }

  /** The skin that draws this stage: its `skin` attribute, or the default one. */
  get skin() {
    return getSkin(this.getAttribute('skin'));
  }

  /** The element that holds the stage's content (it moves into the canvas on the GPU path). */
  get source() {
    return this.#source;
  }
  /** Resolves with 'webgpu' once the compositor draws the stage, or 'dom'. */
  get ready() {
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

    // A skin registered later, or redefined, applies at once.
    document.addEventListener('loom-skin', (e) => {
      if (e.detail?.name === this.skin?.name) this.#restyle();
    }, { signal: this.#listeners.signal });
    this.listen('pointerdown', () => this.#unlockAudio(), { capture: true });
    this.listen('keydown', () => this.#unlockAudio(), { capture: true });
    this.listen('click', (e) => this.#guardHold(e), { capture: true });
    this.listen('reset', () => setTimeout(() => this.#sync()), { capture: true });

    this.#instances = new Map();
    this.#adoptBehaviors();
    // A component imported later (a lazy chunk) joins the stages already running.
    document.addEventListener('loom-behaviors', () => {
      this.#adoptBehaviors();
      this.#sync();
    }, { signal: this.#listeners.signal });

    for (const button of this.#source.querySelectorAll('button[hold]')) this.#describeHold(button);
    this.#observe();
    const generation = ++this.#generation;
    this.#ready = this.#enhance(generation);
  }

  disconnectedCallback() {
    ++this.#generation;
    this.#listeners?.abort();
    for (const o of this.#observers) o.disconnect();
    this.#observers = [];
    cancelAnimationFrame(this.#domFrame);
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
    if (t?.pending && t.movers && state.el && t.movers.some((m) => m === state.el || m.contains(state.el))) return;
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
   * - sound: the skin's sound to play.
   */
  async transition(update, { scope = null, direction = 1, morph = null, cut = true, sound = null, style = null } = {}) {
    if (!this.#compositor || this.reduced) {
      await update?.();
      return;
    }
    this.#finishTransition();
    this.#endReflow();
    const scopes = scope ? [scope].flat().filter(Boolean) : null;
    const movers = morph ? [...morph] : null;
    const measure = () => (movers ? this.#measured(movers) : scopes ? new Map() : this.#keyed());
    const before = measure();
    const scopeBefore = scopes ? this.#rectsOf(scopes) : [];
    const transition = {
      start: NaN, pending: true, pairs: [], exits: [], movers, resolve: null, cut: cut !== false,
      scope: null, direction: direction < 0 ? -1 : 1,
      style: style ? (primitives.all().find((d) => d.name === style && d.cut)?.kind ?? 0) : 0,
      ms: scopes ? this.skin.transition.scopedMs : this.skin.transition.ms,
      band: this.skin.transition.band, slant: this.skin.transition.slant,
    };
    const done = new Promise((resolve) => (transition.resolve = resolve));
    await this.#compositor.captureGhost();
    if (!this.#compositor) {
      await update?.();
      return;
    }
    this.#transition = transition;
    const version = this.#compositor.sourceVersion;
    try {
      await update?.();
    } catch (error) {
      this.#finishTransition();
      throw error;
    }
    if (scopes) {
      // The region is measured before and after: the cut covers both.
      const r = union([...scopeBefore, ...this.#rectsOf(scopes)]);
      transition.scope = r ? [r[0] - 2, r[1] - 2, r[2] + 4, r[3] + 4] : null;
    }
    // Where everything goes is known as soon as the DOM has changed: the flights are
    // set now, so that while the new picture is on its way each element is drawn where
    // it was (from the old picture, so nothing changes on screen) and a press on it
    // already reaches it.
    const after = measure();
    const most = movers ? MAX_MOVERS : MAX_KEYED;
    for (const [key, a] of before) {
      const b = after.get(key);
      if (b && transition.pairs.length < most) transition.pairs.push({ a: a.rect, b: b.rect, el: b.el });
      // A moved element that is no longer shown crumbles where it was.
      else if (!b && movers) transition.exits.push(a.rect);
    }
    this.play(sound ?? (!transition.cut ? 'shuffle' : scopes ? 'swipe' : 'whoosh'));
    await this.#compositor?.waitForSource(version, 600);
    // Give the polyfill one more frame to settle the new picture.
    await frame();
    if (this.#transition !== transition) return done;
    this.#sync();
    transition.pending = false;
    this.wake();
    return done;
  }

  /**
   * Removes an element with motion (named discard, not remove: an element's own
   * remove() takes the stage itself out): it crumbles where it was, and what comes
   * after it flies into the space it leaves. Resolves once it is gone. A framework that
   * owns the element passes its own `update` (which removes it from its state).
   */
  async discard(el, update = () => el.remove()) {
    if (!el?.isConnected) return;
    if (!this.#compositor || this.reduced || !this.visible(el)) {
      await update();
      return;
    }
    // What can move: its siblings, and what follows each of its ancestors.
    const movers = [...el.parentElement.children].filter((c) => c !== el);
    for (let node = el.parentElement; node && node !== this.#source; node = node.parentElement) {
      for (let next = node.nextElementSibling; next; next = next.nextElementSibling) movers.push(next);
    }
    await this.transition(update, { morph: movers.slice(0, MAX_MOVERS - 1).concat(el), cut: false, sound: 'remove' });
  }

  /** Has an element (just added) assemble block by block. */
  reveal(el) {
    if (!this.#compositor || this.reduced || !el?.isConnected) return;
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
    if (!compositor || this.reduced || this.#transition || this.#reflow) {
      update();
      return true;
    }
    // One picture of the past at a time: earlier changes end now.
    this.#changes = [];
    const change = { el, kind, direction, rect: null, pending: true, ghosted: false, start: NaN };
    this.#changes.push(change);
    await compositor.captureGhost();
    if (!this.#changes.includes(change) || !this.#compositor) {
      update();
      return true;
    }
    const version = compositor.sourceVersion;
    const before = kind === 'fold' ? this.#layoutRect(el) : null;
    const changed = update();
    if (changed === false) {
      this.#changes = this.#changes.filter((c) => c !== change);
      return false;
    }
    change.rect = before ?? this.#layoutRect(el);
    change.ghosted = true;
    this.wake();
    await compositor.waitForSource(version, 600);
    await frame();
    if (!this.#changes.includes(change)) return true;
    change.pending = false;
    this.wake();
    return true;
  }

  /**
   * @internal Opens or closes a <details> with motion: the content below the summary
   * slides while the body is uncovered (opening) or shut (closing).
   */
  async _disclose(details) {
    const compositor = this.#compositor;
    const open = !details.open;
    if (!compositor || this.#transition) {
      details.open = open;
      return;
    }
    this.#endReflow();
    // An exclusive accordion closes another one at the same time: cut the group.
    const group = details.name && open
      ? [...this.#source.querySelectorAll('details[open]')].find((d) => d !== details && d.name === details.name)
      : null;
    if (group) {
      this.play('open');
      await this.transition(() => (details.open = true), { scope: [details, group], sound: 'swipe' });
      return;
    }
    const summary = details.querySelector(':scope > summary');
    const reflow = { details, open, pending: true, ghosted: false, start: NaN, line: 0, column: null, height: 0 };
    this.#reflow = reflow;
    this.wake();
    await compositor.captureGhost();
    if (this.#reflow !== reflow || !this.#compositor) {
      details.open = open;
      return;
    }
    const s = this.#source.getBoundingClientRect();
    reflow.line = summary.getBoundingClientRect().bottom - s.top;
    reflow.column = this.#columnOf(details);
    reflow.ghosted = true;
    const version = compositor.sourceVersion;
    const before = details.getBoundingClientRect().height;
    details.open = open;
    reflow.height = Math.abs(details.getBoundingClientRect().height - before);
    this.play(open ? 'open' : 'close');
    await compositor.waitForSource(version, 600);
    await frame();
    if (this.#reflow !== reflow) return;
    this.#sync();
    reflow.pending = false;
    this.wake();
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
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
    this.#source.append(probe);
    const colors = {};
    for (const [name, [property, fallback]] of Object.entries(this.skin?.tokens ?? {})) {
      probe.style.color = `var(${property}, ${fallback})`;
      colors[name] = parseRgb(getComputedStyle(probe).color);
    }
    probe.remove();
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
      if (this.#syncQueued) return;
      this.#syncQueued = true;
      requestAnimationFrame(() => {
        this.#syncQueued = false;
        this.#sync();
      });
    });
    content.observe(this.#source, {
      childList: true, subtree: true, attributes: true, characterData: true,
      attributeFilter: ['hidden', 'class', 'hold', 'open', 'value', 'max', 'min', 'low', 'high', 'optimum', 'aria-selected', 'aria-current', 'segments', 'sortable', 'removable', 'list', 'aria-busy', 'ring'],
    });
    this.#observers.push(adopt, content);
  }

  #sync() {
    if (!this.#source) return;
    for (const button of this.#source.querySelectorAll('button[hold]')) this.#describeHold(button);
    for (const behavior of this.#behaviors) behavior.sync?.();
    this.wake();
  }

  /** Creates the registered behaviours this stage does not have yet, in paint order. */
  #adoptBehaviors() {
    for (const [name, { Class }] of behaviorList()) {
      if (!this.#instances.has(name)) this.#instances.set(name, new Class(this));
    }
    this.#behaviors = behaviorList().map(([name]) => this.#instances.get(name));
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

  #endReflow() {
    this.#reflow = null;
    this.#changes = [];
  }

  #keyed() {
    const map = new Map();
    this.#sourceRect = null;
    for (const el of this.#source.querySelectorAll('*')) {
      const name = el.dataset.morph || getComputedStyle(el).viewTransitionName;
      if (!name || name === 'none' || map.has(name)) continue;
      if (!this.visible(el)) continue;
      const rect = this.#layoutRect(el);
      if (rect[2] < 1 || rect[3] < 1) continue;
      map.set(name, { el, rect });
    }
    return map;
  }

  /** Elements keyed by themselves, with their layout rects. */
  #measured(elements) {
    const map = new Map();
    this.#sourceRect = null;
    for (const el of elements) {
      if (!this.visible(el)) continue;
      const rect = this.#layoutRect(el);
      if (rect[2] >= 1 && rect[3] >= 1) map.set(el, { el, rect });
    }
    return map;
  }

  /** Where an element is in the layout, ignoring any flight it is on. */
  #layoutRect(el) {
    const s = this.#sourceRect ?? this.#source.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return [r.left - s.left, r.top - s.top, r.width, r.height];
  }

  #finishTransition() {
    const t = this.#transition;
    if (!t) return;
    this.#transition = null;
    t.resolve?.();
  }

  #domTick = (now) => {
    this.#domFrame = 0;
    if (this.#compositor) return;
    this.#step(now, 1 / 60);
    if (this.#animating) this.#domFrame = requestAnimationFrame(this.#domTick);
  };

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
    let active = false;
    for (const behavior of this.#behaviors) active = behavior.step(now, dt) || active;

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
    if (t) {
      u[U.wipeActive] = 1;
      u[U.wipeBand] = t.band;
      u[U.wipeSlant] = t.slant;
      active = true;
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
        for (const rect of t.exits) {
          const k = clamp01(e / EXIT_MS);
          // Fast at first: what is removed starts to go at once.
          if (k < 1) scene.push(GHOST, rect, ZERO4, ZERO4, 0, Math.sqrt(k), 1);
          end = Math.max(end, EXIT_MS);
        }
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
          this.#finishTransition();
        }
      }
    }

    if (!t) {
      for (const c of this.#changes) {
        active = true;
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
      active = true;
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

    for (const behavior of this.#behaviors) behavior.emit(scene, now);
    this.#sourceRect = null;
    this.#animating = active;
    return { data: scene.data, count: scene.count, mask: scene.mask, uniforms: u };
  }

  /** @internal */
  _needsFrames() {
    return Boolean(this.#animating || this.#transition || this.#boot || this.#reflow || this.#changes.length || this.#arrivals.length);
  }

  /** @internal */
  _attachCompositor(compositor) {
    this.#compositor = compositor;
  }

  /** @internal */
  _detachCompositor(compositor) {
    if (this.#compositor === compositor) this.#compositor = null;
  }

  async #enhance(generation) {
    try {
      if (!navigator.gpu || matchMedia('(forced-colors: active)').matches || this.hasAttribute('static')) return 'dom';
      const runtime = await loadRuntime();
      await document.fonts?.ready;
      if (generation !== this.#generation || !this.isConnected) return 'dom';

      const source = this.#source;
      const canvas = document.createElement('canvas');
      canvas.setAttribute('content', 'drawable');
      canvas.className = 'loom-canvas';
      const height = source.offsetHeight;
      canvas.style.height = `${height}px`;
      source.style.width = `${this.clientWidth}px`;
      source.setAttribute('drawable', '');
      this.insertBefore(canvas, source);
      canvas.append(source);
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
      // An overlay opens with its own motion (domloom/dialog), not with the boot sweep.
      this.#boot = this.reduced || !this.skin.boot || this.overlay ? null : { start: NaN };
      await host.addPlugin(createCompositor(runtime, this), {});
      if (generation !== this.#generation) return 'dom';

      const resize = new ResizeObserver(() => {
        const width = `${this.clientWidth}px`;
        if (source.style.width !== width) source.style.width = width;
        const h = `${source.offsetHeight}px`;
        if (canvas.style.height !== h) canvas.style.height = h;
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
    if (error) {
      this.dispatchEvent(new CustomEvent('loom-fallback', { bubbles: true, detail: { error } }));
    }
  }

  #release() {
    this.#host?.destroy();
    this.#host = null;
    this.#compositor = null;
    this.#finishTransition();
    this.#endReflow();
    this.#boot = null;
    const canvas = this.#canvas;
    this.#canvas = null;
    if (canvas && this.#source) {
      this.#source.removeAttribute('drawable');
      this.#source.style.width = '';
      if (canvas.parentNode === this) this.insertBefore(this.#source, canvas);
      else this.append(this.#source);
      canvas.remove();
    }
    if (this.isConnected) this.dataset.renderer = 'dom';
  }
}
