# HTML-in-Canvas dependency

DomLoom currently ships a build of html-in-canvas-polyfill 1.0.3 with a change to font handling in SVG snapshots. The dependency is bundled in DomLoom's npm package. Its public API and Web Component markup are unchanged.

The snapshot may omit an unused Unicode subset when a face with matching descriptors survives in the same CSS scope. The fast path handles simple English and Italian text, including accented Italian vowels and common punctuation. Other scripts, dynamically generated CSS content, localized controls, and uncertain transforms use the full stylesheet. Each serialized tile is checked after projecting the current form state and flattening shadow content.

To rebuild the tarball, use a clean checkout of [the upstream repository](https://github.com/GiuseppeScottoLavina/html-in-canvas-polyfill) at tag `v1.0.3` (commit `86e8f7f8f8263a0329bd97c7d5406d4f9326d443`). Set `DOMLOOM_VENDOR` to the absolute path of this directory.

```sh
git apply "$DOMLOOM_VENDOR/html-in-canvas-font-subsets.patch"
npm ci
npm run check
node --test test/unit/snapshot-capture/font-subsets.test.mjs
node test/unit/run.mjs --chrome "$CHROME_PATH" test/unit/snapshot-capture/font-subsets.browser.test.mjs
npm pack --pack-destination "$DOMLOOM_VENDOR"
```

The package prepack script rebuilds its ESM, classic and type bundles. Install the resulting tarball through DomLoom's package manifest and lockfile. Replace the local dependency with an upstream release once that release includes the optimization.
