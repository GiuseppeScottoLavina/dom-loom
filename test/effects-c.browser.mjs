// End-to-end checks of the fluid effect ([fluid]) in Chrome with WebGPU, on Chrome's own
// HTML-in-Canvas and on the polyfill (--disable-features=CanvasDrawElement).
//   node test/effects-c.browser.mjs            both paths
//   node test/effects-c.browser.mjs --native   only the native path
import assert from 'node:assert/strict';
import { launch, startServer } from './harness.mjs';

const only = process.argv.includes('--native') ? ['native'] : ['native', 'polyfill'];
const results = [];

async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FAIL ${name}\n       ${error.message.split('\n').join('\n       ')}`);
  }
}

const FIXTURE = 'test/fixtures/effects-c.html';

async function open(browser, url, { reduced = false, noGpu = false, touch = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: touch,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  if (noGpu) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  await page.goto(url + FIXTURE);
  const renderers = await page.evaluate(() =>
    customElements.whenDefined('loom-stage').then(() => Promise.all([...document.querySelectorAll('loom-stage')].map((s) => s.ready))));
  await page.waitForTimeout(1100); // the boot sweep
  return { page, context, errors, renderers };
}

const framesDuring = (page, ms, selector) => page.evaluate(async ({ ms, selector }) => {
  const canvas = document.querySelector(selector);
  if (!canvas) return -1;
  let n = 0;
  const count = () => n++;
  canvas.addEventListener('effectframe', count);
  await new Promise((r) => setTimeout(r, ms));
  canvas.removeEventListener('effectframe', count);
  return n;
}, { ms, selector });

/** Green channel of a screenshot, indexed from its top left in CSS px (DPR 1). */
async function greens(page, clip) {
  const png = await page.screenshot(clip ? { clip } : {});
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const g = new Array(c.width * c.height);
    for (let i = 0; i < g.length; i++) g[i] = d[i * 4 + 1];
    return { w: c.width, g };
  }, png.toString('base64'));
}

/** Drags the mouse along a polyline of page points, one move every ~16 ms. */
async function drag(page, points, { pause = 16 } = {}) {
  await page.mouse.move(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(pause);
  }
}

const line = (x0, y0, x1, y1, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

const fieldState = (page, id) => page.evaluate((id) => {
  const f = document.querySelector(id).field;
  let max = 0;
  for (const v of f.data) max = Math.max(max, Math.abs(v));
  return { active: f.active, max };
}, id);

/** Waits until the stage's field is off, and returns how long it took (ms). */
async function untilRest(page, id, limit = 9000) {
  const started = Date.now();
  while (Date.now() - started < limit) {
    if (!(await fieldState(page, id)).active) {
      const took = Date.now() - started;
      await page.waitForTimeout(250); // the frame that shows the rest is drawn
      return took;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(`${id} did not come to rest in ${limit} ms`);
}

/** Stops the water where it is (the grid keeps what it holds), for exact comparisons. */
const freeze = (page) => page.evaluate(async () => {
  const { FluidSim } = await import('/src/behaviors/fluid-sim.js');
  if (!window.__step) window.__step = FluidSim.prototype.step;
  FluidSim.prototype.step = function () { return this.maxShift; };
});
const thaw = (page) => page.evaluate(async () => {
  const { FluidSim } = await import('/src/behaviors/fluid-sim.js');
  if (window.__step) FluidSim.prototype.step = window.__step;
});

async function run(path, browser, url) {
  console.log(`\n${path}`);
  const { page, context, errors, renderers } = await open(browser, url);
  const box = (sel) => page.locator(sel).boundingBox();

  await check(`${path}: every stage is drawn by the compositor, on the right path`, async () => {
    assert.deepEqual(renderers, ['webgpu', 'webgpu', 'webgpu', 'webgpu']);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('loom-stage')].map((s) => [s.dataset.renderer, s.dataset.mode])),
      Array(4).fill(['webgpu', path]));
  });

  await check(`${path}: after load nothing asks for frames, with the field off`, async () => {
    assert.equal(await framesDuring(page, 1000, '#water canvas'), 0);
    assert.equal(await framesDuring(page, 600, '#twin canvas'), 0);
    assert.deepEqual(await fieldState(page, '#water'), { active: false, max: 0 });
  });

  await check(`${path}: a stage without [fluid], and a panel that is not water, take the pointer and stay at rest`, async () => {
    const p = await box('#plain');
    await drag(page, line(p.x + 5, p.y + 5, p.x + p.width - 5, p.y + p.height - 5, 12));
    assert.equal(await framesDuring(page, 500, '#plain canvas'), 0);
    const d = await box('#dry');
    await page.mouse.move(d.x + 180, d.y + 10);
    await drag(page, line(d.x + 180, d.y + 10, d.x + d.width - 10, d.y + d.height - 10, 14));
    assert.deepEqual(await fieldState(page, '#weak'), { active: false, max: 0 }, 'a stroke over a dry panel stirs nothing');
    assert.equal(await framesDuring(page, 500, '#weak canvas'), 0);
  });

  await check(`${path}: a stroke stirs the water under it, the picture swirls and comes back to rest by itself`, async () => {
    const b = await box('#water');
    const frames = framesDuring(page, 700, '#water canvas');
    await drag(page, line(b.x + 60, b.y + 150, b.x + 480, b.y + 140, 20));
    assert.ok((await frames) > 5, 'frames are drawn while it moves');
    const mid = await fieldState(page, '#water');
    assert.equal(mid.active, true);
    assert.ok(mid.max > 6, `the water is displaced (${mid.max.toFixed(1)} px)`);
    await page.mouse.move(b.x + b.width + 40, b.y - 30);
    const took = await untilRest(page, '#water');
    assert.deepEqual(await fieldState(page, '#water'), { active: false, max: 0 });
    assert.equal(await framesDuring(page, 800, '#water canvas'), 0, 'no frames once it rests');
    console.log(`       it took ${took} ms to come to rest`);
  });

  await check(`${path}: the water is where the finger is, and the picture on the GPU is what the mapper says`, async () => {
    const stage = page.locator('#water');
    await stage.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    // The glint and the caustics are light on top; for the comparison the water only moves the picture.
    await page.evaluate(async () => {
      const m = await import('/src/index.js');
      const { FLUID } = await import('/src/primitives/fluid.js');
      window.__holo = m.holo;
      m.defineSkin({ ...m.holo, draw: { ...m.holo.draw, fluid: (scene, s) => scene.push(FLUID, s.rect, [s.strength, 0, 0, 0]) } });
    });
    await page.waitForTimeout(300);
    const b = await box('#water');
    const rest = await greens(page);
    await drag(page, line(b.x + 90, b.y + 150, b.x + 450, b.y + 150, 14), { pause: 14 });
    await freeze(page);
    await page.waitForTimeout(500);
    // The finger dragged the water to the right, along y = 150 from x = 90 to 450.
    const cell = await page.evaluate(({ bx, by }) => {
      const stage = document.querySelector('#water');
      const f = stage.field;
      const canvas = stage.querySelector('canvas').getBoundingClientRect();
      let best = null;
      for (let r = 0; r < f.rows; r++) {
        for (let c = 0; c < f.cols; c++) {
          const m = Math.hypot(f.data[(r * f.cols + c) * 2], f.data[(r * f.cols + c) * 2 + 1]);
          if (!best || m > best.m) best = { m, c, r, ox: f.data[(r * f.cols + c) * 2], oy: f.data[(r * f.cols + c) * 2 + 1] };
        }
      }
      const x = ((best.c + 0.5) / f.cols) * canvas.width + canvas.left - bx;
      const y = ((best.r + 0.5) / f.rows) * canvas.height + canvas.top - by;
      return { ...best, x, y };
    }, { bx: b.x, by: b.y });
    assert.ok(cell.m > 8, `a clear displacement (${cell.m.toFixed(1)} px)`);
    assert.ok(cell.ox < 0, `content follows the finger to the right: o.x < 0 (${cell.ox.toFixed(1)})`);
    assert.ok(cell.x > 60 && cell.x < 480 && cell.y > 90 && cell.y < 210, `at the stroke (${cell.x.toFixed(0)}, ${cell.y.toFixed(0)})`);

    const canvas = await box('#water canvas');
    const turned = await greens(page);
    const samples = [];
    for (let y = Math.ceil(canvas.y + 70); y < canvas.y + canvas.height - 40; y += 1) {
      for (let x = Math.ceil(canvas.x + 40); x < canvas.x + canvas.width - 40; x += 2) samples.push({ x, y });
    }
    const mapped = await page.evaluate(({ samples, cx, cy }) => {
      const stage = document.querySelector('#water');
      return samples.map(({ x, y }) => stage.mapPoint({ x: x + 0.5 - cx, y: y + 0.5 - cy }));
    }, { samples, cx: canvas.x, cy: canvas.y });
    let moved = 0;
    let viaMapper = 0;
    let viaIdentity = 0;
    samples.forEach(({ x, y }, i) => {
      const m = mapped[i];
      if (!m) return;
      const sx = m.x + canvas.x - 0.5;
      const sy = m.y + canvas.y - 0.5;
      if (Math.hypot(sx - x, sy - y) < 1.5) return;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const at = (xx, yy) => rest.g[yy * rest.w + xx];
      const predicted = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      const flat = rest.g[y * rest.w + x];
      if (Math.abs(predicted - flat) < 50) return;
      moved++;
      const seen = turned.g[y * turned.w + x];
      if (Math.abs(seen - predicted) <= 45) viaMapper++;
      if (Math.abs(seen - flat) <= 45) viaIdentity++;
    });
    assert.ok(moved >= 40, `too few discriminating samples (${moved})`);
    assert.ok(viaMapper / moved >= 0.8, `mapper explains ${viaMapper}/${moved}, identity ${viaIdentity}/${moved}`);
    console.log(`       fluid: mapper ${viaMapper}/${moved} moved pixels, identity ${viaIdentity}/${moved}`);
    await thaw(page);
    await page.evaluate(async () => (await import('/src/index.js')).defineSkin(window.__holo));
    await page.mouse.move(b.x + b.width + 40, b.y - 30);
    await untilRest(page, '#water');
  });

  await check(`${path}: a click on displaced content lands on the button shown there, not on the one the layout has`, async () => {
    const stage = page.locator('#twin');
    await stage.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    const b = await box('#twin');
    // Dragging left across both buttons makes each pixel show content from its right.
    await drag(page, line(b.x + 520, b.y + 40, b.x + 40, b.y + 40, 12), { pause: 12 });
    await freeze(page);
    await page.waitForTimeout(500);
    const hit = await page.evaluate(() => {
      const stage = document.querySelector('#twin');
      const src = stage.source.getBoundingClientRect();
      const rects = ['a', 'b'].map((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { id, x: r.left - src.left, y: r.top - src.top, w: r.width, h: r.height };
      });
      const inner = (r, x, y) => Math.min(x - r.x, r.x + r.w - x, y - r.y, r.y + r.h - y);
      const of = (x, y) => rects.map((r) => ({ id: r.id, d: inner(r, x, y) })).find((r) => r.d > 0) ?? null;
      let best = null;
      for (let y = rects[0].y + 6; y < rects[0].y + rects[0].h - 6; y += 2) {
        for (let x = 0; x < src.width; x += 1) {
          const layout = of(x, y);
          const m = stage.mapPoint({ x, y });
          const shown = m && of(m.x, m.y);
          if (!layout || !shown || layout.id === shown.id || layout.d < 3 || shown.d < 5) continue;
          const score = Math.min(layout.d, shown.d);
          if (!best || score > best.score) best = { x, y, layout: layout.id, shown: shown.id, score };
        }
      }
      return best && { ...best, ox: src.left, oy: src.top };
    });
    assert.ok(hit, 'a point shows a different button from the one the layout has there');
    await page.evaluate(() => (window.__log.length = 0));
    await page.mouse.click(hit.ox + hit.x, hit.oy + hit.y);
    const log = await page.evaluate(() => window.__log.slice());
    assert.deepEqual(log, [hit.shown], `a click where button ${hit.shown.toUpperCase()} is drawn (layout: ${hit.layout.toUpperCase()}) clicks ${hit.shown.toUpperCase()}`);
    console.log(`       click at (${hit.x}, ${hit.y}): layout ${hit.layout.toUpperCase()}, shown ${hit.shown.toUpperCase()}, clicked ${log[0].toUpperCase()}`);
    await thaw(page);
    await page.mouse.move(b.x + b.width + 40, b.y - 30);
    await untilRest(page, '#twin');
    await page.waitForTimeout(900); // the press on the button has rung out
    assert.equal(await framesDuring(page, 600, '#twin canvas'), 0);
  });

  await check(`${path}: two [fluid] panels share one field; the one that is not water stays still`, async () => {
    const stage = page.locator('#weak');
    await stage.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    const half = await box('#half');
    const full = await box('#full');
    await drag(page, [
      ...line(half.x + 40, half.y + 20, half.x + half.width - 40, half.y + 24, 6),
      ...line(full.x + half.width - 40, full.y + 24, full.x + 40, full.y + 20, 6),
    ], { pause: 12 });
    await freeze(page);
    await page.waitForTimeout(400);
    const moved = await page.evaluate(() => {
      const stage = document.querySelector('#weak');
      const src = stage.source.getBoundingClientRect();
      const shift = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        let max = 0;
        for (let y = r.top - src.top + 6; y < r.bottom - src.top - 6; y += 3) {
          for (let x = r.left - src.left + 6; x < r.right - src.left - 6; x += 3) {
            const m = stage.mapPoint({ x, y });
            if (m) max = Math.max(max, Math.hypot(m.x - x, m.y - y));
          }
        }
        return max;
      };
      return { half: shift('half'), full: shift('full'), dry: shift('dry') };
    });
    assert.ok(moved.half > 1, `the half panel moves (${moved.half.toFixed(1)})`);
    assert.ok(moved.full > 1, `the full panel moves (${moved.full.toFixed(1)})`);
    assert.ok(moved.dry < 0.01, `the dry panel does not (${moved.dry.toFixed(2)})`);
    await thaw(page);
    await page.mouse.move(2, 2);
    await untilRest(page, '#weak');
    assert.equal(await framesDuring(page, 600, '#weak canvas'), 0);
  });

  await check(`${path}: the fluid step stays a small part of a frame (under 2 ms) in the page`, async () => {
    const stage = page.locator('#water');
    await stage.scrollIntoViewIfNeeded();
    const b = await box('#water');
    await page.evaluate(async () => {
      const { FluidSim } = await import('/src/behaviors/fluid-sim.js');
      const step = FluidSim.prototype.step;
      window.__costs = [];
      FluidSim.prototype.step = function (dt) {
        const t = performance.now();
        const r = step.call(this, dt);
        window.__costs.push(performance.now() - t);
        return r;
      };
      window.__restore = () => { FluidSim.prototype.step = step; };
    });
    for (let k = 0; k < 3; k++) {
      await drag(page, [...line(b.x + 60, b.y + 100, b.x + 480, b.y + 220, 16), ...line(b.x + 480, b.y + 220, b.x + 80, b.y + 140, 16)], { pause: 12 });
    }
    await untilRest(page, '#water');
    const costs = await page.evaluate(() => { window.__restore(); return window.__costs; });
    const avg = costs.reduce((a, c) => a + c, 0) / costs.length;
    const worst = Math.max(...costs);
    console.log(`       ${costs.length} steps: ${avg.toFixed(3)} ms average, ${worst.toFixed(3)} ms worst`);
    assert.ok(costs.length > 60);
    assert.ok(avg < 2, `average ${avg.toFixed(3)} ms`);
  });

  await check(`${path}: no console errors or page errors`, async () => {
    assert.deepEqual(errors, []);
  });
  await context.close();

  await check(`${path}: a touch drag stirs the water too, and it rests again`, async () => {
    const touch = await open(browser, url, { touch: true });
    try {
      assert.deepEqual(touch.renderers, ['webgpu', 'webgpu', 'webgpu', 'webgpu']);
      const b = await touch.page.locator('#water').boundingBox();
      const client = await touch.context.newCDPSession(touch.page);
      const send = (type, x, y) => client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
      const frames = framesDuring(touch.page, 700, '#water canvas');
      const points = line(b.x + 60, b.y + 150, b.x + 480, b.y + 140, 20);
      await send('touchStart', ...points[0]);
      for (const [x, y] of points.slice(1)) {
        await send('touchMove', x, y);
        await touch.page.waitForTimeout(16);
      }
      const during = await fieldState(touch.page, '#water');
      await send('touchEnd');
      assert.ok((await frames) > 5, 'frames are drawn');
      assert.ok(during.active && during.max > 4, `the water is displaced by the touch (${during.max.toFixed(1)} px)`);
      await untilRest(touch.page, '#water');
      assert.equal(await framesDuring(touch.page, 600, '#water canvas'), 0);
      assert.deepEqual(touch.errors, []);
    } finally {
      await touch.context.close();
    }
  });

  await check(`${path}: reduced motion: no effect at all, and the page still works`, async () => {
    const reduced = await open(browser, url, { reduced: true });
    try {
      const b = await reduced.page.locator('#water').boundingBox();
      await drag(reduced.page, line(b.x + 60, b.y + 150, b.x + 480, b.y + 140, 20));
      assert.equal(await framesDuring(reduced.page, 600, '#water canvas'), 0);
      assert.deepEqual(await fieldState(reduced.page, '#water'), { active: false, max: 0 });
      const alpha = await reduced.page.locator('#alpha').boundingBox();
      await reduced.page.mouse.click(alpha.x + alpha.width / 2, alpha.y + alpha.height / 2);
      assert.deepEqual(await reduced.page.evaluate(() => window.__log), ['alpha']);
      assert.deepEqual(reduced.errors, []);
    } finally {
      await reduced.context.close();
    }
  });

  await check(`${path}: without WebGPU the stage falls back to the DOM and a stroke does nothing`, async () => {
    const dom = await open(browser, url, { noGpu: true });
    try {
      assert.deepEqual(dom.renderers, ['dom', 'dom', 'dom', 'dom']);
      const b = await dom.page.locator('#water').boundingBox();
      await drag(dom.page, line(b.x + 60, b.y + 150, b.x + 480, b.y + 140, 20));
      await dom.page.waitForTimeout(300);
      assert.deepEqual(await fieldState(dom.page, '#water'), { active: false, max: 0 });
      const alpha = await dom.page.locator('#alpha').boundingBox();
      await dom.page.mouse.click(alpha.x + alpha.width / 2, alpha.y + alpha.height / 2);
      assert.deepEqual(await dom.page.evaluate(() => window.__log), ['alpha']);
      assert.deepEqual(dom.errors, []);
    } finally {
      await dom.context.close();
    }
  });
}

const { server, url } = await startServer();
try {
  for (const path of only) {
    const browser = await launch({ polyfill: path === 'polyfill' });
    try {
      await run(path, browser, url);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
