import { defineConfig } from 'vite';

// Relative asset URLs: the demo works at the root of a site and under a project
// path such as https://<user>.github.io/<repo>/ (GitHub Pages).
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
