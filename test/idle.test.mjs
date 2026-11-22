import assert from 'node:assert/strict';
import test from 'node:test';
import { Drops } from '../src/behaviors/drops.js';
import { Presses } from '../src/behaviors/presses.js';
import { Splits } from '../src/behaviors/splits.js';
import { Toasts } from '../src/behaviors/toasts.js';

// Exercise each registered handler with separate stage and window events. A
// detached node keeps its attributes and children, just as it does in the DOM.
function element(parentElement = null, attributes = {}) {
  const attrs = new Map(Object.entries(attributes));
  return Object.assign(new EventTarget(), {
    parentElement, nodeType: 1, dataset: {}, children: [], ownerDocument: { activeElement: null },
    contains(node) {
      for (let current = node; current; current = current.parentElement) if (current === this) return true;
      return false;
    },
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: (name) => attrs.delete(name),
    toggleAttribute(name, enabled) { if (enabled) attrs.set(name, ''); else attrs.delete(name); },
    matches: () => false,
  });
}

function fixture() {
  const local = new Map();
  const global = new Map();
  const stage = {
    source: element(), reduced: false, gpu: true,
    skin: { durations: { press: 200, burst: 200, nudge: 200 } },
    wakes: 0, sounds: [], discarded: [],
    wake() { this.wakes++; },
    play(sound) { this.sounds.push(sound); },
    discard(node) { this.discarded.push(node); },
    rectOf() { return [0, 0, 100, 40]; },
    pointOf(event) { return [event.clientX ?? 0, 0]; },
    listen(type, fn) { local.set(type, fn); },
    listenGlobal(type, fn) { global.set(type, fn); },
  };
  const fire = (handlers, type, event) => {
    handlers.get(type)({ type, timeStamp: 50, button: 0, preventDefault() {}, ...event });
  };
  return {
    stage,
    local: (type, event) => fire(local, type, event),
    global: (type, event) => fire(global, type, event),
  };
}

test('unrelated pointer and keyboard releases do no work and each press follows its owner', () => {
  const { stage, local, global } = fixture();
  const button = element(stage.source, { hold: '1s' });
  button.closest = () => button;
  button.matches = (selector) => selector === 'button[hold]';
  const presses = new Presses(stage);
  global('pointerup', { pointerId: 9 });
  assert.equal(stage.wakes, 0);
  local('pointerdown', { target: button, pointerId: 1 });
  local('pointerdown', { target: button, pointerId: 2 });
  local('keydown', { target: button, key: 'Enter' });
  const before = stage.wakes;
  global('pointercancel', { pointerId: 9 });
  global('keyup', { key: ' ' });
  assert.equal(stage.wakes, before);
  assert.equal(presses.holding(button), true);
  global('pointerup', { pointerId: 2 });
  assert.equal(presses.holding(button), true);
  assert.deepEqual(presses.list.map((p) => Number.isFinite(p.releasedAt)), [false, true, false]);
  global('keyup', { key: 'Enter' });
  assert.deepEqual(presses.list.map((p) => Number.isFinite(p.releasedAt)), [false, true, true]);
  global('blur');
  assert.equal(presses.holding(button), false);
  assert.equal(stage.sounds.filter((sound) => sound === 'release').length, 3);
  assert.equal(stage.wakes, before + 3);
  global('pointerup', { pointerId: 1 });
  assert.equal(stage.wakes, before + 3);
});

function toastFixture() {
  const f = fixture();
  const region = element(f.stage.source, { toasts: '' });
  const toast = element(region);
  const child = element(toast);
  toast.dataset.timeout = '100ms';
  toast.closest = child.closest = () => toast;
  region.children.push(toast);
  f.stage.source.querySelectorAll = () => [region];
  return { ...f, region, toast, child, behavior: new Toasts(f.stage) };
}

test('toast sleeps while hover or focus persists and removes once after the remaining time', async () => {
  const { stage, local, toast, child, behavior } = toastFixture();
  let removed = 0;
  toast.addEventListener('loom-remove', () => removed++);
  assert.equal(behavior.step(20, 0.02), true);
  local('pointerover', { target: toast });
  local('focusin', { target: child });
  local('pointerout', { target: toast, relatedTarget: child });
  local('focusout', { target: child });
  assert.equal(behavior.step(520, 0.5), false); // Hover survived focus leaving.
  local('focusin', { target: child });
  local('pointerout', { target: toast });
  assert.equal(behavior.step(1020, 0.5), false); // Focus survived hover leaving.
  assert.equal(behavior.items.get(toast).elapsed, 20);
  local('focusout', { target: child });
  assert.equal(behavior.step(1099, 0.079), true);
  assert.equal(behavior.step(1100, 0.001), false);
  assert.equal(behavior.step(1200, 0.1), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(removed, 1);
  assert.deepEqual(stage.discarded, [toast]);
});

test('a framework can remove or move a toast before its deferred expiration', async () => {
  for (const move of ['detach', 'move']) {
    const { stage, toast, behavior } = toastFixture();
    let removed = 0;
    toast.addEventListener('loom-remove', () => removed++);
    assert.equal(behavior.step(100, 0.1), false);
    toast.parentElement = move === 'detach' ? null : element(stage.source);
    assert.equal(behavior.step(120, 0.02), false);
    assert.equal(behavior.items.size, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(removed, 0);
    assert.deepEqual(stage.discarded, []);
  }
});

test('removing a hovered dropzone stops rendering and clears its hover state', () => {
  const { stage, local } = fixture();
  const drops = new Drops(stage);
  const zone = element(stage.source, { dropzone: '' });
  const input = element(zone);
  zone.closest = () => zone;
  zone.querySelector = () => input;
  local('dragover', { target: zone, dataTransfer: { types: ['Files'] } });
  assert.equal(zone.hasAttribute('data-over'), true);
  assert.equal(drops.step(16, 0.016), true);
  zone.parentElement = null;
  assert.equal(drops.step(32, 0.016), false);
  assert.equal(drops.states.size, 0);
  assert.equal(zone.hasAttribute('data-over'), false);
});

test('a splitter keeps its owning pointer and releases removed panes during a drag', () => {
  const { stage, local, global } = fixture();
  const split = element(stage.source, { split: '' });
  const handle = element(split);
  split.style = { setProperty() {} };
  split.querySelector = () => handle;
  handle.closest = () => handle;
  handle.focus = () => {};
  stage.source.querySelectorAll = () => stage.source.contains(split) ? [split] : [];
  const splits = new Splits(stage);
  local('pointerdown', { target: handle, pointerId: 1 });
  local('pointerdown', { target: handle, pointerId: 2 });
  global('pointermove', { pointerId: 2, clientX: 77 });
  global('pointercancel', { pointerId: 2 });
  assert.equal(handle.getAttribute('aria-valuenow'), '50');
  assert.equal(splits.drag.pointerId, 1);
  global('pointermove', { pointerId: 1, clientX: 64 });
  assert.equal(handle.getAttribute('aria-valuenow'), '64');
  split.parentElement = null;
  global('pointermove', { pointerId: 1, clientX: 55 });
  assert.equal(handle.getAttribute('aria-valuenow'), '64');
  assert.equal(splits.step(16, 0.016), false);
  global('pointerup', { pointerId: 1 });
  assert.equal(splits.drag, null);
  assert.equal(splits.states.size, 0);

  split.parentElement = stage.source;
  local('pointerdown', { target: handle, pointerId: 2 });
  global('pointermove', { pointerId: 2, clientX: 71 });
  global('pointerup', { pointerId: 2 });
  assert.equal(handle.getAttribute('aria-valuenow'), '71');
  assert.equal(splits.drag, null);
});
