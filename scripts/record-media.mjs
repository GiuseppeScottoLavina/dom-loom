// Records the README's animations from the demo: each scene plays in Chrome with WebGPU,
// Playwright films it, and ffmpeg cuts the stage out into a GIF with its own palette.
//   node scripts/record-media.mjs            every scene
//   node scripts/record-media.mjs deploy     one scene
// Needs Chrome (or CHROME_PATH) and ffmpeg. Writes docs/media/<scene>.gif.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, root, startServer } from '../test/harness.mjs';

const OUT = join(root, 'docs/media');
const VIEW = { width: 1280, height: 900 };
const wait = (page, ms) => page.waitForTimeout(ms);

/** Presses at the middle of an element, holds, releases. */
async function hold(page, selector, ms) {
  const b = await page.locator(selector).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.down();
  await wait(page, ms);
  await page.mouse.up();
}

/** Moves to the middle of an element and clicks there (the canvas takes the pointer). */
async function press(page, selector) {
  const b = await page.locator(selector).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await wait(page, 120);
  await page.mouse.down();
  await wait(page, 90);
  await page.mouse.up();
}

// Each scene: the stage to film, how wide the GIF is, and what happens.
const scenes = {
  deploy: {
    stage: '#loadout',
    width: 520,
    async play(page) {
      await page.locator('input[name=callsign]').click();
      await page.keyboard.type('Nightjar', { delay: 90 });
      await wait(page, 300);
      for (const role of ['Breacher', 'Medic', 'Engineer']) {
        await press(page, `label:has(input[value=${role}])`);
        await wait(page, 380);
      }
      const r = await page.locator('#altitude').boundingBox();
      await page.mouse.move(r.x + r.width * 0.3, r.y + r.height / 2, { steps: 6 });
      await page.mouse.down();
      await page.mouse.move(r.x + r.width * 0.85, r.y + r.height / 2, { steps: 14 });
      await page.mouse.move(r.x + r.width * 0.55, r.y + r.height / 2, { steps: 10 });
      await page.mouse.up();
      await wait(page, 300);
      await press(page, 'input[name=comms]');
      await wait(page, 300);
      await press(page, 'input[name=roe]');
      await wait(page, 300);
      await hold(page, '#loadout button[type=submit]', 1100);
      await wait(page, 1900);
    },
  },
  ops: {
    stage: '#ops',
    width: 520,
    async play(page) {
      await press(page, '#hit');
      await wait(page, 1300);
      await press(page, '#hit');
      await wait(page, 1300);
      await press(page, '#link');
      await wait(page, 2200);
      await press(page, '#tab-objectives');
      await wait(page, 1100);
      await press(page, '#tab-intel');
      await wait(page, 1300);
    },
  },
  abort: {
    stage: '#ops',
    width: 520,
    // The dialog is its own overlay stage over the page: the film starts once it has shut.
    async play(page, mark) {
      await press(page, '#abort');
      await wait(page, 900);
      await hold(page, '#abort-dialog button[value=abort]', 1150);
      await wait(page, 380);
      mark();
      await wait(page, 3400);
    },
  },
  roster: {
    stage: '#roster',
    width: 560,
    async play(page) {
      for (const n of [3, 4, 1]) {
        await press(page, `#roster-table thead th:nth-child(${n}) button`);
        await wait(page, 1500);
      }
    },
  },
  scope: {
    stage: '#ops',
    width: 520,
    async before(page) {
      await page.locator('#tab-intel').click();
      await wait(page, 1500);
    },
    async play(page) {
      const m = await page.locator('.recon-map').boundingBox();
      const path = [[0.2, 0.3], [0.45, 0.25], [0.7, 0.3], [0.85, 0.35], [0.6, 0.6], [0.45, 0.85], [0.25, 0.75]];
      for (const [fx, fy] of path) {
        await page.mouse.move(m.x + m.width * fx, m.y + m.height * fy, { steps: 22 });
        await wait(page, 380);
      }
      await page.mouse.move(m.x + m.width + 60, m.y + m.height / 2, { steps: 10 });
      await wait(page, 500);
    },
  },
};

const only = process.argv.slice(2);
const chosen = Object.entries(scenes).filter(([name]) => !only.length || only.includes(name));
mkdirSync(OUT, { recursive: true });
const { server, url } = await startServer();
const browser = await launch({});
try {
  for (const [name, scene] of chosen) {
    const dir = mkdtempSync(join(tmpdir(), 'domloom-media-'));
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, recordVideo: { dir, size: VIEW } });
    const page = await context.newPage();
    const opened = Date.now();
    await page.goto(url);
    const stage = page.locator(scene.stage);
    await stage.scrollIntoViewIfNeeded();
    await page.evaluate((sel) => document.querySelector(sel).ready, scene.stage);
    await wait(page, 1600);
    await scene.before?.(page);
    await page.mouse.move(4, 4);
    await wait(page, 400);
    const box = await stage.boundingBox();
    let start = (Date.now() - opened) / 1000;
    await scene.play(page, () => { start = (Date.now() - opened) / 1000; });
    const length = (Date.now() - opened) / 1000 - start;
    await context.close();
    const video = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));
    const crop = [box.width, box.height, box.x, box.y].map((v) => Math.round(v) & ~1).join(':');
    const gif = join(OUT, `${name}.gif`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-t', String(length), '-i', video,
      '-vf', `crop=${crop},fps=16,scale=${scene.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      gif]);
    console.log(`${name}: ${length.toFixed(1)} s, ${(statSync(gif).size / 1e6).toFixed(2)} MB`);
    rmSync(dir, { recursive: true, force: true });
  }
} finally {
  await browser.close();
  await server.close();
}
