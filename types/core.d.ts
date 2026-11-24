// Types of dom-loom/core: the stage, skins, behaviours, primitives' registry and blends.

export type Rect = [x: number, y: number, width: number, height: number];

export interface TransitionOptions {
  /** Cut only this region (an element or a list of them), measured before and after the update. */
  scope?: Element | Element[] | null;
  /** 1: the blade runs left to right; -1: right to left. */
  direction?: 1 | -1;
  /** Elements that fly from where they were to where they are after the update. */
  morph?: Iterable<Element> | null;
  /** false: no blade, only the elements fly. */
  cut?: boolean;
  /** The skin's sound to play. */
  sound?: string | null;
  /** The name of a registered primitive with a `cut` capability, drawn in place of the blade. */
  style?: string | null;
  /** The name of a registered exit style for the removed elements of `morph` ('shatter', with dom-loom/shatter); they crumble by default. */
  exit?: string | null;
}

export interface DiscardOptions {
  /** 'shatter' (with dom-loom/shatter): the element breaks into shards instead of crumbling. */
  exit?: string | null;
}

/** A grid of displacements in CSS px over the whole canvas, written by behaviours. */
export interface DisplacementField {
  readonly cols: number;
  readonly rows: number;
  /** cols * rows vec2 (x, y), row by row. */
  readonly data: Float32Array;
  /** false: the shader ignores the field. */
  active: boolean;
  /** Call after writing: uploads the grid and wakes the stage. */
  changed(): void;
}

export declare class LoomStage extends HTMLElement {
  /** Resolves with 'webgpu' once the compositor draws the stage, or 'dom'. */
  readonly ready: Promise<'webgpu' | 'dom'>;
  readonly gpu: boolean;
  /** A stage in a dialog or a popover (the `overlay` attribute): transparent around its panel. */
  get overlay(): boolean;
  /** Sets the `overlay` attribute: true or '' for a line of light, an edge to open from, false or null to remove it. */
  set overlay(value: boolean | '' | 'center' | 'left' | 'right' | 'top' | 'bottom' | null);
  readonly reduced: boolean;
  /** The element that holds the stage's content. */
  readonly source: HTMLElement;
  /** The skin that draws the stage (its `skin` attribute, or the default one). */
  get skin(): Skin | null;
  /** Sets the `skin` attribute (a skin or its name; null for the default). */
  set skin(name: string | Skin | null);
  /** A displacement field for behaviours to write (inactive until a behaviour sets `active`). */
  readonly field: DisplacementField;
  /** Like document.startViewTransition(update), drawn by the compositor and live while it plays. */
  transition(update?: () => unknown, options?: TransitionOptions): Promise<void>;
  /** Removes an element with motion; `update` removes it (default: el.remove()). */
  discard(el: Element, update?: () => unknown, options?: DiscardOptions): Promise<void>;
  /** Has an element that was just added assemble block by block. */
  reveal(el: Element): void;
  /** The point of the live content shown at a visible point of the stage (CSS px), null over no element. */
  mapPoint(point: { x: number; y: number }): { x: number; y: number } | null;
  /** Where an element is drawn inside the stage, in CSS px. */
  rectOf(el: Element): Rect;
  /** The instance of a registered behaviour. */
  behavior(name: string): unknown;
  /** Asks for frames until every behaviour rests. */
  wake(): void;

  // For behaviours (defineBehavior): what the built-in ones use.
  /** Adds a listener on the stage that is removed with it. */
  listen(type: string, listener: (event: any) => void, options?: AddEventListenerOptions): void;
  /** Adds a listener on another target that is removed with the stage. */
  listenOn(target: EventTarget, type: string, listener: (event: any) => void, options?: AddEventListenerOptions): void;
  /** Adds a listener on the window that is removed with the stage (the end of a gesture may happen outside it). */
  listenGlobal(type: string, listener: (event: any) => void, options?: AddEventListenerOptions): void;
  /** Whether an element of the stage is drawn: connected, rendered, not visibility:hidden. */
  visible(el: Element | null | undefined): boolean;
  /** A pointer event's point as the user sees it, in the canvas's CSS pixels. */
  pointOf(event: { clientX: number; clientY: number }): [x: number, y: number];
  /** Has the skin draw one state of a control into the scene. */
  draw(name: string, scene: SceneLike, state: Record<string, any>): void;
  /** Plays one of the skin's sounds (with the `sound` attribute, after a gesture). */
  play(name: string, ...args: unknown[]): void;
  /** A short vibration (with the `haptics` attribute, where the device has it). */
  buzz(ms: number): void;
  /** Clicks a control as the user would, past the hold guard. */
  activate(el: HTMLElement): void;
}

export interface DrawContext {
  colors: Record<string, [number, number, number]>;
  now: number;
  reduced: boolean;
  whole: Rect;
  durations: Record<string, number>;
  stage: LoomStage;
}

export interface SceneLike {
  push(kind: number, rect: ArrayLike<number>, p?: ArrayLike<number>, q?: ArrayLike<number>, h1?: number, h2?: number, h3?: number): void;
}

export type DrawHook = (scene: SceneLike, state: Record<string, any>, ctx: DrawContext) => void;

export interface SkinDefinition {
  name: string;
  /** Colour name -> [custom property, fallback]. A function fallback reads the page around the stage and returns a CSS colour. */
  tokens?: Record<string, [string, string | ((stage: HTMLElement) => string)]>;
  /** Which tokens the compositor uses for the cut's blade, its rim light, the panel and empty space. */
  roles?: Partial<Record<'hot' | 'rim' | 'bg' | 'void', string>>;
  draw?: Record<string, DrawHook>;
  sounds?: Record<string, (...args: any[]) => void>;
  shader?: Partial<Record<'scanlines' | 'chroma' | 'crumble' | 'hatch', number>>;
  transition?: Partial<Record<'ms' | 'scopedMs' | 'band' | 'slant', number>>;
  boot?: { ms: number } | null;
  durations?: Partial<Record<string, number>>;
  disclosure?: { crumble?: number };
  /** The native parts the hooks paint instead, hidden on the GPU path (default: all three). */
  draws?: Array<'focus' | 'thumbs' | 'gauges'>;
  /** hover: false keeps the reticle on keyboard focus only. */
  reticle?: { hover?: boolean };
}

export type Skin = Readonly<Required<SkinDefinition>>;

export declare const DEFAULT_SKIN: 'holo';
export declare function defineSkin(skin: SkinDefinition): Skin;
export declare function extendSkin(name: string, draw: Record<string, DrawHook>, sounds?: Record<string, (...args: any[]) => void> | null): void;
export declare function getSkin(name?: string | null): Skin | null;
export declare function skinNames(): string[];
export declare const holo: Skin;

export declare function defineBehavior(name: string, Class: new (stage: LoomStage) => {
  step(now: number, dt: number): boolean;
  emit(scene: SceneLike, now: number): void;
  sync?(): void;
  mutated?(records: MutationRecord[]): void;
}, order?: number): void;

export interface PrimitiveDefinition {
  kind: number;
  name: string;
  functions?: string;
  offset?: { wgsl: string; js(x: number, y: number, items: Float32Array, base: number, out: { x: number; y: number }, ctx: { uniforms: Float32Array | null; field: Float32Array | null }): void; whole?: boolean };
  /** transition: true draws it over a transition too (over the cut and the ghosts). */
  picture?: { name: string; order: number; transition?: boolean; wgsl: string; js(x: number, y: number, items: Float32Array, base: number): { x: number; y: number; final?: boolean } | null | undefined };
  light?: { wgsl: string };
  /** Works on the finished pixel; js returns false where the pixel shows nothing. */
  post?: { wgsl: string; js?(x: number, y: number, items: Float32Array, base: number): boolean };
  /** A style for stage.transition(..., { style: name }): js returns null where the OLD page shows, undefined where the live one does. */
  cut?: {
    wgsl: string;
    fn: string;
    js(x: number, y: number, scope: [number, number, number, number], s: number, front: number, dir: 1 | -1, uniforms: Float32Array): null | undefined;
    /** Scales the skin's transition time for this style (default 1). */
    pace?: number;
  };
  /** A way out for the elements a transition removes, chosen with { exit: name }. */
  exit?: {
    name: string;
    ms: number;
    /** The item that shows a removed element of `rect`, `elapsed` ms after it left; null once it is gone. h holds up to three header values. */
    item(rect: Rect, elapsed: number, options: { seed: number; origin: [number, number] | null; whole: Rect }): { rect: ArrayLike<number>; p: ArrayLike<number>; q: ArrayLike<number>; h: [number?, number?, number?] } | null;
  };
}
export declare function definePrimitive(def: PrimitiveDefinition): number;

/** Blends of paint primitives: PILL takes all five; TONE takes BEHIND, OVER, INK and INVERT; FOCUS takes OVER and INK. */
export declare const ADD: 0;
export declare const BEHIND: 1;
export declare const OVER: 2;
/** Ink on paper: multiplies, so black stays black and white paper takes the colour. */
export declare const INK: 3;
/** Reverses the picture: ink turns paper-white and paper turns ink (the colour is unused). */
export declare const INVERT: 4;


export declare function audio(): AudioContext | null;
export declare function output(): AudioNode;
export declare function tone(options: { type?: OscillatorType; from: number; to?: number; duration: number; gain?: number; attack?: number; delay?: number }): void;
export declare function noise(options: { duration: number; gain?: number; filter?: BiquadFilterType; from?: number; to?: number; q?: number; delay?: number }): void;

export interface LoomSortDetail { column: number; direction: 'ascending' | 'descending'; header: HTMLTableCellElement }

declare global {
  interface HTMLElementTagNameMap {
    'loom-stage': LoomStage;
  }
  interface HTMLElementEventMap {
    'loom-fallback': CustomEvent<{ error: unknown }>;
    'loom-sort': CustomEvent<LoomSortDetail>;
    'loom-sorted': CustomEvent<LoomSortDetail & { rows: HTMLTableRowElement[] }>;
    'loom-remove': CustomEvent<null>;
  }
}
