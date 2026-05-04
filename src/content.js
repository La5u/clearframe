'use strict';
import { buildMatcher, findMatches } from './core/matcher.js';
import { getAllCapsAction, lowerAllCapsLongWords, matchReplacementCase } from './core/display-utils.js';
import { pluralizeWord, pastTenseWord, ingWord, adverbWord } from './core/stemmer.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings-utils.js';

const { index, types: TYPE_MAP, categories: TYPE_CATEGORIES } = ClearFrame;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE']);
const SKIP_SELECTOR = 'nav,button,select,option,[role=navigation],[role=menu],[aria-hidden=true],#cf-tooltip';
const HIGHLIGHT_PREFIX = 'clearframe-';
const UNDERLINE_SUFFIX = '-underline';
const ALL_CAPS_HIGHLIGHT_NAME = 'clearframe-all-caps-underline';
const TYPE_HIGHLIGHT_NAMES = Object.keys(TYPE_MAP).flatMap(type => [
  getHighlightName(type),
  getHighlightName(type, 'underline')
]);
const SUPPORTS_HIGHLIGHTS = !!(globalThis.Highlight && globalThis.CSS?.highlights);
const COLOR_RGB = {
  yellow: '250, 204, 21',
  green: '74, 222, 128',
  gray: '209, 213, 219',
  red: '248, 113, 113',
  pink: '244, 114, 182',
  orange: '251, 146, 60',
  purple: '196, 128, 255',
  blue: '96, 165, 250',
  teal: '45, 212, 191',
  brown: '161, 98, 7'
};
const UNDERLINE_RGB = {
  yellow: '202, 138, 4',
  green: '22, 163, 74',
  gray: '107, 114, 128',
  red: '220, 38, 38',
  pink: '219, 39, 119',
  orange: '234, 88, 12',
  purple: '147, 51, 234',
  blue: '37, 99, 235',
  teal: '20, 184, 166',
  brown: '120, 53, 15'
};
const DEFAULT_TYPE_INTENSITY = 0.65;
const TYPE_INTENSITY = {
  absolute: 0.5,
  aggression: 0.75,
  authority: 0.65,
  clickbait: 0.85,
  colloquialism: 0.35,
  conflict: 0.65,
  derogatory: 0.95,
  distancing: 0.7,
  dysphemism: 0.8,
  euphemism: 0.75,
  exaggeration: 0.7,
  fear: 0.9,
  hype: 0.65,
  idiom: 0.35,
  loaded: 0.9,
  'loaded-framing': 0.85,
  minimizing: 0.6,
  moral: 0.8,
  'negative-framing': 0.75,
  passive: 0.7,
  repetition: 0.45,
  reveal: 0.65,
  'rhetorical-question': 0.4,
  superlative: 0.65,
  uncertainty: 0.65,
  unsourced: 0.8
};
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
const originalNodeText = new WeakMap();
const internallyMutatedNodes = new WeakSet();

let settings = normalizeSettings(DEFAULT_SETTINGS);
const ALL_CAPS_TERM_ID = '__clearframe_all_caps__';
const ALL_CAPS_TERM = {
  phrase: 'caps emphasis',
  type: 'clickbait',
  neutral: 'Caps normalized.',
  stemType: '',
  regex: '',
  remove: false,
  hasNeutral: true
};

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
  const safeType = String(type).replace(/[^a-z0-9-]/gi, '-');
  return mode === 'underline'
    ? HIGHLIGHT_PREFIX + safeType + UNDERLINE_SUFFIX
    : HIGHLIGHT_PREFIX + safeType;
}

function getTermById(termId) {
  return index.termsById[termId] || (termId === ALL_CAPS_TERM_ID ? ALL_CAPS_TERM : null);
}

function applyStemmedReplacement(sourceText, basePhrase, replacement, stemType) {
  const source = sourceText.toLowerCase();
  const base = basePhrase.toLowerCase();
  let next = replacement;

  if (stemType === 'noun') {
    if (source === pluralizeWord(base)) next = pluralizeWord(replacement);
  } else if (stemType === 'verb') {
    if (source === pluralizeWord(base)) next = pluralizeWord(replacement);
    else if (source === pastTenseWord(base)) next = pastTenseWord(replacement);
    else if (source === ingWord(base)) next = ingWord(replacement);
  } else if (stemType === 'adjective') {
    if (source === adverbWord(base)) next = adverbWord(replacement);
  }

  return matchReplacementCase(sourceText, next);
}

function getReplacementForTerm(term, sourceText) {
  if (term.phrase === ALL_CAPS_TERM.phrase) {
    return lowerAllCapsLongWords(sourceText);
  }
  return applyStemmedReplacement(sourceText, term.phrase, term.neutral, term.stemType || '');
}

function findAllCapsMatches(text) {
  const matches = [];
  const pattern = /\b[A-Z0-9]+(?:'[A-Z0-9]+)*\b/g;
  let pending = null;
  for (const match of text.matchAll(pattern)) {
    if (typeof match.index !== 'number' || !match[0]) continue;
    if (!getAllCapsAction(match[0])) continue;
    const start = match.index;
    const end = match.index + match[0].length;
    if (pending && /^[\s:;,.!?'"()[\]{}-]+$/.test(text.slice(pending.end, start))) {
      pending.end = end;
      continue;
    }
    if (pending) matches.push(pending);
    pending = { start, end, termId: ALL_CAPS_TERM_ID, virtual: true };
  }
  if (pending) matches.push(pending);
  return matches;
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function resolveMatches(matches) {
  const accepted = [];

  for (const match of matches) {
    const overlappingIndexes = [];
    for (let i = 0; i < accepted.length; i++) {
      if (overlaps(match, accepted[i])) overlappingIndexes.push(i);
    }

    if (!overlappingIndexes.length) {
      accepted.push(match);
      continue;
    }

    if (match.virtual) {
      continue;
    }

    for (let i = overlappingIndexes.length - 1; i >= 0; i--) {
      const acceptedMatch = accepted[overlappingIndexes[i]];
      if (acceptedMatch.virtual) accepted.splice(overlappingIndexes[i], 1);
    }

    if (!accepted.some(existing => overlaps(match, existing))) {
      accepted.push(match);
    }
  }

  return accepted.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
}

function setNodeText(node, text) {
  if (node.nodeValue === text) return;
  internallyMutatedNodes.add(node);
  node.nodeValue = text;
}

function initMatcher() {
  return buildMatcher(index, term => isEnabled(term.type));
}

function initFindMatches(text) {
  return findMatches(matcher, text, index.termsById, index.regexTerms || []);
}

function skipNode(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  return (
    parent.isContentEditable ||
    SKIP_TAGS.has(parent.tagName) ||
    parent.closest(SKIP_SELECTOR)
  );
}

function clearRegistry() {
  if (!SUPPORTS_HIGHLIGHTS) return;
  for (const name of TYPE_HIGHLIGHT_NAMES) {
    CSS.highlights.delete(name);
  }
  CSS.highlights.delete(ALL_CAPS_HIGHLIGHT_NAME);
}

function getTypeIntensity(type) {
  return TYPE_INTENSITY[type] ?? DEFAULT_TYPE_INTENSITY;
}

function alphaForIntensity(maxAlpha, type) {
  return Math.max(0.08, Math.min(maxAlpha, maxAlpha * getTypeIntensity(type)));
}

function buildTypeHighlightRule(type) {
  const color = getColor(type);
  const highlightRgb = COLOR_RGB[color] || COLOR_RGB.gray;
  const underlineRgb = UNDERLINE_RGB[color] || UNDERLINE_RGB.gray;
  const highlightAlpha = alphaForIntensity(MAX_HIGHLIGHT_ALPHA, type);
  const underlineAlpha = alphaForIntensity(MAX_UNDERLINE_ALPHA, type);
  return `
::highlight(${getHighlightName(type)}) {
  background-color: rgba(${highlightRgb}, ${highlightAlpha.toFixed(3)});
}
::highlight(${getHighlightName(type, 'underline')}) {
  background-color: transparent;
  text-decoration: underline;
  text-decoration-color: rgba(${underlineRgb}, ${underlineAlpha.toFixed(3)});
  text-decoration-thickness: 1px;
  text-underline-offset: 1px;
}`;
}

function syncHighlightStyles() {
  let style = document.getElementById('cf-highlight-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'cf-highlight-styles';
    (document.head || document.documentElement).appendChild(style);
  }
  const typeRules = Object.keys(TYPE_MAP).map(buildTypeHighlightRule).join('\n');
  style.textContent = `${typeRules}
::highlight(${ALL_CAPS_HIGHLIGHT_NAME}) {
  background-color: transparent;
  text-decoration: underline;
  text-decoration-color: rgba(125, 211, 252, 0.42);
  text-decoration-thickness: 0.75px;
  text-underline-offset: 2px;
}`;
}

function updateBadge(count = totalMatches) {
  chrome.runtime.sendMessage({ type: 'COUNT', count }).catch(() => {});
}

function buildHighlightRegistry(rangesByName) {
  if (!SUPPORTS_HIGHLIGHTS) return;
  syncHighlightStyles();
  clearRegistry();
  for (const [name, ranges] of rangesByName) {
    if (!ranges.length) continue;
    const highlight = new Highlight();
    for (const range of ranges) highlight.add(range);
    CSS.highlights.set(name, highlight);
  }
}

function restoreHoverReveal() {
  if (!hoverReveal) return;
  if (hoverReveal.node.nodeValue === hoverReveal.revealedText) {
    setNodeText(hoverReveal.node, hoverReveal.displayText);
    hoverReveal.record.range.setStart(hoverReveal.node, hoverReveal.record.startOffset);
    hoverReveal.record.range.setEnd(hoverReveal.node, hoverReveal.record.endOffset);
  }
  hoverReveal = null;
}

function revealOriginalText(record) {
  if (record.action !== 'replaced' || !record.sourceText || !record.replacementText) return;
  if (hoverReveal?.record === record) return;
  restoreHoverReveal();

  const displayText = record.node.nodeValue || '';
  if (displayText.slice(record.startOffset, record.endOffset) !== record.replacementText) return;

  const revealedText = displayText.slice(0, record.startOffset) +
    record.sourceText +
    displayText.slice(record.endOffset);
  hoverReveal = {
    record,
    node: record.node,
    displayText,
    revealedText,
    revealEndOffset: record.startOffset + record.sourceText.length
  };
  setNodeText(record.node, revealedText);
  record.range.setStart(record.node, record.startOffset);
  record.range.setEnd(record.node, record.revealEndOffset);
}

function isPointInsideHoverReveal(x, y) {
  if (!hoverReveal) return false;
  const length = hoverReveal.node.nodeValue?.length || 0;
  const start = Math.min(hoverReveal.record.startOffset, length);
  const end = Math.min(hoverReveal.revealEndOffset, length);
  if (start >= end) return false;

  const range = document.createRange();
  range.setStart(hoverReveal.node, start);
  range.setEnd(hoverReveal.node, end);
  const rects = [...range.getClientRects()];
  range.detach?.();
  return rects.some(rect =>
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom
  );
}

function hideTooltip() {
  restoreHoverReveal();
  activeHover = null;
  const tip = document.getElementById('cf-tooltip');
  if (tip) tip.style.display = 'none';
}

function showTooltip(record, x, y) {
  let tip = document.getElementById('cf-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'cf-tooltip';
    document.body.appendChild(tip);
  }

  tip.textContent = `${record.type} - ${record.category}`;
  tip.style.display = 'block';
  revealOriginalText(record);

  const rect = record.range.getBoundingClientRect();
  const left = Number.isFinite(rect.left) && rect.width > 0 ? rect.left : x;
  const top = Number.isFinite(rect.top) && rect.height > 0 ? rect.top : y;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top - tip.offsetHeight - 8)}px`;
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
  if (!settings.enabled || !highlightRecords.length) return;
  const caret = document.caretPositionFromPoint
    ? document.caretPositionFromPoint(e.clientX, e.clientY)
    : document.caretRangeFromPoint?.(e.clientX, e.clientY);
  const node = caret?.offsetNode || caret?.startContainer;
  const offset = caret?.offset ?? caret?.startOffset;
  if (!node || typeof offset !== 'number') {
    if (activeHover) hideTooltip();
    return;
  }
  const record = findRecordAtPoint(node, offset);
  if (!record) {
    if (isPointInsideHoverReveal(e.clientX, e.clientY)) return;
    if (activeHover) hideTooltip();
    return;
  }
  if (activeHover === record) return;
  restoreHoverReveal();
  activeHover = record;
  showTooltip(record, e.clientX, e.clientY);
}

function compareMatches(a, b) {
  if (a.start !== b.start) return a.start - b.start;
  const lengthDelta = (b.end - b.start) - (a.end - a.start);
  if (lengthDelta !== 0) return lengthDelta;
  return Number(!!a.virtual) - Number(!!b.virtual);
}

function getTermAction(term) {
  const shouldRemove = term.remove && settings.removeTerms;
  const shouldReplace = !shouldRemove && settings.replaceTerms && term.hasNeutral;
  if (shouldRemove) return 'removed';
  return shouldReplace ? 'replaced' : 'highlighted';
}

function getReplacementText(term, sourceText, action) {
  if (action === 'removed') return '';
  if (action === 'replaced') return getReplacementForTerm(term, sourceText);
  return sourceText;
}

function getModeForEntry(term, action) {
  if (action === 'highlighted') return 'highlight';
  if (action !== 'replaced') return null;
  return term.phrase === ALL_CAPS_TERM.phrase ? 'all-caps-underline' : 'underline';
}

function incrementTermStat(term, action) {
  const bucket = termStats[term.phrase] || (termStats[term.phrase] = { highlighted: 0, replaced: 0, removed: 0 });
  bucket[action]++;
  totalMatches++;
}

function createHighlightRecord(range, entry) {
  return {
    range,
    node: range.startContainer,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    type: entry.term.type,
    category: getCategory(entry.term.type),
    action: entry.action,
    sourceText: entry.sourceText,
    replacementText: entry.replacementText
  };
}

function addRangeForEntry(rangesByName, range, entry) {
  const name = entry.mode === 'all-caps-underline'
    ? ALL_CAPS_HIGHLIGHT_NAME
    : getHighlightName(entry.term.type, entry.mode);
  const list = rangesByName.get(name);
  if (list) list.push(range);
  else rangesByName.set(name, [range]);
}

function buildNodePlan(text) {
  const matches = initFindMatches(text);
  const allCapsMatches = findAllCapsMatches(text);
  const combinedMatches = resolveMatches([...matches, ...allCapsMatches].sort(compareMatches));

  if (!combinedMatches.length) {
    return { displayText: text, plannedHighlights: [], matches: combinedMatches };
  }

  let cursor = 0;
  let displayText = '';
  const plannedHighlights = [];

  for (const match of combinedMatches) {
    const term = getTermById(match.termId);
    if (!term) continue;
    const sourceText = text.slice(match.start, match.end);

    displayText += text.slice(cursor, match.start);
    const start = displayText.length;
    const action = getTermAction(term);
    const replacement = getReplacementText(term, sourceText, action);

    displayText += replacement;
    const end = displayText.length;
    const mode = getModeForEntry(term, action);
    if (mode) plannedHighlights.push({ start, end, term, mode, action, sourceText, replacementText: replacement });

    cursor = match.end;
  }

  displayText += text.slice(cursor);
  return { displayText, plannedHighlights, matches: combinedMatches };
}

function restoreOriginalTextNodes() {
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!originalNodeText.has(node)) continue;
    setNodeText(node, originalNodeText.get(node));
    originalNodeText.delete(node);
  }
}

function renderHighlights() {
  termStats = Object.create(null);
  totalMatches = 0;
  highlightRecords = [];
  highlightRecordsByNode = new WeakMap();

  if (!settings.enabled || !matcher || !document.body) {
    if (!settings.enabled && document.body) {
      restoreOriginalTextNodes();
    }
    clearRegistry();
    updateBadge();
    return;
  }

  const rangesByName = new Map();
  const records = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    if (skipNode(node)) continue;
    const currentText = node.nodeValue || '';
    const sourceText = originalNodeText.get(node) ?? currentText;

    if (!sourceText || sourceText.trim().length < 2) {
      if (originalNodeText.has(node) && currentText !== sourceText) {
        setNodeText(node, sourceText);
      }
      originalNodeText.delete(node);
      continue;
    }

    const { displayText, plannedHighlights, matches } = buildNodePlan(sourceText);
    const didReplace = displayText !== sourceText;
    const nextText = didReplace ? displayText : sourceText;

    if (didReplace) {
      originalNodeText.set(node, sourceText);
    } else {
      originalNodeText.delete(node);
    }

    if (currentText !== nextText) {
      setNodeText(node, nextText);
    }

    for (const match of matches) {
      const term = getTermById(match.termId);
      if (!term) continue;
      incrementTermStat(term, getTermAction(term));
    }

    for (const entry of plannedHighlights) {
      const range = document.createRange();
      range.setStart(node, entry.start);
      range.setEnd(node, entry.end);
      const record = createHighlightRecord(range, entry);
      records.push(record);
      const nodeRecords = highlightRecordsByNode.get(node);
      if (nodeRecords) nodeRecords.push(record);
      else highlightRecordsByNode.set(node, [record]);
      addRangeForEntry(rangesByName, range, entry);
    }
  }

  highlightRecords = records;
  buildHighlightRegistry(rangesByName);
  updateBadge();
}

function scheduleRender() {
  if (rerenderFrame) return;
  rerenderFrame = requestAnimationFrame(() => {
    rerenderFrame = 0;
    renderHighlights();
  });
}

function isEditableEventTarget(target) {
  return target instanceof Element && (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

function saveRuntimeSettings() {
  chrome.storage.sync.set({ settings });
}

function toggleRuntimeSetting(key) {
  settings = normalizeSettings({ ...settings, [key]: !settings[key] });
  saveRuntimeSettings();
  matcher = initMatcher();
  hideTooltip();
  renderHighlights();
}

function handleKeyDown(e) {
  if (isEditableEventTarget(e.target) || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.repeat) return;

  const setting = RUNTIME_SHORTCUTS[e.key.toLowerCase()];
  if (!setting) return;
  e.preventDefault();
  toggleRuntimeSetting(setting);
}

function isTooltipNode(node) {
  return node instanceof Element && (node.id === 'cf-tooltip' || node.closest?.('#cf-tooltip'));
}

function isSkippedMutationNode(node) {
  if (isTooltipNode(node)) return true;
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el) return true;
  return (
    el.isContentEditable ||
    SKIP_TAGS.has(el.tagName) ||
    !!el.closest(SKIP_SELECTOR)
  );
}

function hasMeaningfulText(node) {
  return (node.textContent || node.nodeValue || '').trim().length >= 2;
}

function hasRenderableMutation(mutations) {
  return mutations.some(mutation => {
    if (mutation.type === 'characterData') {
      if (internallyMutatedNodes.has(mutation.target)) {
        internallyMutatedNodes.delete(mutation.target);
        return false;
      }
      return !isSkippedMutationNode(mutation.target) && hasMeaningfulText(mutation.target);
    }
    return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
      !isSkippedMutationNode(node) && hasMeaningfulText(node)
    );
  });
}

function init() {
  chrome.storage.sync.get(['settings', 'userTypeColors'], r => {
    loadSettings(r.settings, r.userTypeColors);
    matcher = initMatcher();
    const start = () => {
      renderHighlights();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    const mutationObserver = new MutationObserver(mutations => {
      if (!settings.enabled) return;
      for (const mutation of mutations) {
        if (mutation.type === 'characterData' && !internallyMutatedNodes.has(mutation.target)) {
          originalNodeText.delete(mutation.target);
        }
      }
      if (hasRenderableMutation(mutations)) {
        scheduleRender();
      }
    });
    mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    document.addEventListener('mousemove', handleHoverMove, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('blur', hideTooltip);
  });
}

if (window.top === window) init();

chrome.runtime.onMessage.addListener((msg, src, sendResponse) => {
  if (msg.type === 'GET_COUNT') {
    sendResponse({ count: totalMatches });
    return;
  }

  if (msg.type === 'GET_TERMS') {
    const groups = { highlighted: [], replaced: [], removed: [] };
    for (const [term, counts] of Object.entries(termStats)) {
      for (const action of Object.keys(groups)) {
        const count = counts[action] || 0;
        if (count > 0) groups[action].push({ term, count });
      }
    }
    for (const action of Object.keys(groups)) {
      groups[action].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
    }
    sendResponse({ groups });
    return;
  }

  if (msg.type === 'RELOAD_SETTINGS') {
    chrome.storage.sync.get(['settings', 'userTypeColors'], r => {
      loadSettings(r.settings, r.userTypeColors);
      matcher = initMatcher();
      renderHighlights();
    });
  }
});
