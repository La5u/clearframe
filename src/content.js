'use strict';
import { buildMatcher, findMatches } from './core/matcher.js';
import { getAllCapsAction, lowerAllCapsLongWords, matchReplacementCase } from './core/display-utils.js';
import { pluralizeWord, pastTenseWord, ingWord, adverbWord } from './core/stemmer.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings-utils.js';
import { chooseReplacementTerm, getReplacementSourceText, resolveMatchGroups } from './core/match-plan.js';

const { index, types: TYPE_MAP, categories: TYPE_CATEGORIES } = ClearFrame;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE']);
const SKIP_SELECTOR = 'nav,button,select,option,[role=navigation],[role=menu],[aria-hidden=true],#cf-tooltip';
const HIGHLIGHT_PREFIX = 'clearframe-';
const ALL_CAPS_HIGHLIGHT_NAME = 'clearframe-all-caps-underline';
const MULTI_HIGHLIGHT_NAME = 'clearframe-multiple';
const SELECTED_HIGHLIGHT_NAME = 'clearframe-selected';
const TYPE_HIGHLIGHT_NAMES = Object.keys(TYPE_MAP).flatMap(t => [getHighlightName(t), getHighlightName(t, 'underline')]);
const SUPPORTS_HIGHLIGHTS = !!(globalThis.Highlight && globalThis.CSS?.highlights);
const COLOR_RGB = { yellow: '250, 204, 21', green: '74, 222, 128', gray: '209, 213, 219', red: '248, 113, 113', pink: '244, 114, 182', orange: '251, 146, 60', purple: '196, 128, 255', blue: '96, 165, 250', teal: '45, 212, 191', brown: '161, 98, 7' };
const UNDERLINE_RGB = { yellow: '202, 138, 4', green: '22, 163, 74', gray: '107, 114, 128', red: '220, 38, 38', pink: '219, 39, 119', orange: '234, 88, 12', purple: '147, 51, 234', blue: '37, 99, 235', teal: '20, 184, 166', brown: '120, 53, 15' };
const DEFAULT_TYPE_INTENSITY = 0.65;
const TYPE_INTENSITY = { absolute: 0.5, aggression: 0.75, 'all-caps': 0.5, authority: 0.65, clickbait: 0.85, colloquialism: 0.35, conflict: 0.65, derogatory: 0.95, distancing: 0.7, dysphemism: 0.8, euphemism: 0.75, exaggeration: 0.7, fear: 0.9, hype: 0.65, idiom: 0.35, loaded: 0.9, 'loaded-framing': 0.85, minimizing: 0.6, moral: 0.8, 'negative-framing': 0.75, passive: 0.7, repetition: 0.45, reveal: 0.3, 'rhetorical-question': 0.4, superlative: 0.65, uncertainty: 0.65, unsourced: 0.8 };
const MAX_HIGHLIGHT_ALPHA = 0.32;
const MAX_UNDERLINE_ALPHA = 0.84;
const RUNTIME_SHORTCUTS = { c: 'enabled', r: 'replaceTerms', x: 'removeTerms' };

let matcher = null;
let totalMatches = 0;
let termStats = Object.create(null);
let highlightRecords = [];
let highlightRecordsByNode = new WeakMap();
let activeHover = null;
let hoverReveal = null;
let rerenderFrame = 0;
let renderPending = false;
const navigationIndexes = new Map();
let activeHighlightStyleNames = new Set();
const originalNodeText = new WeakMap();
const internallyMutatedNodes = new WeakSet();
let dirtyNodes = null;

let settings = normalizeSettings(DEFAULT_SETTINGS);
const ALL_CAPS_TERM_ID = '__clearframe_all_caps__';
const ALL_CAPS_TERM = { phrase: 'caps emphasis', type: 'all-caps', neutral: 'Caps normalized.', stemType: '', regex: '', remove: false, hasNeutral: true };

function loadSettings(rawSettings = {}, rawTypeColors = {}) {
  settings = normalizeSettings(rawSettings, rawTypeColors);
}

function isEnabled(type) {
  return settings.types?.[type] !== false;
}

function getColor(type) {
  return settings.userTypeColors?.[type] || TYPE_MAP[type] || 'gray';
}

function getCategory(type) {
  return TYPE_CATEGORIES?.[type] || 'General';
}

function getHighlightName(type, mode = 'highlight') {
  const safe = String(type).replace(/[^a-z0-9-]/gi, '-');
  return HIGHLIGHT_PREFIX + safe + (mode === 'underline' ? '-underline' : '');
}

function getTermById(id) {
  return index.termsById[id] || (id === ALL_CAPS_TERM_ID ? ALL_CAPS_TERM : null);
}

function applyStemmedReplacement(src, base, replacement, stemType) {
  const source = src.toLowerCase(), b = base.toLowerCase();
  let next = replacement;
  if (stemType === 'noun') {
    if (source === pluralizeWord(b)) {
      next = pluralizeWord(replacement);
    }
  } else if (stemType === 'verb') {
    if (source === pluralizeWord(b)) {
      next = pluralizeWord(replacement);
    } else if (source === pastTenseWord(b)) {
      next = pastTenseWord(replacement);
    } else if (source === ingWord(b)) {
      next = ingWord(replacement);
    }
  } else if (stemType === 'adjective' && source === adverbWord(b)) {
    next = adverbWord(replacement);
  }
  return matchReplacementCase(src, next);
}

function getReplacementForTerm(term, src) {
  return term.phrase === ALL_CAPS_TERM.phrase ? lowerAllCapsLongWords(src) : applyStemmedReplacement(src, term.phrase, term.neutral, term.stemType || '');
}

function findAllCapsMatches(text) {
  const matches = [];
  let pending = null;
  for (const m of text.matchAll(/\b[A-Z0-9]+(?:'[A-Z0-9]+)*\b/g)) {
    if (typeof m.index !== 'number' || !m[0] || !getAllCapsAction(m[0])) {
      continue;
    }
    const start = m.index, end = m.index + m[0].length;
    if (pending && /^[\s:;,.!?'"()[\]{}-]+$/.test(text.slice(pending.end, start))) {
      pending.end = end; continue;
    }
    if (pending) {
      matches.push(pending);
    }
    pending = { start, end, termId: ALL_CAPS_TERM_ID, virtual: true };
  }
  if (pending) {
    matches.push(pending);
  }
  return matches;
}

function setNodeText(node, text) {
  if (node.nodeValue !== text) {
    internallyMutatedNodes.add(node); node.nodeValue = text;
  }
}

function replaceNodeText(node, start, end, text) {
  internallyMutatedNodes.add(node);
  node.replaceData(start, end - start, text);
}

function initMatcher() {
  return buildMatcher(index, t => isEnabled(t.type));
}
function initFindMatches(text) {
  return findMatches(matcher, text, index.termsById, index.regexTerms || [], false, t => isEnabled(t.type));
}

function skipNode(node, visibilityCache) {
  const p = node.parentElement;
  return !p || p.isContentEditable || SKIP_TAGS.has(p.tagName) || !!p.closest(SKIP_SELECTOR) || !isVisibleElement(p, visibilityCache);
}

function clearRegistry() {
  if (!SUPPORTS_HIGHLIGHTS) {
    return;
  }
  TYPE_HIGHLIGHT_NAMES.forEach(n => CSS.highlights.delete(n));
  CSS.highlights.delete(ALL_CAPS_HIGHLIGHT_NAME);
  CSS.highlights.delete(MULTI_HIGHLIGHT_NAME);
  CSS.highlights.delete(SELECTED_HIGHLIGHT_NAME);
}

function getTypeIntensity(type) {
  return TYPE_INTENSITY[type] ?? DEFAULT_TYPE_INTENSITY;
}
function alphaForIntensity(max, type) {
  return Math.max(0.08, Math.min(max, max * getTypeIntensity(type)));
}

function buildTypeHighlightRule(type, mode) {
  const c = getColor(type);
  const hRgb = COLOR_RGB[c] || COLOR_RGB.gray, uRgb = UNDERLINE_RGB[c] || UNDERLINE_RGB.gray;
  const hA = alphaForIntensity(MAX_HIGHLIGHT_ALPHA, type).toFixed(3), uA = alphaForIntensity(MAX_UNDERLINE_ALPHA, type).toFixed(3);
  const h = getHighlightName(type), u = getHighlightName(type, 'underline');
  if (mode === 'underline') {
    return `::highlight(${u}){background-color:transparent;text-decoration:underline;text-decoration-color:rgba(${uRgb},${uA});text-decoration-thickness:1px;text-underline-offset:1px}`;
  }
  return `::highlight(${h}){background-color:rgba(${hRgb},${hA})}`;
}

function syncHighlightStyles(activeNames, includeSelected = false) {
  let el = document.getElementById('cf-highlight-styles');
  if (!el) {
    el = document.createElement('style'); el.id = 'cf-highlight-styles'; (document.head || document.documentElement).appendChild(el);
  }
  const rules = [];
  for (const type of Object.keys(TYPE_MAP)) {
    if (activeNames.has(getHighlightName(type))) {
      rules.push(buildTypeHighlightRule(type, 'highlight'));
    }
    if (activeNames.has(getHighlightName(type, 'underline'))) {
      rules.push(buildTypeHighlightRule(type, 'underline'));
    }
  }
  if (activeNames.has(ALL_CAPS_HIGHLIGHT_NAME)) {
    rules.push(`::highlight(${ALL_CAPS_HIGHLIGHT_NAME}){background-color:transparent;text-decoration:underline;text-decoration-color:rgba(125,211,252,.42);text-decoration-thickness:.75px;text-underline-offset:2px}`);
  }
  if (activeNames.has(MULTI_HIGHLIGHT_NAME)) {
    rules.push(`::highlight(${MULTI_HIGHLIGHT_NAME}){background-color:rgba(147,51,234,.42);text-decoration:underline;text-decoration-color:rgba(88,28,135,.95);text-decoration-thickness:1px;text-underline-offset:2px}`);
  }
  if (includeSelected) {
    rules.push(`::highlight(${SELECTED_HIGHLIGHT_NAME}){background-color:CanvasText;color:Canvas}`);
  }
  el.textContent = rules.join('\n');
}

function removeHighlightStyles() {
  document.getElementById('cf-highlight-styles')?.remove();
}

function clearHighlightPresentation() {
  clearRegistry();
  removeHighlightStyles();
  activeHighlightStyleNames = new Set();
}

function updateBadge(count = totalMatches) {
  chrome.runtime.sendMessage({ type: 'COUNT', count }).catch(() => {});
}

function addRange(map, name, range) {
  const list = map.get(name);
  if (list) {
    list.push(range);
  } else {
    map.set(name, [range]);
  }
}

function getActiveHighlightNames(rangesByName) {
  const names = new Set();
  for (const [name, ranges] of rangesByName) {
    if (ranges.length > 0) {
      names.add(name);
    }
  }
  return names;
}

function buildHighlightRegistry(rangesByName) {
  if (!SUPPORTS_HIGHLIGHTS) {
    return;
  }
  clearRegistry();
  const activeNames = getActiveHighlightNames(rangesByName);
  activeHighlightStyleNames = activeNames;
  if (!activeNames.size) {
    removeHighlightStyles();
    return;
  }
  syncHighlightStyles(activeNames);
  for (const [name, ranges] of rangesByName) {
    if (!ranges.length) {
      continue;
    }
    const hl = new Highlight();
    ranges.forEach(r => hl.add(r));
    CSS.highlights.set(name, hl);
  }
}

function restoreHoverReveal() {
  if (!hoverReveal) {
    return;
  }
  if (hoverReveal.node.nodeValue === hoverReveal.revealedText) {
    replaceNodeText(hoverReveal.node, hoverReveal.record.startOffset, hoverReveal.revealEndOffset, hoverReveal.record.replacementText);
    hoverReveal.record.range.setStart(hoverReveal.node, hoverReveal.record.startOffset);
    hoverReveal.record.range.setEnd(hoverReveal.node, hoverReveal.record.endOffset);
  }
  hoverReveal = null;
}

function revealOriginalText(record) {
  if (record.action !== 'replaced' || !record.sourceText || !record.replacementText || hoverReveal?.record === record) {
    return;
  }
  restoreHoverReveal();
  const display = record.node.nodeValue || '';
  if (display.slice(record.startOffset, record.endOffset) !== record.replacementText) {
    return;
  }
  const revealed = display.slice(0, record.startOffset) + record.sourceText + display.slice(record.endOffset);
  hoverReveal = { record, node: record.node, displayText: display, revealedText: revealed, revealEndOffset: record.startOffset + record.sourceText.length };
  replaceNodeText(record.node, record.startOffset, record.endOffset, record.sourceText);
  record.range.setStart(record.node, record.startOffset);
  record.range.setEnd(record.node, hoverReveal.revealEndOffset);
}

function isPointInsideHoverReveal(x, y) {
  if (!hoverReveal) {
    return false;
  }
  const len = hoverReveal.node.nodeValue?.length || 0, start = Math.min(hoverReveal.record.startOffset, len), end = Math.min(hoverReveal.revealEndOffset, len);
  if (start >= end) {
    return false;
  }
  const r = document.createRange();
  r.setStart(hoverReveal.node, start); r.setEnd(hoverReveal.node, end);
  const hit = [...r.getClientRects()].some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  r.detach?.();
  return hit;
}

function hideTooltip() {
  restoreHoverReveal(); activeHover = null; const t = document.getElementById('cf-tooltip'); if (t) {
    t.style.display = 'none';
  }
  if (renderPending) {
    scheduleRender();
  }
}

function scrollRecordIntoView(record) {
  if (!record?.node?.isConnected) {
    return;
  }
  const rect = record.range.getBoundingClientRect();
  if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
    return;
  }
  const scrollingElement = document.scrollingElement || document.documentElement;
  scrollingElement.scrollTop += rect.top - (window.innerHeight / 2) + (rect.height / 2);
}

function isVisibleElement(element, cache) {
  const seen = [];
  for (let current = element; current; current = current.parentElement) {
    if (cache?.has(current)) {
      const cached = cache.get(current);
      seen.forEach(el => cache.set(el, cached));
      return cached;
    }
    seen.push(current);
    const style = window.getComputedStyle(current);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.contentVisibility === 'hidden'
    ) {
      cache?.set(current, false);
      seen.forEach(el => cache?.set(el, false));
      return false;
    }
  }
  seen.forEach(el => cache?.set(el, true));
  return true;
}

function navigateToTerm(term, action) {
  const records = highlightRecords.filter(record =>
    (record.term === term && record.action === action) ||
    record.terms?.some(item => item.phrase === term && item.action === action),
  );
  if (!records.length) {
    return;
  }
  const key = `${action}\n${term}`;
  const index = ((navigationIndexes.get(key) ?? -1) + 1) % records.length;
  navigationIndexes.set(key, index);
  const record = records[index];
  scrollRecordIntoView(record);
  if (SUPPORTS_HIGHLIGHTS) {
    syncHighlightStyles(activeHighlightStyleNames, true);
    CSS.highlights.set(SELECTED_HIGHLIGHT_NAME, new Highlight(record.range));
  }
}

function showTooltip(record, x, y) {
  let tip = document.getElementById('cf-tooltip');
  if (!tip) {
    tip = document.createElement('div'); tip.id = 'cf-tooltip'; document.body.appendChild(tip);
  }
  const terms = record.terms?.length ? record.terms : [{ type: record.type, category: record.category }];
  tip.textContent = terms.map(term => `${term.type} - ${term.category}`).join('\n');
  tip.style.display = 'block';
  revealOriginalText(record);
  const r = record.range.getBoundingClientRect();
  const left = Number.isFinite(r.left) && r.width > 0 ? r.left : x;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, (Number.isFinite(r.top) && r.height > 0 ? r.top : y) - tip.offsetHeight - 8)}px`;
}

function findRecordAtPoint(node, offset) {
  const records = highlightRecordsByNode.get(node) || [];
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].range.isPointInRange(node, offset)) {
      return records[i];
    }
  }
  return null;
}

function handleHoverMove(e) {
  if (!settings.enabled || !highlightRecords.length) {
    return;
  }
  const rawCaret = document.caretPositionFromPoint
    ? document.caretPositionFromPoint(e.clientX, e.clientY)
    : document.caretRangeFromPoint?.(e.clientX, e.clientY);
  const cp = /** @type {CaretPosition | null} */ (rawCaret);
  const range = /** @type {Range | null} */ (rawCaret);
  const node = cp?.offsetNode || range?.startContainer;
  const offset = cp?.offset ?? range?.startOffset;
  if (!node || typeof offset !== 'number') {
    if (activeHover) {
      hideTooltip();
    } return;
  }
  const record = findRecordAtPoint(node, offset);
  if (!record) {
    if (!isPointInsideHoverReveal(e.clientX, e.clientY) && activeHover) {
      hideTooltip();
    } return;
  }
  if (activeHover === record) {
    return;
  }
  restoreHoverReveal();
  activeHover = record;
  showTooltip(record, e.clientX, e.clientY);
}

function getTermAction(term) {
  const remove = term.remove && settings.removeTerms;
  const replace = !remove && settings.replaceTerms && term.hasNeutral;
  return remove ? 'removed' : replace ? 'replaced' : 'highlighted';
}

function getReplacementText(term, src, action) {
  if (action === 'removed') {
    return '';
  }
  if (action === 'replaced') {
    return getReplacementForTerm(term, src);
  }
  return src;
}

function getModeForEntry(term, action, terms = [term]) {
  if (action === 'highlighted') {
    if (terms.length > 1) {
      return 'multiple';
    }
    return 'highlight';
  }
  if (action !== 'replaced') {
    return null;
  }
  if (terms.length > 1) {
    return 'multiple';
  }
  return term.phrase === ALL_CAPS_TERM.phrase ? 'all-caps-underline' : 'underline';
}

function getHighlightNameForMode(type, mode) {
  if (mode === 'all-caps-underline') {
    return ALL_CAPS_HIGHLIGHT_NAME;
  }
  if (mode === 'multiple') {
    return MULTI_HIGHLIGHT_NAME;
  }
  return getHighlightName(type, mode);
}

function incrementTermStat(term, action) {
  (termStats[term.phrase] ||= { highlighted: 0, replaced: 0, removed: 0 })[action]++;
  totalMatches++;
}

function getTermsForMatch(match) {
  return (match.termIds || [match.termId]).map(getTermById).filter(Boolean);
}

function processNodePlan(text) {
  const matches = initFindMatches(text);
  const allCaps = isEnabled(ALL_CAPS_TERM.type) ? findAllCapsMatches(text) : [];
  const combined = resolveMatchGroups([...matches, ...allCaps]);
  if (!combined.length) {
    return { displayText: text, entries: [], matches: combined };
  }

  let cursor = 0, displayText = '';
  const entries = [];
  for (const m of combined) {
    const terms = getTermsForMatch(m);
    const term = chooseReplacementTerm(terms, getTermAction, ALL_CAPS_TERM.phrase);
    if (!term) {
      continue;
    }
    const src = text.slice(m.start, m.end);
    displayText += text.slice(cursor, m.start);
    const start = displayText.length, action = getTermAction(term), replacementSrc = getReplacementSourceText(term, terms, src, ALL_CAPS_TERM.phrase, lowerAllCapsLongWords), replacement = getReplacementText(term, replacementSrc, action);
    displayText += replacement;
    const end = displayText.length, mode = getModeForEntry(term, action, terms);
    if (mode) {
      entries.push({ start, end, term, terms, mode, action, sourceText: src, replacementText: replacement, highlightName: getHighlightNameForMode(term.type, mode) });
    }
    cursor = m.end;
  }
  displayText += text.slice(cursor);
  return { displayText, entries, matches: combined };
}

function restoreOriginalTextNodes() {
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode; if (originalNodeText.has(n)) {
      setNodeText(n, originalNodeText.get(n)); originalNodeText.delete(n);
    }
  }
}

function processNode(node, rangesByName, records, visibilityCache) {
  if (skipNode(node, visibilityCache)) {
    return;
  }
  const current = node.nodeValue || '';
  const source = originalNodeText.get(node) ?? current;
  if (!source || source.trim().length < 2) {
    if (originalNodeText.has(node) && current !== source) {
      setNodeText(node, source);
    }
    originalNodeText.delete(node);
    return;
  }
  const { displayText, entries, matches } = processNodePlan(source);
  if (displayText !== source) {
    originalNodeText.set(node, source);
  } else {
    originalNodeText.delete(node);
  }
  if (current !== displayText) {
    setNodeText(node, displayText);
  }
  for (const m of matches) {
    for (const t of getTermsForMatch(m)) {
      incrementTermStat(t, getTermAction(t));
    }
  }
  for (const e of entries) {
    const range = document.createRange();
    range.setStart(node, e.start); range.setEnd(node, e.end);
    const rec = {
      range,
      node,
      startOffset: e.start,
      endOffset: e.end,
      term: e.term.phrase,
      terms: e.terms.map(term => ({
        phrase: term.phrase,
        type: term.type,
        category: getCategory(term.type),
        action: getTermAction(term),
      })),
      type: e.term.type,
      category: getCategory(e.term.type),
      action: e.action,
      sourceText: e.sourceText,
      replacementText: e.replacementText,
      highlightName: e.highlightName,
    };
    records.push(rec);
    const nr = highlightRecordsByNode.get(node);
    if (nr) {
      nr.push(rec);
    } else {
      highlightRecordsByNode.set(node, [rec]);
    }
    addRange(rangesByName, e.highlightName, range);
  }
}

function renderHighlights() {
  const full = dirtyNodes === null;
  if (full) {
    termStats = Object.create(null); totalMatches = 0; highlightRecords = []; highlightRecordsByNode = new WeakMap();
    navigationIndexes.clear();
  }
  if (!settings.enabled || !matcher || !document.body) {
    if (!settings.enabled && document.body) {
      restoreOriginalTextNodes();
    }
    clearHighlightPresentation(); updateBadge(); dirtyNodes = null; return;
  }
  const rangesByName = new Map(), newRecords = [];
  const visibilityCache = new WeakMap();
  if (full) {
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    nodes.forEach(n => processNode(n, rangesByName, newRecords, visibilityCache));
    highlightRecords = newRecords;
  } else {
    const nodes = [...dirtyNodes].filter(n => n.parentElement && !skipNode(n, visibilityCache));
    dirtyNodes = null;
    const nodeSet = new Set(nodes);
    highlightRecords = highlightRecords.filter(r => {
      if (!r.node.isConnected || !r.node.parentElement) {
        return false;
      }
      if (nodeSet.has(r.node)) {
        return false;
      }
      addRange(rangesByName, r.highlightName, r.range);
      return true;
    });
    nodeSet.forEach(n => {
      highlightRecordsByNode.delete(n); const cur = n.nodeValue || ''; const src = originalNodeText.get(n) ?? cur; if (!src || src.trim().length < 2) {
        if (originalNodeText.has(n) && cur !== src) {
          setNodeText(n, src);
        } originalNodeText.delete(n);
      }
    });
    nodes.forEach(n => processNode(n, rangesByName, newRecords, visibilityCache));
    highlightRecords.push(...newRecords);
  }
  buildHighlightRegistry(rangesByName);
  updateBadge();
}

function scheduleRender() {
  if (hoverReveal) {
    renderPending = true;
    return;
  }
  if (rerenderFrame) {
    return;
  }
  renderPending = false;
  rerenderFrame = requestAnimationFrame(() => {
    rerenderFrame = 0;
    if (hoverReveal) {
      renderPending = true;
      return;
    }
    renderHighlights();
  });
}

function isEditableEventTarget(target) {
  return target instanceof Element && (/** @type {HTMLElement} */(target).isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function saveRuntimeSettings() {
  void chrome.storage.sync.set({ settings });
}

function toggleRuntimeSetting(key) {
  settings = normalizeSettings({ ...settings, [key]: !settings[key] });
  saveRuntimeSettings();
  matcher = initMatcher();
  hideTooltip();
  dirtyNodes = null;
  renderHighlights();
}

function handleKeyDown(e) {
  if (isEditableEventTarget(e.target) || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.repeat) {
    return;
  }
  const s = RUNTIME_SHORTCUTS[e.key.toLowerCase()];
  if (!s) {
    return;
  }
  e.preventDefault();
  toggleRuntimeSetting(s);
}

function isTooltipNode(node) {
  return node instanceof Element && (node.id === 'cf-tooltip' || !!node.closest?.('#cf-tooltip'));
}

function isSkippedMutationNode(node, visibilityCache) {
  if (isTooltipNode(node)) {
    return true;
  }
  const el = node instanceof Element ? node : node?.parentElement;
  return !el || el.isContentEditable || SKIP_TAGS.has(el.tagName) || !!el.closest(SKIP_SELECTOR) || !isVisibleElement(el, visibilityCache);
}

function hasMeaningfulText(node) {
  return (node.textContent || node.nodeValue || '').trim().length >= 2;
}

function init() {
  chrome.storage.sync.get(['settings', 'userTypeColors'], (/** @type {any} */ r) => {
    loadSettings(r.settings, r.userTypeColors);
    matcher = initMatcher();
    const start = () => {
      dirtyNodes = null; renderHighlights();
    };
    if (document.body) {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    }

    const mo = new MutationObserver(mutations => {
      if (!settings.enabled) {
        return;
      }
      if (dirtyNodes === null) {
        dirtyNodes = new Set();
      }
      const visibilityCache = new WeakMap();
      for (const m of mutations) {
        if (m.type === 'characterData') {
          if (internallyMutatedNodes.has(m.target)) {
            internallyMutatedNodes.delete(m.target);
          } else {
            originalNodeText.delete(m.target);
            if (!isSkippedMutationNode(m.target, visibilityCache) && hasMeaningfulText(m.target)) {
              dirtyNodes.add(m.target);
            }
          }
        } else {
          for (const n of m.addedNodes) {
            if (n.nodeType === Node.TEXT_NODE) {
              if (!isSkippedMutationNode(n, visibilityCache) && hasMeaningfulText(n)) {
                dirtyNodes.add(n);
              }
            } else if (n.nodeType === Node.ELEMENT_NODE) {
              const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
              while (w.nextNode()) {
                const tn = w.currentNode; if (!isSkippedMutationNode(tn, visibilityCache) && hasMeaningfulText(tn)) {
                  dirtyNodes.add(tn);
                }
              }
            }
          }
        }
      }
      if (dirtyNodes.size > 0) {
        scheduleRender();
      }
    });
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
    document.addEventListener('mousemove', handleHoverMove, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('blur', hideTooltip);
  });
}

if (window.top === window) {
  init();
}

chrome.runtime.onMessage.addListener((msg, _src, sendResponse) => {
  if (msg.type === 'GET_COUNT') {
    sendResponse({ count: totalMatches }); return;
  }
  if (msg.type === 'GET_TERMS') {
    const groups = { highlighted: [], replaced: [], removed: [] };
    for (const [term, counts] of Object.entries(termStats)) {
      for (const action of Object.keys(groups)) {
        const c = counts[action] || 0; if (c > 0) {
          groups[action].push({ term, count: c });
        }
      }
    }
    for (const action of Object.keys(groups)) {
      groups[action].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
    }
    sendResponse({ groups }); return;
  }
  if (msg.type === 'NAVIGATE_TERM') {
    navigateToTerm(msg.term, msg.action);
    return;
  }
  if (msg.type === 'RELOAD_SETTINGS') {
    chrome.storage.sync.get(['settings', 'userTypeColors'], (/** @type {any} */ r) => {
      loadSettings(r.settings, r.userTypeColors); matcher = initMatcher(); dirtyNodes = null; renderHighlights();
    });
  }
});
