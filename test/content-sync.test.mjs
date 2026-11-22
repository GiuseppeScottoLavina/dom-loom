import assert from 'node:assert/strict';
import test from 'node:test';
import { defineBehavior, defineSkin, extendSkin, LoomStage } from '../src/index.js';
import { createListElement } from '../src/core/list-elements.js';
import { Chips } from '../src/behaviors/chips.js';
import { Gauges } from '../src/behaviors/gauges.js';
import { Ranges } from '../src/behaviors/ranges.js';
import { Notices } from '../src/behaviors/notices.js';

const childList = (target, addedNodes, removedNodes = []) => ({ type: 'childList', target, addedNodes, removedNodes });
const attribute = (target, attributeName) => ({ type: 'attributes', target, attributeName, addedNodes: [], removedNodes: [] });
const element = (selectors = []) => ({
  nodeType: 1, isConnected: true, childElementCount: 0, style: { setProperty() {} },
  matches(selector) { return selectors.includes(selector); },
  closest(selector) { return this.matches(selector) ? this : null; },
});

test('stage routes content edits, keeps custom sync and installs lazy behaviours synchronously', async () => {
  const controls = new Map();
  const queries = [];
  const observers = [];
  const frames = new Map();
  let frameId = 0;
  let reads = 0;
  let wakes = 0;
  const source = {
    ...element(), append() {}, contains(el) { return el.isConnected; },
    querySelectorAll(selector) { queries.push(selector); return controls.get(selector) ?? []; },
  };
  const media = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { createElement() { return { ...element(), remove() {} }; } });
  globalThis.getComputedStyle = () => { reads++; return { color: 'rgb(1,2,3)' }; };
  globalThis.matchMedia = () => media;
  globalThis.requestAnimationFrame = cb => { frames.set(++frameId, cb); return frameId; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  globalThis.MutationObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.target = null; }
  };
  class Stage extends LoomStage {
    dataset = {};
    get isConnected() { return true; }
    querySelector() { return source; }
    closest() { return null; }
    hasAttribute(name) { return name === 'static'; }
    getAttribute() { return null; }
    listen() {}
    listenGlobal() {}
    wake() { wakes++; }
  }
  const stage = new Stage();
  stage.connectedCallback();
  await stage.ready;
  const content = observers.find(o => o.target === source);
  const flush = () => {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(performance.now()); }
  };
  const clock = element();
  const text = { nodeType: 3, parentElement: clock };
  queries.length = 0;
  wakes = 0;
  for (let n = 0; n < 18; n++) {
    content.cb([childList(clock, [text], [text])]);
    flush();
  }
  assert.deepEqual(queries, []);
  assert.equal(wakes, 0);

  // A new control still gets discovered. Subsequent value edits use the same
  // animation state and can be coalesced without any further stage queries.
  const progress = Object.assign(element(['progress, meter']), { localName: 'progress', position: 0.25 });
  controls.set('progress, meter', [progress]);
  content.cb([childList(source, [progress])]);
  flush();
  const gauge = stage.behavior('gauges').states.get(progress);
  assert.equal(gauge.f, 0.25);
  queries.length = 0;
  progress.position = 0.75;
  content.cb([attribute(progress, 'value'), attribute(progress, 'max')]);
  assert.equal(frames.size, 1);
  flush();
  assert.equal(gauge.f, 0.75);
  assert.deepEqual(queries, []);

  const badge = Object.assign(element(['[badge]']), { textContent: '1' });
  controls.set('[badge]', [badge]);
  content.cb([childList(source, [badge])]);
  flush();
  queries.length = 0;
  badge.textContent = '2';
  content.cb([childList(badge, [text], [text])]);
  assert.equal(stage.behavior('notices').pings[0].el, badge);
  assert.deepEqual(queries, []);

  // A framework can edit the same tree as the generated listbox.
  const list = createListElement('ul');
  const option = createListElement('li');
  content.cb([childList(list, [option]), attribute(option, 'aria-selected')]);
  flush();
  assert.deepEqual(queries, []);
  content.cb([childList(list, [element()])]);
  flush();
  assert.ok(queries.includes('button[hold]'));

  const initialReads = reads;
  const initialWakes = wakes;
  extendSkin('holo', { testOne() {} });
  extendSkin('holo', { testTwo() {} });
  await new Promise(queueMicrotask);
  assert.equal(reads, initialReads);
  assert.equal(wakes, initialWakes + 1);
  defineSkin({ name: 'holo', tokens: { hot: ['--hot', '#fff'] } });
  assert.equal(reads, initialReads + 1);
  const beforeMedia = wakes;
  media.dispatchEvent(new Event('change'));
  assert.equal(wakes, beforeMedia + 1);

  let customSyncs = 0;
  class Plugin { sync() { customSyncs++; } }
  queries.length = 0;
  defineBehavior('test-plugin', Plugin);
  assert.ok(stage.behavior('test-plugin') instanceof Plugin);
  assert.equal(customSyncs, 1);
  assert.deepEqual(queries, []);
  content.cb([childList(clock, [text], [text]), attribute(progress, 'value')]);
  flush();
  assert.equal(customSyncs, 2);
  assert.deepEqual(queries, []);

  // A queued sync and a host observer must end with this stage connection.
  const host = {};
  stage.observe(host, { attributes: true }, () => {});
  content.cb([childList(clock, [text], [text])]);
  stage.disconnectedCallback();
  flush();
  assert.equal(customSyncs, 2);
  assert.ok(observers.every(o => o.target === null));
});

test('a static busy region keeps requesting frames only with animated GPU rendering', () => {
  const region = {};
  const stage = { gpu: false, reduced: false, visible: () => true, skin: { durations: {} },
    source: { querySelectorAll: q => q.includes('aria-busy') ? [region] : [] }, wake() {},
  };
  const notices = new Notices(stage);
  assert.equal(notices.step(1), false);
  stage.gpu = true;
  assert.equal(notices.step(2), true);
  stage.reduced = true;
  assert.equal(notices.step(3), false);
});

test('native indeterminate progress sleeps and a stationary slider needs no layout read in step', () => {
  const progress = { localName: 'progress', position: -1, style: { setProperty() {} } };
  const slider = { isConnected: true, value: '50', style: { setProperty() {} } };
  const stage = { gpu: false, reduced: false, visible: () => true, skin: { durations: { hit: 900, complete: 700 } },
    source: { querySelectorAll: q => q.includes('progress') ? [progress] : [slider] }, wake() {}, listen() {}, listenGlobal() {},
    rectOf() { throw Error('unexpected layout read'); },
  };
  const gauges = new Gauges(stage);
  const ranges = new Ranges(stage);
  assert.equal(gauges.step(1000, 1 / 60), false);
  assert.equal(Boolean(ranges.step(1000, 1 / 60)), false);
  stage.gpu = true;
  assert.equal(gauges.step(1001, 1 / 60), true);
});

test('chip names follow text edits while keeping author-supplied buttons and labels', () => {
  function removeButton(label = null) {
    return {
      getAttribute() { return label; },
      setAttribute(name, value) { assert.equal(name, 'aria-label'); label = value; },
    };
  }
  globalThis.document = { createElement: () => removeButton() };
  const authored = removeButton('Delete saved filter');
  let button = authored;
  const chip = { textContent: 'Active', closest: () => null, querySelector: () => button, append(el) { button = el; } };
  const stage = { source: { querySelectorAll: () => [chip] }, listen() {} };
  const chips = new Chips(stage);
  assert.equal(authored.getAttribute('aria-label'), 'Delete saved filter');
  button = null;
  chips.syncControl(chip);
  assert.equal(button.getAttribute('aria-label'), 'Remove Active');
  chip.textContent = 'Paused';
  chips.syncControl(chip);
  assert.equal(button.getAttribute('aria-label'), 'Remove Paused');
  button.setAttribute('aria-label', 'Clear selection');
  chips.syncControl(chip);
  assert.equal(button.getAttribute('aria-label'), 'Clear selection');
});
