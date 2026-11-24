# Contributing to DomLoom

Thanks for helping. Bug reports, ideas and pull requests are welcome.

## Before you start

- For a bug, open an issue with the browser and its version, the render path (`data-renderer` and `data-mode` on the stage: `webgpu` or `dom`, and `native`, `native-bridged` or `polyfill`), the smallest markup that shows it, and what you expected.
- For a new effect or component, open an issue first. DomLoom keeps a few rules (below); talking first saves you work.

## Set up

Node 22.12 or later, and Google Chrome for the browser suites (or set `CHROME_PATH`).

```sh
npm install
npm run dev              # the demo at http://127.0.0.1:5173
```

## Checks

Run these before opening a pull request:

```sh
npm test                 # unit tests: the mapper twins, the shader, the stage's scheduling
npm run test:types       # the public TypeScript types
npm run test:browser     # Chrome with WebGPU, native and polyfill paths
npm run test:effects     # the effect suites, each in its own process
npm run test:guide       # every example of the guide
npm run test:visual      # every demo stage at rest, pixel by pixel against HEAD
```

`npm run test:visual` reports how many pixels changed per stage. A change that is meant to look different shows up there too: say so in the pull request.

## The rules of the codebase

- **The DOM holds still, the GPU moves.** Hover, press, drag and focus change shader uniforms, never CSS. The DOM changes only when a control's state does.
- **Every effect is impossible in CSS.** If CSS can do it, it does not belong in the compositor.
- **Every primitive that moves pixels has a JavaScript twin** next to its WGSL, so the input mapper sends a click to what is drawn under the pointer. Tests compare the twin with real GPU pixels.
- **Zero frames at rest.** A stage renders only while something moves.
- **Plain HTML first.** A feature works on standard elements and attributes, keeps the element's accessibility, and has a plain-CSS fallback without WebGPU.
- **One commit, one change**, with a message that says what changed and why.

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
