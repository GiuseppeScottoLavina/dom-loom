// The guide's pages in Chrome with WebGPU, on Chrome's own HTML-in-Canvas and on the
// polyfill: every example starts on the GPU, every example script runs, nothing logs an
// error, the stages rest, and a few examples do what their page says.
//   node test/guide.browser.mjs            both paths
//   node test/guide.browser.mjs --native   only the native path
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { launch, root, startServer } from './harness.mjs';

const only = process.argv.includes('--native') ? ['native'] : ['native', 'polyfill'];
const pages = readdirSync(`${root}guide`).filter((f) => f.endsWith('.html')).sort();
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

/** Frames drawn by any stage of the page in `ms`. */
const framesDuring = (page, ms) => page.evaluate(async (ms) => {
  let n = 0;
  const count = () => n++;
  const canvases = [...document.querySelectorAll('loom-stage canvas')];
  for (const c of canvases) c.addEventListener('effectframe', count);
  await new Promise((r) => setTimeout(r, ms));
  for (const c of canvases) c.removeEventListener('effectframe', count);
  return n;
}, ms);

/** Brings a stage to the middle of the viewport and waits for it to start. */
async function show(page, selector) {
  const stage = page.locator(selector);
  await stage.evaluate((s) => s.scrollIntoView({ block: 'center' }));
  const renderer = await stage.evaluate((s) => s.ready);
  await page.waitForTimeout(500);
  return renderer;
}

/** A click where an element is drawn (the canvas takes the pointer). */
async function click(page, selector) {
  const b = await page.locator(selector).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

async function run(path, browser, url) {
  for (const file of pages) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
    });
    try {
      await page.goto(`${url}guide/${file}`);
      await page.waitForTimeout(800);
      await check(`${path}, ${file}: every example starts on the GPU, its script runs, nothing logs an error, and the page rests`, async () => {
        const ids = await page.evaluate(() => [...document.querySelectorAll('.example')].map((e) => e.id));
        for (const id of ids) {
          const stages = await page.locator(`#${id} .live > loom-stage`).count();
          if (stages) assert.equal(await show(page, `#${id} .live > loom-stage`), 'webgpu', `${id} runs on the GPU`);
        }
        const shown = await page.evaluate(() => [...document.querySelectorAll('.example')].every((e) => e.querySelector('.codes figure.code')));
        assert.ok(shown, 'every example shows its code');
        await page.mouse.move(2, 2);
        await page.waitForTimeout(1200);
        assert.equal(await framesDuring(page, 600), 0, 'the stages rest');
        assert.deepEqual(errors, []);
      });

      if (file === 'feedback.html') {
        await check(`${path}, ${file}: a click on the middle of a header sorts the table, and the page hears it`, async () => {
          await show(page, '#table-example .live > loom-stage');
          await click(page, '#table-example th:nth-child(3)');
          await page.waitForTimeout(1300);
          assert.equal(await page.locator('#table-example .live output').textContent(), 'Sorted by Score, ascending.');
          assert.equal(await page.locator('#table-example tbody tr:first-child td').first().textContent(), 'Osei');
        });
      }
      if (file === 'transitions.html') {
        await check(`${path}, ${file}: the cut swaps the views, a scoped cut changes the entry, a discard removes`, async () => {
          await show(page, '#cut-example .live > loom-stage');
          await click(page, '#cut-example .live form button');
          await page.waitForTimeout(1300);
          assert.deepEqual(await page.evaluate(() => [document.querySelector('#cut-example form').hidden, document.querySelector('#cut-example section').hidden]), [true, false]);
          await show(page, '#scope-example .live > loom-stage');
          await click(page, '#scope-example [data-move="1"]');
          await page.waitForTimeout(900);
          assert.match(await page.locator('#scope-example article').textContent(), /Entry 2/);
          await show(page, '#discard-example .live > loom-stage');
          await click(page, '#discard-example [data-do=shatter]');
          await page.waitForTimeout(1900);
          assert.equal(await page.locator('#discard-example li').count(), 2);
          assert.deepEqual(errors, []);
        });
      }
      if (file === 'overlays.html') {
        await check(`${path}, ${file}: a dialog opens, shuts on Escape with its value, and a menu item reaches the page`, async () => {
          await show(page, '#dialog-example .live > loom-stage');
          await click(page, '#quit');
          await page.waitForTimeout(900);
          assert.equal(await page.evaluate(() => document.querySelector('#quit-dialog').open), true);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(900);
          assert.deepEqual(await page.evaluate(() => [document.querySelector('#quit-dialog').open, document.querySelector('#quit-out').value]), [false, 'Still playing.']);
          await show(page, '#menu-example .live > loom-stage');
          await click(page, '#menu-example .live > loom-stage button');
          await page.waitForTimeout(900);
          await click(page, '#save-game');
          await page.waitForTimeout(800);
          assert.equal(await page.locator('#menu-out').textContent(), 'Game saved.');
          assert.deepEqual(errors, []);
        });
      }
      if (file === 'skins.html') {
        await check(`${path}, ${file}: a skin defined after its stage started draws it`, async () => {
          await show(page, '#define-example .live > loom-stage');
          assert.equal(await page.locator('#define-example .live > loom-stage').evaluate((s) => s.skin?.name), 'ember');
        });
      }
    } finally {
      await context.close();
    }
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
