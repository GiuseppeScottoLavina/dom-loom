# Changelog

All notable changes to DomLoom. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## 0.3.0 - 2026-11-25

The first public release. It depends on `@giuseppe-scotto-lavina/html-in-canvas-polyfill` ^1.0.4, whose snapshots embed only the font subsets a tile of simple text uses and resolve `rem` against the page's root.

### Added

- `<loom-stage>`: one canvas and one WebGPU compositor per panel, drawing the live HTML inside it through HTML-in-Canvas (native on Chrome 157+, the polyfill elsewhere), with zero frames at rest and a plain-CSS fallback without WebGPU.
- Form controls with game feel: presses that dent, a reticle that locks onto hover and keyboard focus, hold-to-confirm buttons with a screen-reader alternative, sliding radio selections, stretching switches, liquid ranges, glitching invalid fields, rolling numbers, interval ranges, a datalist combobox.
- Feedback and collections: game-bar meters and progress (damage trail, shock, segments, rings), ARIA tabs with a scoped blade cut, details that slide and crumble, sortable tables whose rows fly, `aria-current` markers, ratings, dropzones, removable chips, toasts, alerts, badges, busy regions.
- Surfaces and effects: tilting foil cards, bending carousels, elastic splitters, a magnifying loupe, a point-light surface, fluid panels.
- Overlays: dialogs, drawers, popovers, ARIA menus and select lists drawn by transparent stages.
- Transitions: `stage.transition(update)` with a blade cut, morph flights between states, crumbling exits, `style: 'curl'` and `style: 'melt'` cuts, and `exit: 'shatter'`; the new page stays live while they play, and ghosts are the picture as it was presented.
- A modular build: per-component entries, a shader compiled from the primitives a page imports, a presence mask for primitive kinds 1 to 63, and paint blends `ADD`, `BEHIND`, `OVER`, `INK`, `INVERT`.
- Skins: `defineSkin` and `extendSkin`, the `holo` skin, token fallbacks that read the page, `draws` and `reticle` options.
- React and Vue helpers, TypeScript types, and a skill for AI agents (`skills/domloom/SKILL.md`).
- A demo console (Loadout, Ops, Roster, Supply, Comms, Archive), and browser suites on the native and polyfill paths with pixel checks of the input mapper.
- A guide with live examples for every feature (`guide/`, published with the demo), and its browser suite (`npm run test:guide`).
- Types for `dom-loom/core` (without the primitive kinds it does not export), for each `dom-loom/primitives/*` entry, and for the stage's behaviour API (`listen`, `draw`, `visible`, `pointOf`…).
- For pages that are apps:
  - `bare` and `fill` on a stage. `bare` has no panel, and the page shows through its transparent canvas. With `fill`, the content takes the height the stage's parent gives it. Together they wrap a layout element, such as a nav in a header.
  - `toasts="viewport"`: a page's notifications at the bottom centre of the viewport, in a bare stage of their own.
  - `removable="row"` for removable items that are not chips.
  - `loom-plain` for buttons that keep the page's look.
  - `overlay="zoom"`: an overlay that opens and closes at scale (from 94 %, fading), scaled by the compositor so that clicks land where they are seen. Primitives can now have a `view`, which moves the whole frame (picture, lights and input), and `ZOOM` is one.
  - `current="line"` for a page's own navigation: the links keep their look, and a line on the bottom edge of the current one slides to the next. It is drawn inside the item's box, so it never leaves the canvas. In such a navigation the reticle follows keyboard focus only, not the pointer.
- Names in the page's language: the remove, dismiss, sort and splitter buttons and the hold hints follow the nearest `lang`. English and Italian are built in, and `defineStrings(lang, words)` adds a language or changes words. Labels the page sets still win.

### Fixed

- `skin` and `overlay` can be set as properties, as React 19 and Vue do: they reflect to the attributes (they had getters only, so React threw and Vue warned and dropped them).
- A click on a sortable header's arrow sorts the table (the arrow was over the header's sort button).
- With reduced motion, a held button no longer shakes while it charges, a finished hold sends no shock, and a refused tap no longer shakes.
- `data-mode` is cleared when a stage falls back to plain HTML.
- `useLoomDiscard` (React) and Vue's `discard` pass `{ exit }` on to the stage.
- A click is never lost while a stage starts. Until its compositor is compiled, the content stays the page's (shown and clickable). It moves into the canvas only when the first frame can follow at once, never under a press in progress, and until that frame a click on the canvas goes to the element under it. The boot sweep no longer swallows clicks below its line. On a software GPU this window had lasted seconds, with the stage blank and every click lost.
- A stage sized by its content (a flex item, an inline block) keeps its content's width. Its canvas's percentage width used to resolve from the canvas's own aspect ratio, which squeezed the content.
- An overlay born in a closed dialog opens on a picture of its own size. It used to start its opening on the canvas of the closed dialog (no size), drawing a few stretched frames. Now the canvas takes the overlay's size when the dialog opens, and the opening waits for a frame at that size. An overlay with no width of its own is as wide as its content (a dialog shrinks to fit it), since the content, inside the canvas, no longer gives it one.
- The reticle stays inside its stage. Around a control at the stage's edge (a link of a bar as tall as the stage) its brackets were cut by the canvas; they are now pulled in. Controls away from the edges are unchanged.
- A remove button with content of its own (the page's icon) no longer gets the drawn cross on top of it.
- A number field with `step="any"` steps. The browser's `stepUp()` throws on a field without an allowed step, so its arrow keys, wheel and step buttons did nothing. Such a field now steps by amounts in its own units: `data-step` on a button is the amount, `data-step-by` on the field is the arrow-key and wheel amount (1 by default), and the value lands on that amount's grid, within `min` and `max`, without floating-point noise. Fields with a numeric `step` step as before.
- A stage that changes height no longer flickers. Closing a `<details>` that made the stage shorter showed, for a few frames, the old picture squashed into the new height (and, on the polyfill, the text twice): the canvas now takes its new size before the frame is drawn, a picture of the old size keeps its scale until one of the new size arrives, and the disclosure waits for that picture.
