// End-to-end checks of <loom-stage> in Chrome with WebGPU, on Chrome's own
// HTML-in-Canvas and on the polyfill (--disable-features=CanvasDrawElement).
//   node test/stage.browser.mjs            both paths
//   node test/stage.browser.mjs --native   only the native path
//   CHROME_PATH=/path/to/chrome            another browser build
import assert from 'node:assert/strict';
import { launch, startServer } from './harness.mjs';
import { checkDemoLoader } from './demo-loader.browser.mjs';

const only = process.argv.includes('--native') ? ['native'] : ['native', 'polyfill'];
const results = [];
// The accessibility trees seen on each path (they must be the same).
const trees = {};

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

async function open(browser, url, { reduced = false, noGpu = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  if (noGpu) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
  });
  await page.goto(url);
  const renderer = await page.evaluate(() =>
    customElements.whenDefined('loom-stage').then(async () => {
      const all = await Promise.all([...document.querySelectorAll('loom-stage')].map((s) => s.ready));
      return all[0];
    }));
  await page.waitForTimeout(1100); // the boot sweep
  return { page, context, errors, renderer };
}

const framesDuring = (page, ms, selector = '#loadout canvas') => page.evaluate(async ({ ms, selector }) => {
  const canvas = document.querySelector(selector);
  if (!canvas) return 0;
  let n = 0;
  const count = () => n++;
  canvas.addEventListener('effectframe', count);
  await new Promise((r) => setTimeout(r, ms));
  canvas.removeEventListener('effectframe', count);
  return n;
}, { ms, selector });

const formActive = (page) => page.evaluate(() => !document.querySelector('#loadout-form').inert);

async function fillValid(page) {
  await page.fill('input[name=callsign]', 'Nightjar');
  await page.click('text=Medic');
  await page.locator('input[name=roe]').check();
}

async function holdDeploy(page, ms) {
  const box = await page.locator('button[type=submit]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** Green channel of a screenshot, indexed from its top left in CSS px (DPR 1). */
async function greens(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const g = new Array(c.width * c.height);
    for (let i = 0; i < g.length; i++) g[i] = d[i * 4 + 1];
    return { w: c.width, g };
  }, png.toString('base64'));
}

async function run(path, browser, url) {
  console.log(`\n${path}`);
  await check(`${path}: a growing stage paints the last of 96 slider thumbs and routes its input`, async () => {
    const context = await browser.newContext({ viewport: { width: 660, height: 430 }, reducedMotion: 'reduce' });
    try {
      const panelPage = await context.newPage();
      await panelPage.goto(`${url}test/fixtures/density.html`);
      const panel = panelPage.locator('#panel');
      assert.equal(await panel.evaluate(stage => stage.ready), 'webgpu');
      assert.equal(await panel.getAttribute('data-mode'), path);
      await panel.evaluate(stage => {
        const inputs = document.createDocumentFragment();
        for (let i = 1; i < 96; i++) {
          const range = document.createElement('input');
          range.type = 'range';
          range.setAttribute('aria-label', `Slider ${i + 1}`);
          inputs.append(range);
        }
        stage.source.append(inputs);
      });
      const last = panelPage.getByRole('slider', { name: 'Slider 96', exact: true });
      const box = await last.boundingBox();
      const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
      // The unadorned track crosses only a few rows. The Holo thumb fills the centre.
      let lit = 0;
      for (let attempt = 0; attempt < 12 && lit < 100; attempt++) {
        const { g } = await greens(panelPage, { x: x - 10, y: y - 10, width: 21, height: 21 });
        lit = g.filter(value => value > 155).length;
        if (lit < 100) await panelPage.waitForTimeout(100);
      }
      assert.ok(lit >= 100, `last slider thumb is missing (${lit} lit pixels)`);
      await panelPage.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
      const clicked = Number(await last.inputValue());
      assert.ok(clicked > 50 && clicked < 100);
      await panelPage.keyboard.press('ArrowRight');
      assert.equal(Number(await last.inputValue()), clicked + 1);
    } finally {
      await context.close();
    }
  });
  await check(`${path}: lazy stages start near the viewport or on focus, keeping the editable selection`, async () => {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(url);
      await page.evaluate(() => document.querySelector('#loadout').ready);
      assert.equal(await page.locator('#archive canvas').count(), 0);
      await page.locator('#archive').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('#archive').dataset.renderer === 'webgpu');
      const focus = await page.evaluate(async () => {
        const stage = document.createElement('loom-stage');
        stage.setAttribute('loading', 'lazy');
        stage.style.cssText = 'position:absolute;top:20000px;width:250px';
        const input = document.createElement('input');
        input.value = 'Nightjar';
        stage.append(input);
        document.body.append(stage);
        input.focus({ preventScroll: true });
        input.setSelectionRange(2, 5);
        const renderer = await stage.ready;
        return [renderer, document.activeElement === input, input.selectionStart, input.selectionEnd];
      });
      assert.deepEqual(focus, ['webgpu', true, 2, 5]);
      const nested = await page.evaluate(async () => {
        const stage = document.createElement('loom-stage');
        stage.setAttribute('loading', 'lazy');
        stage.style.cssText = 'position:absolute;top:20000px;width:250px';
        const widget = document.createElement('span');
        const shadow = widget.attachShadow({ mode: 'open' });
        const input = document.createElement('input');
        shadow.append(input);
        stage.append(widget);
        document.body.append(stage);
        input.focus({ preventScroll: true });
        await stage.ready;
        const enhanced = shadow.activeElement === input;
        stage.querySelector('canvas').dispatchEvent(new CustomEvent('effecterror'));
        return [enhanced, stage.dataset.renderer, shadow.activeElement === input];
      });
      assert.deepEqual(nested, [true, 'dom', true]);
      const moved = await page.evaluate(async () => {
        const stage = document.createElement('loom-stage');
        stage.setAttribute('loading', 'lazy');
        stage.style.cssText = 'position:absolute;top:20000px;width:250px';
        const input = document.createElement('input');
        const outside = document.createElement('button');
        stage.append(input);
        document.body.append(stage, outside);
        const observer = new MutationObserver(() => {
          if (stage.dataset.renderer === 'loading') {
            observer.disconnect();
            outside.focus({ preventScroll: true });
          }
        });
        observer.observe(stage, { attributes: true, attributeFilter: ['data-renderer'] });
        input.focus({ preventScroll: true });
        const renderer = await stage.ready;
        return [renderer, document.activeElement === outside];
      });
      assert.deepEqual(moved, ['webgpu', true]);
    } finally {
      await context.close();
    }
  });
  let session = await open(browser, url);
  const { page } = session;

  await check(`${path}: the compositor draws the stage`, async () => {
    assert.equal(session.renderer, 'webgpu');
    assert.equal(await page.evaluate(() => document.querySelector('loom-stage').dataset.mode), path);
  });

  await check(`${path}: the accessibility tree is the plain HTML's`, async () => {
    const tree = {};
    for (const id of ['loadout', 'ops']) tree[id] = await page.locator(`#${id}`).ariaSnapshot();
    trees[path] = tree;
    assert.match(tree.loadout, /textbox "Callsign"/);
    assert.match(tree.loadout, /radio "Scout" \[checked\]/);
    assert.match(tree.loadout, /slider "Drop altitude"/);
    assert.match(tree.loadout, /switch "Night vision" \[checked\]/);
    assert.match(tree.ops, /tab "Vitals" \[selected\]/);
    assert.match(tree.ops, /meter "Hull"/);
    if (trees.native && path !== 'native') assert.deepEqual(tree, trees.native, 'the same tree as on the native path');
  });

  await check(`${path}: no frame is rendered at rest`, async () => {
    assert.equal(await framesDuring(page, 1200), 0);
  });

  await check(`${path}: the range's fill follows its value, nothing stays from the start`, async () => {
    const box = await page.locator('#altitude').boundingBox();
    await page.focus('#altitude');
    await page.keyboard.press('Home');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(900);
    const g = await greens(page);
    // A quarter of the way along: inside the fill the page started with (1,200 of 300-3,000 m).
    const x = Math.round(box.x + box.width * 0.25);
    const y = Math.round(box.y + box.height / 2);
    const lit = Math.max(...[-1, 0, 1].map((d) => g.g[(y + d) * g.w + x]));
    assert.ok(lit < 120, `the track is lit where the value is not (green ${lit})`);
    await page.evaluate(() => {
      const range = document.querySelector('#altitude');
      range.value = 1200;
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(700);
  });

  await check(`${path}: the presented pixels follow the input mapper during a press`, async () => {
    const clear = await page.locator('button[type=reset]').boundingBox();
    const canvas = await page.locator('#loadout canvas').boundingBox();
    // Hover first, so the reference shows the same reticle as the pressed picture.
    await page.mouse.move(clear.x + 8, clear.y + clear.height / 2);
    await page.waitForTimeout(700);
    const rest = await greens(page);
    // Press near the left edge of Clear: the dent pulls the label toward the finger.
    await page.mouse.down();
    await page.waitForTimeout(700); // the dent settles at full depth
    const pressed = await greens(page);
    // Inside the button, away from the reticle's corners: lights are drawn in screen
    // space and are the same in both pictures, so they would only blur the comparison.
    const samples = [];
    for (let y = Math.ceil(clear.y + 3); y < clear.y + clear.height - 3; y += 1) {
      for (let x = Math.ceil(clear.x + 3); x < clear.x + clear.width - 3; x += 1) {
        const nearCornerX = x < clear.x + 16 || x > clear.x + clear.width - 16;
        const nearCornerY = y < clear.y + 16 || y > clear.y + clear.height - 16;
        if (!(nearCornerX && nearCornerY)) samples.push({ x, y });
      }
    }
    const mapped = await page.evaluate(({ samples, cx, cy }) => {
      const stage = document.querySelector('loom-stage');
      // Fragments are shaded at pixel centres.
      return samples.map(({ x, y }) => stage.mapPoint({ x: x + 0.5 - cx, y: y + 0.5 - cy }));
    }, { samples, cx: canvas.x, cy: canvas.y });
    await page.mouse.up();
    let movedPoints = 0;
    let mapperMatches = 0;
    let identityMatches = 0;
    samples.forEach(({ x, y }, i) => {
      const m = mapped[i];
      if (!m) return;
      // Pixel centres: the shader samples the source bilinearly at the mapped point.
      const sx = m.x + canvas.x - 0.5;
      const sy = m.y + canvas.y - 0.5;
      if (Math.hypot(sx - x, sy - y) < 1.5) return; // only where the picture moved
      const seen = pressed.g[y * pressed.w + x];
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const at = (xx, yy) => rest.g[yy * rest.w + xx];
      const viaMapper = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
        (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      const viaIdentity = rest.g[y * rest.w + x];
      if (Math.abs(viaMapper - viaIdentity) < 50) return; // only where it tells them apart
      movedPoints++;
      if (Math.abs(seen - viaMapper) <= 45) mapperMatches++;
      if (Math.abs(seen - viaIdentity) <= 45) identityMatches++;
    });
    assert.ok(movedPoints >= 20, `too few discriminating samples (${movedPoints})`);
    const share = mapperMatches / movedPoints;
    assert.ok(share >= 0.8, `mapper explains ${(share * 100).toFixed(0)} % of moved pixels (identity ${identityMatches}/${movedPoints})`);
    assert.ok(mapperMatches > identityMatches * 2, `identity explains ${identityMatches}, mapper ${mapperMatches}`);
    console.log(`       mapper ${mapperMatches}/${movedPoints} moved pixels, identity ${identityMatches}/${movedPoints}`);
    await page.waitForTimeout(900);
  });

  await check(`${path}: a tap on Deploy does not submit`, async () => {
    await fillValid(page);
    await holdDeploy(page, 120);
    await page.waitForTimeout(500);
    assert.equal(await formActive(page), true);
  });

  await check(`${path}: Enter in a field does not bypass the hold`, async () => {
    await page.focus('input[name=callsign]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    assert.equal(await formActive(page), true);
  });

  await check(`${path}: an activation nobody pressed arms the hold button, a second one confirms`, async () => {
    await fillValid(page);
    // What a screen reader does: a click with no pointer press (detail 0).
    await page.evaluate(() => document.querySelector('button[type=submit]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    await page.waitForTimeout(150);
    assert.equal(await formActive(page), true, 'the first activation only arms');
    assert.match(await page.locator('#loadout .loom-live').textContent(), /Deploy: activate again to confirm/);
    await page.waitForTimeout(5000);
    await page.evaluate(() => document.querySelector('button[type=submit]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    await page.waitForTimeout(150);
    assert.equal(await formActive(page), true, 'an arming expires');
    assert.equal(await page.locator('button[type=submit]').getAttribute('aria-description'), 'Press and hold, or activate twice, to confirm');
  });

  await check(`${path}: a completed hold runs the form's validation`, async () => {
    await page.fill('input[name=callsign]', '');
    await holdDeploy(page, 1150);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.activeElement?.name), 'callsign');
    assert.equal(await formActive(page), true);
  });

  await check(`${path}: a completed hold submits a valid form and plays the transition`, async () => {
    await fillValid(page);
    await page.waitForTimeout(400);
    await holdDeploy(page, 1150);
    await page.waitForFunction(() => !document.querySelector('[data-view=receipt]').inert, null, { timeout: 4000 });
    const out = await page.evaluate(() => ({
      callsign: document.querySelector('[data-out=callsign]').textContent,
      role: document.querySelector('[data-out=role]').textContent,
    }));
    assert.deepEqual(out, { callsign: 'Nightjar', role: 'Medic' });
    await page.waitForTimeout(1500);
  });

  await check(`${path}: a click on a flying element reaches it, the old page takes none`, async () => {
    const canvas = await page.locator('#loadout canvas').boundingBox();
    const from = await page.locator('#edit').boundingBox();
    const to = await page.locator('button[type=submit]').evaluate((b) => {
      // Where the Deploy button will land: measured on the hidden form.
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await page.evaluate(() => {
      window.__flight = document.querySelector('loom-stage').transition(() => {
        document.querySelector('[data-view=receipt]').inert = true;
        document.querySelector('#loadout-form').inert = false;
      });
      window.__clicks = [];
      window.addEventListener('click', (e) => {
        window.__clicks.push(e.target.closest?.('button')?.textContent.trim() ?? e.target.localName);
      }, { capture: true });
    });
    // Sample the path between the two places while the element flies; click a point
    // that the mapper sends into the Deploy button although it is outside its box.
    let clicked = null;
    let sawNoTarget = false;
    for (let attempt = 0; attempt < 40 && !clicked; attempt++) {
      const probe = await page.evaluate(({ from, to, cx, cy }) => {
        const stage = document.querySelector('loom-stage');
        let found = null;
        let none = false;
        for (let t = 0.2; t <= 0.8; t += 0.05) {
          const x = from.x + from.width / 2 + (to.x + to.width / 2 - from.x - from.width / 2) * t;
          const y = from.y + from.height / 2 + (to.y + to.height / 2 - from.y - from.height / 2) * t;
          const m = stage.mapPoint({ x: x - cx, y: y - cy });
          if (m === null) none = true;
          if (!m) continue;
          const sx = m.x + cx;
          const sy = m.y + cy;
          const insideTarget = sx > to.x + 4 && sx < to.x + to.width - 4 && sy > to.y + 4 && sy < to.y + to.height - 4;
          const outsideBox = x < to.x - 12 || x > to.x + to.width + 12 || y < to.y - 12 || y > to.y + to.height + 12;
          if (insideTarget && outsideBox) found = { x, y };
        }
        return { found, none };
      }, { from, to, cx: canvas.x, cy: canvas.y });
      sawNoTarget ||= probe.none;
      if (probe.found) {
        await page.mouse.move(probe.found.x, probe.found.y);
        await page.mouse.down();
        await page.mouse.up();
        clicked = probe.found;
      } else await page.waitForTimeout(16);
    }
    assert.ok(clicked, 'no point of the flight was mapped into the button');
    await page.waitForTimeout(200);
    const clicks = await page.evaluate(() => window.__clicks);
    // One click, on the element drawn there (polyfill 1.0.3 swallows the browser's own).
    assert.deepEqual(clicks, ['Deploy'], `the click reached ${JSON.stringify(clicks)}`);
    assert.equal(await formActive(page), true, 'a plain click on a hold button does not submit');
    assert.ok(sawNoTarget, 'some sampled point of the old page mapped to no target');
    await page.evaluate(() => window.__flight);
  });

  await check(`${path}: two activations nobody pressed submit through the hold button`, async () => {
    await page.evaluate(() => {
      document.querySelector('[data-view=receipt]').inert = true;
      document.querySelector('#loadout-form').inert = false;
    });
    await fillValid(page);
    const click = () => page.evaluate(() => document.querySelector('button[type=submit]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    await click();
    await page.waitForTimeout(300);
    assert.equal(await formActive(page), true);
    await click();
    await page.waitForFunction(() => !document.querySelector('[data-view=receipt]').inert, null, { timeout: 4000 });
    await page.waitForTimeout(1500);
  });

  await opsChecks(path, page);
  await rosterChecks(path, page);
  await inputChecks(path, page);
  await feedbackChecks(path, page);
  await surfaceChecks(path, page);
  await overlayChecks(path, page);
  await menuChecks(path, page);

  await check(`${path}: no errors`, async () => {
    assert.deepEqual(session.errors, []);
  });
  await session.context.close();

  if (path !== 'native') return;

  session = await open(browser, `${url}test/fixtures/react.html`);
  await check('react: sorting and removing through React state, with motion and no DOM fights', async () => {
    const p = session.page;
    assert.equal(session.renderer, 'webgpu');
    const names = () => p.evaluate(() => [...document.querySelectorAll('#stage tbody td:first-child')].map((td) => td.textContent));
    await p.click('#stage th:nth-child(2) button.loom-sort');
    await p.waitForTimeout(1200);
    assert.deepEqual(await names(), ['Moth', 'Kestrel', 'Grackle', 'Nightjar'], 'sorted by level, rendered by React');
    assert.deepEqual(await p.evaluate(() => window.__app.rows.map((r) => r[0])), ['Moth', 'Kestrel', 'Grackle', 'Nightjar']);
    assert.equal(await p.locator('#stage th:nth-child(2)').getAttribute('aria-sort'), 'ascending');
    await p.click('#tags li:nth-child(2) button.loom-remove');
    await p.waitForTimeout(1200);
    assert.deepEqual(await p.evaluate(() => window.__app.tags), ['Night op', 'Drones']);
    await p.evaluate(() => window.__app.addTag('Rain'));
    await p.waitForTimeout(800);
    const dom = await p.evaluate(() => [...document.querySelectorAll('#tags li')].map((li) => li.firstChild.textContent));
    assert.deepEqual(dom, ['Night op', 'Drones', 'Rain'], 'React and the DOM agree after a re-render');
    assert.equal(await p.locator('#stage thead button.loom-sort').count(), 2, 'the sort buttons survive React renders');
    assert.deepEqual(await p.evaluate(() => window.__errors), []);
    assert.deepEqual(session.errors, []);
  });
  await session.context.close();

  session = await open(browser, `${url}test/fixtures/vue.html`);
  await check('vue: a transition and a removal through Vue state', async () => {
    const p = session.page;
    assert.equal(session.renderer, 'webgpu');
    await p.click('#tags li:first-child button.loom-remove');
    await p.waitForTimeout(1200);
    assert.deepEqual(await p.evaluate(() => window.__app.tags.value), ['Low profile', 'Drones']);
    await p.evaluate(() => window.__app.flip());
    assert.equal(await p.locator('#done').count(), 1);
    await p.waitForTimeout(400);
    assert.deepEqual(await p.evaluate(() => window.__errors), []);
    assert.deepEqual(session.errors, []);
  });
  await session.context.close();

  session = await open(browser, `${url}test/fixtures/lazy.html`);
  await check('lazy: a component imported after the stage started joins it, shader included', async () => {
    const p = session.page;
    assert.equal(session.renderer, 'webgpu');
    assert.equal(await p.evaluate(() => document.querySelector('#lazy').behavior('tabs')), null);
    await p.evaluate(() => window.loadTabs());
    await p.waitForTimeout(400);
    const state = await p.evaluate(() => ({
      has: Boolean(document.querySelector('#lazy').behavior('tabs')),
      second: document.querySelector('#p2').hidden,
    }));
    assert.deepEqual(state, { has: true, second: true }, 'the tabs behaviour runs on the stage that was already there');
    await p.focus('#t1');
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(800);
    assert.equal(await p.evaluate(() => document.querySelector('#p1').hidden), true);
    assert.deepEqual(session.errors, []);
  });
  await session.context.close();

  session = await open(browser, url, { noGpu: true });
  await check('dom: the accessibility tree is the same as on the GPU paths', async () => {
    const p = session.page;
    const tree = {};
    for (const id of ['loadout', 'ops']) tree[id] = await p.locator(`#${id}`).ariaSnapshot();
    assert.deepEqual(tree, trees.native);
  });
  await check('dom: tabs and details work without WebGPU', async () => {
    const p = session.page;
    await p.focus('#tab-vitals');
    await p.keyboard.press('ArrowRight');
    const state = await p.evaluate(() => ({
      focused: document.activeElement.id,
      selected: document.querySelector('#tab-objectives').getAttribute('aria-selected'),
      vitals: document.querySelector('#panel-vitals').hidden,
      objectives: document.querySelector('#panel-objectives').hidden,
    }));
    assert.deepEqual(state, { focused: 'tab-objectives', selected: 'true', vitals: true, objectives: false });
    await p.click('text=Extract the courier');
    assert.equal(await p.evaluate(() => document.querySelectorAll('#panel-objectives details')[1].open), true);
  });
  await check('dom: the combobox, chips and numbers work without WebGPU', async () => {
    const p = session.page;
    await p.click('input[name=exfil]');
    await p.keyboard.type('pi');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(() => document.querySelector('input[name=exfil]').value), 'North pier');
    await p.click('#tags li:first-child button.loom-remove');
    assert.equal(await p.locator('#tags li').count(), 3, 'removal is immediate without the compositor');
    await p.click('button[aria-controls=crates][data-step="-1"]');
    assert.equal(await p.evaluate(() => document.querySelector('#crates').value), '5');
  });
  await check('dom: a dialog opens and closes at once without WebGPU', async () => {
    const p = session.page;
    await p.evaluate(() => document.querySelector('#abort-dialog').showModal());
    await p.waitForTimeout(200);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(50);
    assert.equal(await p.evaluate(() => document.querySelector('#abort-dialog').open), false);
  });
  await check('dom: without WebGPU the same form works in plain DOM', async () => {
    const p = session.page;
    assert.equal(session.renderer, 'dom');
    assert.equal(await p.locator('loom-stage canvas').count(), 0);
    await fillValid(p);
    await holdDeploy(p, 150);
    await p.waitForTimeout(300);
    assert.equal(await formActive(p), true, 'a tap does not submit');
    await holdDeploy(p, 1150);
    await p.waitForFunction(() => !document.querySelector('[data-view=receipt]').inert, null, { timeout: 3000 });
    assert.deepEqual(session.errors, []);
  });
  await session.context.close();

  session = await open(browser, url, { reduced: true });
  await check('reduced motion: the transition is an immediate swap', async () => {
    const p = session.page;
    await fillValid(p);
    await holdDeploy(p, 1150);
    await p.waitForFunction(() => !document.querySelector('[data-view=receipt]').inert, null, { timeout: 3000 });
    const ms = await p.evaluate(async () => {
      const t = performance.now();
      await document.querySelector('loom-stage').transition(() => {
        document.querySelector('[data-view=receipt]').inert = true;
        document.querySelector('#loadout-form').inert = false;
      });
      return performance.now() - t;
    });
    assert.ok(ms < 50, `the swap took ${ms.toFixed(0)} ms`);
    assert.equal(await formActive(p), true);
    assert.deepEqual(session.errors, []);
  });
  await session.context.close();
}

/** The second stage: gauges, tabs, disclosures. */
async function opsChecks(path, page) {
  const at = (sel) => page.locator(sel).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.locator('#ops').scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(600);

  await check(`${path}: the second stage renders no frame at rest`, async () => {
    assert.equal(await page.evaluate(() => document.querySelector('#ops').dataset.renderer), 'webgpu');
    assert.equal(await framesDuring(page, 1000, '#ops canvas'), 0);
  });

  await check(`${path}: a drop in a meter leaves a white trail that drains`, async () => {
    const bar = await at('#hull');
    const before = await page.evaluate(() => document.querySelector('#hull').value);
    await page.evaluate(() => (document.querySelector('#hull').value -= 30));
    await page.waitForTimeout(160);
    // The middle of the part that was lost: white while the trail holds, then empty.
    const f0 = before / 100;
    const f1 = (before - 30) / 100;
    const x = Math.round(bar.x + 2 + (bar.width - 4) * (f0 + f1) / 2);
    const y = Math.round(bar.y + bar.height / 2);
    const lit = await greens(page);
    await page.waitForTimeout(1500);
    const drained = await greens(page);
    const g0 = Math.max(lit.g[y * lit.w + x], lit.g[y * lit.w + x + 2]);
    const g1 = Math.max(drained.g[y * drained.w + x], drained.g[y * drained.w + x + 2]);
    assert.ok(g0 > 200, `the trail should be white (green ${g0})`);
    assert.ok(g1 < 80, `the trail should have drained (green ${g1})`);
    assert.equal(await framesDuring(page, 600, '#ops canvas'), 0, 'the stage rests again');
  });

  await check(`${path}: arrow keys switch tabs with a cut that stays inside the panels`, async () => {
    const panel = await at('#panel-vitals');
    const canvas = await at('#ops canvas');
    await page.focus('#tab-vitals');
    await page.keyboard.press('ArrowRight');
    // While it cuts: the head of the stage is live, the right of the panel is still the old one.
    let sawOld = false;
    let headLive = true;
    for (let i = 0; i < 40 && !sawOld; i++) {
      const probe = await page.evaluate(({ panel, canvas }) => {
        const stage = document.querySelector('#ops');
        const head = stage.mapPoint({ x: 40, y: 20 });
        const right = stage.mapPoint({ x: panel.x - canvas.x + panel.width - 8, y: panel.y - canvas.y + 20 });
        return { head, right };
      }, { panel, canvas });
      headLive &&= Boolean(probe.head) && Math.abs(probe.head.x - 40) < 0.01 && Math.abs(probe.head.y - 20) < 0.01;
      sawOld ||= probe.right === null;
      if (!sawOld) await page.waitForTimeout(10);
    }
    assert.ok(sawOld, 'the old panel showed during the cut');
    assert.ok(headLive, 'outside the panels the stage stays live');
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({
      focused: document.activeElement.id,
      vitals: document.querySelector('#panel-vitals').hidden,
      objectives: document.querySelector('#panel-objectives').hidden,
    }));
    assert.deepEqual(state, { focused: 'tab-objectives', vitals: true, objectives: false });
  });

  await check(`${path}: a click on a summary while it slides reaches the summary shown there`, async () => {
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    const canvas = await at('#ops canvas');
    const third = await at('#panel-objectives details:nth-of-type(3) > summary');
    const clicks = [];
    await page.exposeFunction(`__summary_${path}`, (t) => clicks.push(t));
    await page.evaluate((name) => {
      document.querySelector('#ops').addEventListener('click', (e) => {
        window[name](e.target.closest('summary')?.textContent.trim().split(/\s+/).slice(0, 2).join(' ') ?? e.target.localName);
      }, { capture: true });
    }, `__summary_${path}`);
    await page.click('text=Extract the courier');
    // Find the moment the content below has started to slide: the old place of the
    // third summary shows the third summary, which now lies lower in the page.
    const cx = third.x + 60;
    const cy = third.y + third.height / 2;
    let hit = null;
    // The slide starts after the old picture is kept and the new one arrives (a few frames).
    for (let i = 0; i < 160 && !hit; i++) {
      hit = await page.evaluate(({ cx, cy, canvas }) => {
        const m = document.querySelector('#ops').mapPoint({ x: cx - canvas.x, y: cy - canvas.y });
        if (!m || Math.abs(m.y - (cy - canvas.y)) < 12) return null;
        const el = document.elementFromPoint(m.x + canvas.x, m.y + canvas.y);
        return el?.closest('summary') ? { under: document.elementFromPoint(cx, cy)?.localName } : null;
      }, { cx, cy, canvas });
      if (!hit) await page.waitForTimeout(8);
    }
    assert.ok(hit, 'the slide was not seen');
    assert.notEqual(hit.under, 'summary', 'without the mapper the point would hit something else');
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(900);
    const open = await page.evaluate(() => [...document.querySelectorAll('#panel-objectives details')].map((d) => d.open));
    assert.deepEqual(open, [true, true, true], `details open: ${open}`);
    assert.deepEqual(clicks, ['Extract the', 'Wipe the'], `clicks: ${JSON.stringify(clicks)}`);
  });

  await check(`${path}: closing a details shuts it and the stage rests`, async () => {
    await page.click('text=Secure the relay');
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => document.querySelector('#panel-objectives details').open), false);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(900); // the reticle fades out
    assert.equal(await framesDuring(page, 600, '#ops canvas'), 0);
  });
}

/** The third stage: a sortable table, pagination, a stepper. */
async function rosterChecks(path, page) {
  const firstCells = () => page.evaluate(() =>
    [...document.querySelectorAll('#roster-table tbody tr')].filter((r) => !r.hidden).map((r) => r.cells[0].textContent));
  await page.locator('#roster').scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(700);

  await check(`${path}: the roster renders no frame at rest`, async () => {
    assert.equal(await framesDuring(page, 800, '#roster canvas'), 0);
  });

  await check(`${path}: a sortable header is a button that sorts by number`, async () => {
    await page.focus('#roster-table th:nth-child(3) button');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1300);
    const state = await page.evaluate(() => ({
      sort: document.querySelector('#roster-table th:nth-child(3)').getAttribute('aria-sort'),
      levels: [...document.querySelectorAll('#roster-table tbody tr')].map((r) => Number(r.cells[2].textContent)),
    }));
    assert.equal(state.sort, 'ascending');
    assert.deepEqual(state.levels, [...state.levels].sort((a, b) => a - b));
  });

  await check(`${path}: a press on a row in flight reaches the row shown, and only it`, async () => {
    // At the trusted pointerdown, the mapper (frozen on the presented frame) must send
    // the point to the row that is shown there, not to the row the layout has there.
    // Rows are compared in source coordinates (immune to any hit-test geometry shift).
    await page.evaluate(() => {
      const canvas = document.querySelector('#roster canvas');
      const stage = document.querySelector('#roster');
      const rowAt = (x, y) => {
        const src = stage.source.getBoundingClientRect();
        const row = [...document.querySelectorAll('#roster-table tbody tr')].find((r) => {
          if (r.hidden) return false;
          const b = r.getBoundingClientRect();
          const l = b.left - src.left;
          const t = b.top - src.top;
          return x >= l && x < l + b.width && y >= t && y < t + b.height;
        });
        return row ? row.cells[0].textContent : null;
      };
      window.__rowClicks = [];
      window.__aim = null;
      document.addEventListener('pointerdown', (e) => {
        if (!e.isTrusted || window.__aim) return;
        const box = canvas.getBoundingClientRect();
        const m = stage.mapPoint({ x: e.clientX - box.x, y: e.clientY - box.y });
        window.__aim = { shown: m ? rowAt(m.x, m.y) : null, layout: rowAt(e.clientX - box.x, e.clientY - box.y) };
      }, { capture: true });
      document.querySelector('#roster-table').addEventListener('click', (e) => {
        const row = e.target.closest('tbody tr');
        if (row) window.__rowClicks.push(row.cells[0].textContent);
      }, { capture: true });
    });
    const seen = [];
    // Sorting by hit rate and back by level keeps most rows of the page and moves them.
    for (let attempt = 0; attempt < 10 && seen.length < 3; attempt++) {
      // The whole stage in view: a press outside the viewport goes to <html>, not to the page.
      await page.evaluate(() => document.querySelector('#roster').scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(250);
      const before = await page.evaluate(() => [...document.querySelectorAll('#roster-table tbody tr')]
        .filter((r) => !r.hidden)
        .map((r) => {
          const b = r.getBoundingClientRect();
          return { x: b.x + 40, y: b.y + b.height / 2 };
        }));
      const headY = () => page.evaluate(() => document.querySelector('#roster-table thead').getBoundingClientRect().y);
      const y0 = await headY();
      await page.click(`#roster-table th:nth-child(${attempt % 2 ? 3 : 4}) button`);
      // The header click was a trusted pointerdown too: aim at the next one.
      await page.evaluate(() => {
        window.__aim = null;
        window.__rowClicks = [];
      });
      await page.waitForTimeout(80);
      // Old row centres are where rows are still shown early in their flight (the
      // header click may have scrolled the page: the header has not moved in the table).
      const dy = (await headY()) - y0;
      const spot = before[(attempt * 2 + 1) % before.length];
      const viewport = page.viewportSize();
      if (spot.y + dy < 4 || spot.y + dy > viewport.height - 4) continue;
      await page.mouse.click(spot.x, spot.y + dy);
      await page.waitForTimeout(1200);
      const aim = await page.evaluate(() => window.__aim);
      if (aim?.shown && aim.shown !== aim.layout) seen.push({ ...aim, clicks: await page.evaluate(() => window.__rowClicks) });
    }
    assert.ok(seen.length >= 1, 'no press landed on a row in flight');
    // Every press on a row in flight reaches the row shown, and only it.
    for (const s of seen) assert.deepEqual(s.clicks, [s.shown], `shown ${s.shown}, clicks ${JSON.stringify(s.clicks)}`);
    assert.ok(seen.length >= 1, 'no press landed on a row in flight');
    console.log(`       ${seen.length}/${seen.length} presses on rows in flight reached the row shown`);
  });

  await check(`${path}: pages and steps move their aria-current marker`, async () => {
    const was = await firstCells();
    await page.click('.pages button[data-page="2"]');
    await page.waitForTimeout(900);
    const now = await firstCells();
    assert.equal(await page.locator('.pages button[data-page="2"]').getAttribute('aria-current'), 'page');
    assert.equal(now.length, 6);
    assert.ok(now.every((name) => !was.includes(name)), 'page 2 shows other rows');
    await page.locator('#ops').scrollIntoViewIfNeeded();
    await page.click('#tab-objectives');
    await page.waitForTimeout(700);
    await page.click('#advance');
    assert.equal(await page.evaluate(() => document.querySelector('.steps [aria-current=step]').textContent), 'Extract');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1200);
    assert.equal(await framesDuring(page, 600, '#ops canvas'), 0);
  });
}

/** The fourth stage: numbers, an interval, a combobox, chips, a dropzone, a rating. */
async function inputChecks(path, page) {
  await page.locator('#req').scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(700);
  const value = (sel) => page.evaluate((sel) => document.querySelector(sel).value, sel);

  await check(`${path}: the supply stage renders no frame at rest`, async () => {
    assert.equal(await framesDuring(page, 800, '#req canvas'), 0);
  });

  await check(`${path}: a number steps with its buttons and arrow keys, and stops at max`, async () => {
    await page.click('button[aria-controls=crates][data-step="1"]');
    await page.waitForTimeout(250);
    assert.equal(await value('#crates'), '7');
    await page.focus('#crates');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(250);
    assert.equal(await value('#crates'), '8');
    await page.evaluate(() => (document.querySelector('#crates').value = 24));
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(250);
    assert.equal(await value('#crates'), '24');
  });

  await check(`${path}: the ends of an interval cannot cross`, async () => {
    await page.focus('[interval] input[name=from]');
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    assert.deepEqual([await value('[name=from]'), await value('[name=to]')], ['18', '18']);
    await page.keyboard.press('Home');
  });

  await check(`${path}: a datalist field opens its own listbox in the stage`, async () => {
    const field = page.locator('input[name=exfil]');
    assert.equal(await field.getAttribute('list'), null, 'the browser popup is off');
    await field.click();
    await page.keyboard.type('r');
    await page.waitForTimeout(400);
    const options = await page.evaluate(() => [...document.querySelectorAll('.loom-listbox [role=option]')].map((o) => o.textContent));
    assert.ok(options.length >= 3 && options.every((o) => /r/i.test(o)), JSON.stringify(options));
    assert.equal(await field.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await field.getAttribute('aria-activedescendant'), await page.evaluate(() => document.querySelectorAll('.loom-listbox [role=option]')[1].id));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    assert.equal(await value('input[name=exfil]'), options[1]);
    assert.equal(await field.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.querySelector('.loom-listbox').hidden), true);
  });

  await check(`${path}: a removed chip goes, the focus stays in the list, a new chip arrives`, async () => {
    await page.focus('#tags li:nth-child(2) button.loom-remove');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(1100);
    const state = await page.evaluate(() => ({
      tags: [...document.querySelectorAll('#tags li')].map((l) => l.firstChild.textContent.trim()),
      focus: document.activeElement.getAttribute('aria-label'),
    }));
    assert.deepEqual(state.tags, ['Night op', 'Drones', 'Rain']);
    assert.equal(state.focus, 'Remove Drones');
    await page.fill('#tag-input', 'Extraction');
    await page.press('#tag-input', 'Enter');
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#tags li').count(), 4);
    assert.equal(await page.locator('#tags li:last-child button.loom-remove').getAttribute('aria-label'), 'Remove Extraction');
  });

  await check(`${path}: files dropped on a dropzone go to its input`, async () => {
    const zone = await page.locator('[dropzone]').boundingBox();
    await page.evaluate(({ x, y }) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['a'], 'relay-schematics.pdf'));
      dt.items.add(new File(['b'], 'patrols.csv'));
      const input = document.querySelector('[dropzone] input');
      for (const type of ['dragover', 'drop']) {
        input.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      }
    }, { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.querySelector('[dropzone] input').files.length), 2);
    assert.match(await value('#files-out'), /relay-schematics\.pdf, patrols\.csv/);
  });

  await check(`${path}: a rating is a radio group, and the stage rests after it`, async () => {
    await page.click('[rating] label:nth-of-type(4)');
    assert.equal(await page.evaluate(() => document.querySelector('[rating] :checked').value), '4');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1400);
    assert.equal(await framesDuring(page, 600, '#req canvas'), 0);
  });
}

/** The fifth stage: toasts, an alert, a badge, a busy region, ring gauges. */
async function feedbackChecks(path, page) {
  await page.locator('#comms').scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(700);
  const frames = (ms) => framesDuring(page, ms, '#comms canvas');
  const addToast = (text, timeout) => page.evaluate(({ text, timeout }) => {
    const li = document.createElement('li');
    li.textContent = text;
    li.dataset.timeout = timeout;
    document.querySelector('#comms [toasts]').append(li);
  }, { text, timeout });
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('#comms [toasts] > li')].map((li) => li.firstChild.textContent));

  await check(`${path}: the comms stage renders no frame at rest`, async () => {
    assert.equal(await frames(800), 0);
  });

  await check(`${path}: a toast counts down and goes; pointing at one holds it`, async () => {
    await addToast('Short', '600ms');
    await page.waitForTimeout(1400);
    assert.deepEqual(await toasts(), [], 'the toast is gone');
    await addToast('Held', '600ms');
    await page.waitForTimeout(150);
    const box = await page.locator('#comms [toasts] > li').boundingBox();
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.waitForTimeout(1200);
    assert.deepEqual(await toasts(), ['Held'], 'a toast under the pointer stays');
    assert.equal(await page.locator('#comms [toasts] button.loom-remove').getAttribute('aria-label'), 'Dismiss');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1500);
    assert.deepEqual(await toasts(), []);
    assert.equal(await page.locator('#comms [toasts]').getAttribute('aria-live'), 'polite');
  });

  await check(`${path}: an alert and a badge are noticed when they change, then the stage rests`, async () => {
    await page.waitForTimeout(400);
    assert.equal(await frames(300), 0);
    await page.evaluate(() => {
      const alert = document.querySelector('#alarm');
      alert.textContent = 'Test alarm';
      alert.hidden = false;
    });
    assert.ok(await frames(300) > 5, 'the alert lands');
    await page.waitForTimeout(900);
    assert.equal(await frames(300), 0);
    await page.evaluate(() => (document.querySelector('#unread').textContent = '9'));
    assert.ok(await frames(300) > 5, 'the badge pings');
    await page.waitForTimeout(700);
    assert.equal(await frames(300), 0);
  });

  await check(`${path}: a busy region shimmers until it is not busy, then rests`, async () => {
    const intercept = page.locator('#intercept');
    await intercept.evaluate((el) => el.setAttribute('aria-busy', 'true'));
    await page.waitForTimeout(200);
    assert.ok(await frames(400) > 10, 'it shimmers');
    await intercept.evaluate((el) => el.setAttribute('aria-busy', 'false'));
    await page.waitForTimeout(1200);
    assert.equal(await frames(500), 0);
  });
}

/** The sixth stage: a tilting card, a carousel, a splitter. */
async function surfaceChecks(path, page) {
  await page.locator('#archive').scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(800);
  const frames = (ms) => framesDuring(page, ms, '#archive canvas');

  await check(`${path}: the archive renders no frame at rest`, async () => {
    assert.equal(await frames(800), 0);
  });

  await check(`${path}: a tilted card's pixels follow the input mapper, and its button takes the click`, async () => {
    // The foil and the glare are light added on top; for the comparison the card turns without them.
    await page.evaluate(async () => {
      const m = await import('/src/index.js');
      window.__holo = m.holo;
      m.defineSkin({
        ...m.holo,
        draw: { ...m.holo.draw, tilt: (scene, s) => scene.push(m.TILT, s.rect, [s.rotX, s.rotY, 900, s.lift], [0, 0, 0, 0], 16) },
      });
    });
    await page.waitForTimeout(300);
    const card = await page.locator('#ops-strip article').first().boundingBox();
    const canvas = await page.locator('#archive canvas').boundingBox();
    const rest = await greens(page);
    await page.mouse.move(card.x + card.width * 0.88, card.y + card.height * 0.12);
    await page.waitForTimeout(1200); // the turn settles
    const turned = await greens(page);
    const samples = [];
    for (let y = Math.ceil(card.y + 4); y < card.y + card.height - 4; y += 1) {
      for (let x = Math.ceil(card.x + 4); x < card.x + card.width - 4; x += 2) samples.push({ x, y });
    }
    const mapped = await page.evaluate(({ samples, cx, cy }) => {
      const stage = document.querySelector('#archive');
      return samples.map(({ x, y }) => stage.mapPoint({ x: x + 0.5 - cx, y: y + 0.5 - cy }));
    }, { samples, cx: canvas.x, cy: canvas.y });
    let moved = 0;
    let viaMapper = 0;
    let viaIdentity = 0;
    samples.forEach(({ x, y }, i) => {
      const m = mapped[i];
      if (!m) return;
      const sx = m.x + canvas.x - 0.5;
      const sy = m.y + canvas.y - 0.5;
      if (Math.hypot(sx - x, sy - y) < 1.5) return;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const at = (xx, yy) => rest.g[yy * rest.w + xx];
      const predicted = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      const flat = rest.g[y * rest.w + x];
      if (Math.abs(predicted - flat) < 50) return;
      moved++;
      const seen = turned.g[y * turned.w + x];
      if (Math.abs(seen - predicted) <= 45) viaMapper++;
      if (Math.abs(seen - flat) <= 45) viaIdentity++;
    });
    assert.ok(moved >= 20, `too few discriminating samples (${moved})`);
    assert.ok(viaMapper / moved >= 0.8, `mapper explains ${viaMapper}/${moved}, identity ${viaIdentity}/${moved}`);
    console.log(`       tilt: mapper ${viaMapper}/${moved} moved pixels, identity ${viaIdentity}/${moved}`);
    const button = await page.locator('#ops-strip article:first-child .replay').boundingBox();
    // Click where the button is drawn now: through the mapper, find a point that lands on it.
    const target = await page.evaluate(({ b, cx, cy }) => {
      const stage = document.querySelector('#archive');
      for (let y = b.y - 10; y < b.y + b.height + 10; y += 2) {
        for (let x = b.x - 10; x < b.x + b.width + 10; x += 2) {
          const m = stage.mapPoint({ x: x - cx, y: y - cy });
          if (m && m.x + cx > b.x + 6 && m.x + cx < b.x + b.width - 6 && m.y + cy > b.y + 6 && m.y + cy < b.y + b.height - 6) return { x, y };
        }
      }
      return null;
    }, { b: button, cx: canvas.x, cy: canvas.y });
    assert.ok(target, 'the button is drawn somewhere');
    await page.mouse.click(target.x, target.y);
    assert.equal(await page.evaluate(() => document.querySelector('#replay-out').value), 'Replaying Op Nightfall…');
    await page.evaluate(async () => (await import('/src/index.js')).defineSkin(window.__holo));
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1000);
    assert.equal(await frames(500), 0, 'the card settles flat and the stage rests');
  });

  await check(`${path}: dragging the carousel with the mouse scrolls it and selects no text`, async () => {
    const strip = await page.locator('#ops-strip').boundingBox();
    const y = strip.y + 40;
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#ops-strip')).cursor), 'grab');
    const before = await page.evaluate(() => document.querySelector('#ops-strip').scrollLeft);
    await page.mouse.move(strip.x + strip.width * 0.7, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(strip.x + strip.width * (0.7 - i * 0.06), y);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#ops-strip')).cursor), 'grabbing');
    await page.mouse.up();
    await page.waitForTimeout(900);
    const state = await page.evaluate(() => ({
      scroll: document.querySelector('#ops-strip').scrollLeft,
      selected: getSelection().toString(),
      dragging: document.querySelector('#ops-strip').hasAttribute('data-dragging'),
    }));
    assert.ok(state.scroll > before + 50, `it scrolled (${before} -> ${state.scroll})`);
    assert.equal(state.selected, '', 'no text was selected');
    assert.equal(state.dragging, false);
    await page.evaluate(() => document.querySelector('#ops-strip').scrollTo({ left: 0 }));
    await page.waitForTimeout(300);
  });

  await check(`${path}: the carousel's arrow moves it a slide`, async () => {
    const before = await page.evaluate(() => document.querySelector('#ops-strip').scrollLeft);
    await page.click('button[aria-controls=ops-strip][data-step="1"]');
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => document.querySelector('#ops-strip').scrollLeft);
    assert.ok(after > before + 100, `${before} -> ${after}`);
  });

  await check(`${path}: the splitter is a keyboard splitter, and a drag past its limit springs back`, async () => {
    const hr = page.locator('[split] > hr');
    await hr.focus();
    await page.keyboard.press('Home');
    assert.equal(await hr.getAttribute('aria-valuenow'), '25');
    await page.keyboard.press('ArrowRight');
    assert.equal(await hr.getAttribute('aria-valuenow'), '27');
    await page.keyboard.press('End');
    assert.equal(await hr.getAttribute('aria-valuenow'), '75');
    await page.waitForTimeout(900); // the divider drawn catches up with the layout
    const box = await hr.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x - i * 60, box.y + 30); // far past the stage
    await page.mouse.up();
    assert.equal(await hr.getAttribute('aria-valuenow'), '25');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1400);
    assert.equal(await frames(500), 0, 'released outside the stage, it springs back and rests');
  });
}

/** Overlays: a dialog and a drawer drawn by transparent stages. */
async function overlayChecks(path, page) {
  const dialog = '#abort-dialog';
  const open = () => page.evaluate((sel) => document.querySelector(sel).open, dialog);
  await page.locator('#ops').scrollIntoViewIfNeeded();
  // The Abort button is on the Vitals tab; earlier checks left another tab open.
  await page.click('#tab-vitals');
  await page.mouse.move(2, 2);
  await page.waitForTimeout(900);

  await check(`${path}: a dialog opens from a line, transparent outside its panel and its cut corners`, async () => {
    await page.click('#abort');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(90);
    // Early in the opening, the panel's top edge is still closed: no input there.
    const early = await page.evaluate((sel) => {
      const s = document.querySelector(`${sel} loom-stage`);
      return { renderer: s.dataset.renderer, top: s.mapPoint({ x: 60, y: 6 }) };
    }, dialog);
    assert.equal(early.renderer, 'webgpu');
    assert.equal(early.top, null, 'the part that is not open yet takes no input');
    await page.waitForTimeout(1000);
    const box = await page.locator(`${dialog} loom-stage`).boundingBox();
    const g = await greens(page);
    const at = (x, y) => g.g[Math.round(y) * g.w + Math.round(x)];
    const corner = at(box.x + 3, box.y + 3);
    const outside = at(box.x - 8, box.y + 3);
    // Inside, the panel draws its content: the brightest pixel across the title is its ink.
    const title = await page.locator(`${dialog} h2`).boundingBox();
    let ink = 0;
    for (let x = title.x; x < title.x + Math.min(title.width, 260); x++) ink = Math.max(ink, at(x, title.y + title.height / 2));
    assert.ok(Math.abs(corner - outside) <= 6, `the cut corner shows the page behind (corner ${corner}, outside ${outside})`);
    assert.ok(ink > 200, `the panel and its title are drawn (brightest ${ink})`);
    assert.equal(await framesDuring(page, 600, `${dialog} canvas`), 0, 'an open dialog rests');
  });

  await check(`${path}: Escape, Stay and a held Abort close the dialog after it has shut`, async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    assert.equal(await open(), true, 'it is still shutting');
    await page.waitForTimeout(900);
    assert.equal(await open(), false);
    await page.click('#abort');
    await page.waitForTimeout(900);
    await page.click(`${dialog} button[value=stay]`);
    await page.waitForTimeout(900);
    assert.deepEqual(await page.evaluate((sel) => [document.querySelector(sel).open, document.querySelector(sel).returnValue], dialog), [false, 'stay']);
    await page.click('#abort');
    await page.waitForTimeout(900);
    const b = await page.locator(`${dialog} button[value=abort]`).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1150);
    await page.mouse.up();
    await page.waitForTimeout(1200);
    assert.deepEqual(await page.evaluate((sel) => [document.querySelector(sel).open, document.querySelector(sel).returnValue], dialog), [false, 'abort']);
    assert.equal(await page.locator('#abort-out').textContent(), 'Abort ordered. Pulling out.');
  });

  await check(`${path}: a drawer opens from its edge and closes with its form`, async () => {
    await page.locator('#archive').scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1200);
    await page.click('#crew');
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => document.querySelector('#crew-drawer').open), true);
    await page.click('#crew-drawer button');
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => document.querySelector('#crew-drawer').open), true, 'it is still shutting');
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => document.querySelector('#crew-drawer').open), false);
  });
}

/** A menu in an anchored popover, and a select whose list opens in the stage. */
async function menuChecks(path, page) {
  const focused = () => page.evaluate(() => document.activeElement?.textContent.trim());
  const menuOpen = () => page.evaluate(() => document.querySelector('#ops-menu').matches(':popover-open'));
  await page.locator('#ops').scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(900);

  await check(`${path}: a menu opens under its button, and the keyboard drives it`, async () => {
    await page.click('#ops-actions');
    await page.waitForTimeout(700);
    const place = await page.evaluate(() => {
      const a = document.querySelector('#ops-actions').getBoundingClientRect();
      const m = document.querySelector('#ops-menu').getBoundingClientRect();
      return { gap: Math.round(m.top - a.bottom), left: Math.round(m.left - a.left) };
    });
    assert.deepEqual(place, { gap: 6, left: 0 }, 'anchored under its button');
    assert.equal(await page.evaluate(() => document.querySelector('#ops-menu loom-stage').dataset.renderer), 'webgpu');
    assert.equal(await focused(), 'Request resupply', 'the first item takes the focus');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'Line', 'arrows skip separators and captions');
    await page.keyboard.press('a');
    assert.equal(await focused(), 'Abort mission…', 'a letter moves to the next item starting with it');
    await page.keyboard.press('End');
    await page.keyboard.press('Home');
    await page.keyboard.press('l');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    assert.equal(await menuOpen(), false, 'choosing closes the menu');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[aria-labelledby=formation-label] [role=menuitemradio]')].map((r) => r.getAttribute('aria-checked'))), ['false', 'true', 'false']);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'ops-actions', 'the focus goes back to the button');
    await page.click('#ops-actions');
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    assert.equal(await menuOpen(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'ops-actions');
  });

  await check(`${path}: a select opens its list in the stage for the pointer`, async () => {
    await page.locator('#req').scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      window.__changes = 0;
      document.querySelector('#transport').addEventListener('change', () => window.__changes++);
    });
    await page.click('#transport');
    await page.waitForTimeout(500);
    const list = page.locator('[data-for-select]');
    assert.equal(await list.isVisible(), true, 'the stage shows the list');
    assert.equal(await list.getAttribute('aria-hidden'), 'true', 'screen readers keep the select itself');
    const third = await list.locator('[role=option]:nth-child(3)').boundingBox();
    await page.mouse.click(third.x + 20, third.y + third.height / 2);
    await page.waitForTimeout(600);
    assert.deepEqual(await page.evaluate(() => [document.querySelector('#transport').value, window.__changes]), ['Armoured truck', 1]);
    assert.equal(await list.isVisible(), false);
    await page.click('#transport');
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    assert.equal(await list.isVisible(), false, 'Escape closes it');
  });
}

const { server, url } = await startServer();
try {
  for (const path of only) {
    const browser = await launch({ polyfill: path === 'polyfill' });
    try {
      if (path === 'native') await check('the production loader covers delayed styles and releases the form', () => checkDemoLoader(browser));
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
