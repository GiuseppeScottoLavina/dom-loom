import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleLazyStage } from '../src/core/lazy-stage.js';

function fixture() {
  let observers = 0;
  let observer;
  let now = 0;
  let timerId = 0;
  let rectReads = 0;
  const timers = new Map();
  const scrollListeners = new Set();
  const doc = new class extends EventTarget {
    addEventListener(type, listener, options) {
      assert.deepEqual([type, options.capture, options.passive], ['scroll', true, true]);
      scrollListeners.add(listener);
      super.addEventListener(type, listener, options);
    }
    removeEventListener(type, listener, capture) {
      assert.equal(capture, true);
      assert.ok(scrollListeners.delete(listener));
      super.removeEventListener(type, listener, capture);
    }
  }();
  doc.defaultView = {
    innerWidth: 1000, innerHeight: 800, performance: { now: () => now },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, at: now + ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    IntersectionObserver: class {
      stages = new Set();
      records = [];
      constructor(callback, { rootMargin }) {
        assert.equal(rootMargin, '240px');
        this.deliver = (...entries) => callback(entries);
        observer = this;
        observers++;
      }
      observe(stage) { this.stages.add(stage); }
      unobserve(stage) { this.stages.delete(stage); }
      disconnect() { this.disconnected = true; }
      takeRecords() { return this.records.splice(0); }
    },
  };
  function advance(ms) {
    now += ms;
    for (const [id, { fn, at }] of [...timers]) {
      if (at > now) continue;
      timers.delete(id);
      fn();
    }
  }
  return {
    stage: (top = 300) => Object.assign(new EventTarget(), {
      ownerDocument: doc,
      getBoundingClientRect() { rectReads++; return { left: 100, right: 900, top, bottom: top + 150 }; },
    }),
    get reads() { return rectReads; }, get now() { return now; },
    get observer() { return observer; }, get count() { return observers; },
    get timers() { return timers.size; }, get listeners() { return scrollListeners.size; },
    scroll: () => doc.dispatchEvent(new Event('scroll')), advance,
  };
}

test('scrolling defers newly approached stages and drops those passed before 120 ms of quiet', () => {
  const env = fixture();
  const [initial, passed, visible] = [env.stage(), env.stage(), env.stage()];
  const started = [];
  const connection = new AbortController();
  for (const stage of [initial, passed, visible]) scheduleLazyStage(stage, () => started.push(stage), connection.signal);
  assert.equal(env.count, 1);
  assert.equal(env.listeners, 1);
  const entry = (target, isIntersecting) => ({ target, isIntersecting });
  env.observer.deliver(entry(initial, true));
  assert.deepEqual(started, [initial]);
  env.scroll();
  env.observer.deliver(entry(passed, true), entry(visible, true));
  for (let i = 0; i < 8; i++) { env.advance(30); env.scroll(); }
  assert.deepEqual(started, [initial]);
  // An exit already queued by the browser can precede the next observer callback.
  env.observer.records.push(entry(passed, false));
  env.advance(119);
  assert.deepEqual(started, [initial]);
  env.advance(1);
  assert.deepEqual(started, [initial, visible]);
  env.observer.deliver(entry(passed, true));
  env.advance(120);
  assert.deepEqual(started, [initial, visible, passed]);
  assert.equal(env.timers, 0);
  assert.ok(env.observer.disconnected);
});

test('ready, focus or a press starts once even during scroll; abort removes every pending start', () => {
  for (const trigger of ['ready', 'focusin', 'pointerdown', 'disconnect']) {
    const env = fixture();
    const stage = env.stage();
    const controller = new AbortController();
    let count = 0;
    const start = scheduleLazyStage(stage, () => count++, controller.signal);
    env.scroll();
    env.observer.deliver({ target: stage, isIntersecting: true });
    if (trigger === 'disconnect') controller.abort();
    else if (trigger === 'ready') start();
    else stage.dispatchEvent(new Event(trigger));
    start();
    env.advance(150);
    stage.dispatchEvent(new Event('pointerdown'));
    assert.equal(count, trigger === 'disconnect' ? 0 : 1);
    assert.equal(env.timers, 0);
    assert.ok(env.observer.disconnected);
    assert.equal(env.listeners, 0);
    const next = scheduleLazyStage(stage, () => {}, new AbortController().signal);
    assert.equal(env.count, 2);
    next();
  }
});

test('three approaching stages start centre-first over separate intervals with one geometry pass', () => {
  const env = fixture();
  const fringe = env.stage(850);
  const edge = env.stage(5);
  const centre = env.stage(330);
  const stages = [fringe, edge, centre];
  const started = [];
  for (const stage of stages) scheduleLazyStage(stage, () => started.push([stage, env.now]), new AbortController().signal);
  env.scroll();
  env.observer.deliver(...stages.map(target => ({ target, isIntersecting: true })));
  assert.equal(env.reads, 0);
  env.advance(120);
  assert.deepEqual(started, [[centre, 120]]);
  env.advance(119);
  assert.equal(started.length, 1);
  env.advance(1);
  assert.deepEqual(started, [[centre, 120], [edge, 240]]);
  env.advance(120);
  assert.deepEqual(started, [[centre, 120], [edge, 240], [fringe, 360]]);
  assert.equal(env.reads, 3);
  assert.equal(env.timers, 0);
});

test('scroll and exits between scheduled starts invalidate the previous ranking', () => {
  const env = fixture();
  const stages = [env.stage(320), env.stage(100), env.stage(850)];
  const started = [];
  for (const stage of stages) scheduleLazyStage(stage, () => started.push(stage), new AbortController().signal);
  env.observer.deliver(...stages.map(target => ({ target, isIntersecting: true })));
  assert.deepEqual(started, [stages[0]]);
  env.advance(80);
  env.scroll();
  env.observer.records.push({ target: stages[1], isIntersecting: false });
  env.advance(40);
  assert.deepEqual(started, [stages[0]]);
  env.advance(80);
  assert.deepEqual(started, [stages[0], stages[2]]);
  assert.equal(env.timers, 0);
});
