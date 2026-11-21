// Loads the polyfill and its effects host once per page, only when a stage asks for it.
let pending = null;

export function loadRuntime() {
  pending ??= (async () => {
    const [core, effects] = await Promise.all([
      import('@giuseppe-scotto-lavina/html-in-canvas-polyfill'),
      import('@giuseppe-scotto-lavina/html-in-canvas-polyfill/effects'),
    ]);
    const installed = core.getInstalled?.() ?? core.install();
    const api = effects.installEffects();
    return {
      api,
      mode: installed?.mode ?? 'unknown',
      definePlugin: effects.definePlugin,
      NO_TARGET: effects.NO_TARGET,
    };
  })();
  return pending;
}
