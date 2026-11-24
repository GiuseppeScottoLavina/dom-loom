import type { App, Ref } from 'vue';
import type { DiscardOptions, LoomStage, TransitionOptions } from './index.js';

export declare function isCustomElement(tag: string): boolean;
export declare const DomLoom: { install(app: App): void };
export declare function useLoomStage(stage: Ref<LoomStage | null | undefined>): {
  transition(update: () => unknown, options?: TransitionOptions): Promise<void>;
  discard(el: Element, update: () => unknown, options?: DiscardOptions): Promise<void>;
};
