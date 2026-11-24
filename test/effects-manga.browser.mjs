// End-to-end checks of the manga skin on the demo's survey (manga.html) in Chrome with
// WebGPU, on Chrome's own HTML-in-Canvas and on the polyfill.
//   node test/effects-manga.browser.mjs            both paths
//   node test/effects-manga.browser.mjs --native   only the native path
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

const framesDuring = (page, ms) => page.evaluate(async (ms) => {
  const canvas = document.querySelector('#survey canvas');
  if (!canvas) return 0;
  let n = 0;
  const count = () => n++;
  canvas.addEventListener('effectframe', count);
  await new Promise((r) => setTimeout(r, ms));
  canvas.removeEventListener('effectframe', count);
  return n;
}, ms);

/** The pixels of a page region (DPR 1) as { w, h, d } with RGBA bytes. */
async function pixels(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return { w: c.width, h: c.height, d: Array.from(ctx.getImageData(0, 0, c.width, c.height).data) };
  }, png.toString('base64'));
}

/** Counts of the region's pixels: dark (ink), light (paper), mid (grey) and red (spot). */
function census(s) {
  const n = { dark: 0, light: 0, mid: 0, red: 0, all: 0 };
  for (let i = 0; i < s.d.length; i += 4) {
    const [r, g, b] = [s.d[i], s.d[i + 1], s.d[i + 2]];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    n.all++;
    if (r > 170 && g < 110 && b < 110) n.red++;
    else if (l < 70) n.dark++;
    else if (l > 200) n.light++;
    else n.mid++;
  }
  return n;
}

const box = (page, selector) => page.locator(selector).boundingBox();
const inset = (b, k) => ({ x: b.x + k, y: b.y + k, width: b.width - 2 * k, height: b.height - 2 * k });

async function run(path, browser, url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  try {
    await page.goto(`${url}manga.html`);
    const renderer = await page.evaluate(() => customElements.whenDefined('loom-stage').then(() => document.querySelector('#survey').ready));
    await page.waitForTimeout(900);

    await check(`${path}: the survey is drawn by the compositor on the manga paper`, async () => {
      assert.equal(renderer, 'webgpu');
      const card = await box(page, '#survey');
      const s = await pixels(page, { x: card.x + card.width - 40, y: card.y + card.height - 30, width: 10, height: 10 });
      const [r, g, b] = s.d;
      assert.ok(Math.abs(r - 0xf7) < 6 && Math.abs(g - 0xf5) < 6 && Math.abs(b - 0xf0) < 6, `paper, not holo's panel (${r}, ${g}, ${b})`);
    });

    await check(`${path}: the selected option is a reversed panel, and it moves with the choice`, async () => {
      const print = inset(await box(page, 'label:has(input[value=Print])'), 4);
      const borrowed = inset(await box(page, 'label:has(input[value=Borrowed])'), 4);
      let p = census(await pixels(page, print));
      assert.ok(p.dark > p.all * 0.6, `Print, selected, is mostly ink (${p.dark} of ${p.all})`);
      await page.click('label:has(input[value=Borrowed])');
      await page.waitForTimeout(700);
      p = census(await pixels(page, print));
      const q = census(await pixels(page, borrowed));
      assert.ok(p.light > p.all * 0.6, `Print is paper again (${p.light} of ${p.all})`);
      assert.ok(q.dark > q.all * 0.6, `Borrowed is reversed (${q.dark} of ${q.all})`);
    });

    await check(`${path}: a ticked box holds a screen of spot dots, not a flat fill`, async () => {
      await page.check('input[value="Oni Kitchen"]');
      await page.waitForTimeout(600);
      const b = await box(page, 'input[value="Oni Kitchen"]');
      // The lower right of the box, clear of the tick.
      const n = census(await pixels(page, { x: b.x + b.width / 2 + 2, y: b.y + b.height / 2 + 2, width: 6, height: 6 }));
      assert.ok(n.red > 2 && n.light + n.mid > 2, `red dots on paper (${JSON.stringify(n)})`);
    });

    await check(`${path}: the card keeps three favourites and says so`, async () => {
      await page.check('input[value="Kitsune Courier"]');
      await page.check('input[value="Tidebreaker"]');
      await page.click('input[value="Gravity Club"]');
      assert.deepEqual(await page.evaluate(() => [
        document.querySelectorAll('input[name=series]:checked').length, document.querySelector('#picked').value,
      ]), [3, 'Three at most!']);
    });

    await check(`${path}: a held Send hits with ink focus lines, then the card turns to its postmarked side and rests`, async () => {
      await page.fill('input[name=pen]', 'Inkfox');
      await page.mouse.move(2, 2);
      await page.waitForTimeout(400);
      const send = await box(page, 'button[type=submit]');
      const caption = await box(page, '.field:has(input[name=pen]) .loom-caption');
      const card = await box(page, '#survey');
      // Blank paper on the pen name's caption row, right of its words: nothing is drawn there at rest. It is far
      // enough from the button that the lines there have their full width.
      const left = card.x + card.width * 0.45;
      const blank = { x: left, y: caption.y, width: card.x + card.width - 40 - left, height: caption.height };
      const rest = census(await pixels(page, blank));
      assert.ok(rest.light > rest.all * 0.97, `blank at rest (${JSON.stringify(rest)})`);
      await page.mouse.move(send.x + send.width / 2, send.y + send.height / 2);
      await page.mouse.down();
      // The hold completes at 900 ms and the burst starts then, while the button is still held.
      await page.waitForTimeout(980);
      const hit = census(await pixels(page, blank));
      await page.mouse.up();
      assert.ok(hit.dark > hit.all * 0.08, `focus lines cross it (${JSON.stringify(hit)})`);
      assert.ok(hit.mid < hit.dark * 0.6, `in ink, not grey (${JSON.stringify(hit)})`);
      await page.waitForTimeout(2600);
      assert.deepEqual(await page.evaluate(() => [
        document.querySelector('#survey-form').inert, document.querySelector('[data-view=receipt]').inert, document.activeElement.id,
        document.querySelector('[data-out=votes]').textContent,
      ]), [true, false, 'receipt-title', 'Kitsune Courier · Tidebreaker · Oni Kitchen']);
      assert.equal(await framesDuring(page, 600), 0, 'the stage rests');
    });

    await check(`${path}: Fill another card turns the card back to an empty survey`, async () => {
      // A click where the button is drawn (the canvas takes the pointer and maps it).
      const again = await box(page, '#again');
      await page.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
      await page.waitForTimeout(2600);
      assert.deepEqual(await page.evaluate(() => [
        document.querySelector('#survey-form').inert, document.querySelectorAll('input[name=series]:checked').length,
        document.querySelector('#picked').value,
      ]), [false, 0, '0 / 3']);
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
