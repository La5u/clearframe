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
  types: { superlative: false },
  userTypeColors: {}
};

let settings = { ...DEFAULT_SETTINGS, types: { ...DEFAULT_SETTINGS.types } };
let matcher = null;
let totalMatches = 0;
let termCounts = Object.create(null);
let highlightRecords = [];
let activeHover = null;
let hoverFrame = 0;
let hoverPoint = null;
let rerenderFrame = 0;
const originalNodeText = new WeakMap();
const internallyMutatedNodes = new WeakSet();

function loadSettings(rawSettings = {}, rawTypeColors = {}) {
  const next = { ...DEFAULT_SETTINGS, ...rawSettings };
  next.types = { ...(next.types || {}) };
  if (!Object.keys(next.types).length) {
    next.types.superlative = false;
  }
  next.userTypeColors = { ...(next.userTypeColors || {}), ...rawTypeColors };
  settings = next;
}

function isWordChar(c) {
  const code = c.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 39
  );
}

function boundary(text, start, end) {
  const prev = start > 0 ? text[start - 1] : ' ';
  const next = end < text.length ? text[end] : ' ';
  return !isWordChar(prev) && !isWordChar(next);
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

const IRREGULAR_VERB_FORMS = {
  break: { past: 'broke' },
  sunset: { past: 'sunset' }
};

function isConsonant(code) {
  return code >= 97 && code <= 122 && ![97, 101, 105, 111, 117].includes(code);
}

function shouldDoubleFinalConsonant(word) {
  if (word.length < 3 || word.length > 4) return false;
  if (/(w|x|y)$/i.test(word)) return false;
  if (/(ck|ch|sh|th|ph|gh|qu)$/i.test(word)) return false;
  const last = word.charCodeAt(word.length - 1);
  const mid = word.charCodeAt(word.length - 2);
  const prev = word.charCodeAt(word.length - 3);
  return isConsonant(last) && !isConsonant(mid) && isConsonant(prev);
}

function pluralizeWord(word) {
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + 'es';
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
  return word + 's';
}

function pastTenseWord(word) {
  if (IRREGULAR_VERB_FORMS[word]?.past) return IRREGULAR_VERB_FORMS[word].past;
  if (word.endsWith('e')) return word + 'd';
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ied';
  if (shouldDoubleFinalConsonant(word)) return word + word[word.length - 1] + 'ed';
  return word + 'ed';
}

function ingWord(word) {
  if (word.endsWith('ie')) return word.slice(0, -2) + 'ying';
  if (word.endsWith('e')) return word.slice(0, -1) + 'ing';
  if (shouldDoubleFinalConsonant(word)) return word + word[word.length - 1] + 'ing';
  return word + 'ing';
}

function adverbWord(word) {
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ily';
  return word + 'ly';
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

  if (/^[A-Z]/.test(sourceText) && next) {
    next = next[0].toUpperCase() + next.slice(1);
  }

  return next;
}

function setNodeText(node, text) {
  if (node.nodeValue === text) return;
  internallyMutatedNodes.add(node);
  node.nodeValue = text;
}

function buildMatcher() {
  const root = Object.create(null);
  if (!index.buckets) return root;

  for (const entries of Object.values(index.buckets)) {
    for (const entry of entries) {
      const term = index.termsById[entry.termId];
      if (!term || !isEnabled(term.type)) continue;

      let node = root;
      for (const ch of entry.phraseNorm) {
        node = node[ch] ||= Object.create(null);
      }
      node.$ = entry.termId;
    }
  }

  return root;
}

function collectPhraseMatches(text) {
  if (!matcher) return [];

  const matches = [];
  const lower = text.toLowerCase();
  let indexPos = 0;

  while (indexPos < lower.length) {
    let node = matcher[lower[indexPos]];
    if (!node) {
      indexPos++;
      continue;
    }

    let matched = null;
    let cursor = indexPos + 1;

    if (node.$ && boundary(lower, indexPos, cursor)) {
      matched = { start: indexPos, end: cursor, termId: node.$ };
    }

    while (cursor < lower.length) {
      node = node[lower[cursor]];
      if (!node) break;
      cursor++;
      if (node.$ && boundary(lower, indexPos, cursor)) {
        matched = { start: indexPos, end: cursor, termId: node.$ };
      }
    }

    if (matched) {
      matches.push(matched);
      indexPos = matched.end;
    } else {
      indexPos++;
    }
  }

  return matches;
}

const regexCache = new Map();

function getRegexMatcher(pattern) {
  if (!pattern) return null;
  if (!regexCache.has(pattern)) {
    regexCache.set(pattern, new RegExp(pattern, 'giu'));
  }
  return regexCache.get(pattern);
}

function collectRegexMatches(text) {
  const matches = [];
  for (const term of index.regexTerms || []) {
    const compiled = getRegexMatcher(term.pattern);
    if (!compiled) continue;
    compiled.lastIndex = 0;
    for (const match of text.matchAll(compiled)) {
      if (!match[0]) continue;
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        termId: term.termId
      });
    }
  }
  return matches;
}

function findMatches(text) {
  const matches = [...collectPhraseMatches(text), ...collectRegexMatches(text)]
    .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const accepted = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    accepted.push(match);
    cursor = match.end;
  }
  return accepted;
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

function updateBadge() {
  chrome.runtime.sendMessage({ type: 'COUNT', count: totalMatches }).catch(() => {});
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
  const matches = findMatches(text);
  if (!matches.length) {
    return { displayText: text, plannedHighlights: [], matches };
  }

  let cursor = 0;
  let displayText = '';
  const plannedHighlights = [];

  for (const match of matches) {
    const term = index.termsById[match.termId];
    if (!term) continue;
    const sourceText = text.slice(match.start, match.end);

    displayText += text.slice(cursor, match.start);
    const replaceable = settings.replaceTerms && term.hasNeutral;
    const replacement = replaceable
      ? applyStemmedReplacement(sourceText, term.phrase, term.neutral, term.stemType || '')
      : sourceText;
    const start = displayText.length;
    displayText += replacement;
    const end = displayText.length;

    if (replaceable) {
      if (replacement.length > 0 && !term.remove) {
        plannedHighlights.push({ start, end, term, mode: 'underline', sourceText });
      }
    } else {
      plannedHighlights.push({ start, end, term, mode: 'highlight', sourceText });
    }

    cursor = match.end;
  }

  displayText += text.slice(cursor);
  return { displayText, plannedHighlights, matches };
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
  termCounts = Object.create(null);
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
    const didReplace = settings.replaceTerms && displayText !== sourceText;
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
      const term = index.termsById[match.termId];
      if (!term) continue;
      termCounts[term.phrase] = (termCounts[term.phrase] || 0) + 1;
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
        mode: entry.mode
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
    matcher = buildMatcher();
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
    const terms = Object.entries(termCounts)
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
    sendResponse({ terms });
    return;
  }

  if (msg.type === 'RELOAD_SETTINGS') {
    chrome.storage.sync.get(['settings', 'userTypeColors'], r => {
      loadSettings(r.settings, r.userTypeColors);
      matcher = buildMatcher();
      renderHighlights();
    });
  }
});
