// Loads the polyfill (only where it has to run) and its effects host, once per page,
// when a stage first asks for them. On a browser with its own HTML-in-Canvas the
// polyfill's core is never downloaded: the loader decides first.
let pending = null;

export function loadRuntime() {
  pending ??= (async () => {
    const [{ load }, effects] = await Promise.all([
      import('@giuseppe-scotto-lavina/html-in-canvas-polyfill/loader'),
      import('@giuseppe-scotto-lavina/html-in-canvas-polyfill/effects'),
    ]);
    const loaded = await load();
    if (loaded.status === 'error' || loaded.status === 'refused') {
      throw loaded.error ?? new Error(loaded.reason ?? `HTML-in-Canvas is not available (${loaded.status})`);
    }
    return {
      api: effects.installEffects(),
      mode: loaded.mode ?? loaded.status,
      definePlugin: effects.definePlugin,
      NO_TARGET: effects.NO_TARGET,
    };
  })().catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}

let device = null;
let requesting = null;

/**
 * The page's one GPUDevice, shared by every stage (one device per stage costs memory
 * and, on some GPUs, stability). Hosts call this again after a device loss: a new
 * device is requested then.
 */
export function sharedDevice() {
  if (device) return device;
  requesting ??= (async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter');
    const next = await adapter.requestDevice();
    next.lost.then(() => {
      if (device === next) device = null;
    });
    device = next;
    return next;
  })().finally(() => {
    requesting = null;
  });
  return requesting;
}
