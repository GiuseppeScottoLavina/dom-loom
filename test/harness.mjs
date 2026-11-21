// Shared browser harness: a Vite dev server and Chrome with WebGPU.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

export const root = fileURLToPath(new URL('../', import.meta.url));

export async function startServer() {
  const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const { port } = server.httpServer.address();
  return { server, url: `http://127.0.0.1:${port}/` };
}

export async function launch({ polyfill = false, headless = true } = {}) {
  const executablePath = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    chromium.executablePath(),
  ].find((path) => path && existsSync(path));
  const args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];
  if (polyfill) args.push('--disable-features=CanvasDrawElement');
  // Extra flags, for example a software WebGPU in CI.
  if (process.env.CHROME_ARGS) args.push(...process.env.CHROME_ARGS.split(/\s+/).filter(Boolean));
  return chromium.launch({ executablePath, headless, args });
}
