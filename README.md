# DomLoom

Ordinary HTML controls drawn through one WebGPU compositor, with the motion and light of a game interface. Presses dent the button under the finger, a radio selection slides to the new choice, a reticle locks onto what you point at or tab to, a hold-to-confirm button charges and fires, and an invalid field glitches. The elements underneath stay real HTML: focusable, read by screen readers, validated and submitted with their form.

DomLoom is built on [HTML-in-Canvas](https://github.com/WICG/html-in-canvas) and on the effects host of [`@giuseppe-scotto-lavina/html-in-canvas-polyfill`](https://github.com/GiuseppeScottoLavina/html-in-canvas-polyfill). It runs on Chrome's own implementation (Chrome 157 and later) and on the polyfill elsewhere.

## Use it

```html
<link rel="stylesheet" href="domloom/style.css">
<script type="module">import 'domloom';</script>

<loom-stage sound>
  <form>
    <label>Callsign <input name="callsign" required></label>
    <label><input type="radio" name="role" value="scout" checked> Scout</label>
    <label><input type="radio" name="role" value="medic"> Medic</label>
    <input type="range" name="altitude" min="300" max="3000">
    <label><input type="checkbox" role="switch" name="nv"> Night vision</label>
    <button hold="900ms">Deploy</button>
  </form>
</loom-stage>
```

There is nothing else to learn for the controls themselves: DomLoom recognises the standard elements inside a stage.

### Only what you use

`import 'domloom'` brings every component. To pay only for some, import the core and the components you use; each brings its behaviour, its drawing in the default skin and the compositor primitives it needs, and the shader is built from those primitives only.

```js
import 'domloom/core';     // <loom-stage>, transitions, buttons and hold, the focus reticle
import 'domloom/forms';    // choices, ranges, text fields, numbers
import 'domloom/table';
import 'domloom/tabs';
```

```css
@import 'domloom/base.css';
@import 'domloom/skins/holo/base.css';      /* standard HTML */
@import 'domloom/skins/holo/toast.css';     /* and the attribute components you use */
```

| Entry (minified, gzip) | |
| --- | --- |
| `domloom/core` | 22 KB |
| `domloom/core` + `domloom/tabs` | 24 KB |
| `domloom/forms` | 27 KB |
| `domloom` (all) | 41 KB |

Components: `choice`, `range`, `field`, `number`, `forms` (the four), `gauge`, `tabs`, `details`, `table`, `current`, `rating`, `dropzone`, `removable`, `combobox`, `toast`, `alert`, `badge`, `busy`, `tilt`, `carousel`, `split`. A component imported later (a lazy chunk) joins the stages already running. The polyfill and the effects host are loaded by the first stage that starts, in their own chunks.

| You write | What happens |
| --- | --- |
| `<button>`, `<summary>`, a link, a label of a radio or checkbox | Pressing dents it around the contact point; releasing sends a ring through it |
| `<button hold="900ms">` | The button only fires after a hold. It charges, shakes, and bursts when it fires. A tap, a click from a script or Enter in a field is refused with a shake. Screen readers hear "Press and hold to confirm" |
| Radios with the same name | The selection is a slanted fill that slides to the new choice, front edge first |
| `<input type="checkbox" role="switch">` | A knob that stretches as it travels; the track lights up |
| `<input type="checkbox">` | The box fills from the centre |
| `<input type="range">` | A liquid fill that sloshes with the thumb's speed, and a diamond thumb that brightens while dragged |
| Text fields, `<textarea>`, `<select>` | A scan line on focus, an underline that pulses while typing, a glitch when the field is invalid |
| Anything focusable | Lock-on brackets that fly to the hovered or keyboard-focused control. The last input wins: Tab takes the reticle from the mouse |
| `<meter>`, `<progress>` | A game bar. A drop cuts the bar at once, sends a shock through the whole stage and leaves a white trail that drains after a beat; a gain shows where the bar is going and fills toward it. A `<progress>` without a value sweeps; reaching the end flashes. Meters are cut into chips (`segments="5"` sets how many, `segments="0"` none) and take the colour of their region: `low`, `high` and `optimum` as HTML defines them |
| `<details>` | Opening slides what is below down and uncovers the body behind a scan line; closing shuts it upward and its last rows crumble. Clicks during the slide reach what is shown. Exclusive accordions (`name`) switch with a cut |
| `[role=tablist]` with `[role=tab][aria-controls]` and `[role=tabpanel]` | Tabs that work: click, arrow keys, Home and End select; panels are shown with `hidden`. The indicator stretches to the new tab, and the panel changes with a cut that runs the way you moved. Use `<button type="button" role="tab">` |
| Radio selection, tab indicator | While they move they are glass: the labels they slide over bend at their edges |
| `<table sortable>` | Every header of the first `<thead>` row becomes a sort button (`nosort` on a `<th>` opts out). Rows sort by `data-value` or their text, numbers as numbers, and fly to their new places on arcs; rows that leave the visible set crumble. `loom-sort` fires first (cancelable, to sort on a server), `loom-sorted` once the rows are in order |
| `<input type="number">` | Stepping rolls the digits over: the old value leaves, the new one comes in. Arrow keys and the wheel step it; so does a `<button aria-controls="its-id" data-step="1">` (or `-1`) |
| `[interval]` holding two `<input type="range">` | One track with two thumbs that cannot cross; the liquid runs between them |
| `<input list>` with its `<datalist>` | The browser's popup cannot be drawn into a canvas, so the stage opens its own listbox under the field (the ARIA combobox pattern: arrow keys, Enter, Escape). It unfolds and folds with a scan line |
| `[removable]` (a tag, a chip, a list item) | Gets a remove button (also Delete or Backspace on it). Removing crumbles it and the rest flies into the gap; `loom-remove` fires first (cancelable). A removable element that is added assembles block by block |
| `[dropzone]` holding an `<input type="file">` | Files dragged over it pull the panel into a vortex at the pointer; dropped, they go to the input (its `change` fires) and the vortex collapses |
| `[rating]` around a radio group | Stars: pointing previews, choosing lights them up one after another |
| `[toasts]` (a list or a box) | Each child is a toast: it assembles, counts down (`data-timeout`, 5 s by default) with a bar of light, holds while pointed at or focused, and crumbles when the time is up or it is dismissed. `data-tone="good|warn|bad"`. The region is made a polite live region |
| `role="alert"` | When an alert appears or its text changes, it lands with a shock and its text tears for a moment |
| `[badge]` | When its number changes, it pings (up and down sound and light differently) |
| `aria-busy="true"` | The placeholder content is drawn as blocks and a scan passes over it while busy; when it is no longer busy the real content assembles block by block |
| `<progress ring>`, `<meter ring>` | A ring instead of a bar, with the same damage trail, gain preview, segments and sweep |
| `[tilt]` (a card) | Turns toward the pointer in perspective, with a shadow and a glare; in holo its foil lights up the edges of the content as it turns. Its content stays clickable where it is drawn |
| `[carousel]` (a scroll container) | Scroll-snapping strip that the mouse can drag; buttons with `aria-controls` and `data-step` move it a slide. While it moves it curves like film, the more the faster |
| `[split]` holding a pane, an `<hr>` and a pane | The `<hr>` is a window splitter: drag it, or focus it and use the arrow keys, Home and End (`aria-valuemin`, `aria-valuemax`, `aria-valuenow` in %). Pulled past a limit, the panes stretch like rubber and spring back |
| `aria-current` in a list | The current page of a `<nav>` list, the place in a `nav[aria-label=breadcrumb]`, or the step of an `<ol>` with `aria-current="step"`: the marker stretches over when it moves, and a stepper's beam runs up to the current step |

### Transitions

```js
const stage = document.querySelector('loom-stage');
await stage.transition(() => showReceipt());
```

It works like `document.startViewTransition(update)`. The compositor keeps a picture of the old content, runs `update`, then cuts to the new content with a slanted blade; ahead of the blade the old page breaks into blocks that are blown away. Elements with the same `view-transition-name` (or `data-morph`) in both states fly on an arc from the old place to the new one, leave a streak, and reassemble line by line. Unlike a native view transition, the new page is live while this plays: a click on a flying element reaches that element, and the old page takes no input.

`stage.transition(update, { scope: element, direction: -1 })` cuts only the region of `scope` (an element or a list of them, measured before and after the update), right to left.

`stage.transition(update, { morph: elements, cut: false })` has no blade: the listed elements fly from where they were to where they are after `update` (a reorder, a move to another column), and those that are no longer shown crumble where they were.

### Attributes and API

| | |
| --- | --- |
| `sound` | Procedural interface sounds (WebAudio, no files), after the first gesture in the stage |
| `haptics` | Short vibrations on toggles and on a completed hold, where the device has them |
| `static` | Never start the compositor; plain DOM styling only |
| `stage.ready` | Resolves with `'webgpu'` or `'dom'` |
| `stage.transition(update, {scope, direction, morph, cut})` | See above; resolves when the transition has ended |
| `skin` | The skin that draws the stage (default `holo`) |
| `stage.remove(el)` | Removes an element with motion: it crumbles, and what follows it flies into the space it leaves |
| `stage.reveal(el)` | Has an element that was just added assemble block by block |
| `stage.mapPoint({x, y})` | The point of the live content shown at a visible point of the stage (CSS px), `null` where no element is shown |
| `data-renderer`, `data-mode` | `webgpu` / `loading` / `dom`, and `native` / `polyfill` |
| `loom-fallback` event | The compositor failed and the stage went back to plain DOM; `detail.error` says why |

## Skins

A skin decides how a stage looks, moves and sounds. The behaviours (pressing, holding, selecting, sorting, validating) are the same for every skin: they compute what a control is doing and hand that state to the skin's draw hooks, which turn it into compositor primitives. `holo`, the holo-kinetic material above, is the default skin.

```js
import { defineSkin, PILL, RING, ADD } from 'domloom';

defineSkin({
  name: 'mine',
  tokens: { accent: ['--mine-accent', '#ffcc00'], bg: ['--mine-panel', '#ffffff'] },
  roles: { hot: 'accent', rim: 'accent', bg: 'bg', void: 'bg' },
  shader: { scanlines: 0, chroma: 0.3, crumble: 0, hatch: 0 },
  draw: {
    press(scene, { rect, depth }, { colors }) {
      scene.push(PILL, rect, [4, 0, 8, depth * 0.3], colors.accent, ADD);
    },
  },
  sounds: { press: () => {} },
});
```

```html
<loom-stage skin="mine">…</loom-stage>
```

Draw hooks receive `(scene, state, ctx)`; `ctx` holds `colors` (from `tokens`), `now`, `reduced`, `whole` (the stage's rect), `durations` and `stage`. A hook a skin leaves out draws nothing. The hooks and their state:

| Hook | State |
| --- | --- |
| `reticle` | `rect`, `alpha`, `flash` |
| `press` | `rect`, `point`, `depth`, `released`, `t` (ms since release), `strength` |
| `charge`, `burst`, `nudge` | `rect`, and `progress` and `holding`, or `t` |
| `choice` (radio group), `indicator` (tabs) | `rect`, `alpha`, `motion` (the rect's springs, for speed) |
| `switch`, `checkbox`, `toggled` | `rect`, and `position`, `velocity`, `on`, or `amount`, or `t`, `on`, `select` |
| `range` | `rect`, `value`, `drag`, `slosh` |
| `field` | `rect`, `scan`, `focus`, `typing`, `invalid`, `glitch` |
| `gauge` | `rect`, `kind`, `fill`, `trail`, `gaining`, `tone` (0 good, 1 caution, 2 bad), `segments`, `indeterminate`, `hit`, `complete` |
| `current` | `rect`, `alpha`, `motion`, `value` (the `aria-current` value), `items`, `index`, `list` |
| `sorted` | `rect`, `t`, `direction` |
| `reveal` (details) | `column`, `line`, `shown`, `k`, `opening` |
| `rolled` (number), `unfold` (listbox) | `rect`, and `t`, `direction`, or `line`, `k`, `opening` |
| `rating` | `stars` (rects), `value`, `hover`, `lit` (ms since each star lit) |
| `drop` | `rect`, `point`, `pull` (0..1 while files hover), `dropped` (ms since the drop), `files` |
| `interval` | `rect`, `low`, `high`, `drag` (two values), `slosh` |
| `option` (listbox) | `rect`, `alpha`, `motion` |
| `toast` | `rect`, `left` (time left, 0..1), `paused`, `tone` |
| `alert`, `badge` | `rect`, `t`, and `tone` or `up` |
| `busy` | `rect`, `now` |
| `tilt` | `rect`, `rotX`, `rotY` (radians), `lift`, `glare` (the pointer) |
| `bend` (carousel) | `rect`, `speed` (px per ms) |
| `split` | `rect`, `laid` (the divider in the layout), `shown` (where it is drawn), `dragging`, `focused` |
| `gauge` with `ring` | as `gauge`, with `ring: true` |

Every state also has `el`, the element. A skin's stylesheet styles the controls at rest; scope its rules to `loom-stage[skin="mine"]`, and load it next to `domloom/base.css`, which holds what every skin relies on. `domloom/style.css` is base plus holo.

The holo material is themed with custom properties on the stage: `--loom-void`, `--loom-panel`, `--loom-line`, `--loom-ink`, `--loom-dim`, `--loom-holo`, `--loom-signal`, `--loom-warn`, `--loom-cut`, `--loom-font`, `--loom-display`, `--loom-mono`.

## How it works

- **One stage, one canvas, one pass.** `<loom-stage>` moves its content into a `<canvas content="drawable">` and creates one effects host with one compositor plugin. Each control's behaviour describes its state every frame as a few items in a buffer: spatial items (dent, jitter, glitch, morph) move the picture, and light items (brackets, fills, rings, scan lines, liquid) are SDF shapes painted over it. There is no canvas per component.
- **The DOM holds still.** Hover, press, drag and focus never change CSS. They change shader uniforms, so they show in the next frame and cost no re-capture of the HTML. The DOM changes only when the control's state does (`checked`, `value`), and the GPU animates the change. `loom.css` contains no transition on the GPU path.
- **The shader is built from what the page uses.** Each primitive (`src/primitives/*`: a dent, a lens, a tilted card, an arc…) is one module with its WGSL and the JavaScript twin of what it does to the picture. The compositor compiles the primitives the page has imported, and every frame tells the shader which kinds are in the scene, so a pass for an effect that is not on screen costs nothing.
- **The input mapper is the shader.** A fragment shader maps backwards, from the pixel shown to the source point it shows, and that is exactly the question the host's input mapper answers for a pointer. Each primitive's JavaScript twin sits next to its WGSL. Each presented frame freezes its own numbers for the mapper, and the browser test checks the twins against real GPU pixels.
- **Why it needs the GPU.** CSS can move, scale and clip whole boxes. It cannot bend the lines of text a shock front crosses, refract a label under a moving piece of glass, break a picture of the old page into blocks, smear a flying element along its path, or keep the new page clickable while the old one is still on screen. Those are per-pixel operations on a picture of live HTML, which is what HTML-in-Canvas provides; the mapper keeps every one of them clickable where it is seen.
- **Zero work at rest.** The plugin is `continuous` only while a spring moves. A page at rest renders no frame.
- **Fallbacks.** Without WebGPU, in forced colours, or after a GPU failure, the same markup is styled in plain CSS and the behaviours (hold, validation, transitions as an instant swap) keep working. With reduced motion, springs snap, transitions swap at once and nothing shakes.

## Limits

- The polyfill's canvas is opaque, so a stage is a rectangle and the cut corners are painted in `--loom-void`. Put stages on a background of that colour.
- Each stage creates its own GPU device. Use a few stages per page (one per panel), not one per control.
- Top-layer content (an open modal `<dialog>`, an open popover) is not drawn into a canvas. A dialog needs its own stage inside it.
- Select popups, date pickers and other native pickers open with the browser's own look.
- Opening or closing a `<details>` changes the height of the stage at once (the canvas must have the size of its content); the content inside slides. In a multi-column layout only the column of the `<details>` slides.
- On the polyfill path (1.0.2) a border 1.5 px wide on a rotated pseudo-element is not drawn (2 px is). The material uses gradients there.
- When the picture moves under a still pointer (rows flying after a sort), the press is mapped to the row that is shown, but the polyfill (1.0.2) re-targets the click only for controls: on the polyfill path a click on a plain cell reaches the row of the layout (a button inside the row is re-targeted), and on Chrome's native path it is often swallowed. The browser test reports this as a note.
- On the polyfill path, when a click is remapped to a different element, the native click also reaches the element under the unmapped point (polyfill 1.0.2; Chrome's native path does not do this).

## Publish the demo

`.github/workflows/pages.yml` builds the demo and publishes it on GitHub Pages at every push to `main` (it runs the unit tests first). In the repository, set Settings → Pages → Source to "GitHub Actions" once. The build uses relative URLs, so the demo works under `https://<user>.github.io/<repo>/`.

## Develop

Node 22 or later.

```sh
npm install
npm run dev              # the demo at http://127.0.0.1:5173
npm test                 # unit tests of the mapper twins
npm run test:browser     # Chrome with WebGPU, native path and polyfill path
npm run build            # the demo site in dist/
```

`npm run test:browser` uses `/Applications/Google Chrome.app` or `CHROME_PATH`. It checks that no frame renders at rest, compares pressed GPU pixels with the input mapper, and checks the hold guard, form validation, a click on an element in flight, the damage trail of a meter, the scoped cut of the tabs, a click on a sliding summary, sorting, the mapping of a press on a row in flight, pagination and steppers, the DOM fallback and reduced motion.
