// Effects D and E in Chrome with WebGPU, on Chrome's own HTML-in-Canvas and on the polyfill:
// SHATTER (an exit style for removed elements) and MELT (a style of cut).
//   node test/effects-de.browser.mjs            both paths
//   node test/effects-de.browser.mjs --native   only the native path
// The pages run on a clock that the test can freeze (window.__freeze), so a frame is the
// same for the screenshot, for the input mapper and for the click.
import assert from 'node:assert/strict';
import { launch, startServer } from './harness.mjs';
import { MELT } from '../src/primitives/melt.js';
import { SHARDS, grid } from '../src/primitives/shards.js';
import { primitives } from '../src/core/primitives.js';
import { buildShader } from '../src/core/shader.js';
import { mapThrough } from '../src/core/mapper.js';
import { ITEM_FLOATS, Scene, U, UNIFORM_FLOATS } from '../src/core/scene.js';

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

// ---- Without a browser: the twins and the registry --------------------------------

function uniforms(values = {}) {
  const u = new Float32Array(UNIFORM_FLOATS);
  u[U.viewport + 2] = 640;
  u[U.viewport + 3] = 420;
  for (const [key, value] of Object.entries(values)) u[U[key]] = value;
  return u;
}

async function pure() {
  console.log('\nregistry and twins');
  await check('the primitives register as kinds 27 and 28, with the capabilities that stage.js and the shader use', () => {
    assert.equal(SHARDS, 27);
    assert.equal(MELT, 28);
    assert.equal(primitives.get(27).name, 'shards');
    assert.equal(primitives.get(27).exit.name, 'shatter');
    assert.equal(primitives.get(27).picture.transition, true);
    assert.equal(primitives.get(28).name, 'melt');
    assert.equal(primitives.get(28).cut.fn, 'meltCut');
    const code = buildShader(primitives.all());
    assert.ok(code.includes('fn shardsPicture('));
    assert.ok(code.includes('fn meltCut('));
    // The shards are drawn over the cut, not in the picture pass (their w is an opacity).
    assert.ok(code.includes('let over = shardsPicture(p, light);'));
    assert.ok(!code.includes('shardsPicture(p, &light)'));
    assert.ok(code.includes(`if (style == 28u) { return meltCut(p, sc, s, front, dir, light); }`));
  });

  await check('a grid of shards stays between about 12 and 48 for any element', () => {
    for (const [w, h] of [[90, 28], [420, 150], [800, 40], [30, 30], [1200, 900], [40, 600], [1, 1]]) {
      const [gx, gy] = grid(w, h);
      assert.ok(gx >= 1 && gy >= 1 && gx * gy <= 48, `${w}x${h}: ${gx}x${gy}`);
      if (w * h >= 2000) assert.ok(gx * gy >= 12, `${w}x${h}: ${gx}x${gy}`);
    }
  });

  await check('shards: the item starts as the whole old picture, ends with null, bursts from the origin and takes no input', () => {
    const rect = [40, 100, 420, 150];
    const whole = [0, 0, 640, 460];
    const start = SHARDS && primitives.get(27).exit.item(rect, 0, { origin: null, seed: 7, whole });
    assert.deepEqual(start.p, rect);
    assert.deepEqual(start.q.slice(0, 2), [250, 175], 'no press: the centre');
    assert.ok(start.rect[0] >= 0 && start.rect[1] >= 0 && start.rect[0] + start.rect[2] <= 640 && start.rect[1] + start.rect[3] <= 460, 'clipped to the stage');
    const [tau, gx, gy] = start.h;
    assert.equal(tau, 0);
    assert.equal(primitives.get(27).exit.item(rect, 1400, { seed: 7, whole }), null, 'gone');
    const pressed = primitives.get(27).exit.item(rect, 0, { origin: [10, 400], seed: 7, whole });
    assert.deepEqual(pressed.q.slice(0, 2), [10, 400]);
    // Before anything breaks loose the shards tile the whole rect, none of it takes input.
    const scene = new Scene();
    scene.push(27, start.rect, start.p, start.q, tau, gx, gy);
    const u = uniforms({ wipeActive: 1, wipeFront: 1.1, wipeBand: 0.1, wipeSlant: 0.42 });
    for (const [x, y] of [[60, 120], [250, 175], [450, 240], [100, 200]]) {
      assert.equal(mapThrough(x, y, u, scene.data, 1), null, `(${x}, ${y}) is under a shard`);
    }
    for (const [x, y] of [[20, 120], [250, 90], [250, 260], [500, 175]]) {
      assert.deepEqual(mapThrough(x, y, u, scene.data, 1), { x, y }, `(${x}, ${y}) is outside the element`);
    }
    // Later, the shards have left: the middle of the old rect is live again.
    const later = primitives.get(27).exit.item(rect, 900, { seed: 7, whole });
    const scene2 = new Scene();
    scene2.push(27, later.rect, later.p, later.q, ...later.h);
    let live = 0;
    for (let x = 50; x < 460; x += 10) for (let y = 105; y < 250; y += 10) if (mapThrough(x, y, u, scene2.data, 1)) live++;
    assert.ok(live > 0.5 * 42 * 15, `most of the old rect is open again (${live})`);
    // The burst depends on where it comes from.
    const left = primitives.get(27).exit.item(rect, 450, { origin: [0, 175], seed: 7, whole });
    const right = primitives.get(27).exit.item(rect, 450, { origin: [640, 175], seed: 7, whole });
    const a = new Scene(), b = new Scene();
    a.push(27, left.rect, left.p, left.q, ...left.h);
    b.push(27, right.rect, right.p, right.q, ...right.h);
    let differ = 0;
    for (let x = 0; x < 640; x += 8) for (let y = 0; y < 460; y += 8) {
      if ((mapThrough(x, y, u, a.data, 1) === null) !== (mapThrough(x, y, u, b.data, 1) === null)) differ++;
    }
    assert.ok(differ > 20, `the origin moves the shards (${differ})`);
  });

  await check('melt: the old page everywhere while the cut waits, then the front of each column only goes down', () => {
    const js = primitives.get(28).cut.js;
    const u = uniforms({ wipeBand: 0.1 });
    const sc = [0, 0, 640, 420];
    for (const [x, y] of [[0, 0], [100, 5], [320, 210], [639, 419]]) {
      assert.equal(js(x, y, sc, 0.5, 0, 1, u), null, 'front 0: the old page');
    }
    for (const x of [3, 77, 200, 333, 500, 631]) {
      let last = 0;
      for (let front = 0.05; front <= 1.1; front += 0.05) {
        let y = 0;
        while (y < 420 && js(x, y, sc, 0.5, front, 1, u) === undefined) y++;
        // Above the front: the new page, below: the old one, with no gaps.
        for (let k = y; k < 420; k += 7) assert.equal(js(x, k, sc, 0.5, front, 1, u), null);
        assert.ok(y >= last, `column ${x}: the front never rises (${y} < ${last})`);
        last = y;
      }
      assert.equal(last, 420, `column ${x}: the page is all new at the end`);
    }
    // A scoped cut measures from its own region.
    assert.equal(js(300, 160, [200, 150, 200, 100], 0.5, 0, 1, u), null);
    assert.equal(js(300, 150, [200, 150, 200, 100], 0.5, 0.9, 1, u), undefined);
  });
}

// ---- The browser ----------------------------------------------------------------

async function open(browser, url, { reduced = false, noGpu = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 700, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  if (noGpu) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }));
  // A clock that can stand still: time is the real one, less the time it was frozen.
  await context.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const real = performance.now.bind(performance);
    window.__freeze = { at: null };
    performance.now = () => window.__freeze.at ?? real();
    window.requestAnimationFrame = (cb) => raf((ts) => cb(window.__freeze.at ?? ts));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  await page.goto(`${url}test/fixtures/effects-de.html`);
  const renderers = await page.evaluate(() => customElements.whenDefined('loom-stage').then(
    () => Promise.all([...document.querySelectorAll('loom-stage')].map((s) => s.ready))));
  await page.waitForTimeout(1100); // the boot sweep
  return { page, context, errors, renderers };
}

const framesDuring = (page, ms, selector) => page.evaluate(async ({ ms, selector }) => {
  const canvas = document.querySelector(selector);
  if (!canvas) return 0;
  let n = 0;
  const count = () => n++;
  canvas.addEventListener('effectframe', count);
  await new Promise((r) => setTimeout(r, ms));
  canvas.removeEventListener('effectframe', count);
  return n;
}, { ms, selector });

/** Freezes the clock a moment after `start()` began a motion and returns the time that was frozen. */
async function freezeAfter(page, start) {
  await start();
  await page.waitForTimeout(60);
  return page.evaluate(() => {
    window.__freeze.at = performance.now();
    return window.__freeze.at;
  });
}

async function showAt(page, t) {
  await page.evaluate((t) => { window.__freeze.at = t; }, t);
  await page.waitForTimeout(260);
}

const thaw = (page) => page.evaluate(() => { window.__freeze.at = null; });

/** Which grid points of a screenshot differ from another one (rows of booleans, by y then x). */
async function differing(page, a, b, points) {
  return page.evaluate(async ({ a, b, points }) => {
    const read = async (b64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    };
    const [ia, ib] = await Promise.all([read(a), read(b)]);
    return points.map(([x, y]) => {
      const i = (y * ia.width + x) * 4;
      return Math.abs(ia.data[i] - ib.data[i]) + Math.abs(ia.data[i + 1] - ib.data[i + 1]) + Math.abs(ia.data[i + 2] - ib.data[i + 2]) > 36;
    });
  }, { a: a.toString('base64'), b: b.toString('base64'), points });
}

async function run(path, browser, url) {
  console.log(`\n${path}`);
  const live = await open(browser, url);
  const { page } = live;

  await check(`${path}: both stages draw on the GPU with the shatter and melt shaders compiled`, async () => {
    assert.deepEqual(live.renderers, ['webgpu', 'webgpu']);
    assert.equal(await page.locator('#fx').getAttribute('data-renderer'), 'webgpu');
    assert.equal(await page.locator('#view').getAttribute('data-renderer'), 'webgpu');
    assert.equal(await page.locator('#fx').getAttribute('data-mode'), path);
  });

  // ---- shatter ----
  const rest = async (top = 300, height = 150) => {
    const stage = page.locator('#fx');
    const box = await stage.boundingBox();
    // A region that only the shards reach: below everything that flies when the element goes.
    return { x: Math.round(box.x), y: Math.round(box.y) + top, width: 640, height };
  };
  const probePoints = (clip) => {
    const points = [];
    for (let y = 0; y < clip.height; y += 5) for (let x = 6; x < clip.width - 6; x += 5) points.push([x, y]);
    return points;
  };

  await check(`${path}: a removed card breaks into shards that leave through the input mapper and the picture alike`, async () => {
    const clip = await rest();
    const empty = await page.evaluate(() => document.querySelector('#fx').rectOf(document.querySelector('#card')));
    assert.ok(empty[2] > 300, 'the card is on the stage');
    const t0 = await freezeAfter(page, () => page.evaluate(() => document.querySelector('#kill').click()));
    // The card is gone from the DOM already; the shards still show its old picture.
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#card'))), false);
    await showAt(page, t0 + 20);
    const centre = await page.evaluate(([x, y]) => document.querySelector('#fx').mapPoint({ x, y }), [empty[0] + empty[2] / 2, empty[1] + empty[3] / 2]);
    assert.equal(centre, null, 'under the cracked picture there is no input');
    // The picture and the mapper agree on where the shards are.
    await showAt(page, t0 + 800);
    const shot = await page.screenshot({ clip });
    const points = probePoints(clip);
    const mapped = await page.evaluate(({ points, clip }) => {
      const stage = document.querySelector('#fx');
      const top = stage.getBoundingClientRect().top + window.scrollY;
      return points.map(([x, y]) => stage.mapPoint({ x, y: y + clip.y - top }) === null);
    }, { points, clip });
    // The empty stage, once everything has finished.
    await thaw(page);
    await page.waitForTimeout(2200);
    const reference = await page.screenshot({ clip });
    const drawn = await differing(page, shot, reference, points);
    let covered = 0;
    let agreed = 0;
    let mappedOnly = 0;
    let drawnOnly = 0;
    const total = points.length;
    points.forEach((_, i) => {
      if (drawn[i]) covered++;
      if (drawn[i] === mapped[i]) agreed++;
      else if (mapped[i]) mappedOnly++;
      else drawnOnly++;
    });
    console.log(`       (${covered} drawn, mapper and picture agree on ${agreed} of ${total} samples; ${mappedOnly} mapped without a visible difference)`);
    assert.ok(covered > 25, `shards are drawn in the free region (${covered} samples)`);
    // A shard that is as dark as the panel behind it is mapped but cannot be told apart in a picture.
    assert.ok(drawnOnly <= 3 + 0.06 * covered, `a visible shard takes no input (${drawnOnly} of ${covered})`);
    assert.ok(agreed / total > 0.9, `the mapper agrees with the picture on ${((agreed / total) * 100).toFixed(1)}% of ${total} samples`);
  });

  await check(`${path}: the stage rests after the shatter and the page is live where the shards were`, async () => {
    assert.equal(await framesDuring(page, 700, '#fx canvas'), 0, 'zero frames at rest');
    const state = await page.evaluate(() => {
      const stage = document.querySelector('#fx');
      return { gone: !document.querySelector('#card'), mapped: stage.mapPoint({ x: 250, y: 175 }) };
    });
    assert.equal(state.gone, true);
    assert.deepEqual(state.mapped, { x: 250, y: 175 });
  });

  await check(`${path}: [removable][exit="shatter"] shatters a chip, a plain one crumbles`, async () => {
    // The chip with the attribute: its remove button, with the pointer. The card is gone: below the chips is free.
    const clip = await rest(160, 290);
    // Nothing else flies in the region under the chips.
    await page.evaluate(() => document.querySelector('#kill').parentElement.remove());
    await page.waitForTimeout(700);
    const shatter = async (selector) => {
      const button = await page.locator(`${selector} button.loom-remove`).boundingBox();
      const t0 = await freezeAfter(page, async () => {
        await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
      });
      await showAt(page, t0 + 10); // the transition starts when the new picture has arrived
      await showAt(page, t0 + 800);
      const shot = await page.screenshot({ clip });
      await thaw(page);
      await page.waitForTimeout(2100);
      const after = await page.screenshot({ clip });
      const drawn = (await differing(page, shot, after, probePoints(clip))).filter(Boolean).length;
      return drawn;
    };
    const shards = await shatter('#c1');
    const crumble = await shatter('#c4');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#chips li')].map((li) => li.id).join()), 'c2,c3');
    console.log(`       (differing samples: ${shards} for the shattered chip, ${crumble} for the crumbled one)`);
    assert.ok(shards > 8, `shards of the chip are in the free region (${shards})`);
    assert.ok(crumble * 4 < shards, 'a chip without the attribute crumbles in place');
    assert.equal(await framesDuring(page, 700, '#fx canvas'), 0);
  });

  await check(`${path}: stage.transition with { exit: 'shatter', morph } breaks what the update removes`, async () => {
    // A fresh list inside the stage: two rows, the first removed by the update.
    await page.evaluate(() => {
      const list = document.createElement('div');
      list.id = 'rows';
      list.style.cssText = 'display:grid;gap:8px;margin:10px 0;width:300px';
      list.innerHTML = '<div id="r1" style="height:60px;border:1px solid #7ff0ff">First row</div><div id="r2" style="height:60px;border:1px solid #7ff0ff">Second row</div>';
      document.querySelector('#fx .loom-source').append(list);
    });
    await page.waitForTimeout(700);
    const t0 = await freezeAfter(page, () => page.evaluate(() => {
      const stage = document.querySelector('#fx');
      const rows = [...document.querySelectorAll('#rows > div')];
      window.__gone = stage.transition(() => rows[0].remove(), { morph: rows, cut: false, exit: 'shatter' });
    }));
    await showAt(page, t0 + 50);
    const over = await page.evaluate(() => {
      const stage = document.querySelector('#fx');
      const r = stage.rectOf(document.querySelector('#r2'));
      return { second: stage.mapPoint({ x: r[0] + 40, y: r[1] + r[3] / 2 }), r };
    });
    assert.ok(over.second, 'the row that stays is live at its new place or its old one');
    await thaw(page);
    await page.evaluate(() => window.__gone);
    await page.waitForTimeout(250);
    assert.equal(await framesDuring(page, 700, '#fx canvas'), 0);
    await page.evaluate(() => document.querySelector('#rows').remove());
    await page.waitForTimeout(500);
  });

  // ---- melt ----
  await check(`${path}: melt shows the old page, then a front per column; input follows the front`, async () => {
    // The way forward and back, to see where the new page's button is.
    await page.evaluate(() => document.querySelector('#to-b').click());
    await page.evaluate(() => window.__done);
    await page.waitForTimeout(500);
    const box = await page.evaluate(() => {
      const c = document.querySelector('#view canvas').getBoundingClientRect();
      const r = document.querySelector('#to-a').getBoundingClientRect();
      return { canvas: [c.left, c.top + window.scrollY], button: [r.left - c.left, r.top - c.top, r.width, r.height] };
    });
    await page.evaluate(() => document.querySelector('#to-a').click());
    await page.evaluate(() => window.__done);
    await page.waitForTimeout(500);
    const [bx, by, bw, bh] = box.button;
    const t0 = await freezeAfter(page, () => page.evaluate(() => document.querySelector('#to-b').click()));
    const at = (x, y) => page.evaluate(([x, y]) => document.querySelector('#view').mapPoint({ x, y }), [x, y]);
    // At the beginning everything is the old page.
    await showAt(page, t0 + 20);
    assert.equal(await at(bx + bw / 2, by + bh / 2), null, 'the old page still shows');
    assert.equal(await at(20, 300), null);
    // Find a moment when the front crosses the button, and a column where it does.
    let found = null;
    for (let ms = 260; ms <= 480 && !found; ms += 20) {
      await showAt(page, t0 + ms);
      const columns = await page.evaluate(({ bx, bw, by, bh }) => {
        const stage = document.querySelector('#view');
        const out = [];
        for (let x = bx + 6; x < bx + bw - 6; x += 6) {
          let first = null;
          let flips = 0;
          let wasLive = null;
          for (let y = 0; y < 420; y += 2) {
            const live = stage.mapPoint({ x, y }) !== null;
            if (wasLive !== null && live !== wasLive) flips++;
            if (!live && first === null) first = y;
            wasLive = live;
          }
          out.push({ x, first, flips });
        }
        return out;
      }, { bx, bw, by, bh });
      const column = columns.find((c) => c.first !== null && c.first > by + 8 && c.first < by + bh - 8);
      if (column) found = { ms, column, columns };
    }
    assert.ok(found, 'the front crossed the button during the melt');
    for (const c of found.columns) assert.ok(c.flips <= 1, `column ${c.x}: live above the front, old below it (${c.flips} changes)`);
    const { x, first } = found.column;
    // Below the front the old page takes no input: a press there does nothing.
    await page.evaluate(() => { window.__log.length = 0; });
    const clickAt = async (px, py) => {
      await page.mouse.click(box.canvas[0] + px, box.canvas[1] + py);
      await page.waitForTimeout(80);
    };
    await clickAt(x, first + 6);
    assert.deepEqual(await page.evaluate(() => window.__log), [], 'a click below the front lands on nothing');
    // Above it the new page is live: the button gets the click.
    const above = await at(x, first - 6);
    assert.ok(above && Math.abs(above.x - x) < 3 && Math.abs(above.y - (first - 6)) < 3, 'the point above the front is live');
    await clickAt(x, first - 6);
    assert.deepEqual(await page.evaluate(() => window.__log), ['click:to-a'], 'a click above the front reaches the new page');
    await thaw(page);
    await page.evaluate(() => window.__done);
    await page.waitForTimeout(400);
  });

  await check(`${path}: melt ends with the new page, live and at rest, and plays again in reverse`, async () => {
    // The click above started the way back to the first page.
    assert.equal(await page.evaluate(() => [document.querySelector('#a').hidden, document.querySelector('#b').hidden]).then(String), 'false,true');
    assert.equal(await framesDuring(page, 700, '#view canvas'), 0, 'zero frames at rest');
    assert.deepEqual(await page.evaluate(() => document.querySelector('#view').mapPoint({ x: 20, y: 300 })), { x: 20, y: 300 });
    // The way forward, with a real pointer all the way through.
    const button = await page.locator('#to-b').boundingBox();
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
    await page.evaluate(() => window.__done);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelector('#b').hidden), false);
    assert.equal(await framesDuring(page, 700, '#view canvas'), 0);
  });

  await check(`${path}: no errors, still on the GPU`, async () => {
    assert.deepEqual(live.errors, []);
    assert.equal(await page.locator('#fx').getAttribute('data-renderer'), 'webgpu');
    assert.equal(await page.locator('#view').getAttribute('data-renderer'), 'webgpu');
  });
  await live.context.close();

  // ---- reduced motion and no WebGPU: plain behaviour ----
  for (const [label, options] of [['reduced motion', { reduced: true }], ['without WebGPU', { noGpu: true }]]) {
    await check(`${path}: ${label}: the card is removed and the page changes plainly, without a frame`, async () => {
      const plain = await open(browser, url, options);
      try {
        const p = plain.page;
        assert.deepEqual(plain.renderers, options.noGpu ? ['dom', 'dom'] : ['webgpu', 'webgpu']);
        // Both effects are skipped: the promises settle at once, where the effects take over a second.
        const took = (selector, key) => p.evaluate(async ({ selector, key }) => {
          const t = performance.now();
          document.querySelector(selector).click();
          await window[key];
          return performance.now() - t;
        }, { selector, key });
        assert.ok(await took('#kill', '__gone') < 400, 'the card goes at once');
        assert.equal(await p.evaluate(() => Boolean(document.querySelector('#card'))), false);
        assert.ok(await took('#to-b', '__done') < 400, 'the page changes at once');
        assert.deepEqual(await p.evaluate(() => [document.querySelector('#a').hidden, document.querySelector('#b').hidden]), [true, false]);
        // A chip with exit="shatter" is removed plainly.
        await p.locator('#c1 button.loom-remove').click();
        await p.waitForTimeout(150);
        assert.equal(await p.evaluate(() => Boolean(document.querySelector('#c1'))), false);
        await p.waitForTimeout(600);
        // Drawing the new content may take frames; once it is done the stage rests.
        p.__rest = options.noGpu ? 0 : await framesDuring(p, 500, '#fx canvas');
        assert.equal(p.__rest, 0, 'the stage rests');
        assert.deepEqual(plain.errors, []);
      } finally {
        await plain.context.close();
      }
    });
  }
}

await pure();
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
