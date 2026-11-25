// What an app's page asks of the stages, in Chrome with WebGPU, on Chrome's own
// HTML-in-Canvas and on the polyfill: names in the page's language, buttons that keep the
// page's look, removable rows that are not chips, a page's toasts at the bottom of the
// viewport, and a stage around a layout element that keeps its layout.
//   node test/app.browser.mjs            both paths
//   node test/app.browser.mjs --native   only the native path
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

/** The colour of the page at a point, from a screenshot. */
async function pixel(page, x, y) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(1, 1);
    c.getContext('2d').drawImage(bitmap, 0, 0);
    return [...c.getContext('2d').getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, png.toString('base64'));
}

async function run(path, browser, url) {
  console.log(`\n${path}`);
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}test/fixtures/app.html`);
  await page.waitForFunction(() => ['#navstage', '#content', '#dock'].every((s) => document.querySelector(s).dataset.renderer === 'webgpu'));
  await page.waitForTimeout(1100); // the boot sweep
  const style = (sel, ...props) => page.evaluate(([sel, props]) => {
    const cs = getComputedStyle(document.querySelector(sel));
    return Object.fromEntries(props.map((p) => [p, cs[p]]));
  }, [sel, props]);
  const attr = (sel, name) => page.evaluate(([sel, name]) => document.querySelector(sel).getAttribute(name), [sel, name]);

  await check(`${path}: the names DomLoom gives come in the element's language; the page's own win`, async () => {
    assert.equal(await attr('#chip > .loom-remove', 'aria-label'), 'Remove Garlic');
    assert.equal(await attr('#chip-it > .loom-remove', 'aria-label'), 'Rimuovi Aglio');
    assert.equal(await attr('#hold-it', 'aria-description'), 'Tieni premuto, o attiva due volte, per confermare');
    assert.equal(await attr('#hold-own', 'aria-description'), 'Tieni premuto per svuotare');
    assert.equal(await attr('#own > .loom-remove', 'aria-label'), 'Take out hemp');
  });

  await check(`${path}: a button with loom-plain keeps the page's look`, async () => {
    assert.deepEqual(await style('#styled', 'textTransform'), { textTransform: 'uppercase' }, 'other buttons keep the skin');
    const plain = await style('#plain', 'textTransform', 'letterSpacing', 'borderTopStyle');
    assert.equal(plain.textTransform, 'none');
    assert.equal(plain.letterSpacing, 'normal');
    assert.notEqual(plain.borderTopStyle, 'solid', 'no skin border');
  });

  await check(`${path}: removable="row" keeps the row's look; only a chip looks like a chip`, async () => {
    const row = await style('#row', 'paddingLeft', 'textTransform', 'borderTopStyle', 'display');
    assert.deepEqual(row, { paddingLeft: '0px', textTransform: 'none', borderTopStyle: 'none', display: 'grid' });
    assert.equal((await style('#chip', 'textTransform')).textTransform, 'uppercase', 'a chip is still a chip');
    assert.ok(await page.evaluate(() => !!document.querySelector('#row > button.loom-remove')), 'the row has its remove button');
  });

  await check(`${path}: a remove button with content of its own gets no drawn cross`, async () => {
    assert.equal((await style('#own > .loom-remove', 'backgroundImage')).backgroundImage, 'none');
    assert.notEqual((await style('#chip > .loom-remove', 'backgroundImage')).backgroundImage, 'none', 'the button DomLoom adds has its cross');
  });

  await check(`${path}: a stage with fill takes the height its parent gives it, and bare lets the page show`, async () => {
    const box = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const link = r('#navstage a[aria-current]');
      return { stage: r('#navstage').height, nav: r('#navstage nav').height, link: link.top + link.height / 2, header: r('header').height };
    });
    assert.equal(box.stage, 70, 'the stage is as tall as the header');
    assert.equal(box.nav, 70, 'the nav fills it');
    assert.ok(Math.abs(box.link - 35) < 2, `the links are centred in the header (${box.link})`);
    // Beside the links, inside the stage: the header's colour, not a panel.
    const stage = await page.evaluate(() => {
      const r = document.querySelector('#navstage').getBoundingClientRect();
      return { x: Math.round(r.right - 8), y: Math.round(r.top + 8) };
    });
    const [r, g, b] = await pixel(page, stage.x, stage.y);
    assert.ok(Math.abs(r - 0x2a) < 6 && Math.abs(g - 0x1a) < 6 && Math.abs(b - 0x4a) < 6, `the header shows through (${r},${g},${b})`);
  });

  await check(`${path}: toasts="viewport" shows the page's toasts at the bottom centre of the viewport`, async () => {
    await page.evaluate(() => {
      const li = document.createElement('li');
      li.id = 'toast';
      li.textContent = 'Recipe saved';
      document.querySelector('[toasts=viewport]').append(li);
    });
    await page.waitForTimeout(800);
    const place = () => page.evaluate(() => {
      const r = document.querySelector('#dock').getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), width: Math.round(r.width) };
    });
    const before = await place();
    assert.deepEqual(before, { left: 290, right: 290, bottom: 16, width: 420 });
    await page.evaluate(() => scrollBy(0, 900));
    await page.waitForTimeout(200);
    assert.deepEqual(await place(), before, 'it stays when the page scrolls');
    await page.setViewportSize({ width: 390, height: 700 });
    await page.waitForTimeout(400);
    assert.deepEqual(await place(), { left: 16, right: 16, bottom: 16, width: 358 }, 'on a phone it spans the width');
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.waitForTimeout(400);
    const close = await page.evaluate(() => {
      const r = document.querySelector('#toast > .loom-remove').getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
    await page.mouse.click(close[0], close[1]);
    await page.waitForFunction(() => !document.querySelector('#toast'), null, { timeout: 4000 });
  });

  await check(`${path}: nothing throws`, async () => {
    assert.deepEqual(errors, []);
  });
  await page.close();
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
