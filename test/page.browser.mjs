// A page stage (<loom-stage page>) around an app's views, in Chrome with WebGPU, on Chrome's
// own HTML-in-Canvas and on the polyfill: plain HTML at rest; a transition draws only the
// visible part of a tall view, keeps the stages inside it in the picture, flies a title,
// takes clicks on the new view during the cut, and gives the page back where it was shown.
//   node test/page.browser.mjs            both paths
//   node test/page.browser.mjs --native   only the native path
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
  const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1, ...options });
  if (options.noGpu) await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }));
  // Every canvas the page stage takes, and every change of its renderer.
  await page.addInitScript(() => {
    window.__canvases = 0;
    addEventListener('DOMContentLoaded', () => {
      const view = document.querySelector('#view');
      new MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) if (n.localName === 'canvas') window.__canvases++;
      }).observe(view, { childList: true });
    });
  });
  await page.goto(`${url}test/fixtures/page.html`);
  await page.waitForFunction((gpu) => !gpu || document.querySelector('#inner').dataset.renderer === 'webgpu', !options.noGpu, { timeout: 20000 });
  await page.waitForTimeout(1500); // the inner stage's boot sweep, and the page stage's idle warm-up
  return page;
}

async function run(path, browser, url) {
  console.log(`\n${path}`);
  const page = await open(browser, url);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await check(`${path}: at rest a page stage is plain HTML, and a change of its view takes no capture`, async () => {
    const rest = await page.evaluate(() => ({
      renderer: document.querySelector('#view').dataset.renderer,
      canvas: !!document.querySelector('#view > canvas'),
      source: getComputedStyle(document.querySelector('#view > .loom-source')).paddingTop,
    }));
    assert.deepEqual(rest, { renderer: 'dom', canvas: false, source: '0px' }, 'no canvas, no skin');
    await page.evaluate(() => {
      for (let i = 0; i < 20; i++) document.querySelector('#title-lab').textContent = `Laboratory ${i}`;
    });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.__canvases), 0, 'never a canvas');
    await page.evaluate(() => (document.querySelector('#title-lab').textContent = 'Laboratory'));
  });

  await check(`${path}: a transition on a 6000 px view scrolled to its middle draws only the visible part, with the stage inside it`, async () => {
    // Halfway down the laboratory, where its inner stage is.
    await page.evaluate(() => scrollTo(0, document.querySelector('#inner').getBoundingClientRect().top + scrollY - 150));
    await page.waitForTimeout(400);
    const height = await page.evaluate(() => document.querySelector('#view').offsetHeight);
    assert.ok(height > 5800, `the view is ${height} px tall`);
    const clip = await page.evaluate(() => {
      const r = document.querySelector('#inner').getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    });
    // The frames the page shows (a screenshot would render the page again, not what is seen).
    const cdp = await page.context().newCDPSession(page);
    const frames = [];
    cdp.on('Page.screencastFrame', (f) => {
      frames.push({ at: Date.now(), data: Buffer.from(f.data, 'base64') });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await page.waitForTimeout(300);
    const started = Date.now();
    await page.evaluate(() => {
      window.__innerLog = [];
      new MutationObserver(() => window.__innerLog.push(document.querySelector('#inner')?.dataset.renderer)).observe(document.querySelector('#inner'), { attributes: true, attributeFilter: ['data-renderer'] });
      window.__done = false;
      // From right to left: the inner stage, on the left, is the old page the longest.
      document.querySelector('#view').transition(() => {
        window.__innerAtUpdate = [...window.__innerLog];
        document.querySelector('#lab').replaceWith(window.recipes());
      }, { direction: -1 }).then(() => (window.__done = true));
    });
    await page.waitForFunction(() => document.querySelector('#view').dataset.renderer === 'webgpu', null, { timeout: 5000 });
    const canvas = await page.evaluate(() => {
      const c = document.querySelector('#view > canvas');
      return { css: c.getBoundingClientRect().height, buffer: c.height, view: innerHeight };
    });
    assert.ok(canvas.css <= canvas.view && canvas.buffer <= Math.min(8192, canvas.view * 2), `the canvas is the visible part (${JSON.stringify(canvas)})`);
    await page.waitForTimeout(400);
    await cdp.send('Page.stopScreencast');
    await cdp.detach();
    const crop = (png) => page.evaluate(async ([b64, clip]) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(clip.width, clip.height);
      c.getContext('2d').drawImage(bitmap, -clip.x, -clip.y);
      const d = c.getContext('2d').getImageData(0, 0, clip.width, clip.height).data;
      return [...d.filter((_, i) => i % 4 === 1)];
    }, [png.toString('base64'), clip]);
    const reference = await crop(frames.filter((f) => f.at < started).at(-1).data);
    // The first 250 ms of the transition: the blade has not reached the left yet.
    const early = frames.filter((f) => f.at > started + 40 && f.at < started + 250);
    assert.ok(early.length > 2, `frames in the transition: ${early.length}`);
    for (const f of early) {
      const g = await crop(f.data);
      const d = g.reduce((sum, v, i) => sum + Math.abs(v - reference[i]), 0) / g.length;
      assert.ok(d < 10, `the inner stage shows in the old picture as it was seen (drift ${d.toFixed(1)} at ${f.at - started} ms)`);
    }
    await page.waitForFunction(() => window.__done, null, { timeout: 8000 });
    assert.deepEqual(await page.evaluate(() => window.__innerAtUpdate), [], 'the inner stage moved into the canvas without restarting');
  });

  await check(`${path}: after the transition the page has its HTML back, and the new view is where it was shown`, async () => {
    const after = await page.evaluate(() => ({
      renderer: document.querySelector('#view').dataset.renderer,
      canvas: !!document.querySelector('#view > canvas'),
      height: document.querySelector('#view').style.height,
      scrollY,
      title: Math.round(document.querySelector('#title-recipes').getBoundingClientRect().top),
    }));
    assert.deepEqual(after, { renderer: 'dom', canvas: false, height: '', scrollY: 0, title: 60 });
  });

  await check(`${path}: a title flies from the old view to the new one, and a click on the new view lands during the cut`, async () => {
    await page.evaluate(() => {
      window.__done = false;
      window.__flight = [];
      const view = document.querySelector('#view');
      // A page turn from the right: the button, on the right, is uncovered first.
      view.transition(() => document.querySelector('#recipes').replaceWith(window.stock()), { direction: -1, style: 'curl' }).then(() => (window.__done = true));
    });
    // The title on its way: where the stage shows it is not yet its place.
    await page.waitForFunction(() => {
      const view = document.querySelector('#view');
      const title = document.querySelector('#title-stock');
      if (!title || !view.querySelector('canvas')) return false;
      const shown = view.rectOf(title)[1];
      const s = view.querySelector('.loom-source').getBoundingClientRect();
      const placed = title.getBoundingClientRect().top - s.top;
      window.__flight.push(shown - placed);
      return Math.abs(shown - placed) > 20;
    }, null, { timeout: 4000, polling: 'raf' });
    // A click on the new view's button while the cut runs, once the point shows the button
    // itself (uncovered by the cut, and no flying title over it).
    const at = await page.evaluate(() => {
      const r = document.querySelector('#restock').getBoundingClientRect();
      return [r.right - 20, r.y + r.height / 2];
    });
    await page.waitForFunction(([x, y]) => {
      const view = document.querySelector('#view');
      const c = view.querySelector('canvas')?.getBoundingClientRect();
      const m = c && view.mapPoint({ x: x - c.left, y: y - c.top });
      return m && Math.abs(m.x - (x - c.left)) < 2 && Math.abs(m.y - (y - c.top)) < 2;
    }, at, { timeout: 4000, polling: 'raf' });
    await page.mouse.click(at[0], at[1]);
    const during = await page.evaluate(() => ({ canvas: !!document.querySelector('#view > canvas'), clicks: document.querySelector('#restock').dataset.n }));
    assert.deepEqual(during, { canvas: true, clicks: '1' }, 'the click reached the new view while the stage drew');
    await page.waitForFunction(() => window.__done, null, { timeout: 8000 });
    const end = await page.evaluate(() => {
      const view = document.querySelector('#view');
      const title = document.querySelector('#title-stock');
      return { canvas: !!view.querySelector('canvas'), title: Math.round(title.getBoundingClientRect().top) };
    });
    assert.equal(end.canvas, false);
    assert.ok(end.title > 200, `the title landed in its place (${end.title})`);
  });

  await check(`${path}: nothing throws`, async () => {
    assert.deepEqual(errors, []);
  });
  await page.close();

  for (const [label, options] of [['with reduced motion', { reducedMotion: 'reduce' }], ['without WebGPU', { noGpu: true }]]) {
    await check(`${path}: ${label}, a page stage's transition updates at once`, async () => {
      const plain = await open(browser, url, options);
      const r = await plain.evaluate(async () => {
        let updated = false;
        const done = document.querySelector('#view').transition(() => {
          document.querySelector('#lab').replaceWith(window.recipes());
          updated = true;
        });
        const sync = updated;
        await done;
        return { sync, canvases: window.__canvases, view: !!document.querySelector('#recipes') };
      });
      assert.deepEqual(r, { sync: true, canvases: 0, view: true });
      await plain.close();
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
