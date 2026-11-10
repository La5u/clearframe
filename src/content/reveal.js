// Owns the hover reveal: while the pointer rests on a reworded match, its
// original wording is written back into the page. Also counts these writes
// per text node, so the mutation observer can tell them from page edits.
let hoverReveal = null;
const internalMutationCounts = new WeakMap();

function countInternalMutation(node) {
  internalMutationCounts.set(node, (internalMutationCounts.get(node) || 0) + 1);
}

// True when a characterData mutation on this node was one of our writes.
/** @param {Text} node */
export function consumeInternalMutation(node) {
  const remaining = internalMutationCounts.get(node) || 0;
  if (remaining > 1) internalMutationCounts.set(node, remaining - 1);
  else if (remaining === 1) internalMutationCounts.delete(node);
  return remaining > 0;
}

export function restoreHoverReveal() {
  if (!hoverReveal) return;
  const { record, node, revealedText } = hoverReveal;
  if (node.nodeValue === revealedText) {
    countInternalMutation(node);
    node.replaceData(record.startOffset, record.sourceText.length, record.replacementText);
    record.range.setStart(node, record.startOffset); record.range.setEnd(node, record.endOffset);
  }
  hoverReveal = null;
}

// For use while the observer is disconnected: the restore's mutation will
// never be observed, so drop its pending count or a later real edit would be
// ignored.
export function restoreHoverRevealUnobserved() {
  const revealedNode = hoverReveal?.node;
  restoreHoverReveal();
  if (revealedNode) internalMutationCounts.delete(revealedNode);
}

export function revealOriginalText(record) {
  if (record.action !== 'replaced' || !record.sourceText || !record.replacementText || hoverReveal?.record === record) return;
  restoreHoverReveal();
  const display = record.node.nodeValue || '';
  if (display.slice(record.startOffset, record.endOffset) !== record.replacementText) return;
  const revealedText = display.slice(0, record.startOffset) + record.sourceText + display.slice(record.endOffset);
  hoverReveal = { record, node: record.node, revealedText };
  countInternalMutation(record.node);
  record.node.replaceData(record.startOffset, record.endOffset - record.startOffset, record.sourceText);
  record.range.setStart(record.node, record.startOffset); record.range.setEnd(record.node, record.startOffset + record.sourceText.length);
}

export function isPointInsideHoverReveal(x, y) {
  return !!hoverReveal && [...hoverReveal.record.range.getClientRects()].some(rect =>
    x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2,
  );
}
