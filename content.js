'use strict';

const { index, types: TYPE_MAP, categories: TYPE_CATEGORIES } = ClearFrame;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE']);
const SKIP_SELECTOR = 'nav,button,select,option,[role=navigation],[role=menu],[aria-hidden=true]';
const HIGHLIGHT_PREFIX = 'clearframe-';
const HIGHLIGHT_NAMES = [...new Set(Object.values(TYPE_MAP))].map(color => HIGHLIGHT_PREFIX + color);
const SUPPORTS_HIGHLIGHTS = !!(globalThis.Highlight && globalThis.CSS?.highlights);
const DEFAULT_SETTINGS = {
  enabled: true,
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

function findMatches(text) {
  if (!matcher) return [];

  const lower = text.toLowerCase();
  const matches = [];
  let i = 0;

  while (i < lower.length) {
    let node = matcher[lower[i]];
    if (!node) {
      i++;
      continue;
    }

    let matched = null;
    let cursor = i + 1;

    if (node.$ && boundary(lower, i, cursor)) {
      matched = { start: i, end: cursor, termId: node.$ };
    }

    while (cursor < lower.length) {
      node = node[lower[cursor]];
      if (!node) break;
      cursor++;
      if (node.$ && boundary(lower, i, cursor)) {
        matched = { start: i, end: cursor, termId: node.$ };
      }
    }

    if (matched) {
      matches.push(matched);
      i = matched.end;
    } else {
      i++;
    }
  }

  return matches;
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

  const text = record.neutral || record.phrase || record.type;
  tip.textContent = text ? `${text} - ${record.type} - ${record.category}` : `${record.type} - ${record.category}`;
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

function renderHighlights() {
  termCounts = Object.create(null);
  totalMatches = 0;
  highlightRecords = [];

  if (!settings.enabled || !matcher || !document.body) {
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
    const text = node.nodeValue;
    if (!text || text.trim().length < 2) continue;

    for (const match of findMatches(text)) {
      const term = index.termsById[match.termId];
      if (!term) continue;

      const range = document.createRange();
      range.setStart(node, match.start);
      range.setEnd(node, match.end);
      records.push({
        range,
        termId: match.termId,
        type: term.type,
        category: getCategory(term.type),
        phrase: term.phrase,
        neutral: term.neutral || ''
      });

      const name = HIGHLIGHT_PREFIX + getColor(term.type);
      const list = rangesByName.get(name);
      if (list) list.push(range);
      else rangesByName.set(name, [range]);

      termCounts[term.phrase] = (termCounts[term.phrase] || 0) + 1;
      totalMatches++;
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
