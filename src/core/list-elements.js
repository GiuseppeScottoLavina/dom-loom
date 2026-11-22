// Listboxes and options created by DomLoom never contain other controls. Track
// actual nodes so framework-owned insertions still reach component discovery.
const generated = new WeakSet();

export function createListElement(tag) {
  const element = document.createElement(tag);
  generated.add(element);
  return element;
}

export function isListMutation(record) {
  if (record.type === 'attributes') return generated.has(record.target)
    && (record.attributeName === 'aria-selected' || record.attributeName === 'hidden');
  if (record.type !== 'childList' || !generated.has(record.target)) return false;
  for (const nodes of [record.addedNodes, record.removedNodes]) {
    for (const node of nodes) {
      if (node.nodeType === 1 && (!generated.has(node) || node.childElementCount)) return false;
    }
  }
  return true;
}
