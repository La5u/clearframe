// Owns the analysis results per text node: analyzes a node and writes its
// display text, restores original text, and keeps the summary the popup and
// badge show (term counts, navigation through matches).
import { createAnalyzer } from '../core/analyze.js';
import { recoverOriginalText } from '../core/restore.js';
import { getSettings } from './settings.js';
import { PAGE_CONTEXT, getElementContext, isLikelyHeadline } from './scanner.js';
import { getLabel } from './labels.js';

/** @typedef {{node: Text, originalText: string, displayedText: string, records: any[]}} NodeResult */

const { analyze } = createAnalyzer({ index: ClearFrame.index });
// A NodeResult owns all retained state for one analyzed text node.
/** @type {Map<Text, NodeResult>} */
const nodeResults = new Map();
// Results for nodes the page detached; kept so reattached nodes can be restored.
/** @type {WeakMap<Text, NodeResult>} */
const detachedResults = new WeakMap();
let totalMatches = 0;
/** @type {Map<string, {effects: Set<string>, wordings: Map<string, number>}>} Per device (technical term): its effect(s) and how often each wording was found. Two labels can share a term name with different effects. */
let deviceStats = new Map();
const navigationIndexes = new Map();
let lastBadgeCount = -1;

// Callers pass only connected, processable nodes. Returns the stored result,
// if the node has matches or was rewritten.
/** @param {Text} node */
export function processTextNode(node) {
  const originalText = node.nodeValue || '';
  if (originalText.trim().length < 2) return;
  const context = getElementContext(node.parentElement);
  const { conversational, preserveText, capsLabel } = context;
  const headline = isLikelyHeadline(context, originalText);
  const plan = analyze(originalText, { headline, conversational, preserveText, capsLabel, pageContext: PAGE_CONTEXT }, getSettings());
  const displayedNodeText = plan.displayText;
  if (displayedNodeText !== originalText) node.nodeValue = displayedNodeText;

  /** @type {NodeResult} */
  const result = { node, originalText, displayedText: displayedNodeText, records: [] };
  for (const entry of plan.entries) {
    const { start, end } = entry;
    const range = document.createRange();
    range.setStart(node, start); range.setEnd(node, end);
    result.records.push({
      range, node, startOffset: start, endOffset: end,
      terms: entry.terms,
      type: entry.term.type, action: entry.action, label: getLabel(entry.term),
      wording: entry.wording, sourceText: entry.sourceText, replacementText: entry.replacementText, highlightName: entry.highlightName,
      matchContext: { headline, conversational, preserveText, pageContext: PAGE_CONTEXT },
    });
  }
  if (result.records.length || displayedNodeText !== originalText) {
    nodeResults.set(node, result);
    return result;
  }
}

function restoreOriginalText(result) {
  const current = result.node.nodeValue || '';
  const original = recoverOriginalText(result, current);
  if (original !== null && original !== current) result.node.nodeValue = original;
}

export function restoreAllText() {
  for (const result of nodeResults.values()) {
    if (result.node.isConnected && result.displayedText !== result.originalText) restoreOriginalText(result);
  }
}

export function clearResults() {
  nodeResults.clear();
  navigationIndexes.clear();
  totalMatches = 0;
  deviceStats = new Map();
}

// Moves results of nodes the page removed aside and returns them.
export function detachDisconnectedResults() {
  const detached = [];
  for (const node of nodeResults.keys()) {
    if (!node.isConnected) {
      const result = nodeResults.get(node);
      if (result) {
        detachedResults.set(node, result); detached.push(result);
      }
      nodeResults.delete(node);
    }
  }
  return detached;
}

// Drops a node's result before re-analysis and returns the live one, if any.
/** @param {Text} node */
export function forgetNode(node) {
  const result = nodeResults.get(node);
  // Re-derive the original before re-analysis so rewritten wording never
  // becomes the new "original" after the page edits this node.
  const previous = result || detachedResults.get(node);
  if (previous && node.isConnected) restoreOriginalText(previous);
  detachedResults.delete(node);
  nodeResults.delete(node);
  return result;
}

export function hasResults() {
  return nodeResults.size > 0;
}

/** @param {Node} node */
export function getNodeRecords(node) {
  return nodeResults.get(/** @type {Text} */ (node))?.records || [];
}

export function getAllRecords() {
  return [...nodeResults.values()].flatMap(result => result.records);
}

// "collateral\ndamage" and "collateral damage" are one wording.
const wordingKey = wording => wording.replace(/\s+/g, ' ');

export function rebuildSummary() {
  totalMatches = 0;
  deviceStats = new Map();
  for (const result of nodeResults.values()) {
    for (const { label, wording } of result.records) {
      let device = deviceStats.get(label.term);
      if (!device) deviceStats.set(label.term, device = { effects: new Set(), wordings: new Map() });
      if (label.effect) device.effects.add(label.effect);
      const key = wordingKey(wording);
      device.wordings.set(key, (device.wordings.get(key) || 0) + 1); totalMatches++;
    }
  }
}

export function getTotalMatches() {
  return totalMatches;
}

export function updateBadge() {
  if (totalMatches === lastBadgeCount) return;
  lastBadgeCount = totalMatches;
  chrome.runtime.sendMessage({ type: 'COUNT', count: totalMatches }).catch(() => {});
}

// The popup's list: devices by frequency, each with its effect and wordings.
export function getDeviceGroups() {
  const byCount = (a, b) => b.count - a.count || a.term.localeCompare(b.term);
  return [...deviceStats].map(([term, { effects, wordings }]) => {
    const list = [...wordings].map(([wording, count]) => ({ term: wording, count })).sort(byCount);
    return { term, effects: [...effects], count: list.reduce((sum, item) => sum + item.count, 0), wordings: list };
  }).sort(byCount);
}

// Each call steps to the next match of this wording under this device, wrapping around.
export function getNextRecord(wording, device) {
  const records = getAllRecords().filter(record => record.label.term === device && wordingKey(record.wording) === wording && record.node.isConnected);
  if (!records.length) return null;
  const key = `${device}\n${wording}`;
  const nextIndex = ((navigationIndexes.get(key) ?? -1) + 1) % records.length;
  navigationIndexes.set(key, nextIndex);
  return records[nextIndex];
}
