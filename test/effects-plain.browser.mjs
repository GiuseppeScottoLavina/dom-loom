// End-to-end checks of the plain skin on the demo's settings page (plain.html, Pico CSS) in
// Chrome with WebGPU, on Chrome's own HTML-in-Canvas and on the polyfill.
//   node test/effects-plain.browser.mjs              the native path
//   node test/effects-plain.browser.mjs --polyfill   the polyfill path too
// The polyfill (1.0.3) resolves rem against its snapshot's own root, not the page's :root,
// so a rem-based framework such as Pico is laid out smaller in its picture than in the page
// and positions drift from the layout. Until it is fixed there, the polyfill run is opt-in.
import assert from 'node:assert/strict';
import { launch, startServer } from './harness.mjs';

const only = process.argv.includes('--polyfill') ? ['native', 'polyfill'] : ['native'];
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

const framesDuring = (page, ms) => page.evaluate(async (ms) => {
  const canvas = document.querySelector('#settings canvas');
  if (!canvas) return 0;
  let n = 0;
  const count = () => n++;
  canvas.addEventListener('effectframe', count);
  await new Promise((r) => setTimeout(r, ms));
  canvas.removeEventListener('effectframe', count);
  return n;
}, ms);

/** The pixels of a page region (DPR 1) as an array of [r, g, b]. */
async function pixels(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const out = [];
    for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
    return out;
  }, png.toString('base64'));
}

const near = (a, b, tol = 10) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
const rgbOf = (css) => css.match(/[\d.]+/g).slice(0, 3).map(Number);
const box = (page, selector) => page.locator(selector).boundingBox();

async function run(path, browser, url, scheme) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 1500 }, deviceScaleFactor: 1, colorScheme: scheme });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  try {
    await page.goto(`${url}plain.html`);
    const renderer = await page.evaluate(() => customElements.whenDefined('loom-stage').then(() => document.querySelector('#settings').ready));
    await page.waitForTimeout(900);
    const accent = rgbOf(await page.evaluate(() => getComputedStyle(document.querySelector('input[type=radio]')).accentColor));
    const pageBg = rgbOf(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor));

    await check(`${path}, ${scheme}: the stage paints only focus and shows the page's own background`, async () => {
      assert.equal(renderer, 'webgpu');
      assert.equal(await page.evaluate(() => document.querySelector('#settings').dataset.draws), 'focus');
      // Blank page right of the Plan radios: inside the stage, nothing but the page there.
      const radio = await box(page, 'input[value=starter]');
      const s = await pixels(page, { x: radio.x + 500, y: radio.y, width: 20, height: 10 });
      assert.ok(s.every((c) => near(c, pageBg, 3)), `the page's background ${pageBg}, got ${s[0]}`);
    });

    await check(`${path}, ${scheme}: a focus ring follows the keyboard, not the pointer`, async () => {
      const save = await box(page, 'button[type=submit]');
      await page.mouse.move(save.x + save.width / 2, save.y + save.height / 2);
      await page.waitForTimeout(500);
      const ringAt = async (b) => (await pixels(page, { x: b.x + b.width / 2, y: b.y - 7, width: 40, height: 5 })).filter((c) => near(c, accent, 40)).length;
      assert.equal(await ringAt(save), 0, 'no ring on hover');
      await page.mouse.move(2, 2);
      await page.locator('input[name=name]').focus();
      await page.keyboard.press('Tab');
      await page.waitForTimeout(700);
      const email = await box(page, 'input[name=email]');
      assert.ok(await ringAt(email) > 20, 'a ring in the accent colour over the email field');
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(100);
      await page.evaluate(() => document.activeElement.blur());
      await page.waitForTimeout(600);
    });

    await check(`${path}, ${scheme}: a held button fills with the accent and spares its label; a short click is refused`, async () => {
      const del = await box(page, '#delete');
      const centre = [del.x + del.width / 2, del.y + del.height / 2];
      await page.mouse.click(...centre);
      await page.waitForTimeout(500);
      assert.equal(await page.locator('#deleted').textContent(), '', 'a click alone does not delete');
      await page.mouse.move(...centre);
      await page.mouse.down();
      await page.waitForTimeout(900);
      // The left part of the button, between its edge and its label: the accent now.
      const ground = await pixels(page, { x: del.x + 6, y: del.y + 6, width: 6, height: 6 });
      assert.ok(ground.filter((c) => near(c, accent, 50)).length > 20, `the ground takes the accent (${ground[0]} vs ${accent})`);
      await page.waitForTimeout(900);
      await page.mouse.up();
      await page.waitForTimeout(1200);
      assert.match(await page.locator('#deleted').textContent(), /Deletion scheduled/);
      assert.equal(await framesDuring(page, 600), 0, 'the stage rests');
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
      for (const scheme of ['light', 'dark']) await run(path, browser, url, scheme);
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
