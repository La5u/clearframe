'use strict';
import { buildMatcher, findMatches } from './core/matcher.js';
import { lowerAllCapsLongWords, matchReplacementCase } from './core/display-utils.js';
import { pluralizeWord, pastTenseWord, ingWord, adverbWord } from './core/stemmer.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings-utils.js';
import { chooseAction, chooseReplacementTerm, getReplacementSourceText, resolveMatchGroups } from './core/match-plan.js';
import { ALL_CAPS_TERM_ID, findAllCapsMatches } from './core/all-caps.js';
import { CONTEXTUAL_TERMS, classifyPageContext, findContextualMatches } from './core/contextual.js';
import { recoverOriginalText } from './core/restore.js';
import { shouldKeepLexicalMatch } from './core/context-filter.js';

const { index, types: TYPE_MAP, categories: TYPE_CATEGORIES, labels: LABELS, colors, underlines, intensity } = ClearFrame;
const SKIP_TAGS_SELECTOR = 'script,style,noscript,textarea,input,code,pre,kbd,samp';
const MEDIA_UI_SELECTOR = '.ytp-caption-window-container,.ytp-caption-segment,.caption-window,.vjs-text-track-display,.jw-captions,.jw-text-track-display,.plyr__captions,.ytp-chrome-controls,.vjs-control-bar,.jw-controlbar,.plyr__controls,[data-testid=video-subtitles]';
const PROTECTED_TEXT_SELECTOR = 'ytd-transcript-segment-renderer,ytd-transcript-segment-list-renderer,.ytd-transcript-segment-renderer,yt-live-chat-app,yt-live-chat-renderer,[aria-live=polite],[aria-live=assertive],[role=status],[role=alert]';
const SKIP_SELECTOR = `nav,button,select,option,[role=navigation],[role=menu],[aria-hidden=true],#cf-tooltip,#cf-suggestion,${MEDIA_UI_SELECTOR}`;
const HIGHLIGHT_PREFIX = 'clearframe-';
const ALL_CAPS_HIGHLIGHT_NAME = 'clearframe-all-caps-underline';
const SELECTED_HIGHLIGHT_NAME = 'clearframe-selected';
const TYPE_HIGHLIGHT_NAMES = Object.keys(TYPE_MAP).flatMap(type => [false, true].flatMap(low => [getHighlightName(type, 'highlight', low), getHighlightName(type, 'underline', low)]));
// Terms below high confidence render fainter, so a reader can weigh them less.
const LOW_CONFIDENCE_ALPHA = 0.5;
const LOW_SUFFIX = '-low';
const SUPPORTS_HIGHLIGHTS = !!(globalThis.Highlight && globalThis.CSS?.highlights);
const COLOR_RGB = colors;
const UNDERLINE_RGB = underlines;
const TYPE_INTENSITY = intensity;
const TYPE_PRIORITY = ['derogatory', 'aggression', 'fear', 'loaded', 'moral', 'dysphemism', 'clickbait', 'loaded-framing', 'unsourced', 'euphemism', 'passive', 'negative-framing', 'conflict', 'exaggeration', 'superlative', 'hype', 'authority', 'uncertainty', 'distancing', 'minimizing', 'all-caps', 'absolute', 'repetition', 'rhetorical-question', 'colloquialism', 'idiom', 'reveal', 'quote'];
const RUNTIME_SHORTCUTS = { r: 'replaceTerms', x: 'removeTerms', f: 'feedbackEnabled' };
const ALL_CAPS_TERM = { phrase: 'caps emphasis', type: 'all-caps', neutral: 'Caps normalized.', stemType: '', regex: '', remove: false };

let settings = normalizeSettings(DEFAULT_SETTINGS);
let matcher = null;
// A NodeResult owns all retained state for one analyzed text node.
/** @type {Map<Text, {node: Text, originalText: string, displayedText: string, records: any[]}>} */
const nodeResults = new Map();
// Results for nodes the page detached; kept so reattached nodes can be restored.
/** @type {WeakMap<Text, {node: Text, originalText: string, displayedText: string, records: any[]}>} */
const detachedResults = new WeakMap();
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

function isFeedbackEnabled() {
  return settings.feedbackEnabled === true;
}

function applySettings(rawSettings = {}, rawTypeColors = {}) {
  const previousKey = getSettingsKey(settings);
  loadSettings(rawSettings, rawTypeColors);
  if (!isFeedbackEnabled()) {
    hideSuggestion();
    if (pinnedTooltipRecord) hideTooltip(true);
    document.querySelector('#cf-tooltip .cf-feedback-actions')?.remove();
  }
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

// The technical term is shown first so readers learn the vocabulary; the
// plain label and effect sit behind the (i).
function getLabel(term) {
  return LABELS?.phrases?.[term.phrase] || LABELS?.types?.[term.type] || { term: term.type, plain: getCategory(term.type), effect: '' };
}

function getCategory(type) {
  return TYPE_CATEGORIES?.[type] || 'General';
}

function getTypeRank(type) {
  const index = TYPE_PRIORITY.indexOf(type);
  return index === -1 ? TYPE_PRIORITY.length : index;
}

function getMostImportantType(terms) {
  let best = terms[0]?.type;
  for (const term of terms) {
    if (getTypeRank(term.type) < getTypeRank(best)) best = term.type;
  }
  return best;
}

function getHighlightName(type, mode = 'highlight', low = false) {
  return HIGHLIGHT_PREFIX + String(type).replace(/[^a-z0-9-]/gi, '-') + (low ? '-low' : '') + (mode === 'underline' ? '-underline' : '');
}

function isLowConfidence(terms) {
  return terms.length > 0 && terms.every(term => (term.confidence || 'high') !== 'high');
}

function getTermById(id) {
  const term = index.termsById[id];
  if (term && !term.phrase) term.phrase = id;
  return term || CONTEXTUAL_TERMS[id] || (id === ALL_CAPS_TERM_ID ? ALL_CAPS_TERM : null);
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
  return !!parent && !parent.isContentEditable && !parent.closest(SKIP_TAGS_SELECTOR) && !parent.closest(SKIP_SELECTOR);
}

function isLikelyHeadline(parent, text) {
  if (parent?.closest('h1,h2,h3,[role=heading],[slot=title],a#video-title,[class*=headline],[class*=title]')) return true;
  if (PAGE_CONTEXT !== 'publication' || text.trim().length < 20) return false;
  const link = parent?.closest('a[href]');
  if (!link || link.closest('nav,footer,[role=navigation],[class*=share],[class*=comment]')) return false;
  return !!parent.closest('strong,b,[class*=pufftext],[data-headline]') || link.getAttribute('itemprop') === 'url';
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
  const low = isLowConfidence(terms.length ? terms : [term]);
  if (terms.length > 1) return getHighlightName(getMostImportantType(terms), 'highlight', low);
  if (action === 'highlighted') return getHighlightName(term.type, 'highlight', low);
  return term.phrase === ALL_CAPS_TERM.phrase ? ALL_CAPS_HIGHLIGHT_NAME : getHighlightName(term.type, 'underline', low);
}

function processText(text, context = {}) {
  const matches = findMatches(matcher, text, index.termsById, index.regexTerms || [],
    term => isEnabled(term.type),
    (termId, start, end) => shouldKeepLexicalMatch(getTermById(termId), text.slice(start, end), text, context, start));
  const allCaps = isEnabled(ALL_CAPS_TERM.type) ? findAllCapsMatches(text) : [];
  const contextual = findContextualMatches(text, context).filter(match => isEnabled(getTermById(match.termId)?.type));
  const combined = resolveMatchGroups([...matches, ...allCaps, ...contextual]);
  let cursor = 0, displayText = '';
  const entries = [];
  const termAction = term => chooseAction(term, settings, context.preserveText === true);
  for (const match of combined) {
    const terms = getTermsForMatch(match);
    // An expanded group spans beyond its lexical term; only all-caps
    // normalization is safe across the whole range, otherwise highlight.
    const capsTerms = match.expanded ? terms.filter(item => item.phrase === ALL_CAPS_TERM.phrase) : [];
    const term = chooseReplacementTerm(capsTerms.length ? capsTerms : terms, termAction, ALL_CAPS_TERM.phrase);
    if (!term) continue;
    const sourceText = text.slice(match.start, match.end);
    const action = match.expanded && !capsTerms.length ? 'highlighted' : termAction(term);
    const replacementSource = getReplacementSourceText(term, terms, sourceText, ALL_CAPS_TERM.phrase, lowerAllCapsLongWords);
    const replacementText = getReplacementText(term, replacementSource, action);
    displayText += text.slice(cursor, match.start);
    const start = displayText.length;
    displayText += replacementText;
    entries.push({ start, end: displayText.length, term, terms, action, sourceText, replacementText, highlightName: getHighlightNameForEntry(term, action, terms) });
    cursor = match.end;
  }
  displayText += text.slice(cursor);
  return { displayText, entries };
}

function restoreAnalysis() {
  restoreHoverReveal();
  for (const result of nodeResults.values()) {
    if (result.node.isConnected && result.displayedText !== result.originalText) restoreOriginalText(result);
  }
}

function restoreOriginalText(result) {
  const current = result.node.nodeValue || '';
  const original = recoverOriginalText(result, current);
  if (original !== null && original !== current) result.node.nodeValue = original;
}

function clearHighlightPresentation() {
  if (SUPPORTS_HIGHLIGHTS) {
    for (const name of [...TYPE_HIGHLIGHT_NAMES, ALL_CAPS_HIGHLIGHT_NAME, SELECTED_HIGHLIGHT_NAME]) {
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

function processTextNode(node) {
  if (!node.isConnected || !isProcessableNode(node)) return;
  const originalText = node.nodeValue || '';
  if (originalText.trim().length < 2) return;
  const parent = node.parentElement;
  const conversational = !!parent?.closest('shreddit-comment,[data-testid*=comment],ytd-comment-thread-renderer,ytd-comments,#comments');
  const headline = isLikelyHeadline(parent, originalText);
  const preserveText = !!parent?.closest(PROTECTED_TEXT_SELECTOR);
  const plan = processText(originalText, { headline, conversational, preserveText, pageContext: PAGE_CONTEXT });
  const displayedNodeText = plan.displayText;
  if (displayedNodeText !== originalText) node.nodeValue = displayedNodeText;

  /** @type {{node: Text, originalText: string, displayedText: string, records: any[]}} */
  const result = { node, originalText, displayedText: displayedNodeText, records: [] };
  for (const entry of plan.entries) {
    const { start, end } = entry;
    const range = document.createRange();
    range.setStart(node, start); range.setEnd(node, end);
    result.records.push({
      range, node, startOffset: start, endOffset: end,
      terms: entry.terms,
      type: entry.term.type, action: entry.action,
      sourceText: entry.sourceText, replacementText: entry.replacementText, highlightName: entry.highlightName,
      matchContext: { headline, conversational, preserveText, pageContext: PAGE_CONTEXT },
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
  if (name === ALL_CAPS_HIGHLIGHT_NAME) return `::highlight(${name}){background-color:transparent;text-decoration:underline;text-decoration-color:rgba(125,211,252,.42);text-decoration-thickness:.75px;text-underline-offset:2px}`;
  const underline = name.endsWith('-underline');
  const base = name.slice(HIGHLIGHT_PREFIX.length, underline ? -'-underline'.length : undefined);
  const low = base.endsWith(LOW_SUFFIX);
  const typeName = low ? base.slice(0, -LOW_SUFFIX.length) : base;
  const color = getColor(typeName);
  const rgb = (underline ? UNDERLINE_RGB : COLOR_RGB)[color] || (underline ? UNDERLINE_RGB.gray : COLOR_RGB.gray);
  const intensity = TYPE_INTENSITY[typeName] ?? 0.65;
  const alpha = (Math.max(0.08, Math.min(underline ? 0.84 : 0.32, (underline ? 0.84 : 0.32) * intensity)) * (low ? LOW_CONFIDENCE_ALPHA : 1)).toFixed(3);
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

function analyzeTargets(root) {
  resetAnalysis();
  const targets = getTextTargets(root);
  for (const node of targets) if (node.isConnected) processTextNode(node);
  rebuildSummary();
  renderHighlights();
  updateBadge();
  return totalMatches;
}

function analyzePage() {
  if (!document.body) return 0;
  if (analysisTimer) {
    window.clearTimeout(analysisTimer);
    analysisTimer = 0;
  }
  pendingMutationNodes.clear();
  pendingDisconnectedCleanup = false;
  pageObserver?.disconnect();
  const count = analyzeTargets(document.body);
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
        const result = nodeResults.get(node);
        highlightNamesChanged ||= removeResultHighlights(result);
        if (result) detachedResults.set(node, result);
        nodeResults.delete(node);
      }
    }
  }
  // The observer is disconnected here, so the restore's mutation will never be
  // observed; drop its pending count or a later real edit would be ignored.
  const revealedNode = hoverReveal?.node;
  restoreHoverReveal();
  if (revealedNode) internalMutationCounts.delete(revealedNode);
  for (const node of pendingMutationNodes) {
    const removedNames = removeResultHighlights(nodeResults.get(node));
    highlightNamesChanged ||= removedNames;
    // Re-derive the original before re-analysis so rewritten wording never
    // becomes the new "original" after the page edits this node.
    const previous = nodeResults.get(node) || detachedResults.get(node);
    if (previous && node.isConnected) restoreOriginalText(previous);
    detachedResults.delete(node);
    if (!node.isConnected || !isProcessableNode(node)) {
      nodeResults.delete(node);
      continue;
    }
    nodeResults.delete(node);
    processTextNode(node);
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
    if (isProcessableNode(node) && (node.nodeValue || '').trim().length >= 2) targets.push(node);
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

// Let the pointer travel from the highlight into the tooltip (to reach the
// (i)) without the tooltip closing in the gap between them.
function isPointTowardTooltip(x, y) {
  const tooltip = document.getElementById('cf-tooltip');
  if (!activeHover || !tooltip || tooltip.style.display === 'none') return false;
  const tip = tooltip.getBoundingClientRect(), word = activeHover.range.getBoundingClientRect();
  return x >= Math.min(tip.left, word.left) - 2 && x <= Math.max(tip.right, word.right) + 2
    && y >= Math.min(tip.top, word.top) - 2 && y <= Math.max(tip.bottom, word.bottom) + 2;
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
  const seen = new Set();
  for (const term of terms) {
    const label = getLabel(term);
    if (seen.has(label.term)) continue;
    seen.add(label.term);
    const row = document.createElement('div'); row.className = 'cf-term';
    const line = document.createElement('div'); line.className = 'cf-term-line';
    const name = document.createElement('span'); name.className = 'cf-term-name'; name.textContent = label.term;
    line.appendChild(name);
    if (term.confidence && term.confidence !== 'high') {
      const confidence = document.createElement('span'); confidence.className = 'cf-confidence'; confidence.textContent = ' · lower confidence';
      line.appendChild(confidence);
    }
    const info = document.createElement('span'); info.className = 'cf-info'; info.textContent = 'i';
    info.tabIndex = 0; info.setAttribute('role', 'button'); info.setAttribute('aria-label', `In plain words: ${label.plain}`);
    const plain = document.createElement('div'); plain.className = 'cf-plain';
    const plainName = document.createElement('strong'); plainName.textContent = label.plain;
    plain.append(plainName, label.effect ? ` – ${label.effect}` : '');
    line.appendChild(info); row.append(line, plain);
    tooltip.appendChild(row);
  }
  tooltip.classList.toggle('pinned', pinnedTooltipRecord === record);
  if (pinnedTooltipRecord === record && isFeedbackEnabled()) {
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
  tooltip.style.left = `${left}px`;
  // Anchor by the bottom edge when above the word, so opening the plain
  // explanation grows the tooltip upward instead of over the word. The
  // explanation opens on the far side of the (i), which keeps it under the pointer.
  tooltip.classList.toggle('cf-above', above >= 8);
  if (above >= 8) {
    tooltip.style.top = 'auto';
    tooltip.style.bottom = `${window.innerHeight - anchorTop + 8}px`;
  } else {
    tooltip.style.bottom = 'auto';
    tooltip.style.top = `${Math.min(anchorBottom + 8, Math.max(8, window.innerHeight - tooltip.offsetHeight - 8))}px`;
  }
}

function findRecordAtCaret(caret, x, y) {
  const node = caret?.offsetNode || caret?.startContainer;
  const offset = caret?.offset ?? caret?.startOffset;
  if (!node || typeof offset !== 'number') return null;
  const records = nodeResults.get(node)?.records || [];
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    // The caret snaps to the nearest text, even from blank space below a
    // paragraph, so the pointer must also be over the highlighted word.
    const caretHit = record.range.isPointInRange(node, offset) || (offset > 0 && record.range.isPointInRange(node, offset - 1));
    const slack = caretHit ? 4 : 2;
    if ([...record.range.getClientRects()].some(rect => x >= rect.left - slack && x <= rect.right + slack && y >= rect.top - slack && y <= rect.bottom + slack)) return record;
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
  const selection = getSelection();
  if (selection && !selection.isCollapsed) {
    if (activeHover || pinnedTooltipRecord) hideTooltip(true);
    return;
  }
  if (pinnedTooltipRecord || !nodeResults.size) return;
  const record = findRecordAtPoint(event.clientX, event.clientY);
  if (!record) {
    if (activeHover && !isPointInsideHoverReveal(event.clientX, event.clientY) && !isPointTowardTooltip(event.clientX, event.clientY)) hideTooltip();
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
  // A drag-selection can still be non-collapsed when the browser dispatches a
  // click. Do not turn that selection into a term tooltip.
  const selection = getSelection();
  if (selection && !selection.isCollapsed) return;
  const record = findRecordAtPoint(event.clientX, event.clientY);
  if (record) {
    pinnedTooltipRecord = record; activeHover = record; showTooltip(record, event.clientX, event.clientY);
  } else if (pinnedTooltipRecord) {
    hideTooltip(true);
  }
}

// Auto-scrolling carousels and tickers fire scroll events constantly; only a
// scroll that moves the hovered text should dismiss its tooltip.
function handleScroll(event) {
  const target = event.target;
  const record = pinnedTooltipRecord || activeHover;
  const movesPage = target === document || target === document.documentElement || target === document.body;
  if (movesPage || !record || (target instanceof Node && target.contains(record.node))) hideTooltip(true);
  hideSuggestion();
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
  if (event.target instanceof Element && event.target.closest('#cf-tooltip,#cf-suggestion')) return;
  // Remove a stale panel even if settings changed before the storage event
  // reached this content script. The setting is checked again immediately
  // before creating a new one.
  hideSuggestion();
  const selection = getSelection();
  if (selection && !selection.isCollapsed) {
    pendingHoverEvent = null;
    if (hoverFrame) {
      cancelAnimationFrame(hoverFrame);
      hoverFrame = 0;
    }
    hideTooltip(true);
  }
  if (!isFeedbackEnabled()) return;
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
      else for (const node of getTextTargets(added)) pendingMutationNodes.add(node);
    }
  }
  if (!pendingMutationNodes.size && !pendingDisconnectedCleanup) return;
  if (!analysisTimer) analysisTimer = window.setTimeout(analyzeMutations, 120);
}

function init() {
  loadSettings(DEFAULT_SETTINGS);
  const start = () => {
    pageObserver = new MutationObserver(mutations => {
      scheduleMutationAnalysis(mutations);
    });
    analyzePage();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  chrome.storage.sync.get(['settings', 'userTypeColors'], (/** @type {any} */ result) => {
    if (getSettingsKey(settings) === getSettingsKey(normalizeSettings(result.settings, result.userTypeColors))) return;
    loadSettings(result.settings, result.userTypeColors);
    if (document.body) analyzePage();
  });
  document.addEventListener('mousemove', handleHoverMove, { capture: true, passive: true });
  document.addEventListener('click', handleTooltipClick, true);
  document.addEventListener('mouseup', handleSelectionSuggestion, true);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('scroll', handleScroll, true);
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
  if (message.type === 'APPLY_SETTINGS') {
    applySettings(message.settings, message.settings?.userTypeColors);
    sendResponse({ ok: true }); return;
  }
});
