import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, preview } from 'vite';
import { root } from './harness.mjs';

async function delayedStyles(browser, url) {
  const page = await browser.newPage({ reducedMotion: 'no-preference' });
  let releaseStyles;
  const styles = new Promise(resolve => { releaseStyles = resolve; });
  try {
    await page.route('**/*.css', async route => {
      await styles;
      await route.continue();
    });
    const scriptDownloaded = page.waitForEvent('requestfinished', request => request.resourceType() === 'script');
    await page.goto(url, { waitUntil: 'commit' });
    await scriptDownloaded;
    // A blocking stylesheet would prevent this paint until we released the request.
    await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0);
    const loading = await page.evaluate(() => {
      const loader = document.querySelector('#demo-loader');
      const content = document.querySelector('#demo-page');
      // Observe the actual fade when it starts, even when CI skips animation frames.
      const reveal = new MutationObserver(() => {
        if (content.inert) return;
        window.loaderFaded = loader.getAnimations().some(animation => {
          const opacity = animation.effect.getKeyframes().map(key => Number(key.opacity));
          return opacity.includes(1) && opacity.at(-1) === 0;
        });
        reveal.disconnect();
      });
      reveal.observe(content, { attributes: true, attributeFilter: ['inert'] });
      return {
        coversPage: [[1, 1], [innerWidth - 2, innerHeight - 2]].every(([x, y]) => loader.contains(document.elementFromPoint(x, y))),
        inert: content.inert,
        upgraded: Boolean(customElements.get('loom-stage')),
      };
    });
    assert.deepEqual(loading, { coversPage: true, inert: true, upgraded: false });

    releaseStyles();
    await page.locator('#demo-loader').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.loaderFaded), true, 'the loader fades to transparent');
    assert.equal(await page.locator('.layout').first().evaluate(el => getComputedStyle(el).display), 'grid');
    await page.getByRole('button', { name: 'Sound off' }).click();
    assert.equal(await page.getByRole('button', { name: 'Sound on' }).getAttribute('aria-pressed'), 'true');
  } finally {
    releaseStyles();
    await page.close();
  }
}

async function fallback(browser, url, javaScriptEnabled) {
  const page = await browser.newPage({ javaScriptEnabled, reducedMotion: 'reduce' });
  try {
    if (javaScriptEnabled) await page.route('**/*.js', route => route.abort());
    await page.goto(url);
    await page.locator('#demo-loader').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.layout').first().evaluate(el => getComputedStyle(el).display), 'grid');
    const callsign = page.getByRole('textbox', { name: 'Callsign' });
    await callsign.fill('Nightjar');
    assert.equal(await callsign.inputValue(), 'Nightjar');
  } finally {
    await page.close();
  }
}

export async function checkDemoLoader(browser) {
  const outDir = await mkdtemp(join(tmpdir(), 'domloom-loader-'));
  try {
    await build({ root, logLevel: 'error', build: { outDir } });
    const server = await preview({ root, logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
    try {
      const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
      await delayedStyles(browser, url);
      await fallback(browser, url, false);
      await fallback(browser, url, true);
    } finally {
      await server.close();
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
