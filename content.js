'use strict';

const { index, types: TYPE_MAP, categories: TYPE_CATEGORIES } = ClearFrame;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE']);
const SKIP_SELECTOR = 'nav,button,select,option,[role=navigation],[role=menu],[aria-hidden=true],#cf-tooltip';
const HIGHLIGHT_PREFIX = 'clearframe-';
const HIGHLIGHT_NAMES = [...new Set(Object.values(TYPE_MAP))].map(color => HIGHLIGHT_PREFIX + color);
const UNDERLINE_SUFFIX = '-underline';
const UNDERLINE_NAMES = [...new Set(Object.values(TYPE_MAP))].map(color => HIGHLIGHT_PREFIX + color + UNDERLINE_SUFFIX);
const SUPPORTS_HIGHLIGHTS = !!(globalThis.Highlight && globalThis.CSS?.highlights);
const DEFAULT_SETTINGS = {
  enabled: true,
  replaceTerms: false,
  removeTerms: false,
  types: { absolute: false, moral: false, superlative: false },
  userTypeColors: {}
};

let settings = { ...DEFAULT_SETTINGS, types: { ...DEFAULT_SETTINGS.types } };
let matcher = null;
let totalMatches = 0;
let termStats = Object.create(null);
let highlightRecords = [];
let activeHover = null;
let hoverFrame = 0;
let hoverPoint = null;
let rerenderFrame = 0;
const originalNodeText = new WeakMap();
const internallyMutatedNodes = new WeakSet();

const { buildMatcher, findMatches } = require('./matcher');
const { lowerAllCapsLongWords } = require('./display-utils');
const { pluralizeWord, pastTenseWord, ingWord, adverbWord } = require('./stemmer');
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
const ALL_CAPS_MIN_LENGTH = 4;
const ALL_CAPS_COMMON_WORDS = new Set([
  'AND',
  'ALL',
  'THE',
  'THIS',
  'THAT',
  'WITH',
  'FROM',
  'INTO',
  'OVER',
  'YOUR',
  'YOURS',
  'ONLY',
  'VERY',
  'JUST',
  'MORE',
  'MOST',
  'NOT',
  'BUT',
  'FOR',
  'OUT',
  'OUR',
  'ARE',
  'YOU',
  'NOW',
  'SEE'
]);
const ALL_CAPS_ACRONYMS = new Set([
  'ABBA',
  'AI',
  'BBC',
  'CBS',
  'CDC',
  'CEO',
  'EU',
  'FDA',
  'FBI',
  'GOP',
  'IRS',
  'LAX',
  'MLB',
  'NBA',
  'NHL',
  'NFL',
  'NYP',
  'NATO',
  'SEC',
  'UN',
  'UK',
  'USA',
  'UFC',
  'WWE'
]);

function loadSettings(rawSettings = {}, rawTypeColors = {}) {
  const next = { ...DEFAULT_SETTINGS, ...rawSettings };
  next.types = { ...(next.types || {}) };
  if (!Object.keys(next.types).length) {
    next.types.absolute = false;
    next.types.moral = false;
    next.types.superlative = false;
  }
  next.userTypeColors = { ...(next.userTypeColors || {}), ...rawTypeColors };
  settings = next;
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
  const color = getColor(type);
  return mode === 'underline'
    ? HIGHLIGHT_PREFIX + color + UNDERLINE_SUFFIX
    : HIGHLIGHT_PREFIX + color;
}

function getTermById(termId) {
  return index.termsById[termId] || (termId === ALL_CAPS_TERM_ID ? ALL_CAPS_TERM : null);
}

function getAllCapsAction(text) {
  const normalized = text.toUpperCase();
  if (ALL_CAPS_COMMON_WORDS.has(normalized)) return 'all-caps';
  if (normalized.length < ALL_CAPS_MIN_LENGTH) return null;
  if (ALL_CAPS_ACRONYMS.has(normalized)) return null;
  return /^[A-Z]{4,}$/.test(normalized) ? 'all-caps' : null;
}

function isAllCapsText(text) {
  return getAllCapsAction(text) === 'all-caps';
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

  return next ? next.toLowerCase() : next;
}

function getReplacementForTerm(term, sourceText) {
  if (term.phrase === ALL_CAPS_TERM.phrase) {
    return lowerAllCapsLongWords(sourceText);
  }
  return applyStemmedReplacement(sourceText, term.phrase, term.neutral, term.stemType || '');
}

function findAllCapsMatches(text) {
  const matches = [];
  const pattern = /\b[A-Z0-9]{2,}\b/g;
  for (const match of text.matchAll(pattern)) {
    if (typeof match.index !== 'number' || !match[0]) continue;
    if (!getAllCapsAction(match[0])) continue;
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      termId: ALL_CAPS_TERM_ID,
      virtual: true
    });
  }
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
  for (const name of HIGHLIGHT_NAMES) {
    CSS.highlights.delete(name);
  }
  for (const name of UNDERLINE_NAMES) {
    CSS.highlights.delete(name);
  }
}

function updateBadge(count = totalMatches, loading = false) {
  chrome.runtime.sendMessage({ type: 'COUNT', count, loading }).catch(() => {});
}

function buildHighlightRegistry(rangesByName) {
  if (!SUPPORTS_HIGHLIGHTS) return;
  clearRegistry();
  for (const [name, ranges] of rangesByName) {
    if (!ranges.length) continue;
    const highlight = new Highlight();
    for (const range of ranges) highlight.add(range);
    CSS.highlights.set(name, highlight);
  }
}

function hideTooltip() {
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

  const label = record.mode === 'underline'
    ? `Original: ${record.sourceText || record.phrase}\n${record.type} - ${record.category}`
    : `${record.phrase || record.neutral || record.type} - ${record.type} - ${record.category}`;
  tip.textContent = label;
  tip.style.display = 'block';

  const rect = record.range.getBoundingClientRect();
  const left = Number.isFinite(rect.left) && rect.width > 0 ? rect.left : x;
  const top = Number.isFinite(rect.top) && rect.height > 0 ? rect.top : y;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top - tip.offsetHeight - 8)}px`;
}

function findRecordAtPoint(node, offset) {
  for (let i = highlightRecords.length - 1; i >= 0; i--) {
    if (highlightRecords[i].range.isPointInRange(node, offset)) {
      return highlightRecords[i];
    }
  }
  return null;
}

function handleHoverMove(e) {
  if (!settings.enabled || !highlightRecords.length) return;
  hoverPoint = { x: e.clientX, y: e.clientY };
  if (hoverFrame) return;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    const point = hoverPoint;
    if (!point) {
      hideTooltip();
      return;
    }
    const caret = document.caretPositionFromPoint
      ? document.caretPositionFromPoint(point.x, point.y)
      : document.caretRangeFromPoint?.(point.x, point.y);
    const node = caret?.offsetNode || caret?.startContainer;
    const offset = caret?.offset ?? caret?.startOffset;
    if (!node || typeof offset !== 'number') {
      if (activeHover) hideTooltip();
      return;
    }
    const record = findRecordAtPoint(node, offset);
    if (!record) {
      if (activeHover) hideTooltip();
      return;
    }
    if (activeHover === record) return;
    activeHover = record;
    showTooltip(record, point.x, point.y);
  });
}

function buildNodePlan(text) {
  const matches = initFindMatches(text);
  const allCapsMatches = findAllCapsMatches(text);
  const combinedMatches = resolveMatches([...matches, ...allCapsMatches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lengthDelta = (b.end - b.start) - (a.end - a.start);
    if (lengthDelta !== 0) return lengthDelta;
    return Number(!!a.virtual) - Number(!!b.virtual);
  }));

  if (!combinedMatches.length) {
    return { displayText: text, plannedHighlights: [], matches: combinedMatches };
  }

  let cursor = 0;
  let displayText = '';
  const plannedHighlights = [];
  const displaySource = settings.replaceTerms
    ? lowerAllCapsLongWords(text)
    : text;

  for (const match of combinedMatches) {
    const term = getTermById(match.termId);
    if (!term) continue;
    const sourceText = text.slice(match.start, match.end);
    const sourceIsAllCaps = isAllCapsText(sourceText);

    displayText += displaySource.slice(cursor, match.start);
    const start = displayText.length;
    const shouldRemove = term.remove && settings.removeTerms;
    const shouldReplace = !shouldRemove && settings.replaceTerms && term.hasNeutral;
    const action = shouldRemove ? 'removed' : shouldReplace ? 'replaced' : 'highlighted';
    let replacement = sourceText;

    if (shouldRemove) {
      replacement = '';
    } else if (shouldReplace) {
      replacement = getReplacementForTerm(term, sourceText);
    } else if (sourceIsAllCaps) {
      replacement = displaySource.slice(match.start, match.end);
    }

    displayText += replacement;
    const end = displayText.length;

    if (action === 'replaced') {
      plannedHighlights.push({ start, end, term, mode: 'underline', sourceText, action });
    } else if (action === 'highlighted') {
      plannedHighlights.push({ start, end, term, mode: 'highlight', sourceText, action });
    }

    cursor = match.end;
  }

  displayText += displaySource.slice(cursor);
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
      const matchedText = sourceText.slice(match.start, match.end);
      const sourceIsAllCaps = isAllCapsText(matchedText);
      const shouldRemove = term.remove && settings.removeTerms;
      const shouldReplace = !shouldRemove && settings.replaceTerms && term.hasNeutral;
      const action = shouldRemove ? 'removed' : shouldReplace ? 'replaced' : 'highlighted';
      const bucket = termStats[term.phrase] || (termStats[term.phrase] = { highlighted: 0, replaced: 0, removed: 0 });
      bucket[action]++;
      totalMatches++;
    }

    for (const entry of plannedHighlights) {
      const range = document.createRange();
      range.setStart(node, entry.start);
      range.setEnd(node, entry.end);
      records.push({
        range,
        termId: entry.term.phrase,
        type: entry.term.type,
        category: getCategory(entry.term.type),
        phrase: entry.term.phrase,
        sourceText: entry.sourceText,
        neutral: entry.term.neutral || '',
        mode: entry.mode,
        action: entry.action || (entry.mode === 'underline' ? 'replaced' : 'highlighted')
      });

      const name = getHighlightName(entry.term.type, entry.mode);
      const list = rangesByName.get(name);
      if (list) list.push(range);
      else rangesByName.set(name, [range]);
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

function isTooltipNode(node) {
  return node instanceof Element && (node.id === 'cf-tooltip' || node.closest?.('#cf-tooltip'));
}

function hasRenderableMutation(mutations) {
  return mutations.some(mutation => {
    if (mutation.type === 'characterData') {
      if (internallyMutatedNodes.has(mutation.target)) {
        internallyMutatedNodes.delete(mutation.target);
        return false;
      }
      return !isTooltipNode(mutation.target.parentElement);
    }
    return [...mutation.addedNodes, ...mutation.removedNodes].some(node => !isTooltipNode(node));
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
