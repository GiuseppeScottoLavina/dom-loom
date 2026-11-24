# Changelog

All notable changes to DomLoom. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## 0.3.0 - 2026-11-24

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

### Fixed

- `skin` and `overlay` can be set as properties, as React 19 and Vue do: they reflect to the attributes (they had getters only, so React threw and Vue warned and dropped them).
- A click on a sortable header's arrow sorts the table (the arrow was over the header's sort button).
- With reduced motion, a held button no longer shakes while it charges, a finished hold sends no shock, and a refused tap no longer shakes.
- `data-mode` is cleared when a stage falls back to plain HTML.
- `useLoomDiscard` (React) and Vue's `discard` pass `{ exit }` on to the stage.
- A stage that changes height no longer flickers. Closing a `<details>` that made the stage shorter showed, for a few frames, the old picture squashed into the new height (and, on the polyfill, the text twice): the canvas now takes its new size before the frame is drawn, a picture of the old size keeps its scale until one of the new size arrives, and the disclosure waits for that picture.
