---
name: domloom
description: Build, style, or debug DomLoom interfaces in vanilla JavaScript, React, or Vue. Use when a task mentions DomLoom, loom-stage, HTML-in-Canvas controls, shader-driven interaction, or morphing native HTML through the DomLoom compositor.
---

# Build with DomLoom

Start with a working HTML interaction. Put the controls that belong together inside one `<loom-stage>`. DomLoom draws the controls, animates their states and maps input back to the live elements. The application owns the data, validation rules, navigation and focus destinations. A button is still a `<button>`.

## Choose a starting point

| If the user wants… | Do this first |
| --- | --- |
| A form or a small widget | Use the two-file example below. Change the fields and keep the native submit event. |
| To enhance an existing screen | Wrap one coherent panel, import the stylesheet and features, and exercise the existing actions. Keep existing names, labels and event handlers. |
| An app with several views | Keep the stage mounted across the views that morph together. Put independent panels in separate stages. Give below-the-fold panels `loading="lazy"`. |
| React or Vue | Use the adapter recipes below for state updates. Both adapters need a stylesheet and component registrations. |
| A new visual effect | Try a built-in interaction, a matched morph or Holo color tokens first. Use the extension APIs when the requested visual requires its own drawing or input mapping. |

## Run a complete interaction

This guide targets DomLoom 0.3.0. In an existing app, use its installed DomLoom package and bundler. For a blank app, use Node 22.12+ and run `npm init -y` in the app directory. Place the supplied archive next to `package.json`, run `npm install ./dom-loom-0.3.0.tgz`, then `npm install -D vite@7.3.7`. To make the archive from the DomLoom checkout, run `npm ci` and `npm pack` there. The archive includes the project's matching HTML-in-Canvas polyfill. Serve the app on localhost or HTTPS for WebGPU.

Create these two files side by side. In a blank app run `npx vite` from that directory and open the URL it prints.

**`index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Boarding pass</title>
    <style>
      :root { color-scheme: dark; background: #0a0e24; }
      body { max-width: 32rem; margin: 8vh auto; padding: 0 1rem; }
      #booking [hidden] { display: none !important; }
    </style>
    <script type="module" src="./main.js"></script>
  </head>
  <body>
    <main>
      <loom-stage id="booking">
        <form id="booking-form">
          <h1 data-morph="title">Reserve a seat</h1>
          <label>Passenger <input id="passenger" name="passenger" autocomplete="name" required></label>
          <button type="submit" data-morph="action">Issue pass</button>
        </form>
        <section id="receipt" aria-labelledby="receipt-title" hidden>
          <p>Boarding pass</p>
          <h1 id="receipt-title" data-morph="title" tabindex="-1">Seat reserved</h1>
          <p>Passenger <strong id="printed-name"></strong></p>
          <button id="edit" type="button" data-morph="action">Edit passenger</button>
        </section>
      </loom-stage>
    </main>
  </body>
</html>
```

**`main.js`**

```js
import 'dom-loom/style.css';
import 'dom-loom';

const stage = document.querySelector('#booking');
const form = stage.querySelector('#booking-form');
const passenger = stage.querySelector('#passenger');
const receipt = stage.querySelector('#receipt');
const title = stage.querySelector('#receipt-title');
const printedName = stage.querySelector('#printed-name');
const edit = stage.querySelector('#edit');

function showReceipt(open) {
  return stage.transition(() => {
    if (open) printedName.textContent = new FormData(form).get('passenger');
    form.hidden = open;
    receipt.hidden = !open;
    (open ? title : passenger).focus();
  }, { direction: open ? 1 : -1 });
}

form.addEventListener('submit', event => {
  event.preventDefault();
  void showReceipt(true);
});
edit.addEventListener('click', () => void showReceipt(false));
```

Try submitting an empty field. The browser should keep the form open and identify the required field. Enter “Ada” and press Enter. The confirmation should show Ada and focus its heading. Activate **Edit passenger**. The input should regain focus and still contain Ada. These outcomes also apply with `<loom-stage static>`.

## Pick the markup that activates the effect

The full `dom-loom` entry registers every row. For a smaller bundle, keep `import 'dom-loom/style.css'` and replace `import 'dom-loom'` with imports for the features you use, e.g. `import 'dom-loom/forms'` and `import 'dom-loom/tabs'`. Each feature imports core. `dom-loom/forms` groups exactly `choice`, `field`, `number` and `range`. The entries below are relative to `dom-loom/`.

| Interaction | Markup and application contract | Entry |
| --- | --- | --- |
| Press, focus, hold to confirm | Use a button or a link with an actual destination. Add `hold="900ms"` to a button for a deliberate action. Keep its ordinary click or submit handler. | `core` |
| Text, number and step buttons | Label an `input` or `textarea`. To add a step button for `<input id="qty" type="number">`, use `<button type="button" aria-controls="qty" data-step="1">+</button>`. | `field`, `number` |
| Checkbox, switch, radio, stars | Wrap each input in a label. Use `role="switch"` on a checkbox, a shared `name` on related radios, or `<fieldset rating>` around labeled radios with a legend. | `choice`, `rating` |
| Slider or interval | Use a labeled `input[type=range]`. For an interval put two range inputs directly inside one `<div interval>`. Give them distinct accessible names, matching bounds and ordered initial values. | `range` |
| Select or searchable list | Use a native `select` with options for a single choice, or `<input list="stops">` paired with `<datalist id="stops">` for suggestions. | `select`, `combobox` |
| File drop | Put a real `input[type=file]` inside `<label dropzone>`. Handle files on the input's `change` event. | `dropzone` |
| Disclosure or tabs | Use `details` + `summary`. For tabs, put `button[type=button][role=tab]` in a named `[role=tablist]`. Give each tab an ID and `aria-controls` pointing to its panel. Give each panel `role="tabpanel"` and `aria-labelledby`. Start with one selected tab and hide inactive panels. | `details`, `tabs` |
| Current page or step | Use `aria-current="page"` on the active link or `aria-current="step"` on the active step. Update that attribute when the application navigates. | `current` |
| Sortable table | Use `<table sortable>` with a `thead` and a `tbody`. The first header row controls sorting of the first body. Use `th[nosort]` to skip a column and `td[data-value]` for a machine-sortable value. | `table` |
| Removable chip or row | Put `removable` on the item. DomLoom supplies the remove control. Handle `loom-remove` if the application owns the list. Add `exit="shatter"` for shards instead of a crumble. | `removable`, `shatter` |
| Meter or progress | Use `meter` for a measurement and `progress` for work. Set `value` and `max`, or omit `value` for indeterminate progress. Add `ring` for a dial or `segments="5"` on a meter. | `gauge` |
| Toast, alert, badge or busy state | Append a direct child to `<ol toasts>` for a toast. A child can set `data-tone="good"` and `data-timeout="4s"`. Change text inside `[role=alert]` or a number inside `[badge]`. Set and clear `aria-busy="true"` around real work. | `toast`, `alert`, `badge`, `busy` |
| Tilt, carousel or splitter | Put `tilt` on a card. Put `carousel` on a scroll container with slides and target its ID with `button[aria-controls][data-step]`. Put a pane, an `hr` and a pane directly inside `[split]`. | `tilt`, `carousel`, `split` |
| Magnifying glass | Put `loupe` on a table or a block of small text; `loupe="3"` sets the magnification (default 2) and `loupe-size="160"` the glass diameter. The glass follows the mouse; on touch it is press and hold. A click inside it reaches the magnified element. | `loupe` |
| Pointer as a light | Put `lit` on a bordered panel with text or borders to emboss; `lit="0.6"` sets the intensity. It moves no pixel, so inputs inside keep working. | `lit` |
| Water under the pointer | Put `fluid` on a readout panel, not on a region that is mostly sliders or inputs, which a drag would fight; `fluid="0.5"` sets the strength. Dragging stirs the content and it settles. The element needs `touch-action: pan-y pinch-zoom` so a finger stirs sideways and still scrolls (holo sets it). | `fluid` |
| Modal dialog, popover or menu | Put the native `dialog` or `[popover]` outside the ordinary stage. Place a separate `<loom-stage overlay>` directly inside it. Use `showModal()`, a form with `method="dialog"`, or a native `popovertarget` trigger. For a menu put a named `[role=menu]` and buttons with `role="menuitem"` inside the overlay stage. | `dialog`, `popover`, `menu` |

Use native `input`, `change`, `click`, `submit` and `reset` events for application logic. Keep labels, field names, button types and keyboard operation. DomLoom boolean HTML attributes use **presence**. To turn off `static`, `sound` or `haptics`, remove the attribute. Enable sound and haptics when the experience calls for them.

## Choose the motion by what changes

| What changes | How to animate it |
| --- | --- |
| A user presses, types, chooses, drags or opens a built-in control | Use its markup and feature import. Its behavior supplies the motion. |
| Two views replace one another | Call `stage.transition(update)` on their common stage. Give corresponding elements the same `data-morph` value or CSS `view-transition-name`. Each key should occur once per **visible** view. Hide the old view or remove it inside the callback. |
| Only one region needs a cut | Pass `{ scope: panel }` or `{ scope: panel, direction: -1 }`. A scoped cut skips automatic key matching. Add an explicit `morph` list if elements persist and move. |
| Existing items move | Capture the actual nodes **before** the change. Pass them as `{ morph: nodes, cut: false }`. Keep each node's identity across the update. |
| An item appears or disappears | For plain DOM call `stage.reveal(item)` after insertion, or `await stage.discard(item)` to remove it. Newly added removable items and toasts already have entry effects. For a removal as shards, add `exit="shatter"` to a `[removable]`, or pass `{ exit: 'shatter' }` to `discard(item, update, { exit })` or to `transition` with `morph` (entry `dom-loom/shatter`). |
| The cut itself should look different | Pass `{ style: 'curl' }` for a page turn that peels the old view away (`dom-loom/curl`; `direction: -1` peels from the other side) or `{ style: 'melt' }` for an old view that drips down (`dom-loom/melt`). They work unscoped or with `scope`, and the new view stays live underneath. The default is the blade. |

Example for a vanilla list with `id="queue"` inside the stage. Call this from a button's click handler. The stage and the list stay mounted.

```js
function reverseQueue(stage) {
  const list = stage.querySelector('#queue');
  const rows = Array.from(list.children);
  const reversed = rows.slice().reverse();
  return stage.transition(() => list.append(...reversed), {
    morph: rows,
    cut: false,
  });
}
```

Put the actual DOM or state change **inside** the callback. Finish network requests before starting it when possible. The same callback must deliver the correct result with reduced motion, while offscreen and on the DOM renderer. Keep normal input handlers attached. The effects host already maps clicks to live controls at their drawn positions and excludes the old snapshot. For a custom probe, `stage.mapPoint({ x, y })` takes stage-local CSS pixels and returns a source point or `null` where the rendered effect has no live target.

## Let the framework own its data

Keep a stable HTML root inside the stage and use stable data keys for repeated items. Query descendants through the stage ref. The stage moves its content into a source wrapper when it connects. For server-rendered screens, initialize the enhancement on the client after the framework has hydrated the subtree, or use the framework's client-only boundary.

**React.** Use the wrapper and hooks from `dom-loom/react`. This component reorders the same keyed nodes and removes a tag from React state on pointer or keyboard input.

```jsx
import React, { useRef, useState } from 'react';
import { LoomStage, useLoomDiscard, useLoomEvent, useLoomTransition } from 'dom-loom/react';
import 'dom-loom/removable';
import 'dom-loom/style.css';

export default function Tags() {
  const stage = useRef(null);
  const [tags, setTags] = useState(['Window', 'Aisle']);
  const discard = useLoomDiscard(stage);
  const transition = useLoomTransition(stage);
  function reverseTags() {
    const rows = Array.from(stage.current.querySelectorAll('li[data-tag]'));
    return transition(() => setTags(current => current.slice().reverse()), {
      morph: rows, cut: false,
    });
  }
  useLoomEvent(stage, 'loom-remove', event => {
    event.preventDefault();
    const item = event.target;
    const tag = item.dataset.tag;
    if (item.contains(document.activeElement)) {
      const neighbor = item.nextElementSibling ?? item.previousElementSibling;
      const destination = neighbor?.querySelector('button') ?? stage.current.querySelector('h2');
      destination.focus();
    }
    void discard(item, () => setTags(current => current.filter(value => value !== tag)));
  });
  return (
    <LoomStage ref={stage}>
      <section>
        <h2 tabIndex={-1}>Seat preferences</h2>
        <ul aria-label="Seat preferences">
          {tags.map(tag => <li key={tag} data-tag={tag} removable="">{tag}</li>)}
        </ul>
        <button type="button" onClick={reverseTags} disabled={tags.length < 2}>Reverse order</button>
      </section>
    </LoomStage>
  );
}
```

Use `useLoomTransition(stage)` for other state changes. For a state-owned sortable table, listen for `loom-sort`, call `event.preventDefault()` synchronously, read `event.detail.column` and `event.detail.direction` (`ascending` or `descending`), collect the existing rows, then update ordered state inside the transition with `{ morph: rows, cut: false }`. Update the header's `aria-sort` as part of that state. Vanilla tables that accept the default sort can observe `loom-sorted` afterward.

**Vue 3.** In the Vite config, import `isCustomElement` from `dom-loom/vue` and pass `vue({ template: { compilerOptions: { isCustomElement } } })` to the existing Vue plugin setup. Merge that predicate with any custom-element test the application already uses. For runtime-compiled templates, install `DomLoom` from `dom-loom/vue` via `app.use(DomLoom)`. Here is a complete single-file component.

```vue
<script setup>
import { ref } from 'vue';
import { useLoomStage } from 'dom-loom/vue';
import 'dom-loom/core';
import 'dom-loom/style.css';

const stage = ref(null);
const boarding = ref(false);
const { transition } = useLoomStage(stage);
function changeStatus() {
  return transition(() => { boarding.value = !boarding.value; });
}
</script>

<template>
  <loom-stage ref="stage">
    <section>
      <h2 v-if="boarding" data-morph="flight">Boarding now</h2>
      <p v-else data-morph="flight">Awaiting boarding</p>
      <button type="button" @click="changeStatus">Change boarding status</button>
    </section>
  </loom-stage>
</template>
```

The Vue composable waits for `nextTick`. For state-owned removal, intercept `@loom-remove.prevent` and call its `discard(item, updateState)`. For other frameworks, use the element directly and make the transition callback await the framework's DOM commit.

## Art direction and custom effects

The linked files ship in DomLoom. If this skill was copied elsewhere, open the same `src/` and `types/` paths under the installed `node_modules/dom-loom/` directory.

1. Give each interaction a purpose. A seat selector can use radios for the moving choice indicator, a shared title for the jump to the ticket, and `[badge]` for a changing seat count. Motion then communicates selection, continuity and change using three ordinary controls.
2. To recolor Holo, keep the default skin and set tokens on the stage in the initial stylesheet. For the example use `#booking { --loom-holo: #91ffb5; --loom-signal: #ff795d; --loom-panel: #101d20; }`. Style layout in CSS. A per-frame CSS animation inside captured content can force a new capture each frame.
3. For a new skin, register `defineSkin({ name, tokens, roles, draw, sounds })` before using that name in `skin`. Supply its resting-state CSS too. Holo's stylesheet selects only the default and `skin="holo"`. `extendSkin(name, draw, sounds)` changes hooks for every stage using that skin. For a working draw hook and its inputs, read the [Holo choice implementation](../../src/skins/holo/choice.js).
4. For a new behavior, follow [the behavior contract](../../types/index.d.ts) and [a built-in implementation](../../src/behaviors/tilts.js). Register with `defineBehavior(name, Class, order)`. Let `step(now, dt)` return true while frames are needed and false at rest. Emit existing primitives before writing a shader. Import a primitive from the full entry or its exact module, e.g. `import { PILL } from 'dom-loom/primitives/pill'`.
5. For a new deformation, use `definePrimitive` with a unique kind and follow [the tilt primitive](../../src/primitives/tilt.js) and [registry contract](../../src/core/primitives.js). Match the JS input mapping to the WGSL drawing at the same frame. For a custom cut, return `null` over the old snapshot and `undefined` over the live picture in its JS mapping. Test with a real pointer at a visibly displaced target.

**Recipe for a signature press.** To light the bottom edge as a button sinks under the pointer, add `data-lit-edge` to that button. Load this module once at app startup. It keeps Holo's press and release animations and adds a strip only on marked controls. The strip paints light, so the existing input mapping still applies.

```js
import { ADD, PILL, extendSkin, getSkin } from 'dom-loom';

const drawHoloPress = getSkin('holo').draw.press;
extendSkin('holo', {
  press(scene, state, context) {
    drawHoloPress(scene, state, context);
    if (context.reduced || !state.el.hasAttribute('data-lit-edge')) return;
    const depth = Math.min(1, Math.max(0, state.depth));
    if (depth === 0) return;
    const [x, y, width, height] = state.rect;
    const edge = [x, y + height - 3, width * depth, 3];
    scene.push(PILL, edge, [1, 0, 2, depth], context.colors.signal, ADD);
  },
});
```

## Diagnose the result

| Symptom | First check |
| --- | --- |
| The controls look like unstyled HTML | Verify the entry actually imports `dom-loom/style.css` and the bundle served its CSS. Verify the controls are descendants of the stage. |
| Styled controls, no expected effect | Inspect `await stage.ready` on the affected, visible stage. `'webgpu'` is the compositor and `stage.dataset.mode` identifies `native` or `polyfill`. `'dom'` is expected with `static`, forced colors, or unavailable WebGPU. Reduced motion can suppress a transition even on WebGPU. Also check the feature import and markup in the table. |
| Two views cut but their elements never morph | Keep the same stage, check equal visible keys on both sides, and use an unscoped transition for automatic key matching. For reordered nodes, check that each old node survives the update. |
| An automated click immediately after startup misses | `ready` reports the renderer. Holo can still be revealing the control. For a settled-state pointer test, wait for its visible position to map to the intended live control before clicking. |
| A removed row reappears | Cancel the request event and remove the row from framework state inside the adapter's `discard` callback. |
| A lazy page initializes every stage immediately | Reading `stage.ready` or passing React's `onReady` explicitly starts a lazy stage. Read readiness only for the stage you intend to activate. |
| GPU enhancement fails unexpectedly | Listen for `loom-fallback` and inspect `event.detail.error`. Check the secure context and the packaged polyfill. Keep the form usable when `data-renderer="dom"`. |

Before delivering a screen, use the keyboard to complete its primary action, repeat it with a pointer, and exercise the reverse or dismissal path. Repeat with reduced motion and with a static stage. For a custom morph, click during the motion and check the identity of the activated control. Report the renderer and the paths actually tested.
