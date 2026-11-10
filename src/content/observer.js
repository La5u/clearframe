// Runs analysis passes: the full pass over the page, and the debounced pass
// over what a MutationObserver saw the page change. Owns the observer, the
// pending-change sets and the pass timer.
import { clearElementContexts, getTextTargets, isProcessableNode } from './scanner.js';
import { clearResults, detachDisconnectedResults, forgetNode, getAllRecords, getTotalMatches, processTextNode, rebuildSummary, restoreAllText, updateBadge } from './store.js';
import { addResultHighlights, clearHighlightPresentation, removeResultHighlights, renderHighlights, syncHighlightStyles } from './highlights.js';
import { consumeInternalMutation, restoreHoverRevealUnobserved } from './reveal.js';
import { hideTooltip } from './tooltip.js';

const CLEARFRAME_IDS = ['cf-tooltip', 'cf-suggestion', 'cf-highlight-styles'];
const OBSERVE_OPTIONS = { childList: true, subtree: true, characterData: true };
let pageObserver = null;
let analysisTimer = 0;
// Text nodes the page edited, and subtrees it added; walked once per pass.
const pendingMutationNodes = new Set();
const pendingMutationRoots = new Set();
let pendingDisconnectedCleanup = false;

function resetAnalysis() {
  hideTooltip(true);
  restoreAllText();
  clearHighlightPresentation();
  clearResults();
}

function analyzeTargets(root) {
  resetAnalysis();
  clearElementContexts();
  const targets = getTextTargets(root);
  for (const node of targets) if (node.isConnected) processTextNode(node);
  clearElementContexts();
  rebuildSummary();
  renderHighlights(getAllRecords());
  updateBadge();
  return getTotalMatches();
}

export function analyzePage() {
  if (!document.body) return 0;
  if (analysisTimer) {
    window.clearTimeout(analysisTimer);
    analysisTimer = 0;
  }
  pendingMutationNodes.clear();
  pendingMutationRoots.clear();
  pendingDisconnectedCleanup = false;
  pageObserver?.disconnect();
  const count = analyzeTargets(document.body);
  pageObserver?.takeRecords();
  pageObserver?.observe(document.body, OBSERVE_OPTIONS);
  return count;
}

function analyzeMutations() {
  analysisTimer = 0;
  pageObserver?.disconnect();
  let highlightNamesChanged = false;
  if (pendingDisconnectedCleanup) {
    for (const result of detachDisconnectedResults()) {
      const removedNames = removeResultHighlights(result);
      highlightNamesChanged ||= removedNames;
    }
  }
  restoreHoverRevealUnobserved();
  clearElementContexts();
  for (const root of pendingMutationRoots) {
    if (root instanceof Text) pendingMutationNodes.add(root);
    else if (root.isConnected) for (const node of getTextTargets(root)) pendingMutationNodes.add(node);
  }
  pendingMutationRoots.clear();
  for (const node of pendingMutationNodes) {
    const removedNames = removeResultHighlights(forgetNode(node));
    highlightNamesChanged ||= removedNames;
    if (!node.isConnected || !isProcessableNode(node)) continue;
    const addedNames = addResultHighlights(processTextNode(node));
    highlightNamesChanged ||= addedNames;
  }
  pendingMutationNodes.clear();
  pendingDisconnectedCleanup = false;
  clearElementContexts();
  rebuildSummary();
  if (highlightNamesChanged) syncHighlightStyles();
  updateBadge();
  pageObserver?.takeRecords();
  pageObserver?.observe(document.body, OBSERVE_OPTIONS);
}

function isClearFrameNode(node) {
  return CLEARFRAME_IDS.some(id => document.getElementById(id)?.contains(node));
}

// Cheap test that skips empty and whitespace-only insertions and removals,
// and ClearFrame's own elements.
function mayHoldPageText(node) {
  if (node instanceof Text) return (node.nodeValue || '').trim().length >= 2;
  return node instanceof Element && !!node.firstChild && !CLEARFRAME_IDS.includes(node.id);
}

// Runs inside the observer callback for every batch, so it only records what
// changed; added subtrees are walked once, in the debounced analyzeMutations.
function scheduleMutationAnalysis(mutations) {
  for (const mutation of mutations) {
    const target = mutation.target;
    if (mutation.type === 'characterData') {
      if (!(target instanceof Text) || isClearFrameNode(target)) continue;
      if (!consumeInternalMutation(target)) pendingMutationNodes.add(target);
      continue;
    }
    const added = [...mutation.addedNodes].filter(mayHoldPageText);
    const removed = [...mutation.removedNodes].some(mayHoldPageText);
    if ((!added.length && !removed) || isClearFrameNode(target)) continue;
    pendingDisconnectedCleanup ||= removed;
    for (const node of added) pendingMutationRoots.add(node);
  }
  if (!pendingMutationNodes.size && !pendingMutationRoots.size && !pendingDisconnectedCleanup) return;
  if (!analysisTimer) analysisTimer = window.setTimeout(analyzeMutations, 120);
}

// Creates the page observer and runs the first full pass.
export function startObserving() {
  pageObserver = new MutationObserver(mutations => {
    scheduleMutationAnalysis(mutations);
  });
  analyzePage();
}
