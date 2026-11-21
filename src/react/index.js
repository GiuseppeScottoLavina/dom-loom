// domloom/react: <LoomStage> for React, and hooks that make DomLoom's motion and
// React's state agree. A transition keeps a picture of the page before `update`,
// so the update must be in the DOM when it returns: the hooks flush it (flushSync).
//
// Components are imported as usual: import 'domloom/tabs', or import 'domloom'.
import { createElement, forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { flushSync } from 'react-dom';
import '../core/index.js';

const flag = (on) => (on ? '' : undefined);

/**
 * <loom-stage> as a React component. Boolean props become boolean attributes; the
 * ref is the element (stage.transition, stage.discard, stage.ready…).
 */
export const LoomStage = forwardRef(function LoomStage(
  { skin, sound, haptics, static: still, onFallback, onReady, children, ...rest },
  ref,
) {
  const stage = useRef(null);
  useImperativeHandle(ref, () => stage.current, []);
  useLoomEvent(stage, 'loom-fallback', onFallback ? (event) => onFallback(event.detail.error) : null);
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    stage.current?.ready.then((renderer) => ready.current?.(renderer));
  }, []);
  return createElement(
    'loom-stage',
    { ref: stage, skin, sound: flag(sound), haptics: flag(haptics), static: flag(still), ...rest },
    children,
  );
});

/** Listens to a DOM event of the stage (loom-sort, loom-sorted, loom-remove, …). */
export function useLoomEvent(ref, type, handler) {
  const saved = useRef(handler);
  saved.current = handler;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const listener = (event) => saved.current?.(event);
    el.addEventListener(type, listener);
    return () => el.removeEventListener(type, listener);
  }, [ref, type]);
}

/** stage.transition with a React state update: (update, options) => Promise. */
export function useLoomTransition(ref) {
  return useCallback((update, options) => {
    const stage = ref.current;
    if (!stage) {
      flushSync(update);
      return Promise.resolve();
    }
    return stage.transition(() => flushSync(update), options);
  }, [ref]);
}

/** stage.discard with a React state update that takes the element away: (el, update) => Promise. */
export function useLoomDiscard(ref) {
  return useCallback((el, update) => {
    const stage = ref.current;
    if (!stage) {
      flushSync(update);
      return Promise.resolve();
    }
    return stage.discard(el, () => flushSync(update));
  }, [ref]);
}
