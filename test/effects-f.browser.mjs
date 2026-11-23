// Checks of the CURL cut (stage.transition(update, { style: 'curl' })) in Chrome with WebGPU, on
// Chrome's own HTML-in-Canvas and on the polyfill (--disable-features=CanvasDrawElement).
//   node test/effects-f.browser.mjs            both paths
//   node test/effects-f.browser.mjs --native   only the native path
// The frozen frames drive page.clock: the curl is a function of the presented time, so the
// picture and the input mapper can be compared at the very same frame.
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

async function open(browser, url, { reduced = false, noGpu = false, clock = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 880, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  if (noGpu) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  if (clock) await page.clock.install();
  await page.goto(`${url}test/fixtures/effects-f.html`);
  const renderer = await page.evaluate(() =>
    customElements.whenDefined('loom-stage').then(async () => (await Promise.all([...document.querySelectorAll('loom-stage')].map((s) => s.ready)))));
  await page.waitForTimeout(1100); // the boot sweep
  return { page, context, errors, renderer };
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

/** Runs a turn and counts the frames drawn while it plays. */
const turnCounting = (page, call, selector) => page.evaluate(async ({ call, selector }) => {
  const canvas = document.querySelector(selector);
  let n = 0;
  const count = () => n++;
  canvas.addEventListener('effectframe', count);
  await eval(call);
  canvas.removeEventListener('effectframe', count);
  return n;
}, { call, selector });

/** The red, green and blue of every pixel of one row of the stage, from a screenshot (DPR 1). */
async function rowOf(page, box, y) {
  const png = await page.screenshot({ clip: { x: box.x, y: box.y + Math.round(y), width: box.width, height: 1 } });
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bitmap.width, 1);
    const ctx = c.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return Array.from(ctx.getImageData(0, 0, c.width, 1).data);
  }, png.toString('base64'));
}

/**
 * Where the old page starts to show along the row y of the stage, as the mapper has it: the
 * boundary between live points (the new page) and the point where input stops (the old page).
 * dir 1 looks from the left, -1 from the right (the new page lies on the starting side).
 */
const boundary = (page, sel, y, dir) => page.evaluate(({ sel, y, dir }) => {
  const stage = document.querySelector(sel);
  const w = stage.getBoundingClientRect().width;
  const live = (x) => stage.mapPoint({ x, y }) !== null;
  if (dir > 0) {
    for (let x = 0; x < w; x += 0.5) if (!live(x)) return x;
  } else {
    for (let x = w; x > 0; x -= 0.5) if (!live(x)) return x;
  }
  return null;
}, { sel, y, dir });

/** The first pixel brighter than the resting picture, from the side the new page is on. */
function brightEdge(row, ref, dir) {
  const n = row.length / 4;
  const bright = (x) => [0, 1, 2].some((c) => row[x * 4 + c] > ref[x * 4 + c] + 25);
  if (dir > 0) {
    for (let x = 0; x < n - 1; x++) if (bright(x) && bright(x + 1)) return x;
  } else {
    for (let x = n - 1; x > 0; x--) if (bright(x) && bright(x - 1)) return x + 1;
  }
  return null;
}

const CONFIGS = [
  { name: 'full stage, from the left', stage: '#whole', dir: 1, turn: (to, d, s) => `turnFull('${to}', ${d}, ${s})`, a: 'sheet-a', b: 'sheet-b', btn: 'b1', band: '#sheet-b p', bars: '#sheet-b .bars' },
  { name: 'full stage, from the right', stage: '#whole', dir: -1, turn: (to, d, s) => `turnFull('${to}', ${d}, ${s})`, a: 'sheet-a', b: 'sheet-b', btn: 'b1', band: '#sheet-b p', bars: '#sheet-b .bars' },
  { name: 'scoped panel, from the left', stage: '#panels', dir: 1, turn: (to, d, s) => `turnPanel('${to}', ${d}, ${s})`, a: 'panel-a', b: 'panel-b', btn: 'pb1', band: '#panel-b .grid', bars: '#panel-b .bars' },
  { name: 'scoped panel, from the right', stage: '#panels', dir: -1, turn: (to, d, s) => `turnPanel('${to}', ${d}, ${s})`, a: 'panel-a', b: 'panel-b', btn: 'pb1', band: '#panel-b .grid', bars: '#panel-b .bars' },
];

async function run(path, browser, url) {
  console.log(`\n${path}`);

  // Both stages, both ways, in real time: the page turns, the DOM ends where it should, the stage rests.
  await check(`${path}: the curl plays on the GPU, both directions, full stage and scoped, then the stage rests`, async () => {
    const session = await open(browser, url);
    const { page } = session;
    assert.deepEqual(session.renderer, ['webgpu', 'webgpu']);
    for (const cfg of CONFIGS) {
      const hidden = (id) => page.evaluate((id) => document.getElementById(id).hidden, id);
      const frames = await turnCounting(page, cfg.turn(cfg.b, cfg.dir, "'curl'"), `${cfg.stage} canvas`);
      assert.ok(frames > 12, `${cfg.name}: the curl drew ${frames} frames`);
      assert.deepEqual([await hidden(cfg.a), await hidden(cfg.b)], [true, false], `${cfg.name}: the panels switched`);
      await page.waitForTimeout(300);
      assert.equal(await framesDuring(page, 800, `${cfg.stage} canvas`), 0, `${cfg.name}: no frames at rest after the curl`);
      assert.deepEqual(await page.evaluate((sel) => [document.querySelector(sel).dataset.renderer, document.querySelector(sel).dataset.mode], cfg.stage), ['webgpu', path]);
      // The last frame is the plain live page: points map to themselves.
      const identity = await page.evaluate((sel) => [[40, 20], [300, 150], [700, 200]].map(([x, y]) => {
        const m = document.querySelector(sel).mapPoint({ x, y });
        return m && Math.abs(m.x - x) < 0.01 && Math.abs(m.y - y) < 0.01;
      }), cfg.stage);
      assert.deepEqual(identity, [true, true, true], `${cfg.name}: the page is live after the curl`);
      await turnCounting(page, cfg.turn(cfg.a, -cfg.dir, "'curl'"), `${cfg.stage} canvas`);
      assert.deepEqual([await hidden(cfg.a), await hidden(cfg.b)], [false, true]);
    }
    assert.deepEqual(session.errors, []);
    await session.context.close();
  });

  // The picture and the mapper at one frame: where the old page shows, input stops.
  for (const cfg of CONFIGS) {
    await check(`${path}: ${cfg.name}: a frozen curl shows the old page exactly where the mapper stops input, and clicks land only on the new page`, async () => {
      const session = await open(browser, url, { clock: true });
      const { page } = session;
      assert.deepEqual(session.renderer, ['webgpu', 'webgpu']);
      const plain = async (to) => { await page.evaluate((c) => eval(c), cfg.turn(to, 1, "'blade'")); await page.waitForTimeout(250); };
      const box = await page.locator(cfg.stage).boundingBox();
      // Rows of the destination page: the empty band between its text and its bars, and its buttons.
      await plain(cfg.b);
      const rows = await page.evaluate(({ stage, band, bars, btn }) => {
        const s = document.querySelector(stage).getBoundingClientRect();
        const bandEl = document.querySelector(band).getBoundingClientRect();
        const barsEl = document.querySelector(bars).getBoundingClientRect();
        const b = document.getElementById(btn).getBoundingClientRect();
        return { y: (bandEl.bottom + barsEl.top) / 2 - s.y, ybtn: b.y + b.height / 2 - s.y };
      }, { stage: cfg.stage, band: cfg.band, bars: cfg.bars, btn: cfg.btn });
      // The scoped panel: its text is the grid, so the band lies between the grid and the bars.
      const yBand = rows.y;
      const refRow = await rowOf(page, box, yBand);
      await plain(cfg.a);

      await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000));
      await page.evaluate((c) => { window.__turn = eval(c); }, cfg.turn(cfg.b, cfg.dir, "'curl'"));
      const logBefore = await page.evaluate(() => window.__log.length);

      // Step the clock (16 ms frames) until the silhouette is in the middle of a b button.
      let found = null;
      let seen = [];
      for (let i = 0; i < 90 && !found; i++) {
        await page.clock.runFor(16);
        await page.waitForTimeout(25);
        const xb = await boundary(page, cfg.stage, rows.ybtn, cfg.dir);
        if (xb === null) continue;
        seen.push(Math.round(xb));
        const s = cfg.dir > 0 ? -1 : 1; // the side of the new page
        const probe = xb + s * 3;
        const target = await page.evaluate(({ stage, x, y, box }) => {
          const m = document.querySelector(stage).mapPoint({ x, y });
          if (!m) return null;
          const el = document.elementFromPoint(m.x + box.x, m.y + box.y);
          return el?.closest('button')?.id ?? null;
        }, { stage: cfg.stage, x: probe, y: rows.ybtn, box });
        if (target && /^p?b\d$/.test(target) && Math.abs(xb - box.width / 2) < box.width * 0.3) found = { xb, target };
      }
      assert.ok(found, `a frame with the silhouette on a button of the new page (boundaries seen: ${seen.join(', ')})`);
      await page.waitForTimeout(120);

      // 1. The mapper's boundary and the picture's (the first pixel brighter than the resting page) are the same line.
      const xMap = await boundary(page, cfg.stage, yBand, cfg.dir);
      const row = await rowOf(page, box, yBand);
      const xImg = brightEdge(row, refRow, cfg.dir);
      if (process.env.DEBUG) console.log(`      mapper ${xMap} picture ${xImg} button ${found.xb} target ${found.target}`);
      assert.ok(xMap !== null && xImg !== null, `the silhouette is on the row (mapper ${xMap}, picture ${xImg})`);
      assert.ok(Math.abs(xMap - xImg) <= 2.5, `the mapper stops input at ${xMap}, the picture shows the old page from ${xImg}`);

      // 2. Clicks: just before the silhouette (the new page) reach the button shown there; just past it (the old page) reach nothing.
      const side = cfg.dir > 0 ? -1 : 1;
      const xb = found.xb;
      const click = async (x) => {
        const n = await page.evaluate(() => window.__log.length);
        await page.mouse.click(box.x + x, box.y + rows.ybtn);
        await page.waitForTimeout(60);
        return page.evaluate((n) => window.__log.slice(n), n);
      };
      const mapped = (x) => page.evaluate(({ stage, x, y, box }) => {
        const m = document.querySelector(stage).mapPoint({ x, y });
        return m ? (document.elementFromPoint(m.x + box.x, m.y + box.y)?.closest('button')?.id ?? '') : null;
      }, { stage: cfg.stage, x, y: rows.ybtn, box });
      assert.equal(await mapped(xb + side * 3), found.target);
      assert.equal(await mapped(xb - side * 3), null, 'a point just past the silhouette maps to nothing');
      assert.deepEqual(await click(xb + side * 3), [found.target], 'a click just before the silhouette lands on the new page');
      // The old page, in every shape it has (the cylinder, the turned back, the flat part): no input.
      for (const d of [3, 8, 30, 90, 200, 330]) {
        const x = xb - side * d;
        if (x < 4 || x > box.width - 4) continue;
        assert.equal(await mapped(x), null, `the old page covers ${x}`);
        assert.deepEqual(await click(x), [], `a click on the old page at ${x} reaches nothing`);
      }
      // The new page, further from the silhouette: live and clickable.
      const far = xb + side * 40;
      if (far > 4 && far < box.width - 4) {
        const t = await mapped(far);
        if (t && /^p?b\d$/.test(t)) assert.deepEqual(await click(far), [t]);
      }
      // The old page's own buttons never take a click (a1..a6, pa1..pa6).
      const log = await page.evaluate((n) => window.__log.slice(n), logBefore);
      assert.ok(log.every((id) => /^p?b\d$/.test(id)), `only the new page took clicks: ${log}`);

      // 3. Outside a scoped cut the stage is live and untouched.
      if (cfg.stage === '#panels') {
        const head = await page.evaluate(() => document.querySelector('#panels').mapPoint({ x: 40, y: 20 }));
        assert.ok(head && Math.abs(head.x - 40) < 0.01 && Math.abs(head.y - 20) < 0.01, 'the heading above the panels is untouched');
      }

      await page.clock.resume();
      await page.evaluate(() => window.__turn);
      assert.equal(await page.evaluate((id) => document.getElementById(id).hidden, cfg.a), true);
      assert.deepEqual(session.errors, []);
      await session.context.close();
    });
  }

  // The fallbacks: no WebGPU (the DOM renderer) and reduced motion both apply the update at once.
  for (const [label, opts] of [['without WebGPU', { noGpu: true }], ['with reduced motion', { reduced: true }]]) {
    await check(`${path}: ${label}, the curl is a plain update`, async () => {
      const session = await open(browser, url, opts);
      const { page } = session;
      if (opts.noGpu) assert.deepEqual(session.renderer, ['dom', 'dom']);
      const ms = await page.evaluate(async () => {
        const t = performance.now();
        await turnFull('sheet-b', 1);
        await turnPanel('panel-b', -1);
        await turnFull('sheet-a', -1);
        await turnFull('sheet-b', -1);
        return performance.now() - t;
      });
      const state = await page.evaluate(() => ['sheet-a', 'sheet-b', 'panel-a', 'panel-b'].map((id) => document.getElementById(id).hidden));
      assert.deepEqual(state, [true, false, true, false]);
      assert.ok(ms < 400, `four turns took ${ms.toFixed(0)} ms: no animation`);
      // Still clickable, as the DOM it is.
      await page.click('#b2');
      assert.ok((await page.evaluate(() => window.__log)).includes('b2'));
      assert.deepEqual(session.errors, []);
      await session.context.close();
    });
  }
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
