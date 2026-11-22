# DomLoom

Ordinary HTML controls drawn through one WebGPU compositor, with the motion and light of a game interface. Presses dent the button under the finger, a radio selection slides to the new choice, a reticle locks onto what you point at or tab to, a hold-to-confirm button charges and fires, and an invalid field glitches. The elements underneath stay real HTML: focusable, read by screen readers, validated and submitted with their form.

DomLoom is built on [HTML-in-Canvas](https://github.com/WICG/html-in-canvas) and on the effects host of [`@giuseppe-scotto-lavina/html-in-canvas-polyfill`](https://github.com/GiuseppeScottoLavina/html-in-canvas-polyfill). It runs on Chrome's own implementation (Chrome 157 and later) and on the polyfill elsewhere.

## Use it

For AI agents building a screen, the [DomLoom skill](skills/domloom/SKILL.md) includes a runnable form, component markup, framework recipes and browser checks.

```html
<link rel="stylesheet" href="dom-loom/style.css">
<script type="module">import 'dom-loom';</script>

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

`import 'dom-loom'` brings every component. To pay only for some, import the core and the components you use; each brings its behaviour, its drawing in the default skin and the compositor primitives it needs, and the shader is built from those primitives only.

```js
import 'dom-loom/core';     // <loom-stage>, transitions, buttons and hold, the focus reticle
import 'dom-loom/forms';    // choices, ranges, text fields, numbers
import 'dom-loom/table';
import 'dom-loom/tabs';
```

```css
@import 'dom-loom/base.css';
@import 'dom-loom/skins/holo/base.css';      /* standard HTML */
@import 'dom-loom/skins/holo/toast.css';     /* and the attribute components you use */
```

| Entry (minified, gzip) | |
| --- | --- |
| `dom-loom/core` | 22 KB |
| `dom-loom/core` + `dom-loom/tabs` | 24 KB |
| `dom-loom/forms` | 27 KB |
| `dom-loom` (all) | 41 KB |

Components: `choice`, `range`, `field`, `number`, `forms` (the four), `dialog`, `popover`, `menu`, `select`, `gauge`, `tabs`, `details`, `table`, `current`, `rating`, `dropzone`, `removable`, `combobox`, `toast`, `alert`, `badge`, `busy`, `tilt`, `carousel`, `split`. A component imported later (a lazy chunk) joins the stages already running. The polyfill and the effects host are loaded by the first stage that starts, in their own chunks.

| You write | What happens |
| --- | --- |
| `<button>`, `<summary>`, a link, a label of a radio or checkbox | Pressing dents it around the contact point; releasing sends a ring through it |
| `<button hold="900ms">` | The button only fires after a hold (pointer, or Space / Enter on it). It charges, shakes, and bursts when it fires; a tap is refused with a shake. An activation that nobody pressed (a screen reader's, Enter in a field) arms it instead, says "activate again to confirm", and a second one within 4 seconds confirms: hold-to-confirm needs that alternative (WCAG 2.5.1). Screen readers hear "Press and hold, or activate twice, to confirm" |
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
| `<dialog>` or `[popover]` holding `<loom-stage overlay>` | The stage is transparent around its panel (cut corners are cut out) and opens from a line of light; `overlay="left|right|top|bottom"` opens it from that edge (a drawer). A dialog closed by Escape, a `<form method="dialog">` or a `command="close"` button shuts first, then closes, with its `returnValue`. `dialog.close()` from a script closes at once, and so does a popover dismissed by a click outside |
| `[role=menu]` in a popover's overlay stage | The ARIA menu pattern: the first item takes the focus; arrows, Home, End and a letter move it (a light follows); `menuitemcheckbox` and `menuitemradio` toggle; choosing closes the menu; Escape and Tab close it; the focus returns to the button. A popover opened by a `popovertarget` button is anchored under it (above if there is no room) and opens from that side |
| `<select>` | A pointer opens its list inside the stage (the browser's popup cannot be drawn into a canvas). The keyboard and screen readers keep the select's own behaviour and popup |
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
| `loading="lazy"` | Keeps the HTML interactive and starts the GPU within 240 CSS pixels of the viewport once scrolling settles. Focus, a pointer press or switching to `eager` starts it immediately. The default is eager. |
| `stage.ready` | Resolves with `'webgpu'` or `'dom'`. Reading it explicitly starts a lazy stage, as does supplying React's `onReady`. |
| `stage.transition(update, {scope, direction, morph, cut})` | See above; resolves when the transition has ended |
| `skin` | The skin that draws the stage (default `holo`) |
| `stage.discard(el, update?)` | Removes an element with motion: it crumbles, and what follows it flies into the space it leaves. A framework passes `update`, which removes it from its state |
| `stage.reveal(el)` | Has an element that was just added assemble block by block |
| `stage.mapPoint({x, y})` | The point of the live content shown at a visible point of the stage (CSS px), `null` where no element is shown |
| `data-renderer`, `data-mode` | `webgpu` / `loading` / `dom`, and `native` / `polyfill` |
| `loom-fallback` event | The compositor failed and the stage went back to plain DOM; `detail.error` says why |

## Frameworks

`<loom-stage>` is a custom element and works in any framework. Two things need care. A transition keeps a picture of the page before your update, so the update must be in the DOM when it returns. And DomLoom changes the DOM of a sorted table or a removed chip only when nobody else owns it: in a framework, cancel `loom-sort` and `loom-remove` and change your state instead, inside a transition or a discard.

**React** (`dom-loom/react`):

```jsx
import { LoomStage, useLoomDiscard, useLoomEvent, useLoomTransition } from 'dom-loom/react';
import 'dom-loom/table';

function Roster() {
  const stage = useRef(null);
  const transition = useLoomTransition(stage); // flushes your update inside the cut
  const discard = useLoomDiscard(stage);
  useLoomEvent(stage, 'loom-sort', (e) => {
    e.preventDefault();
    const rows = [...stage.current.querySelectorAll('tbody tr')];
    transition(() => setSort(e.detail), { morph: rows, cut: false });
  });
  return <LoomStage ref={stage} sound><table sortable="">…</table></LoomStage>;
}
```

Write DomLoom's attributes as strings in JSX (`sortable=""`, `hold="900ms"`); the types in `dom-loom/react` declare them.

**Vue** (`dom-loom/vue`):

```js
import { DomLoom, isCustomElement, useLoomStage } from 'dom-loom/vue';
app.use(DomLoom);                                  // runtime templates
vue({ template: { compilerOptions: { isCustomElement } } }); // single-file components (vite.config)

const stage = ref(null);
const { transition, discard } = useLoomStage(stage); // waits for nextTick inside the cut
```

Svelte, Solid, Angular (with `CUSTOM_ELEMENTS_SCHEMA`) and plain HTML use the element directly. TypeScript types ship with the package.

## Skins

A skin decides how a stage looks, moves and sounds. The behaviours (pressing, holding, selecting, sorting, validating) are the same for every skin: they compute what a control is doing and hand that state to the skin's draw hooks, which turn it into compositor primitives. `holo`, the holo-kinetic material above, is the default skin.

```js
import { defineSkin, PILL, RING, ADD } from 'dom-loom';

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

Every state also has `el`, the element. A skin's stylesheet styles the controls at rest; scope its rules to `loom-stage[skin="mine"]`, and load it next to `dom-loom/base.css`, which holds what every skin relies on. `dom-loom/style.css` is base plus holo.

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

- A stage on the page is an opaque rectangle: its cut corners are painted in `--loom-void`, so put stages on a background of that colour. Overlay stages are transparent.
- All stages of a page share one GPU device. Still, use a few stages per page (one per panel), not one per control: each has its own canvas and capture.
- Top-layer content (an open modal `<dialog>`, an open popover) is not drawn into the canvas of the page's stages: give it its own `<loom-stage overlay>` (dom-loom/dialog, dom-loom/popover).
- Date and colour pickers open with the browser's own look; so does a select's popup when opened from the keyboard or a screen reader (on purpose: it is fully accessible).
- Opening or closing a `<details>` changes the height of the stage at once (the canvas must have the size of its content); the content inside slides. In a multi-column layout only the column of the `<details>` slides.
- A press in the first moments of a flight (rows sorting) can reach nothing on Chrome's own HTML-in-Canvas: the press is mapped with the frame the browser captured for it, which may still show the row leaving. It never reaches another row.

On Chrome's own HTML-in-Canvas the polyfill's core is not downloaded: the page loads DomLoom, the polyfill's loader and its effects host (about 190 KB of JavaScript for the whole demo, 66 KB gzip).

## Publish the demo

`.github/workflows/pages.yml` builds the demo and publishes it on GitHub Pages at every push to `main` (it runs the unit tests first). In the repository, set Settings → Pages → Source to "GitHub Actions" once. The build uses relative URLs, so the demo works under `https://<user>.github.io/<repo>/`.

## Develop

Node 22 or later.

```sh
npm install
npm run dev              # the demo at http://127.0.0.1:5173
npm test                 # unit tests of the mapper twins
npm run test:browser     # Chrome with WebGPU, native path and polyfill path
npm run test:types       # the public TypeScript types
npm run build            # the demo site in dist/
```

`npm run test:browser` uses `/Applications/Google Chrome.app` or `CHROME_PATH`. It checks that no frame renders at rest, compares pressed GPU pixels with the input mapper, and checks the hold guard, form validation, a click on an element in flight, the damage trail of a meter, the scoped cut of the tabs, a click on a sliding summary, sorting, the mapping of a press on a row in flight, pagination and steppers, the DOM fallback and reduced motion.
