import type { ForwardRefExoticComponent, HTMLAttributes, ReactNode, RefAttributes, RefObject } from 'react';
import type { DiscardOptions, LoomStage as LoomStageElement, TransitionOptions } from './index.js';

export interface LoomStageProps extends HTMLAttributes<LoomStageElement> {
  skin?: string;
  sound?: boolean;
  haptics?: boolean;
  static?: boolean;
  loading?: 'eager' | 'lazy';
  /** No panel (background, padding, frame): the page shows through. For a stage around a layout element, or a page's toasts. */
  bare?: boolean;
  /** The parent sets the stage's height (a stretched flex or grid item), and the content takes all of it. */
  fill?: boolean;
  /** A stage inside a dialog or a popover: transparent; the value is the edge it opens from. */
  overlay?: boolean | 'center' | 'left' | 'right' | 'top' | 'bottom' | 'zoom';
  onFallback?: (error: unknown) => void;
  onReady?: (renderer: 'webgpu' | 'dom') => void;
  children?: ReactNode;
}

export declare const LoomStage: ForwardRefExoticComponent<LoomStageProps & RefAttributes<LoomStageElement>>;
export declare function useLoomEvent<E extends Event = CustomEvent>(ref: RefObject<LoomStageElement | null>, type: string, handler: ((event: E) => void) | null | undefined): void;
export declare function useLoomTransition(ref: RefObject<LoomStageElement | null>): (update: () => void, options?: TransitionOptions) => Promise<void>;
export declare function useLoomDiscard(ref: RefObject<LoomStageElement | null>): (el: Element, update: () => void, options?: DiscardOptions) => Promise<void>;

/** The attributes DomLoom reads on ordinary elements. In JSX, write them as strings: sortable="". */
interface DomLoomAttributes {
  hold?: string;
  sortable?: '' | 'sortable';
  nosort?: '' | 'nosort';
  /** 'row': removable, but not drawn as a chip. */
  removable?: '' | 'removable' | 'row';
  rating?: '' | 'rating';
  interval?: '' | 'interval';
  /** 'viewport': a page's toasts, at the bottom of the viewport (in a bare stage of their own). */
  toasts?: '' | 'toasts' | 'viewport';
  dropzone?: '' | 'dropzone';
  badge?: '' | 'badge';
  tilt?: '' | 'tilt';
  carousel?: '' | 'carousel';
  loupe?: string;
  'loupe-size'?: string;
  lit?: string;
  fluid?: string;
  exit?: 'shatter' | string;
  split?: '' | 'split';
  ring?: '' | 'ring';
  /** 'focus': the reticle follows keyboard focus here, not the pointer. */
  reticle?: 'focus';
  segments?: number | string;
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLAttributes<T> extends DomLoomAttributes {}
}
