// The registry of behaviours: what each kind of control does. A component module
// registers its behaviour; every stage on the page (also one already running)
// creates one instance of each. `order` is paint order: lower draws first.

const registry = new Map();

let sorted;

function register(name, Class, order, component) {
  if (registry.get(name)?.Class === Class) return;
  const definition = { Class, order, component };
  registry.set(name, definition);
  sorted = null;
  if (globalThis.document) {
    const index = behaviorList().findIndex(([key]) => key === name);
    document.dispatchEvent(new CustomEvent('loom-behaviors', { detail: { name, definition, index } }));
  }
}

export function defineBehavior(name, Class, order = 50) {
  register(name, Class, order, false);
}

/** Built-in components discover their controls in their constructors. */
export function defineComponent(name, Class, order) {
  register(name, Class, order, true);
}

/** [name, definition] in paint order. */
export function behaviorList() {
  return sorted ??= [...registry.entries()].sort((a, b) => a[1].order - b[1].order);
}
