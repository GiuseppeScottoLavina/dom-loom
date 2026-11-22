import assert from 'node:assert/strict';
import test from 'node:test';

// The compositor and the presentation clock are driven separately so the stage
// can be interrupted before capture, after a DOM update or during the animation.
const frames = new Map();
let nextFrame = 0;
globalThis.requestAnimationFrame = (callback) => {
  frames.set(++nextFrame, callback);
  return nextFrame;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
globalThis.HTMLElement = class {
  isConnected = true;
  top = 0;
  getAttribute() { return null; }
  getBoundingClientRect() {
    return { left: 0, right: 60, width: 60, top: this.top, bottom: this.top + 30, height: 30 };
  }
};
const { LoomStage } = await import('../src/core/stage.js');
const { defineSkin } = await import('../src/core/skin.js');
defineSkin({ name: 'holo' });
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const opts = { cut: false, morph: [] };

function fixture() {
  const stage = new LoomStage();
  const doc = new EventTarget();
  const observers = new Set();
  doc.defaultView = {
    innerWidth: 600,
    innerHeight: 800,
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    },
  };
  stage.ownerDocument = doc;
  const captures = [];
  const compositor = {
    sourceVersion: 1,
    captureGhost(signal) {
      return new Promise(resolve => {
        captures.push({ signal, resolve });
        signal.addEventListener('abort', () => resolve(false), { once: true });
      });
    },
    waitForSource: () => Promise.resolve(true),
    requestRender() {},
  };
  stage._attachCompositor(compositor);
  return { stage, doc, compositor, observers, captures };
}

test('overlapping transitions apply both callbacks in order and release both callers', async () => {
  const { stage, captures, compositor } = fixture();
  const calls = [];
  const a = stage.transition(() => calls.push('a'), opts);
  const b = stage.transition(() => calls.push('b'), opts);
  assert.equal(captures.length, 2);
  assert.ok(captures[0].signal.aborted);
  captures[1].resolve(true);
  await nextTurn();
  assert.deepEqual(calls, ['a', 'b']);
  await a;
  stage._detachCompositor(compositor);
  await b;
  assert.equal(frames.size, 0);
});

test('a superseded async callback rejects its own request and leaves the current animation alone', async () => {
  const { stage, captures, doc } = fixture();
  let rejectUpdate;
  const a = stage.transition(() => new Promise((_, reject) => { rejectUpdate = reject; }), opts);
  captures[0].resolve(true);
  await nextTurn();
  assert.equal(stage._needsFrames(), false, 'waiting on the user callback holds a still frame');
  const b = stage.transition(() => {}, opts);
  rejectUpdate(new Error('async update failed'));
  await assert.rejects(a, /async update failed/);
  assert.equal(captures[1].signal.aborted, false);
  captures[1].resolve(true);
  await nextTurn();
  assert.equal(frames.size, 1);
  for (const [id, callback] of frames) {
    frames.delete(id);
    callback();
  }
  await nextTurn();
  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  await b;
});

test('offscreen changes update the DOM immediately and never request a capture', async () => {
  const { stage, captures } = fixture();
  stage.top = 900;
  const calls = [];
  const cut = stage.transition(() => calls.push('cut'), opts);
  const roll = stage._change(null, () => { calls.push('roll'); return false; }, 'roll');
  const details = { open: false };
  await stage._disclose(details);
  assert.ok(details.open);
  assert.deepEqual(calls, ['cut', 'roll']);
  assert.equal(captures.length, 0);
  await cut;
  assert.equal(await roll, false);
});

test('moving offscreen between requests preserves the order of a burst of state updates', async () => {
  const { stage } = fixture();
  const calls = [];
  const first = stage.transition(() => calls.push('a'), opts);
  stage.top = 900;
  const second = stage.transition(() => calls.push('b'), opts);
  const third = stage.transition(() => calls.push('c'), opts);
  await Promise.all([first, second, third]);
  assert.deepEqual(calls, ['a', 'b', 'c']);
});

test('scrolling away or detaching during capture still applies each update once', async () => {
  const { stage, captures, compositor, observers } = fixture();
  const details = { open: false };
  const first = stage._disclose(details);
  const second = stage._disclose(details);
  for (const observer of observers) observer.callback([{ isIntersecting: false }]);
  await Promise.all([first, second]);
  assert.equal(details.open, false);
  assert.equal(observers.size, 0);
  let calls = 0;
  const cut = stage.transition(() => calls++, opts);
  stage._detachCompositor(compositor);
  await cut;
  assert.equal(calls, 1);
  assert.ok(captures.every(({ signal }) => signal.aborted));
});

test('a capture timeout and a failed value change release the ghost for the next operation', async () => {
  const { stage, captures, observers } = fixture();
  const timedOut = stage._change(null, () => false, 'roll');
  captures[0].resolve(false);
  assert.equal(await timedOut, false);
  const failed = stage._change(null, () => { throw new Error('change failed'); }, 'roll');
  captures[1].resolve(true);
  await assert.rejects(failed, /change failed/);
  assert.equal(observers.size, 0);
  assert.equal(stage._needsFrames(), false);
});

test('a source timeout requests the live picture once the held ghost ends', async () => {
  const { stage, captures, compositor } = fixture();
  compositor.waitForSource = () => Promise.resolve(false);
  let paints = 0;
  compositor.requestRender = () => paints++;
  const t = stage.transition(() => {}, opts);
  captures[0].resolve(true);
  await t;
  assert.equal(paints, 1);
  assert.equal(stage._needsFrames(), false);
});

test('a late compositor for an obsolete canvas cannot replace or detach the current host', async () => {
  const { stage, captures } = fixture();
  const stale = {};
  stage._attachCompositor(stale, {});
  stage._detachCompositor(stale);
  assert.equal(stage.gpu, true);
  const t = stage.transition(() => {}, opts);
  captures[0].resolve(false);
  await t;
});
