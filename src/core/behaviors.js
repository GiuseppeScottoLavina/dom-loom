// The registry of behaviours: what each kind of control does. A component module
// registers its behaviour; every stage on the page (also one already running)
// creates one instance of each. `order` is paint order: lower draws first.

const registry = new Map();

export function defineBehavior(name, Class, order = 50) {
  if (registry.get(name)?.Class === Class) return;
  registry.set(name, { Class, order });
  globalThis.document?.dispatchEvent(new CustomEvent('loom-behaviors'));
}

/** [name, { Class, order }] in paint order. */
export function behaviorList() {
  return [...registry.entries()].sort((a, b) => a[1].order - b[1].order);
}
