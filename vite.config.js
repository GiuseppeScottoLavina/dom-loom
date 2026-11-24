import { defineConfig } from 'vite';

// Relative asset URLs: the demo works at the root of a site and under a project
// path such as https://<user>.github.io/<repo>/ (GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [{
    name: 'demo-woff2-fonts',
    enforce: 'pre',
    transform(css, id) {
      if (!id.includes('/@fontsource/chakra-petch/') || !id.endsWith('.css')) return;
      // The snapshotter embeds every listed source. Keep one format per Unicode range.
      return css.replace(/,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g, '');
    },
  }, {
    name: 'demo-loader-styles',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!html.includes('id="demo-loader"')) return html;
        // Let the inline loader paint while the browser fetches Vite's hashed CSS.
        return html
          .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, (_, src) =>
            `<link rel="modulepreload" crossorigin data-demo-entry href="${src}">`)
          .replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/g, link =>
            link.replace('rel="stylesheet"', 'rel="preload" as="style" data-demo-css') + '<noscript>' + link + '</noscript>');
      },
    },
  }],
  // Agents work in git worktrees under .claude/ (each with its own node_modules):
  // watching them would make the dev server reload and re-optimize for every change there.
  server: { watch: { ignored: ['**/.claude/**'] } },
  // Scan every page at start: a dependency first met on a second page would make Vite
  // re-optimize mid-session and serve chunks with stale hashes (504 Outdated Optimize Dep).
  optimizeDeps: { entries: ['index.html', 'plain.html'] },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: 'index.html', plain: 'plain.html' } },
    assetsInlineLimit: (file) => file.endsWith('.woff2') ? false : undefined,
  },
});
