// Overlays in dialogs, in Chrome with WebGPU, on Chrome's own HTML-in-Canvas and on the
// polyfill: an overlay born in a closed dialog opens on a picture of its own size, and
// overlay="zoom" opens and closes at scale, with clicks that land where they are seen.
//   node test/dialog.browser.mjs            both paths
//   node test/dialog.browser.mjs --native   only the native path
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

async function open(browser, url, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, ...options });
  if (options.noGpu) await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }));
  await page.goto(`${url}test/fixtures/dialog.html`);
  const renderer = options.noGpu ? 'dom' : 'webgpu';
  await page.waitForFunction((r) => [...document.querySelectorAll('loom-stage')].every((s) => s.dataset.renderer === r), renderer, { timeout: 20000 });
  await page.waitForTimeout(300);
  return page;
}

const frames = (page, dialog) => page.evaluate((d) => window.__frames.filter((f) => f.dialog === d), dialog);

async function run(path, browser, url) {
  console.log(`\n${path}`);
  const page = await open(browser, url);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await check(`${path}: an overlay born in a closed dialog opens on a picture of its own size`, async () => {
    assert.deepEqual(await page.evaluate(() => { const c = document.querySelector('#line canvas'); return [c.width, c.height]; }), [1, 1], 'closed, the canvas has no size');
    await page.evaluate(() => { window.__frames = []; document.querySelector('#line').showModal(); });
    await page.waitForTimeout(1200);
    const opening = (await frames(page, 'line')).filter((f) => f.open > 0.001);
    assert.ok(opening.length > 5, `opening frames: ${opening.length}`);
    const wrong = opening.filter((f) => Math.abs(f.canvas[0] - f.content[0]) > 1 || Math.abs(f.canvas[1] - f.content[1]) > 1);
    assert.deepEqual(wrong.map((f) => `${f.open.toFixed(3)}: ${f.canvas} for ${f.content}`), [], 'no frame of the opening at another size');
    assert.ok(opening[0].content[0] > 400, `the content has its width (${opening[0].content})`);
    await page.evaluate(() => document.querySelector('#line').close());
  });

  await check(`${path}: overlay="zoom" opens at scale, and a click during the zoom lands on the control shown there`, async () => {
    await page.evaluate(() => { window.__frames = []; document.querySelector('#zoom').showModal(); });
    // A frame in the middle of the opening.
    await page.waitForFunction(() => { const f = window.__frames.at(-1); return f && f.from === 5 && f.open > 0.15 && f.open < 0.8; }, null, { timeout: 4000 });
    const probe = await page.evaluate(() => {
      const stage = document.querySelector('#zoom loom-stage');
      const s = 0.94 + 0.06 * window.__frames.at(-1).open;
      const c = stage.querySelector('canvas').getBoundingClientRect();
      const b = document.querySelector('#zoom-ok').getBoundingClientRect();
      // The right end of the button, where the zoom moves it most: where it is seen now.
      const at = { x: b.right - 6 - c.left, y: b.top + b.height / 2 - c.top };
      const seen = { x: c.width / 2 + (at.x - c.width / 2) * s, y: c.height / 2 + (at.y - c.height / 2) * s };
      const mapped = stage.mapPoint(seen);
      return { s, at, seen, mapped, page: { x: seen.x + c.left, y: seen.y + c.top } };
    });
    assert.ok(probe.s < 0.99, `mid-zoom (scale ${probe.s})`);
    assert.ok(probe.mapped && Math.hypot(probe.mapped.x - probe.at.x, probe.mapped.y - probe.at.y) < 3,
      `the mapper sends the point seen (${probe.seen.x.toFixed(1)}, ${probe.seen.y.toFixed(1)}) to the control (${JSON.stringify(probe.mapped)} for ${probe.at.x.toFixed(1)}, ${probe.at.y.toFixed(1)})`);
    const all = await frames(page, 'zoom');
    assert.ok(all.every((f) => f.from === 5), 'drawn as a zoom');
    // A real click where the button is seen: it submits the form, which closes at scale.
    await page.mouse.click(probe.page.x, probe.page.y);
    await page.waitForFunction(() => !document.querySelector('#zoom').open, null, { timeout: 4000 });
    assert.equal(await page.evaluate(() => document.querySelector('#zoom').returnValue), 'ok');
    assert.ok((await frames(page, 'zoom')).some((f) => f.closing && f.open < 0.5), 'it closed at scale');
  });

  for (const how of ['requestClose', 'Escape']) {
    await check(`${path}: overlay="zoom" closes at scale on ${how}, then the dialog closes`, async () => {
      await page.evaluate(() => { window.__frames = []; document.querySelector('#zoom').showModal(); });
      await page.waitForTimeout(900);
      await page.evaluate(() => (window.__frames = []));
      if (how === 'Escape') await page.keyboard.press('Escape');
      else await page.evaluate(() => document.querySelector('#zoom').requestClose());
      await page.waitForTimeout(60);
      assert.equal(await page.evaluate(() => document.querySelector('#zoom').open), true, 'still open while it closes');
      await page.waitForFunction(() => !document.querySelector('#zoom').open, null, { timeout: 4000 });
      // The opening may still settle in its last frames; from the first closing frame on, all close at scale.
      const all = await frames(page, 'zoom');
      const closing = all.slice(all.findIndex((f) => f.closing));
      assert.ok(closing.length > 3, `closing frames: ${closing.length}`);
      // (The last one, shut, is drawn between the end of the motion and the dialog's close.)
      assert.ok(closing.every((f) => f.from === 5 && (f.closing || f.open < 0.02)), 'every frame after it closes at scale');
      assert.ok(closing.at(-1).open < 0.1, `it shut before the dialog closed (${closing.at(-1).open})`);
    });
  }

  await check(`${path}: nothing throws`, async () => {
    assert.deepEqual(errors, []);
  });
  await page.close();

  await check(`${path}: with reduced motion, overlay="zoom" opens at once`, async () => {
    const reduced = await open(browser, url, { reducedMotion: 'reduce' });
    await reduced.evaluate(() => { window.__frames = []; document.querySelector('#zoom').showModal(); });
    await reduced.waitForTimeout(600);
    const moving = (await frames(reduced, 'zoom')).filter((f) => f.open > 0.001 && f.open < 0.999);
    assert.deepEqual(moving, [], 'no frame of an animation');
    assert.equal(await reduced.evaluate(() => document.querySelector('#zoom').open), true);
    await reduced.close();
  });

  await check(`${path}: without WebGPU, overlay="zoom" fades in`, async () => {
    const plain = await open(browser, url, { noGpu: true });
    const fade = await plain.evaluate(() => {
      document.querySelector('#zoom').showModal();
      const cs = getComputedStyle(document.querySelector('#zoom loom-stage'));
      return { property: cs.transitionProperty, opacity: Number(cs.opacity) };
    });
    assert.equal(fade.property, 'opacity');
    await plain.waitForTimeout(400);
    assert.equal(await plain.evaluate(() => Number(getComputedStyle(document.querySelector('#zoom loom-stage')).opacity)), 1);
    await plain.close();
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
