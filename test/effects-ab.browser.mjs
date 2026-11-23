// End-to-end checks of the loupe ([loupe]) and the lit surface ([lit]) in Chrome with WebGPU,
// on Chrome's own HTML-in-Canvas and on the polyfill.
//   node test/effects-ab.browser.mjs            both paths
//   node test/effects-ab.browser.mjs --native   only the native path
//   EFFECTS_SHOTS=/some/dir                     also saves screenshots of both effects mid-motion
import assert from 'node:assert/strict';
import { launch, startServer } from './harness.mjs';

const only = process.argv.includes('--native') ? ['native'] : ['native', 'polyfill'];
const shots = process.env.EFFECTS_SHOTS;
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

async function open(browser, url, { reduced = false, noGpu = false, touch = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 900, height: 1000 },
    deviceScaleFactor: 1,
    hasTouch: touch,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  if (noGpu) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  await page.goto(`${url}test/fixtures/effects-ab.html`);
  const renderer = await page.evaluate(() => customElements.whenDefined('loom-stage').then(() => document.querySelector('#ab').ready));
  await page.waitForTimeout(1100); // the boot sweep
  return { page, context, errors, renderer };
}

const framesDuring = (page, ms) => page.evaluate(async (ms) => {
  const canvas = document.querySelector('#ab canvas');
  if (!canvas) return 0;
  let n = 0;
  const count = () => n++;
  canvas.addEventListener('effectframe', count);
  await new Promise((r) => setTimeout(r, ms));
  canvas.removeEventListener('effectframe', count);
  return n;
}, ms);

/** The channels of a screenshot as one array of [r, g, b] per pixel (DPR 1). */
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

const grey = (s, x, y) => {
  const i = (y * s.w + x) * 4;
  return s.d[i] * 0.2126 + s.d[i + 1] * 0.7152 + s.d[i + 2] * 0.0722;
};
const green = (s, x, y) => s.d[(y * s.w + x) * 4 + 1];

const snapshot = (page, behavior) => page.evaluate((name) => document.querySelector('#ab').behavior(name).snapshot(), behavior);
const boxOf = (page, selector) => page.locator(selector).boundingBox();

async function run(path, browser, url) {
  console.log(`\n${path}`);
  const { page, context, errors, renderer } = await open(browser, url);
  const stage = await boxOf(page, '#ab');
  const table = await boxOf(page, '#loupe-area table');
  const outside = { x: 850, y: 600 };
  const R = 120;
  // The glass sits over the Fuel column, rows 2 and 3.
  const P = { x: table.x + 440, y: table.y + 78 };
  let rest;

  await check(`${path}: the stage renders with WebGPU on the ${path} path`, async () => {
    assert.equal(renderer, 'webgpu');
    assert.equal(await page.locator('#ab').getAttribute('data-renderer'), 'webgpu');
    assert.equal(await page.locator('#ab').getAttribute('data-mode'), path);
    await page.mouse.move(outside.x, outside.y);
    await page.waitForTimeout(300);
    assert.equal(await framesDuring(page, 500), 0, 'no frame at rest');
    rest = await pixels(page, stage);
  });

  await check(`${path}: the loupe magnifies for real, the mapper explains the glass, no frame once settled`, async () => {
    await page.mouse.move(P.x - 150, P.y - 30);
    await page.mouse.move(P.x, P.y, { steps: 5 });
    // A spring lags behind the pointer.
    const lag = await snapshot(page, 'loupes');
    assert.ok(lag && Math.hypot(lag.x + stage.x - P.x, lag.y + stage.y - P.y) > 3, `the glass lags the pointer ${JSON.stringify(lag)}`);
    await page.waitForTimeout(1000);
    const settled = await snapshot(page, 'loupes');
    assert.ok(Math.abs(settled.x + stage.x - P.x) < 0.2 && Math.abs(settled.y + stage.y - P.y) < 0.2, 'the glass settles on the pointer');
    assert.ok(Math.abs(settled.open - 1) < 0.01);
    assert.equal(await framesDuring(page, 600), 0, 'a settled glass costs no frames');
    const glass = await pixels(page, stage);
    if (shots) await page.screenshot({ path: `${shots}/loupe-${path}.png`, clip: { ...stage, height: 340 } });
    // Many pixels of the disc changed.
    const cx = Math.round(P.x - stage.x), cy = Math.round(P.y - stage.y);
    let changed = 0;
    for (let y = cy - 60; y < cy + 60; y++) for (let x = cx - 60; x < cx + 60; x++) if (Math.abs(green(glass, x, y) - green(rest, x, y)) > 30) changed++;
    assert.ok(changed > 300, `the disc shows something else (${changed} px changed)`);
    // Each pixel of the glass shows what the mapper says: magnified, not the flat page.
    const samples = [];
    for (let y = cy - 72; y <= cy + 72; y++) {
      for (let x = cx - 72; x <= cx + 72; x += 2) {
        const dx = x - cx, dy = y - cy;
        if (Math.hypot(dx, dy) > R * 0.7) continue;
        // Not under the specular highlight.
        if (Math.hypot(dx + 0.42 * R, dy + 0.52 * R) < 0.4 * R) continue;
        samples.push({ x, y });
      }
    }
    const mapped = await page.evaluate((samples) => {
      const el = document.querySelector('#ab');
      return samples.map(({ x, y }) => el.mapPoint({ x: x + 0.5, y: y + 0.5 }));
    }, samples);
    let moved = 0, viaMapper = 0, viaIdentity = 0;
    samples.forEach(({ x, y }, i) => {
      const m = mapped[i];
      if (!m) return;
      const sx = m.x - 0.5, sy = m.y - 0.5;
      if (Math.hypot(sx - x, sy - y) < 1.5) return;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const at = (xx, yy) => green(rest, xx, yy);
      const predicted = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      const flat = at(x, y);
      if (Math.abs(predicted - flat) < 40) return;
      moved++;
      const seen = green(glass, x, y);
      if (Math.abs(seen - predicted) <= 45) viaMapper++;
      if (Math.abs(seen - flat) <= 45) viaIdentity++;
    });
    assert.ok(moved >= 60, `too few discriminating samples (${moved})`);
    assert.ok(viaMapper / moved >= 0.8, `mapper explains ${viaMapper}/${moved}, identity ${viaIdentity}/${moved}`);
    console.log(`       loupe: mapper ${viaMapper}/${moved} moved pixels, identity ${viaIdentity}/${moved}`);
  });

  await check(`${path}: a click in the glass lands on the magnified button, not the one under it`, async () => {
    // Glass over the strip of buttons, settled.
    const strip = await boxOf(page, '#strip');
    const S = { x: strip.x + 44 * 4 + 17, y: strip.y + strip.height / 2 };
    await page.mouse.move(S.x, S.y, { steps: 6 });
    await page.waitForTimeout(1000);
    const found = await page.evaluate(({ ox, oy, cx, cy, R }) => {
      const el = document.querySelector('#ab');
      const buttons = [...document.querySelectorAll('#strip button')].map((b) => ({ id: b.id, r: b.getBoundingClientRect() }));
      const hit = (x, y, margin) => buttons.find(({ r }) => x > r.left + margin && x < r.right - margin && y > r.top + margin && y < r.bottom - margin)?.id ?? null;
      let best = null;
      for (let y = cy - R * 0.7; y <= cy + R * 0.7; y += 1) {
        for (let x = cx - R * 0.7; x <= cx + R * 0.7; x += 1) {
          if (Math.hypot(x - cx, y - cy) > R * 0.7) continue;
          const m = el.mapPoint({ x: x - ox, y: y - oy });
          if (!m) continue;
          const shown = hit(m.x + ox, m.y + oy, 6);
          const under = hit(x, y, 0);
          if (!shown || !under || shown === under) continue;
          const score = Math.hypot(x - cx, y - cy);
          if (!best || score > best.score) best = { x, y, shown, under, score };
        }
      }
      return best;
    }, { ox: stage.x, oy: stage.y, cx: S.x, cy: S.y, R });
    assert.ok(found, 'a point of the glass shows one button over another');
    await page.evaluate(() => (window.__log.length = 0));
    // A press where the pointer has not moved: the glass stays where the user sees it.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: found.x, y: found.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: found.x, y: found.y, button: 'left', buttons: 0, clickCount: 1 });
    await page.waitForTimeout(150);
    const log = await page.evaluate(() => window.__log);
    console.log(`       click at the glass point that shows ${found.shown} (the flat page has ${found.under} there): ${JSON.stringify(log)}`);
    assert.deepEqual(log, [`click:${found.shown}`]);
    await page.evaluate(() => document.activeElement?.blur());
    await cdp.detach();
  });

  await check(`${path}: leaving fades the glass out and the stage rests`, async () => {
    await page.mouse.move(outside.x, outside.y, { steps: 3 });
    await page.waitForTimeout(1600); // the glass fades; the click's own ring and focus settle too
    assert.equal(await snapshot(page, 'loupes'), null);
    assert.equal(await framesDuring(page, 500), 0);
    const after = await pixels(page, stage);
    let changed = 0;
    for (let y = 0; y < stage.height; y++) for (let x = 0; x < stage.width; x += 2) if (Math.abs(green(after, x, y) - green(rest, x, y)) > 30) changed++;
    assert.ok(changed < 40, `the page is as it was (${changed} px differ)`);
  });

  await check(`${path}: loupe="3" magnifies more than the default`, async () => {
    const dense = await boxOf(page, '#dense');
    const point = { x: dense.x + 180, y: dense.y + 12 };
    const probe = async () => {
      await page.mouse.move(point.x - 60, point.y);
      await page.mouse.move(point.x, point.y, { steps: 4 });
      await page.waitForTimeout(900);
      return page.evaluate(({ x, y, ox, oy }) => {
        const el = document.querySelector('#ab');
        const a = el.mapPoint({ x: x - ox + 40, y: y - oy });
        return a.x - (x - ox);
      }, { x: point.x, y: point.y, ox: stage.x, oy: stage.y });
    };
    const three = await probe();
    assert.equal((await snapshot(page, 'loupes')).mag, 3);
    // The core is a clean enlargement: 40 px from the centre shows the point 40 / 3 from it.
    assert.ok(Math.abs(three - 40 / 3) < 0.6, `source offset at 40 px: ${three.toFixed(1)}`);
    await page.mouse.move(outside.x, outside.y);
    await page.waitForTimeout(700);
    await page.mouse.move(table.x + 300, table.y + 40, { steps: 4 });
    await page.waitForTimeout(900);
    const two = await page.evaluate(({ ox, oy, x, y }) => {
      const el = document.querySelector('#ab');
      return el.mapPoint({ x: x - ox + 40, y: y - oy }).x - (x - ox);
    }, { ox: stage.x, oy: stage.y, x: table.x + 300, y: table.y + 40 });
    assert.equal((await snapshot(page, 'loupes')).mag, 2);
    assert.ok(Math.abs(two - 20) < 0.6, `the default is a clean ×2: ${two.toFixed(1)}`);
    assert.ok(two > three + 3, `the default (${two.toFixed(1)}) shows farther than ×3 (${three.toFixed(1)})`);
    await page.mouse.move(outside.x, outside.y);
    await page.waitForTimeout(800);
  });

  // ------------------------------------------------------------------ lit
  const litBox = await boxOf(page, '#lit-a');
  const litBoxB = await boxOf(page, '#lit-b');
  const around = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
  let litRest, litRestB;

  await check(`${path}: the pointer lights the surface: relief takes the light, the flat surface hardly, no frame once settled`, async () => {
    await page.mouse.move(outside.x, outside.y);
    await page.waitForTimeout(300);
    litRest = await pixels(page, around(litBox));
    litRestB = await pixels(page, around(litBoxB));
    const L = { x: litBox.x + 95, y: litBox.y + 62 };
    await page.mouse.move(L.x - 120, L.y + 30);
    await page.mouse.move(L.x, L.y, { steps: 6 });
    await page.waitForTimeout(1500);
    const s = await snapshot(page, 'lits');
    assert.ok(Math.abs(s.x + stage.x - L.x) < 0.3 && Math.abs(s.y + stage.y - L.y) < 0.3, 'the light eased onto the pointer');
    assert.equal(await framesDuring(page, 600), 0, 'a settled light costs no frame');
    const lit = await pixels(page, around(litBox));
    if (shots) await page.screenshot({ path: `${shots}/lit-${path}.png`, clip: { x: stage.x, y: litBox.y - 24, width: 760, height: litBox.height + 48 } });
    const lx = Math.round(L.x - litBox.x), ly = Math.round(L.y - litBox.y);
    let edgeSum = 0, edgeN = 0, flatSum = 0, flatN = 0, far = 0;
    const edges = [];
    for (let y = 2; y < lit.h - 2; y++) {
      for (let x = 2; x < lit.w - 2; x++) {
        const dist = Math.hypot(x - lx, y - ly);
        const delta = Math.abs(grey(lit, x, y) - grey(litRest, x, y));
        if (dist > 200) { if (delta > 25) far++; continue; }
        if (dist > 70) continue;
        // The relief of the picture at rest: its slope.
        const gx = grey(litRest, x + 1, y) - grey(litRest, x - 1, y);
        const gy = grey(litRest, x, y + 1) - grey(litRest, x, y - 1);
        if (Math.hypot(gx, gy) > 40) { edgeSum += delta; edgeN++; edges.push(grey(lit, x, y) - grey(litRest, x, y)); } else if (Math.hypot(gx, gy) < 3) { flatSum += delta; flatN++; }
      }
    }
    assert.ok(edgeN > 200 && flatN > 500, `samples ${edgeN}/${flatN}`);
    const edge = edgeSum / edgeN, flat = flatSum / flatN;
    console.log(`       lit: mean change on edges ${edge.toFixed(1)}, on flat ${flat.toFixed(1)}, far px changed ${far}`);
    // The pool lifts the flat paper; the relief goes both ways around that: edges toward the
    // light catch it (brighter than the pool), edges away from it sink (darker than the pool).
    const lifted = flatSum / flatN;
    const brighter = edges.filter((d) => d > lifted + 20).length;
    const darker = edges.filter((d) => d < lifted - 20).length;
    console.log(`       lit relief: ${brighter} edge px brighter than the pool, ${darker} darker (pool ${lifted.toFixed(1)})`);
    assert.ok(lifted > 8, 'the pool lights the paper');
    assert.ok(brighter > 60 && darker > 30, 'edges catch the light on one side and sink on the other');
    assert.ok(far < 10, `nothing changes beyond the light's reach (${far})`);
    // The neighbouring surface is not lit.
    const other = await pixels(page, around(litBoxB));
    let otherChanged = 0;
    for (let y = 0; y < other.h; y++) for (let x = 0; x < other.w; x++) if (Math.abs(grey(other, x, y) - grey(litRestB, x, y)) > 12) otherChanged++;
    assert.ok(otherChanged < 10, `the second surface is untouched (${otherChanged})`);
  });

  await check(`${path}: lit="0.3" is dimmer than lit`, async () => {
    const energy = async (box, boxRest) => {
      const L = { x: box.x + 95, y: box.y + 62 };
      await page.mouse.move(outside.x, outside.y);
      await page.waitForTimeout(800);
      await page.mouse.move(L.x - 100, L.y + 20);
      await page.mouse.move(L.x, L.y, { steps: 5 });
      await page.waitForTimeout(1500);
      const now = await pixels(page, around(box));
      let sum = 0;
      for (let y = 0; y < now.h; y++) for (let x = 0; x < now.w; x++) sum += Math.abs(grey(now, x, y) - grey(boxRest, x, y));
      return sum;
    };
    const full = await energy(litBox, litRest);
    const dim = await energy(litBoxB, litRestB);
    console.log(`       lit energy: 1 -> ${Math.round(full)}, 0.3 -> ${Math.round(dim)}`);
    assert.ok(dim > 0, 'the dim light still shows');
    assert.ok(dim < full * 0.6, 'the intensity attribute dims the light');
    await page.mouse.move(outside.x, outside.y);
    await page.waitForTimeout(800);
  });

  await check(`${path}: a lit surface moves no pixel: the mapper is the identity and a click lands`, async () => {
    const L = { x: litBox.x + 100, y: litBox.y + 100 };
    await page.mouse.move(L.x - 60, L.y - 30);
    await page.mouse.move(L.x, L.y, { steps: 4 });
    await page.waitForTimeout(1300);
    const worst = await page.evaluate(({ ox, oy, box }) => {
      const el = document.querySelector('#ab');
      let w = 0;
      for (let y = box.y - oy; y < box.y - oy + box.height; y += 7) {
        for (let x = box.x - ox; x < box.x - ox + box.width; x += 7) {
          const m = el.mapPoint({ x, y });
          w = Math.max(w, Math.hypot(m.x - x, m.y - y));
        }
      }
      return w;
    }, { ox: stage.x, oy: stage.y, box: litBox });
    assert.ok(worst < 0.01, `mapper drift ${worst}`);
    await page.evaluate(() => (window.__log.length = 0));
    const button = await boxOf(page, '#lit-btn');
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
    assert.deepEqual(await page.evaluate(() => window.__log), ['click:lit-btn']);
  });

  await check(`${path}: leaving fades the light and the stage rests, the page as it was`, async () => {
    await page.mouse.move(outside.x, outside.y, { steps: 3 });
    await page.waitForTimeout(1300);
    assert.equal(await snapshot(page, 'lits'), null);
    assert.equal(await framesDuring(page, 500), 0);
    const after = await pixels(page, around(litBox));
    let changed = 0;
    for (let y = 0; y < after.h; y++) for (let x = 0; x < after.w; x++) if (Math.abs(grey(after, x, y) - grey(litRest, x, y)) > 12) changed++;
    assert.ok(changed < 20, `${changed} px differ from the page at rest`);
  });

  await check(`${path}: no console errors, and the pointer over both effects at once works`, async () => {
    // The loupe's rect is not the lit one: cross from one effect to the other.
    await page.mouse.move(litBox.x + 50, litBox.y + 40);
    await page.mouse.move(table.x + 200, table.y + 60, { steps: 8 });
    await page.waitForTimeout(500);
    assert.ok(await snapshot(page, 'loupes'));
    assert.equal(await snapshot(page, 'lits'), null);
    await page.mouse.move(outside.x, outside.y);
    await page.waitForTimeout(900);
    assert.deepEqual(errors, []);
  });
  await context.close();

  // ------------------------------------------------------------------ touch
  await check(`${path}: touch: a hold shows the glass above the finger, a plain tap is just a tap`, async () => {
    const t = await open(browser, url, { touch: true });
    try {
      assert.equal(t.renderer, 'webgpu');
      const tb = await boxOf(t.page, '#loupe-area table');
      const sb = await boxOf(t.page, '#ab');
      const cdp = await t.context.newCDPSession(t.page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
      const dense = await boxOf(t.page, '#dense');
      const finger = { x: dense.x + 300, y: dense.y + 14 };
      // A tap on a button: clicks, and shows no glass.
      const strip = await boxOf(t.page, '#b2');
      await t.page.evaluate(() => (window.__log.length = 0));
      await touch('touchStart', strip.x + strip.width / 2, strip.y + strip.height / 2);
      await t.page.waitForTimeout(60);
      await touch('touchEnd');
      await t.page.waitForTimeout(500);
      assert.deepEqual(await t.page.evaluate(() => window.__log), ['click:b2'], 'a tap clicks the button');
      assert.equal(await snapshot(t.page, 'loupes'), null, 'a tap shows no glass');
      // A hold.
      await touch('touchStart', finger.x, finger.y);
      await t.page.waitForTimeout(150);
      assert.equal(await snapshot(t.page, 'loupes'), null, 'not before the hold');
      await t.page.waitForTimeout(450);
      const held = await snapshot(t.page, 'loupes');
      assert.ok(held && held.touch, 'the glass shows while the finger rests');
      assert.ok(held.y + sb.y < finger.y - R * 0.8, `the glass is above the finger (${(held.y + sb.y).toFixed(0)} vs ${finger.y.toFixed(0)})`);
      assert.ok(Math.abs(held.focus[1] - (finger.y - sb.y - held.y)) < 1, 'it looks at what the finger covers');
      if (shots) await t.page.screenshot({ path: `${shots}/loupe-touch-${path}.png`, clip: { ...sb, height: 340 } });
      await touch('touchMove', finger.x + 40, finger.y);
      await t.page.waitForTimeout(600);
      const moved = await snapshot(t.page, 'loupes');
      assert.ok(Math.abs(moved.x - held.x - 40) < 2, 'it follows the finger');
      await t.page.evaluate(() => (window.__log.length = 0));
      await touch('touchEnd');
      await t.page.waitForTimeout(900);
      assert.equal(await snapshot(t.page, 'loupes'), null, 'it fades when the finger lifts');
      assert.deepEqual(await t.page.evaluate(() => window.__log), [], 'a peek is not a tap');
      assert.equal(await framesDuring(t.page, 500), 0);
      // Near the top there is no room above the finger: the glass goes below it.
      await touch('touchStart', tb.x + 300, tb.y + 30);
      await t.page.waitForTimeout(500);
      const low = await snapshot(t.page, 'loupes');
      assert.ok(low.y + sb.y > tb.y + 30 + R, 'the glass is below the finger when the top is too near');
      await touch('touchEnd');
      await t.page.waitForTimeout(800);
      assert.deepEqual(t.errors, []);
      await cdp.detach();
    } finally {
      await t.context.close();
    }
  });

  // ------------------------------------------------------------------ reduced motion
  await check(`${path}: reduced motion: the glass and the light sit exactly at the pointer, no fades`, async () => {
    const r = await open(browser, url, { reduced: true });
    try {
      assert.equal(r.renderer, 'webgpu');
      const sb = await boxOf(r.page, '#ab');
      const tb = await boxOf(r.page, '#loupe-area table');
      await r.page.mouse.move(tb.x + 100, tb.y + 30);
      await r.page.mouse.move(tb.x + 380, tb.y + 90);
      await r.page.waitForTimeout(80);
      const g = await snapshot(r.page, 'loupes');
      assert.deepEqual([g.x, g.y, g.open], [tb.x + 380 - sb.x, tb.y + 90 - sb.y, 1]);
      assert.equal(await framesDuring(r.page, 400), 0);
      await r.page.mouse.move(850, 600);
      await r.page.waitForTimeout(80);
      assert.equal(await snapshot(r.page, 'loupes'), null);
      assert.equal(await r.page.evaluate(() => document.querySelector('#ab').behavior('loupes').states.size), 0, 'gone at once');
      const lb = await boxOf(r.page, '#lit-a');
      await r.page.mouse.move(lb.x + 90, lb.y + 40);
      await r.page.mouse.move(lb.x + 200, lb.y + 70);
      await r.page.waitForTimeout(80);
      const l = await snapshot(r.page, 'lits');
      assert.deepEqual([l.x, l.y, l.open], [lb.x + 200 - sb.x, lb.y + 70 - sb.y, 1]);
      assert.equal(await framesDuring(r.page, 400), 0);
      await r.page.mouse.move(850, 600);
      await r.page.waitForTimeout(80);
      assert.equal(await r.page.evaluate(() => document.querySelector('#ab').behavior('lits').states.size), 0);
      assert.deepEqual(r.errors, []);
    } finally {
      await r.context.close();
    }
  });

  // ------------------------------------------------------------------ no WebGPU
  await check(`${path}: without WebGPU the page is the plain page and still works`, async () => {
    const d = await open(browser, url, { noGpu: true });
    try {
      assert.equal(d.renderer, 'dom');
      const tb = await boxOf(d.page, '#loupe-area table');
      await d.page.mouse.move(tb.x + 100, tb.y + 30);
      await d.page.mouse.move(tb.x + 380, tb.y + 90, { steps: 4 });
      const lb = await boxOf(d.page, '#lit-a');
      await d.page.mouse.move(lb.x + 90, lb.y + 40, { steps: 4 });
      await d.page.waitForTimeout(300);
      await d.page.evaluate(() => (window.__log.length = 0));
      await d.page.click('#b4');
      await d.page.click('#lit-btn');
      assert.deepEqual(await d.page.evaluate(() => window.__log), ['click:b4', 'click:lit-btn']);
      assert.equal(await d.page.locator('#ab canvas').count(), 0);
      assert.deepEqual(d.errors, []);
    } finally {
      await d.context.close();
    }
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
