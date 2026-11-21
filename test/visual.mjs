// Visual regression: every stage of the demo at rest, in the working tree and in a git
// ref (HEAD by default), compared pixel by pixel on the same machine and browser.
//   node test/visual.mjs [ref] [--polyfill]
// A change that is meant to look different shows up here too: read the numbers.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { launch, root } from './harness.mjs';

const args = process.argv.slice(2);
const ref = args.find((a) => !a.startsWith('--')) ?? 'HEAD';
const polyfill = args.includes('--polyfill');
const stages = ['loadout', 'ops', 'roster', 'req', 'comms', 'archive'];

const base = mkdtempSync(join(tmpdir(), 'domloom-visual-'));
execFileSync('git', ['worktree', 'add', '--detach', '-q', base, ref], { cwd: root });
symlinkSync(join(root, 'node_modules'), join(base, 'node_modules'));

async function shots(dir, browser) {
  const server = await createServer({ root: dir, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [dir, root] } } });
  await server.listen();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.evaluate(() => customElements.whenDefined('loom-stage').then(() => Promise.all([...document.querySelectorAll('loom-stage')].map((s) => s.ready))));
  const out = {};
  for (const id of stages) {
    const stage = page.locator(`#${id}`);
    if (!(await stage.count())) continue;
    await stage.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(1300);
    out[id] = (await stage.screenshot()).toString('base64');
  }
  await page.context().close();
  await server.close();
  return out;
}

let failed = false;
const browser = await launch({ polyfill });
try {
  const before = await shots(base, browser);
  const after = await shots(root, browser);
  const page = await browser.newPage();
  for (const id of stages) {
    if (!before[id] || !after[id]) {
      console.log(`${id.padEnd(8)} only in ${before[id] ? ref : 'the working tree'}`);
      continue;
    }
    const r = await page.evaluate(async ({ a, b }) => {
      const read = async (b64) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = c.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      };
      const [x, y] = await Promise.all([read(a), read(b)]);
      if (x.width !== y.width || x.height !== y.height) return { size: [x.width, x.height, y.width, y.height] };
      let differ = 0;
      let max = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]));
        if (d > 8) differ++;
        max = Math.max(max, d);
      }
      return { differ, total: x.width * x.height, max };
    }, { a: before[id], b: after[id] });
    if (r.size) {
      failed = true;
      console.log(`${id.padEnd(8)} size ${r.size[0]}x${r.size[1]} -> ${r.size[2]}x${r.size[3]}`);
    } else {
      if (r.differ) failed = true;
      console.log(`${id.padEnd(8)} ${String(r.differ).padStart(7)} of ${r.total} px differ (max ${r.max})`);
    }
  }
} finally {
  await browser.close();
  execFileSync('git', ['worktree', 'remove', '--force', base], { cwd: root });
  rmSync(base, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
