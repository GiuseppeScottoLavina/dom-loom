// domloom/vue: the plugin that tells Vue <loom-stage> is a custom element, and a
// composable for transitions with Vue's state. A transition keeps a picture of the
// page before `update`, so the update must be rendered when it ends: it waits for
// Vue's next tick.
//
// Components are imported as usual: import 'domloom/tabs', or import 'domloom'.
// With single-file components, give the compiler the same test:
//   vue({ template: { compilerOptions: { isCustomElement } } })
import { nextTick } from 'vue';
import '../core/index.js';

export const isCustomElement = (tag) => tag === 'loom-stage';

export const DomLoom = {
  install(app) {
    const previous = app.config.compilerOptions.isCustomElement;
    app.config.compilerOptions.isCustomElement = (tag) => isCustomElement(tag) || Boolean(previous?.(tag));
  },
};

/** For a template ref to a <loom-stage>: { transition(update, options), discard(el, update) }. */
export function useLoomStage(stageRef) {
  const rendered = (update) => async () => {
    await update();
    await nextTick();
  };
  return {
    transition(update, options) {
      const stage = stageRef.value;
      return stage ? stage.transition(rendered(update), options) : rendered(update)();
    },
    discard(el, update) {
      const stage = stageRef.value;
      return stage ? stage.discard(el, rendered(update)) : rendered(update)();
    },
  };
}
