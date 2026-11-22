// Share observation across all pending stages, including stages in scroll containers.
const documents = new WeakMap();
const QUIET_MS = 120;
const START_GAP_MS = 120;

function queueFor(doc) {
  let queue = documents.get(doc);
  if (queue) return queue;
  const win = doc.defaultView;
  const starts = new Map();
  const nearby = new Set();
  let lastScroll = -Infinity;
  let lastStart = -Infinity;
  let ranked = [];
  let timer = null;

  function update(entries) {
    for (const entry of entries) {
      if (!starts.has(entry.target)) continue;
      if (entry.isIntersecting) {
        if (!nearby.has(entry.target)) ranked = [];
        nearby.add(entry.target);
      } else nearby.delete(entry.target);
    }
  }

  function nextStage() {
    if (nearby.size === 1) return nearby.values().next().value;
    if (!ranked.length) {
      // IO rectangles can be from before the scroll. Read the live rectangles
      // together once after it settles, before any enhancement changes layout.
      const w = win.innerWidth;
      const h = win.innerHeight;
      const candidates = [...nearby].map(stage => {
        const r = stage.getBoundingClientRect();
        const visible = r.right > 0 && r.left < w && r.bottom > 0 && r.top < h;
        const x = (r.left + r.right - w) / 2;
        const y = (r.top + r.bottom - h) / 2;
        return { stage, visible, distance: x * x + y * y };
      });
      candidates.sort((a, b) => Number(b.visible) - Number(a.visible) || a.distance - b.distance);
      ranked = candidates.map(c => c.stage);
    }
    let stage;
    do { stage = ranked.shift(); } while (!nearby.has(stage));
    return stage;
  }

  function arm(delay) {
    if (timer !== null) return;
    timer = win.setTimeout(() => {
      timer = null;
      update(observer.takeRecords());
      flush();
    }, Math.ceil(delay));
  }

  function flush() {
    if (!nearby.size) {
      ranked = [];
      win.clearTimeout(timer);
      timer = null;
      return;
    }
    const earliest = Math.max(lastScroll + QUIET_MS, lastStart + START_GAP_MS);
    const remaining = earliest - win.performance.now();
    if (remaining > 0) {
      arm(remaining);
      return;
    }
    starts.get(nextStage())();
    if (nearby.size) arm(START_GAP_MS);
  }

  const observer = new win.IntersectionObserver(entries => {
    update(entries);
    flush();
  }, { rootMargin: '240px' });
  const onScroll = () => {
    lastScroll = win.performance.now();
    ranked.length = 0;
  };
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });

  queue = {
    add(stage, start) {
      starts.set(stage, start);
      observer.observe(stage);
    },
    started() { lastStart = win.performance.now(); },
    remove(stage) {
      starts.delete(stage);
      nearby.delete(stage);
      observer.unobserve(stage);
      if (!nearby.size) {
        ranked = [];
        win.clearTimeout(timer);
        timer = null;
      }
      if (!starts.size) {
        observer.disconnect();
        doc.removeEventListener('scroll', onScroll, true);
        documents.delete(doc);
      }
    },
  };
  documents.set(doc, queue);
  return queue;
}

/** Schedule automatic enhancement and return the same immediate start used by input and ready. */
export function scheduleLazyStage(stage, start, connectionSignal) {
  if (connectionSignal.aborted) return () => {};
  const queue = queueFor(stage.ownerDocument);
  let waiting = true;
  function cancel() {
    if (!waiting) return;
    waiting = false;
    queue.remove(stage);
    stage.removeEventListener('focusin', startNow, true);
    stage.removeEventListener('pointerdown', startNow, true);
    connectionSignal.removeEventListener('abort', cancel);
  }
  function startNow() {
    if (!waiting) return;
    queue.started();
    cancel();
    start();
  }
  connectionSignal.addEventListener('abort', cancel, { once: true });
  stage.addEventListener('focusin', startNow, true);
  stage.addEventListener('pointerdown', startNow, { capture: true, passive: true });
  queue.add(stage, startNow);
  return startNow;
}
