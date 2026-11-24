// End-to-end checks of the glass skin ([glass] panes) in Chrome with WebGPU, on Chrome's own
// HTML-in-Canvas and on the polyfill: a fixture with a pane over stripes, and the demo reader.
//   node test/effects-glass.browser.mjs            both paths
//   node test/effects-glass.browser.mjs --native   only the native path
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

const framesDuring = (page, selector, ms) => page.evaluate(async ([selector, ms]) => {
  const canvas = document.querySelector(`${selector} canvas`);
  if (!canvas) return 0;
  let n = 0;
  const count = () => n++;
  canvas.addEventListener('effectframe', count);
  await new Promise((r) => setTimeout(r, ms));
  canvas.removeEventListener('effectframe', count);
  return n;
}, [selector, ms]);

/** The luminance of a page region (DPR 1), row by row: rows[y][x]. */
async function luma(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const rows = [];
    for (let y = 0; y < c.height; y++) {
      const row = [];
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        row.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      }
      rows.push(row);
    }
    return rows;
  }, png.toString('base64'));
}

/** Black/white crossings along a row. */
const crossings = (row) => row.slice(1).filter((v, i) => (v < 128) !== (row[i] < 128)).length;

async function run(path, browser, url) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 950 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  try {
    await page.goto(`${url}test/fixtures/glass.html`);
    const renderer = await page.evaluate(() => customElements.whenDefined('loom-stage').then(() => document.querySelector('#g').ready));
    await page.waitForTimeout(800);

    await check(`${path}: a pane bends what lies under its rim: stripes there are squeezed`, async () => {
      assert.equal(renderer, 'webgpu');
      const pane = await page.locator('#pane').boundingBox();
      // A column through the middle of the pane's height, along its left end: the rim band
      // (its first 14 px inside) against the same width just outside.
      const y = Math.round(pane.y + pane.height / 2);
      const [inside] = await luma(page, { x: pane.x + 1, y, width: 14, height: 1 });
      const [outside] = await luma(page, { x: pane.x - 15, y, width: 14, height: 1 });
      const [middle] = await luma(page, { x: pane.x + pane.width / 2 - 7, y, width: 14, height: 1 });
      assert.ok(crossings(inside) > crossings(outside), `more stripes in the rim (${crossings(inside)}) than beside it (${crossings(outside)})`);
      assert.ok(crossings(middle) <= crossings(outside) + 1, `the middle is clear glass (${crossings(middle)} vs ${crossings(outside)})`);
    });

    await check(`${path}: a pane stands off the page: a shadow falls below it`, async () => {
      const pane = await page.locator('#pane').boundingBox();
      // White stripes below the pane, close to it and far from it, on the same column phase.
      const x = Math.round(pane.x + pane.width / 2);
      const near = await luma(page, { x: x - 12, y: pane.y + pane.height + 4, width: 12, height: 1 });
      const far = await luma(page, { x: x - 12, y: pane.y + pane.height + 60, width: 12, height: 1 });
      const brightest = (rows) => Math.max(...rows[0]);
      assert.ok(brightest(near) < brightest(far) - 4, `darker under the pane (${brightest(near)} vs ${brightest(far)})`);
      assert.equal(await framesDuring(page, '#g', 500), 0, 'the stage rests');
    });

    await page.goto(`${url}glass.html`);
    await page.evaluate(() => customElements.whenDefined('loom-stage').then(() => document.querySelector('#reader').ready));
    await page.waitForTimeout(900);

    await check(`${path}: in the reader, the bars keep their own lettering crisp over the article`, async () => {
      const where = await page.locator('.where').boundingBox();
      const rows = await luma(page, { x: where.x, y: where.y, width: where.width, height: where.height });
      const darkest = Math.min(...rows.flat());
      assert.ok(darkest < 60, `the title in the bar is ink, not milk (darkest ${darkest})`);
    });

    await check(`${path}: the article scrolls under the glass, and the stage rests after`, async () => {
      const bar = await page.locator('.topbar').boundingBox();
      const before = await luma(page, { x: bar.x + 20, y: bar.y + 2, width: 60, height: 6 });
      await page.evaluate(() => { document.querySelector('.scroller').scrollTop = 500; });
      await page.waitForTimeout(600);
      const after = await luma(page, { x: bar.x + 20, y: bar.y + 2, width: 60, height: 6 });
      const change = before.flat().reduce((s, v, i) => s + Math.abs(v - after.flat()[i]), 0) / before.flat().length;
      assert.ok(change > 8, `the rim shows what passes under it (mean change ${change.toFixed(1)})`);
      assert.equal(await framesDuring(page, '#reader', 600), 0, 'the stage rests');
      assert.deepEqual(errors, []);
    });
  } finally {
    await context.close();
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
