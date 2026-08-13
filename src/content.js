'use strict';
import { buildMatcher, findMatches } from './core/matcher.js';
import { lowerAllCapsLongWords, matchReplacementCase } from './core/display-utils.js';
import { pluralizeWord, pastTenseWord, ingWord, adverbWord } from './core/stemmer.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings-utils.js';
import { chooseReplacementTerm, getReplacementSourceText, resolveMatchGroups } from './core/match-plan.js';
import { ALL_CAPS_TERM_ID, findAllCapsMatches } from './core/all-caps.js';
import { CONTEXTUAL_TERMS, classifyPageContext, findContextualMatches } from './core/contextual.js';
import { shouldKeepLexicalMatch } from './core/context-filter.js';

const { index, types: TYPE_MAP, categories: TYPE_CATEGORIES } = ClearFrame;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE']);
const SKIP_SELECTOR = 'nav,button,select,option,[role=navigation],[role=menu],[aria-hidden=true],#cf-tooltip,#cf-suggestion';
const HIGHLIGHT_PREFIX = 'clearframe-';
const ALL_CAPS_HIGHLIGHT_NAME = 'clearframe-all-caps-underline';
const MULTI_HIGHLIGHT_NAME = 'clearframe-multiple';
const SELECTED_HIGHLIGHT_NAME = 'clearframe-selected';
const TYPE_HIGHLIGHT_NAMES = Object.keys(TYPE_MAP).flatMap(type => [getHighlightName(type), getHighlightName(type, 'underline')]);
const SUPPORTS_HIGHLIGHTS = !!(globalThis.Highlight && globalThis.CSS?.highlights);
const COLOR_RGB = { yellow: '250, 204, 21', green: '74, 222, 128', gray: '209, 213, 219', red: '248, 113, 113', pink: '244, 114, 182', orange: '251, 146, 60', purple: '196, 128, 255', blue: '96, 165, 250', teal: '45, 212, 191', brown: '161, 98, 7' };
const UNDERLINE_RGB = { yellow: '202, 138, 4', green: '22, 163, 74', gray: '107, 114, 128', red: '220, 38, 38', pink: '219, 39, 119', orange: '234, 88, 12', purple: '147, 51, 234', blue: '37, 99, 235', teal: '20, 184, 166', brown: '120, 53, 15' };
const TYPE_INTENSITY = { absolute: 0.5, aggression: 0.75, 'all-caps': 0.5, authority: 0.65, clickbait: 0.85, colloquialism: 0.35, conflict: 0.65, derogatory: 0.95, distancing: 0.7, dysphemism: 0.8, euphemism: 0.75, exaggeration: 0.7, fear: 0.9, hype: 0.65, idiom: 0.35, loaded: 0.9, 'loaded-framing': 0.85, minimizing: 0.6, moral: 0.8, 'negative-framing': 0.75, passive: 0.7, repetition: 0.45, reveal: 0.3, 'rhetorical-question': 0.4, superlative: 0.65, uncertainty: 0.65, unsourced: 0.8 };
const RUNTIME_SHORTCUTS = { r: 'replaceTerms', x: 'removeTerms', f: 'feedbackEnabled' };
const ALL_CAPS_TERM = { phrase: 'caps emphasis', type: 'all-caps', neutral: 'Caps normalized.', stemType: '', regex: '', remove: false, hasNeutral: true };

let settings = normalizeSettings(DEFAULT_SETTINGS);
let matcher = null;
// A NodeResult owns all retained state for one analyzed text node.
/** @type {Map<Text, {node: Text, originalText: string, displayedText: string, records: any[]}>} */
const nodeResults = new Map();
let totalMatches = 0;
/** @type {Record<string, Record<string, number>>} */
let termStats = Object.create(null);
let activeHighlightNames = new Set();
const highlightSets = new Map();
let activeHover = null;
let pinnedTooltipRecord = null;
let hoverReveal = null;
let hoverFrame = 0;
let pendingHoverEvent = null;
let pageObserver = null;
let analysisTimer = 0;
const pendingMutationNodes = new Set();
let pendingDisconnectedCleanup = false;
const internalMutationCounts = new WeakMap();
const navigationIndexes = new Map();
const PAGE_CONTEXT = classifyPageContext(location.hostname);

function getSettingsKey(value) {
  return JSON.stringify({ replaceTerms: value.replaceTerms === true, removeTerms: value.removeTerms === true, monochrome: value.monochrome === true, feedbackEnabled: value.feedbackEnabled === true, types: value.types || {}, userTypeColors: value.userTypeColors || {} });
}

function loadSettings(rawSettings = {}, rawTypeColors = {}) {
  settings = normalizeSettings(rawSettings, rawTypeColors);
  matcher = buildMatcher(index, term => isEnabled(term.type));
}

function applySettings(rawSettings = {}, rawTypeColors = {}) {
  const previousKey = getSettingsKey(settings);
  loadSettings(rawSettings, rawTypeColors);
  if (!settings.feedbackEnabled) hideSuggestion();
  if (previousKey !== getSettingsKey(settings) && document.body) {
    analyzePage();
  }
}

function isEnabled(type) {
  return settings.types?.[type] !== false;
}

function getColor(type) {
  return settings.monochrome ? 'gray' : settings.userTypeColors?.[type] || TYPE_MAP[type] || 'gray';
}

function getCategory(type) {
  return TYPE_CATEGORIES?.[type] || 'General';
}

function getHighlightName(type, mode = 'highlight') {
  return HIGHLIGHT_PREFIX + String(type).replace(/[^a-z0-9-]/gi, '-') + (mode === 'underline' ? '-underline' : '');
}

function getTermById(id) {
  return index.termsById[id] || CONTEXTUAL_TERMS[id] || (id === ALL_CAPS_TERM_ID ? ALL_CAPS_TERM : null);
}

function applyStemmedReplacement(src, base, replacement, stemType) {
  const source = src.toLowerCase(), normalizedBase = base.toLowerCase();
  let next = replacement;
  if (stemType === 'noun' && source === pluralizeWord(normalizedBase)) {
    next = pluralizeWord(replacement);
  } else if (stemType === 'verb') {
    if (source === pluralizeWord(normalizedBase)) next = pluralizeWord(replacement);
    else if (source === pastTenseWord(normalizedBase)) next = pastTenseWord(replacement);
    else if (source === ingWord(normalizedBase)) next = ingWord(replacement);
  } else if (stemType === 'adjective' && source === adverbWord(normalizedBase)) {
    next = adverbWord(replacement);
  }
  return matchReplacementCase(src, next);
}

function getReplacementForTerm(term, src) {
  return term.phrase === ALL_CAPS_TERM.phrase
    ? lowerAllCapsLongWords(src)
    : applyStemmedReplacement(src, term.phrase, term.neutral, term.stemType || '');
}

function isProcessableNode(node) {
  const parent = node.parentElement;
  return !!parent && !parent.isContentEditable && !SKIP_TAGS.has(parent.tagName) && !parent.closest(SKIP_SELECTOR);
}

function isLikelyHeadline(parent, text) {
  if (parent?.closest('h1,h2,h3,[role=heading],[slot=title],a#video-title,[class*=headline],[class*=title]')) return true;
  if (PAGE_CONTEXT !== 'publication' || text.trim().length < 20) return false;
  const link = parent?.closest('a[href]');
  if (!link || link.closest('nav,footer,[role=navigation],[class*=share],[class*=comment]')) return false;
  return !!parent.closest('strong,b,[class*=pufftext],[data-headline]') || link.getAttribute('itemprop') === 'url';
}

function getTermAction(term) {
  if (term.remove && settings.removeTerms) return 'removed';
  if (settings.replaceTerms && term.hasNeutral) return 'replaced';
  return 'highlighted';
}

function getReplacementText(term, src, action) {
  if (action === 'removed') return '';
  if (action === 'replaced') return getReplacementForTerm(term, src);
  return src;
}

function getTermsForMatch(match) {
  return (match.termIds || [match.termId]).map(getTermById).filter(Boolean);
}

function getHighlightNameForEntry(term, action, terms) {
  if (action === 'removed') return null;
  if (terms.length > 1) return MULTI_HIGHLIGHT_NAME;
  if (action === 'highlighted') return getHighlightName(term.type);
  return term.phrase === ALL_CAPS_TERM.phrase ? ALL_CAPS_HIGHLIGHT_NAME : getHighlightName(term.type, 'underline');
}

function processText(text, context = {}) {
  const matches = findMatches(matcher, text, index.termsById, index.regexTerms || [], false,
    term => isEnabled(term.type),
    (termId, start, end) => shouldKeepLexicalMatch(getTermById(termId), text.slice(start, end), text, context));
  const allCaps = isEnabled(ALL_CAPS_TERM.type) ? findAllCapsMatches(text) : [];
  const contextual = findContextualMatches(text, context).filter(match => isEnabled(getTermById(match.termId)?.type));
  const combined = resolveMatchGroups([...matches, ...allCaps, ...contextual]);
  let cursor = 0, displayText = '';
  const entries = [];
  for (const match of combined) {
    const terms = getTermsForMatch(match);
    const term = chooseReplacementTerm(terms, getTermAction, ALL_CAPS_TERM.phrase);
    if (!term) continue;
    const sourceText = text.slice(match.start, match.end);
    const action = getTermAction(term);
    const replacementSource = getReplacementSourceText(term, terms, sourceText, ALL_CAPS_TERM.phrase, lowerAllCapsLongWords);
    const replacementText = getReplacementText(term, replacementSource, action);
    displayText += text.slice(cursor, match.start);
    const start = displayText.length;
    displayText += replacementText;
    entries.push({ start, end: displayText.length, term, terms, action, sourceText, replacementText, highlightName: getHighlightNameForEntry(term, action, terms) });
    cursor = match.end;
  }
  displayText += text.slice(cursor);
  return { displayText, entries, matches: combined };
}

function restoreAnalysis() {
  restoreHoverReveal();
  for (const result of nodeResults.values()) {
    if (result.node.isConnected && result.node.nodeValue === result.displayedText && result.displayedText !== result.originalText) {
      result.node.nodeValue = result.originalText;
    }
  }
}

function clearHighlightPresentation() {
  if (SUPPORTS_HIGHLIGHTS) {
    for (const name of [...TYPE_HIGHLIGHT_NAMES, ALL_CAPS_HIGHLIGHT_NAME, MULTI_HIGHLIGHT_NAME, SELECTED_HIGHLIGHT_NAME]) {
      CSS.highlights.delete(name);
    }
  }
  document.getElementById('cf-highlight-styles')?.remove();
  activeHighlightNames = new Set();
  highlightSets.clear();
}

function resetAnalysis() {
  hideTooltip(true);
  restoreAnalysis();
  clearHighlightPresentation();
  nodeResults.clear();
  navigationIndexes.clear();
  totalMatches = 0;
  termStats = Object.create(null);
  updateBadge();
}

function processTarget(target) {
  const node = target.node;
  if (!node.isConnected || !isProcessableNode(node)) return;
  const originalText = node.nodeValue || '';
  const startOffset = Math.max(0, Math.min(target.start ?? 0, originalText.length));
  const endOffset = Math.max(startOffset, Math.min(target.end ?? originalText.length, originalText.length));
  const source = originalText.slice(startOffset, endOffset);
  if (source.trim().length < 2) return;
  const parent = node.parentElement;
  const conversational = !!parent?.closest('shreddit-comment,[data-testid*=comment],ytd-comment-thread-renderer,ytd-comments,#comments');
  const headline = isLikelyHeadline(parent, source);
  const plan = processText(source, { headline, conversational, pageContext: PAGE_CONTEXT });
  const displayedNodeText = originalText.slice(0, startOffset) + plan.displayText + originalText.slice(endOffset);
  if (displayedNodeText !== originalText) node.nodeValue = displayedNodeText;

  /** @type {{node: Text, originalText: string, displayedText: string, records: any[]}} */
  const result = { node, originalText, displayedText: displayedNodeText, records: [] };
  for (const entry of plan.entries) {
    const start = startOffset + entry.start, end = startOffset + entry.end;
    const range = document.createRange();
    range.setStart(node, start); range.setEnd(node, end);
    result.records.push({
      range, node, startOffset: start, endOffset: end,
      term: entry.term.phrase,
      terms: entry.terms,
      type: entry.term.type, category: getCategory(entry.term.type), action: entry.action,
      sourceText: entry.sourceText, replacementText: entry.replacementText, highlightName: entry.highlightName,
      matchContext: { headline, conversational, pageContext: PAGE_CONTEXT },
    });
  }
  if (result.records.length || displayedNodeText !== originalText) {
    nodeResults.set(node, result);
  }
}

function rebuildSummary() {
  totalMatches = 0;
  termStats = Object.create(null);
  for (const result of nodeResults.values()) {
    for (const record of result.records) {
      const target = (termStats[record.sourceText] ||= { highlighted: 0, replaced: 0, removed: 0 });
      target[record.action]++; totalMatches++;
    }
  }
}

function getAllRecords() {
  return [...nodeResults.values()].flatMap(result => result.records);
}

function buildHighlightRule(name) {
  if (settings.monochrome && name === ALL_CAPS_HIGHLIGHT_NAME) return `::highlight(${name}){background-color:transparent;text-decoration:underline;text-decoration-color:rgba(0,0,0,.65);text-decoration-thickness:1px;text-underline-offset:2px}`;
  if (settings.monochrome && name === MULTI_HIGHLIGHT_NAME) return `::highlight(${name}){background-color:rgba(0,0,0,.20);text-decoration:underline;text-decoration-color:rgba(0,0,0,.75);text-decoration-thickness:1px;text-underline-offset:2px}`;
  if (name === ALL_CAPS_HIGHLIGHT_NAME) return `::highlight(${name}){background-color:transparent;text-decoration:underline;text-decoration-color:rgba(125,211,252,.42);text-decoration-thickness:.75px;text-underline-offset:2px}`;
  if (name === MULTI_HIGHLIGHT_NAME) return `::highlight(${name}){background-color:rgba(147,51,234,.42);text-decoration:underline;text-decoration-color:rgba(88,28,135,.95);text-decoration-thickness:1px;text-underline-offset:2px}`;
  const underline = name.endsWith('-underline');
  const typeName = name.slice(HIGHLIGHT_PREFIX.length, underline ? -'-underline'.length : undefined);
  const color = getColor(typeName);
  const rgb = (underline ? UNDERLINE_RGB : COLOR_RGB)[color] || (underline ? UNDERLINE_RGB.gray : COLOR_RGB.gray);
  const intensity = TYPE_INTENSITY[typeName] ?? 0.65;
  const alpha = Math.max(0.08, Math.min(underline ? 0.84 : 0.32, (underline ? 0.84 : 0.32) * intensity)).toFixed(3);
  return underline
    ? `::highlight(${name}){background-color:transparent;text-decoration:underline;text-decoration-color:rgba(${rgb},${alpha});text-decoration-thickness:1px;text-underline-offset:1px}`
    : `::highlight(${name}){background-color:rgba(${rgb},${alpha})}`;
}

function renderHighlights() {
  clearHighlightPresentation();
  if (!SUPPORTS_HIGHLIGHTS) return;
  const rangesByName = new Map();
  for (const record of getAllRecords()) {
    if (!record.highlightName || record.range.collapsed) continue;
    const ranges = rangesByName.get(record.highlightName) || [];
    ranges.push(record.range);
    rangesByName.set(record.highlightName, ranges);
  }
  activeHighlightNames = new Set(rangesByName.keys());
  for (const [name, ranges] of rangesByName) {
    const highlight = new Highlight(...ranges);
    highlightSets.set(name, highlight); CSS.highlights.set(name, highlight);
  }
  if (activeHighlightNames.size) {
    const style = document.createElement('style');
    style.id = 'cf-highlight-styles';
    style.textContent = [...activeHighlightNames].map(buildHighlightRule).join('\n');
    (document.head || document.documentElement).appendChild(style);
  }
}

function syncHighlightStyles() {
  document.getElementById('cf-highlight-styles')?.remove();
  activeHighlightNames = new Set(highlightSets.keys());
  if (!activeHighlightNames.size) return;
  const style = document.createElement('style'); style.id = 'cf-highlight-styles';
  style.textContent = [...activeHighlightNames].map(buildHighlightRule).join('\n');
  (document.head || document.documentElement).appendChild(style);
}

function removeResultHighlights(result) {
  if (!SUPPORTS_HIGHLIGHTS) return false;
  let namesChanged = false;
  for (const record of result?.records || []) {
    const highlight = highlightSets.get(record.highlightName);
    if (!highlight) continue;
    highlight.delete(record.range);
    if (highlight.size === 0) {
      highlightSets.delete(record.highlightName); CSS.highlights.delete(record.highlightName); namesChanged = true;
    }
  }
  return namesChanged;
}

function addResultHighlights(result) {
  if (!SUPPORTS_HIGHLIGHTS) return false;
  let namesChanged = false;
  for (const record of result?.records || []) {
    if (!record.highlightName || record.range.collapsed) continue;
    let highlight = highlightSets.get(record.highlightName);
    if (!highlight) {
      highlight = new Highlight(); highlightSets.set(record.highlightName, highlight);
      CSS.highlights.set(record.highlightName, highlight); namesChanged = true;
    }
    highlight.add(record.range);
  }
  return namesChanged;
}

function analyzeTargets(targets) {
  resetAnalysis();
  for (const target of targets) if (target.node?.isConnected) processTarget(target);
  rebuildSummary();
  renderHighlights();
  updateBadge();
  return totalMatches;
}

function analyzePage() {
  if (!document.body) return 0;
  pageObserver?.disconnect();
  const count = analyzeTargets(getTextTargets(document.body));
  pageObserver?.takeRecords();
  pageObserver?.observe(document.body, { childList: true, subtree: true, characterData: true });
  return count;
}

function analyzeMutations() {
  analysisTimer = 0;
  pageObserver?.disconnect();
  let highlightNamesChanged = false;
  if (pendingDisconnectedCleanup) {
    for (const node of nodeResults.keys()) {
      if (!node.isConnected) {
        const changed = removeResultHighlights(nodeResults.get(node));
        highlightNamesChanged ||= changed; nodeResults.delete(node);
      }
    }
  }
  for (const node of pendingMutationNodes) {
    const removedNames = removeResultHighlights(nodeResults.get(node));
    highlightNamesChanged ||= removedNames;
    if (!node.isConnected || !isProcessableNode(node)) {
      nodeResults.delete(node);
      continue;
    }
    nodeResults.delete(node);
    processTarget({ node });
    const addedNames = addResultHighlights(nodeResults.get(node));
    highlightNamesChanged ||= addedNames;
  }
  pendingMutationNodes.clear();
  pendingDisconnectedCleanup = false;
  rebuildSummary();
  if (highlightNamesChanged) syncHighlightStyles();
  updateBadge();
  pageObserver?.takeRecords();
  pageObserver?.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function getTextTargets(root) {
  if (!root) return [];
  const targets = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (isProcessableNode(node) && (node.nodeValue || '').trim().length >= 2) targets.push({ node });
  }
  return targets;
}

function updateBadge() {
  chrome.runtime.sendMessage({ type: 'COUNT', count: totalMatches }).catch(() => {});
}

function restoreHoverReveal() {
  if (!hoverReveal) return;
  const { record, node, revealedText } = hoverReveal;
  if (node.nodeValue === revealedText) {
    internalMutationCounts.set(node, (internalMutationCounts.get(node) || 0) + 1);
    node.replaceData(record.startOffset, record.sourceText.length, record.replacementText);
    record.range.setStart(node, record.startOffset); record.range.setEnd(node, record.endOffset);
  }
  hoverReveal = null;
}

function revealOriginalText(record) {
  if (record.action !== 'replaced' || !record.sourceText || !record.replacementText || hoverReveal?.record === record) return;
  restoreHoverReveal();
  const display = record.node.nodeValue || '';
  if (display.slice(record.startOffset, record.endOffset) !== record.replacementText) return;
  const revealedText = display.slice(0, record.startOffset) + record.sourceText + display.slice(record.endOffset);
  hoverReveal = { record, node: record.node, revealedText };
  internalMutationCounts.set(record.node, (internalMutationCounts.get(record.node) || 0) + 1);
  record.node.replaceData(record.startOffset, record.endOffset - record.startOffset, record.sourceText);
  record.range.setStart(record.node, record.startOffset); record.range.setEnd(record.node, record.startOffset + record.sourceText.length);
}

function isPointInsideHoverReveal(x, y) {
  return !!hoverReveal && [...hoverReveal.record.range.getClientRects()].some(rect =>
    x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2,
  );
}

function hideTooltip(force = false) {
  if (pinnedTooltipRecord && !force) return;
  if (force) pinnedTooltipRecord = null;
  restoreHoverReveal(); activeHover = null;
  const tooltip = document.getElementById('cf-tooltip');
  if (tooltip) tooltip.style.display = 'none';
}

function feedbackContext(record) {
  const text = record.node.nodeValue || '';
  const start = Math.max(0, record.startOffset - 120);
  const end = Math.min(text.length, record.endOffset + 120);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function saveFeedback(record, verdict, status) {
  const item = {
    schemaVersion: 1,
    verdict,
    wording: record.sourceText,
    replacement: record.replacementText,
    action: record.action,
    rules: (record.terms || []).map(term => term.phrase),
    types: (record.terms || []).map(term => term.type),
    matchContext: record.matchContext,
    context: feedbackContext(record),
    pageContext: PAGE_CONTEXT,
    hostname: location.hostname,
    createdAt: new Date().toISOString(),
  };
  chrome.storage.local.get({ clearframeFeedback: [] }, result => {
    const feedback = Array.isArray(result.clearframeFeedback) ? result.clearframeFeedback.slice(-499) : [];
    feedback.push(item);
    chrome.storage.local.set({ clearframeFeedback: feedback }, () => {
      status.textContent = chrome.runtime.lastError ? 'Could not save' : 'Saved locally';
    });
  });
}

function showTooltip(record, x, y) {
  let tooltip = document.getElementById('cf-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div'); tooltip.id = 'cf-tooltip'; document.body.appendChild(tooltip);
  }
  const terms = record.terms?.length ? record.terms : [{ type: record.type }];
  tooltip.textContent = '';
  const info = document.createElement('div');
  info.textContent = terms.map(term => `${term.type} - ${getCategory(term.type)}${term.confidence && term.confidence !== 'high' ? ` (${term.confidence})` : ''}`).join('\n');
  tooltip.appendChild(info);
  tooltip.classList.toggle('pinned', pinnedTooltipRecord === record);
  if (pinnedTooltipRecord === record && settings.feedbackEnabled) {
    const actions = document.createElement('div'); actions.className = 'cf-feedback-actions';
    const status = document.createElement('span'); status.className = 'cf-feedback-status';
    for (const [label, verdict] of [['Wrong context', 'wrong-context'], ['Wrong category', 'wrong-category'], ['Bad reword', 'bad-reword'], ['Too broad', 'too-broad'], ['Bad rule', 'bad-rule']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', event => { event.stopPropagation(); saveFeedback(record, verdict, status); });
      actions.appendChild(button);
    }
    actions.appendChild(status); tooltip.appendChild(actions);
  }
  tooltip.style.display = 'block';
  revealOriginalText(record);
  const rect = record.range.getBoundingClientRect();
  const anchorLeft = Number.isFinite(rect.left) && rect.width > 0 ? rect.left : x;
  const anchorTop = Number.isFinite(rect.top) && rect.height > 0 ? rect.top : y;
  const anchorBottom = Number.isFinite(rect.bottom) && rect.height > 0 ? rect.bottom : y;
  const left = Math.min(Math.max(8, anchorLeft), Math.max(8, window.innerWidth - tooltip.offsetWidth - 8));
  const above = anchorTop - tooltip.offsetHeight - 8;
  const top = above >= 8 ? above : Math.min(anchorBottom + 8, Math.max(8, window.innerHeight - tooltip.offsetHeight - 8));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function findRecordAtCaret(caret, x, y) {
  const node = caret?.offsetNode || caret?.startContainer;
  const offset = caret?.offset ?? caret?.startOffset;
  if (!node || typeof offset !== 'number') return null;
  const records = nodeResults.get(node)?.records || [];
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record.range.isPointInRange(node, offset) ||
        (offset > 0 && record.range.isPointInRange(node, offset - 1)) ||
        [...record.range.getClientRects()].some(rect => x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2)) return record;
  }
  return null;
}

function findRecordAtPoint(x, y) {
  const position = /** @type {any} */ (document.caretPositionFromPoint?.(x, y));
  const range = /** @type {any} */ (document.caretRangeFromPoint?.(x, y));
  const direct = findRecordAtCaret(position, x, y) || findRecordAtCaret(range, x, y);
  if (direct) return direct;

  // Some sites place non-text descendants over the visible text. Check nearby
  // text nodes without scanning every match on the page.
  let element = document.elementFromPoint(x, y);
  for (let depth = 0; element && depth < 5; depth++, element = element.parentElement) {
    for (const node of element.childNodes) {
      if (!(node instanceof Text)) continue;
      for (const record of nodeResults.get(node)?.records || []) {
        if ([...record.range.getClientRects()].some(rect => x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2)) return record;
      }
    }
  }
  return null;
}

function processHoverMove(event) {
  if (pinnedTooltipRecord || !nodeResults.size) return;
  const record = findRecordAtPoint(event.clientX, event.clientY);
  if (!record) {
    if (activeHover && !isPointInsideHoverReveal(event.clientX, event.clientY)) hideTooltip();
    return;
  }
  if (activeHover === record) return;
  restoreHoverReveal(); activeHover = record; showTooltip(record, event.clientX, event.clientY);
}

function handleHoverMove(event) {
  pendingHoverEvent = event;
  if (hoverFrame) return;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    const next = pendingHoverEvent; pendingHoverEvent = null;
    if (next) processHoverMove(next);
  });
}

function handleTooltipClick(event) {
  if (event.target instanceof Element && event.target.closest('#cf-tooltip')) return;
  const record = findRecordAtPoint(event.clientX, event.clientY);
  if (record) {
    pinnedTooltipRecord = record; activeHover = record; showTooltip(record, event.clientX, event.clientY);
  } else if (pinnedTooltipRecord) {
    hideTooltip(true);
  }
}

function hideSuggestion() {
  document.getElementById('cf-suggestion')?.remove();
}

function selectionContext(range) {
  const node = range.startContainer;
  const text = node.nodeType === Node.TEXT_NODE ? node.nodeValue || '' : node.textContent || '';
  const offset = node.nodeType === Node.TEXT_NODE ? range.startOffset : 0;
  return text.slice(Math.max(0, offset - 120), Math.min(text.length, offset + 240)).replace(/\s+/g, ' ').trim();
}

function saveSuggestion(wording, context, element, status) {
  const item = {
    schemaVersion: 1, wording, context, pageContext: PAGE_CONTEXT, hostname: location.hostname,
    matchContext: { headline: isLikelyHeadline(element, wording), conversational: !!element.closest('shreddit-comment,[data-testid*=comment],ytd-comment-thread-renderer,ytd-comments,#comments') },
    createdAt: new Date().toISOString(),
  };
  chrome.storage.local.get({ clearframeSuggestions: [] }, result => {
    const suggestions = Array.isArray(result.clearframeSuggestions) ? result.clearframeSuggestions.slice(-499) : [];
    suggestions.push(item);
    chrome.storage.local.set({ clearframeSuggestions: suggestions }, () => {
      status.textContent = chrome.runtime.lastError ? 'Could not save' : 'Saved locally';
    });
  });
}

function handleSelectionSuggestion(event) {
  if (!settings.feedbackEnabled || event.target instanceof Element && event.target.closest('#cf-tooltip,#cf-suggestion')) return;
  hideSuggestion();
  const selection = getSelection();
  const wording = selection?.toString().replace(/\s+/g, ' ').trim() || '';
  if (!selection || selection.isCollapsed || wording.length < 2 || wording.length > 240 || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const element = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  if (!element || element.closest('input,textarea,[contenteditable=true],#cf-tooltip,#cf-suggestion')) return;
  const rect = range.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const panel = document.createElement('div'); panel.id = 'cf-suggestion';
  const preview = document.createElement('div'); preview.className = 'cf-suggestion-preview'; preview.textContent = wording;
  const suggest = document.createElement('button'); suggest.type = 'button'; suggest.textContent = 'Suggest wording';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const status = document.createElement('span'); status.className = 'cf-feedback-status';
  suggest.addEventListener('click', click => { click.stopPropagation(); saveSuggestion(wording, selectionContext(range), element, status); });
  cancel.addEventListener('click', click => { click.stopPropagation(); hideSuggestion(); });
  panel.append(preview, suggest, cancel, status); document.body.appendChild(panel);
  panel.style.left = `${Math.min(Math.max(8, rect.left), Math.max(8, innerWidth - panel.offsetWidth - 8))}px`;
  panel.style.top = `${Math.min(rect.bottom + 7, Math.max(8, innerHeight - panel.offsetHeight - 8))}px`;
}

function navigateToTerm(term, action) {
  const records = getAllRecords().filter(record => record.sourceText === term && record.action === action && record.node.isConnected);
  if (!records.length) return;
  const key = `${action}\n${term}`;
  const nextIndex = ((navigationIndexes.get(key) ?? -1) + 1) % records.length;
  navigationIndexes.set(key, nextIndex);
  const record = records[nextIndex];
  record.node.parentElement?.scrollIntoView({ block: 'center', behavior: 'auto' });
  if (SUPPORTS_HIGHLIGHTS && !record.range.collapsed) {
    const style = document.getElementById('cf-highlight-styles');
    if (style) style.textContent = [...activeHighlightNames].map(buildHighlightRule).join('\n') + `\n::highlight(${SELECTED_HIGHLIGHT_NAME}){background-color:CanvasText;color:Canvas}`;
    CSS.highlights.set(SELECTED_HIGHLIGHT_NAME, new Highlight(record.range));
  }
}

function saveRuntimeSettings(nextSettings) {
  chrome.storage.sync.set({ settings: nextSettings }, () => {
    const error = chrome.runtime.lastError;
    if (error) console.error('ClearFrame settings write failed:', error.message);
  });
}

function handleKeyDown(event) {
  const target = event.target;
  if (target instanceof Element && (/** @type {HTMLElement} */ (target).isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat) return;
  const setting = RUNTIME_SHORTCUTS[event.key.toLowerCase()];
  if (!setting) return;
  event.preventDefault();
  saveRuntimeSettings(normalizeSettings({ ...settings, [setting]: !settings[setting] }));
}

function getTermGroups() {
  /** @type {Record<string, Array<{term: string, count: number}>>} */
  const groups = { highlighted: [], replaced: [], removed: [] };
  for (const [term, counts] of Object.entries(termStats)) {
    for (const action of Object.keys(groups)) {
      if (counts[action] > 0) groups[action].push({ term, count: counts[action] });
    }
  }
  for (const items of Object.values(groups)) items.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  return groups;
}

function isClearFrameNode(node) {
  const element = node instanceof Element ? node : node.parentElement;
  return !!element?.closest('#cf-tooltip,#cf-suggestion,#cf-highlight-styles');
}

function mutationChangesText(mutation) {
  if (isClearFrameNode(mutation.target)) return false;
  if (mutation.type === 'characterData') {
    const remaining = internalMutationCounts.get(mutation.target) || 0;
    if (remaining > 0) {
      if (remaining === 1) internalMutationCounts.delete(mutation.target);
      else internalMutationCounts.set(mutation.target, remaining - 1);
      return false;
    }
    return true;
  }
  return [...mutation.addedNodes, ...mutation.removedNodes].some(node => !isClearFrameNode(node) && (node.textContent || '').trim().length >= 2);
}

function scheduleMutationAnalysis(mutations) {
  for (const mutation of mutations) {
    if (!mutationChangesText(mutation)) continue;
    if (mutation.type === 'characterData' && mutation.target instanceof Text) {
      pendingMutationNodes.add(mutation.target);
      continue;
    }
    pendingDisconnectedCleanup ||= mutation.removedNodes.length > 0;
    for (const added of mutation.addedNodes) {
      if (added instanceof Text) pendingMutationNodes.add(added);
      else for (const target of getTextTargets(added)) pendingMutationNodes.add(target.node);
    }
  }
  if (!pendingMutationNodes.size && !pendingDisconnectedCleanup) return;
  if (!analysisTimer) analysisTimer = window.setTimeout(analyzeMutations, 120);
}

function init() {
  loadSettings(DEFAULT_SETTINGS);
  chrome.storage.sync.get(['settings', 'userTypeColors'], (/** @type {any} */ result) => {
    loadSettings(result.settings, result.userTypeColors);
    const start = () => {
      pageObserver = new MutationObserver(mutations => {
        scheduleMutationAnalysis(mutations);
      });
      analyzePage();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
  document.addEventListener('mousemove', handleHoverMove, { capture: true, passive: true });
  document.addEventListener('click', handleTooltipClick, true);
  document.addEventListener('mouseup', handleSelectionSuggestion, true);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('scroll', () => { hideTooltip(); hideSuggestion(); }, true);
  window.addEventListener('blur', () => { hideTooltip(true); hideSuggestion(); });
}

if (window.top === window) init();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.settings && matcher) applySettings(changes.settings.newValue || {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_COUNT') {
    sendResponse({ count: totalMatches }); return;
  }
  if (message.type === 'GET_TERMS') {
    sendResponse({ groups: getTermGroups() }); return;
  }
  if (message.type === 'NAVIGATE_TERM') {
    navigateToTerm(message.term, message.action); return;
  }
  if (message.type === 'RELOAD_SETTINGS') {
    chrome.storage.sync.get(['settings', 'userTypeColors'], (/** @type {any} */ result) => {
      applySettings(result.settings, result.userTypeColors); sendResponse({ ok: true });
    });
    return true;
  }
});
