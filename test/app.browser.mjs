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

  await check(`${path}: current="line" marks the current page with a line on its bottom edge, inside the canvas, and nothing else`, async () => {
    await page.mouse.move(500, 650);
    await page.waitForTimeout(600);
    const geo = () => page.evaluate(() => {
      const box = (s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
      };
      return { canvas: box('#navstage canvas'), current: box('#navstage a[aria-current]'), other: box('#navstage a:not([aria-current])') };
    });
    const header = (rgb) => Math.abs(rgb[0] - 0x2a) < 8 && Math.abs(rgb[1] - 0x1a) < 8 && Math.abs(rgb[2] - 0x4a) < 8;
    const lit = (rgb) => rgb[1] > 150 && rgb[2] > 150;
    // In the item's padding, clear of its text: the line on the last rows, the header above.
    const marked = async (item) => ({
      line: lit(await pixel(page, item.left + 4, item.bottom - 2)),
      above: header(await pixel(page, item.left + 4, item.bottom - 6)),
      top: header(await pixel(page, item.left + 4, item.top + 4)),
    });
    let g = await geo();
    assert.equal(g.current.bottom, g.canvas.bottom, 'the item reaches the bottom of the canvas');
    assert.deepEqual(await marked(g.current), { line: true, above: true, top: true }, 'a line on the bottom edge, no glass, tint or diamond');
    assert.deepEqual(await marked(g.other), { line: false, above: true, top: true }, 'nothing under the other page');
    await page.evaluate(() => {
      const [a, b] = document.querySelectorAll('#navstage a');
      a.removeAttribute('aria-current');
      b.setAttribute('aria-current', 'page');
    });
    await page.waitForTimeout(900);
    g = await geo();
    assert.deepEqual(await marked(g.current), { line: true, above: true, top: true }, 'the line moved to the new page');
    assert.deepEqual(await marked(g.other), { line: false, above: true, top: true }, 'and left the old one');
  });

  await check(`${path}: without WebGPU, current="line" is the same line, drawn by CSS`, async () => {
    const plain = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await plain.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }));
    await plain.goto(`${url}test/fixtures/app.html`);
    await plain.waitForFunction(() => document.querySelector('#navstage').dataset.renderer === 'dom');
    const looks = await plain.evaluate(() => [...document.querySelectorAll('#navstage a')].map((a) => {
      const cs = getComputedStyle(a);
      return { shadow: cs.boxShadow, border: cs.borderBottomStyle, background: cs.backgroundColor };
    }));
    assert.deepEqual(looks, [
      { shadow: 'rgb(127, 240, 255) 0px -3px 0px 0px inset', border: 'none', background: 'rgba(0, 0, 0, 0)' },
      { shadow: 'none', border: 'none', background: 'rgba(0, 0, 0, 0)' },
    ]);
    await plain.close();
  });

  await check(`${path}: the reticle stays inside the stage; in a current="line" nav it follows the keyboard, not the pointer`, async () => {
    // Every rectangle the reticle hands to the skin, with its stage and alpha.
    await page.evaluate(async () => {
      const { extendSkin, getSkin } = await import('/src/core/skin.js');
      const draw = getSkin('holo').draw.reticle;
      window.__reticles = [];
      extendSkin('holo', {
        reticle(scene, state, ctx) {
          window.__reticles.push({ stage: state.el?.closest('loom-stage')?.id, rect: [...state.rect], alpha: state.alpha });
          return draw(scene, state, ctx);
        },
      });
    });
    const last = (stage) => page.evaluate((stage) => window.__reticles.filter((r) => r.stage === stage).at(-1) ?? null, stage);
    const size = (stage) => page.evaluate((stage) => {
      const s = document.querySelector(`#${stage} .loom-source`);
      return [s.offsetWidth, s.offsetHeight];
    }, stage);

    // The keyboard on the first link: it touches the canvas on the left, the top and the bottom.
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(500, 650);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '#recipes');
    await page.waitForTimeout(700);
    const [w, h] = await size('navstage');
    const focus = await last('navstage');
    assert.ok(focus && focus.alpha > 0.9, 'keyboard focus shows the reticle');
    const [x, y, rw, rh] = focus.rect;
    assert.ok(x >= 4 && y >= 4 && x + rw <= w - 4 && y + rh <= h - 4, `inside the stage (${focus.rect.map(Math.round)} in ${w}×${h})`);
    assert.deepEqual([Math.round(x), Math.round(y), Math.round(y + rh)], [4, 4, h - 4], 'pulled in on the three edges it would cross');

    // The pointer over the bar: no reticle.
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(700);
    const link = await page.evaluate(() => {
      const r = document.querySelector('#navstage a[href="#stock"]').getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
    await page.evaluate(() => (window.__reticles = []));
    await page.mouse.move(link[0], link[1], { steps: 4 });
    await page.waitForTimeout(500);
    const shown = await page.evaluate(() => window.__reticles.filter((r) => r.stage === 'navstage' && r.alpha > 0.05).length);
    assert.equal(shown, 0, 'no reticle on hover');

    // A button inside a panel: its reticle is as it was, five pixels around it.
    const button = await page.evaluate(() => {
      const b = document.querySelector('#styled').getBoundingClientRect();
      return [b.x + b.width / 2, b.y + b.height / 2];
    });
    await page.mouse.move(button[0], button[1], { steps: 4 });
    await page.waitForTimeout(900);
    const inner = await last('content');
    const expected = await page.evaluate(() => {
      const b = document.querySelector('#styled').getBoundingClientRect();
      const s = document.querySelector('#content .loom-source').getBoundingClientRect();
      return [b.x - s.x - 5, b.y - s.y - 5, b.width + 10, b.height + 10];
    });
    assert.ok(inner.rect.every((v, i) => Math.abs(v - expected[i]) < 0.5), `unchanged: ${inner.rect.map(Math.round)} vs ${expected.map(Math.round)}`);
    await page.mouse.move(500, 650);
  });

  await check(`${path}: toasts="viewport" shows the page's toasts at the bottom centre of the viewport`, async () => {
    await page.evaluate(() => {
      const li = document.createElement('li');
      li.id = 'toast';
      li.textContent = 'Recipe saved';
      document.querySelector('[toasts=viewport]').append(li);
    });
    await page.waitForTimeout(800);
    // The stage, and the list and the toast in it: all three span the same width.
    const place = () => page.evaluate(() => {
      const r = document.querySelector('#dock').getBoundingClientRect();
      const inner = ['[toasts=viewport]', '#toast'].map((s) => {
        const b = document.querySelector(s).getBoundingClientRect();
        return [Math.round(b.left - r.left), Math.round(r.right - b.right)];
      });
      if (inner.some(([l, rr]) => l !== 0 || rr !== 0)) return { inner };
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
