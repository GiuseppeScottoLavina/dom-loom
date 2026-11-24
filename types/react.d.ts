import type { ForwardRefExoticComponent, HTMLAttributes, ReactNode, RefAttributes, RefObject } from 'react';
import type { DiscardOptions, LoomStage as LoomStageElement, TransitionOptions } from './index.js';

export interface LoomStageProps extends HTMLAttributes<LoomStageElement> {
  skin?: string;
  sound?: boolean;
  haptics?: boolean;
  static?: boolean;
  loading?: 'eager' | 'lazy';
  /** A stage inside a dialog or a popover: transparent; the value is the edge it opens from. */
  overlay?: boolean | 'center' | 'left' | 'right' | 'top' | 'bottom';
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
  removable?: '' | 'removable';
  rating?: '' | 'rating';
  interval?: '' | 'interval';
  toasts?: '' | 'toasts';
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
  segments?: number | string;
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLAttributes<T> extends DomLoomAttributes {}
}
