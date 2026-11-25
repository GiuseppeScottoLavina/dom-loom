// A stage's start, on a hardware GPU and on software WebGPU (SwiftShader, where compiling
// the compositor takes seconds), on Chrome's own HTML-in-Canvas and on the polyfill: a click
// is never lost while a stage starts, a lazy stage that comes into view takes clicks at
// once, and a start that fails leaves the content as it was.
//   node test/startup.browser.mjs            every path
//   node test/startup.browser.mjs --native   only Chrome's own HTML-in-Canvas
//   node test/startup.browser.mjs --gpu=software   only software WebGPU (or --gpu=hardware)
import assert from 'node:assert/strict';
import { launch, startServer } from './harness.mjs';

const SOFTWARE = '--use-webgpu-adapter=swiftshader --use-angle=swiftshader --enable-unsafe-swiftshader';
const paths = process.argv.includes('--native') ? ['native'] : ['native', 'polyfill'];
const gpuArg = process.argv.find((a) => a.startsWith('--gpu='))?.slice(6);
const gpus = gpuArg ? [gpuArg] : ['hardware', 'software'];
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

/**
 * Clicks the button ten times a second (faster than a person, still separate clicks) until
 * its stage has drawn for a while, or `ms` pass. Every click must land: `lost` lists the
 * stage's state at each one that did not.
 */
async function clickThrough(page, stage, button, ms = 30000) {
  const read = () => page.evaluate(([stage, button]) => {
    const r = document.querySelector(button).getBoundingClientRect();
    return {
      state: document.querySelector(stage).dataset.renderer ?? 'none',
      n: Number(document.querySelector(button).dataset.n ?? 0),
      // Where the button is now: it moves while the page and the stage set up.
      at: [r.x + r.width / 2, r.y + r.height / 2],
    };
  }, [stage, button]);
  const lost = [];
  let sent = 0;
  let drawnAt = 0;
  let last = await read();
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (last.state === 'webgpu') drawnAt ||= Date.now();
    if (drawnAt && Date.now() - drawnAt > 600) break;
    await page.mouse.click(last.at[0], last.at[1]);
    sent++;
    await page.waitForTimeout(100);
    const now = await read();
    if (now.n !== last.n + 1) lost.push(`${last.state} → ${now.state} (${now.n - last.n} landed)`);
    last = now;
  }
  return { sent, lost, drawn: Boolean(drawnAt) };
}

const { server, url } = await startServer();
const base = process.env.CHROME_ARGS ?? '';
try {
  for (const gpu of gpus) {
    process.env.CHROME_ARGS = gpu === 'software' ? `${base} ${SOFTWARE}` : base;
    for (const path of paths) {
      console.log(`\n${path}, ${gpu} GPU`);
      const browser = await launch({ polyfill: path === 'polyfill' });
      try {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${url}test/fixtures/startup.html`);

        await check(`${path}, ${gpu}: every click lands while a stage starts`, async () => {
          const r = await clickThrough(page, '#eager', '#b1');
          assert.ok(r.drawn, 'the stage draws');
          assert.ok(r.sent > 3, `clicks sent: ${r.sent}`);
          assert.deepEqual(r.lost, [], `${r.lost.length} of ${r.sent} clicks lost`);
        });

        await check(`${path}, ${gpu}: a lazy stage takes clicks as soon as it comes into view`, async () => {
          // Not Playwright's scroll, which waits for frames: software WebGPU can hold them back
          // for a long time while it compiles the shader on its first draw.
          await page.evaluate(() => document.querySelector('#lazy').scrollIntoView({ block: 'center' }));
          const r = await clickThrough(page, '#lazy', '#b2', 10000);
          assert.ok(r.sent > 3, `clicks sent: ${r.sent}`);
          assert.deepEqual(r.lost, [], `${r.lost.length} of ${r.sent} clicks lost`);
        });

        await check(`${path}, ${gpu}: nothing throws`, async () => {
          assert.deepEqual(errors, []);
        });
        await page.close();

        await check(`${path}, ${gpu}: a start that fails leaves the content as it was`, async () => {
          const failing = await browser.newPage({ viewport: { width: 800, height: 600 } });
          // The compositor cannot be compiled: the stage gives up before its content moves.
          await failing.addInitScript(() => {
            GPUDevice.prototype.createRenderPipelineAsync = () => Promise.reject(new Error('no pipeline here'));
            window.__fallback = [];
            addEventListener('loom-fallback', (e) => window.__fallback.push(e.detail.error.message), true);
          });
          await failing.goto(`${url}test/fixtures/startup.html`);
          await failing.waitForFunction(() => window.__fallback.length > 0, null, { timeout: 15000 });
          const state = await failing.evaluate(() => ({
            renderer: document.querySelector('#eager').dataset.renderer,
            canvas: !!document.querySelector('#eager canvas'),
            reason: window.__fallback[0],
          }));
          assert.deepEqual(state, { renderer: 'dom', canvas: false, reason: 'no pipeline here' });
          await failing.click('#b1');
          assert.equal(await failing.evaluate(() => document.querySelector('#b1').dataset.n), '1', 'a click lands');
          await failing.close();
        });
      } finally {
        await browser.close();
      }
    }
  }
} finally {
  process.env.CHROME_ARGS = base;
  await server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
