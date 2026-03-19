'use strict';

const { index, types: TYPE_MAP } = ClearFrame;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE']);
const SKIP_SELECTOR = 'nav,button,select,option,[role=navigation],[role=menu],[aria-hidden=true]';

let settings = { enabled: true, types: { superlative: false }, userTypeColors: {} };
let matcher = null;
const IS_TOP_FRAME = window.top === window;
let observer = null;
let currentUrl = location.href;
let scanQueue = [];
let scanQueued = false;
let scanVersion = 0;
const SCAN_BATCH_SIZE = 200;
const SCAN_BUDGET_MS = 14;

function loadSettings(rawSettings = {}, rawTypeColors = {}) {
  settings = { enabled: true, types: { superlative: false }, userTypeColors: {}, ...rawSettings };
  if (!settings.types || Object.keys(settings.types).length === 0) {
    settings.types = { superlative: false };
  }
  settings.userTypeColors = { ...(settings.userTypeColors || {}), ...rawTypeColors };
}

function isWordChar(c) {
  const code = c.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 39
  );
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
    if (!node) { i++; continue; }

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

function boundary(text, start, end) {
  const prev = start > 0 ? text[start - 1] : ' ';
  const next = end < text.length ? text[end] : ' ';
  return !isWordChar(prev) && !isWordChar(next);
}

function isEnabled(type) {
  if (!settings.types || Object.keys(settings.types).length === 0) return true;
  return settings.types[type] !== false;
}

function getColor(type) { return settings.userTypeColors?.[type] || TYPE_MAP[type] || 'gray'; }

function skipNode(node) {
  const p = node.parentElement;
  if (!p || p.isContentEditable || p.closest('.cf-highlight') || 
      SKIP_TAGS.has(p.tagName) || p.closest(SKIP_SELECTOR) || p.closest('#cf-tooltip')) return true;
  return false;
}

function updateBadge() {
  const count = document.querySelectorAll('.cf-highlight').length;
  chrome.runtime.sendMessage({ type: 'COUNT', count }).catch(() => {});
}

function startObserver() {
  if (!document.body) return;
  if (!observer) observer = new MutationObserver(handleMutations);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function stopObserver() {
  if (observer) observer.disconnect();
}

function clearHighlights(root = document) {
  const highlights = root.querySelectorAll ? root.querySelectorAll('.cf-highlight') : [];
  if (!highlights.length) return;
  for (const el of highlights) {
    const parent = el.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  }
}

function refreshPage() {
  if (!settings.enabled || !matcher) return;
  stopObserver();
  scanVersion++;
  scanQueue = [];
  scanQueued = false;
  clearHighlights(document);
  scan(document.body);
  startObserver();
}

function annotate(textNode) {
  if (textNode.cf || skipNode(textNode)) return;
  const text = textNode.nodeValue;
  if (!text || text.trim().length < 2) return;
  const matches = findMatches(text);
  if (!matches.length) return;
  const frag = document.createDocumentFragment();
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, m.start)));
    const term = index.termsById[m.termId];
    const span = document.createElement('span');
    span.className = 'cf-highlight cf-' + getColor(term.type);
    span.textContent = text.slice(m.start, m.end);
    span.dataset.termId = m.termId;
    span.dataset.term = term.phrase;
    span.dataset.type = term.type;
    frag.appendChild(span);
    cursor = m.end;
  }
  if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
  textNode.cf = true;
  textNode.parentNode.replaceChild(frag, textNode);
}

function pumpScanQueue() {
  scanQueued = false;
  if (!settings.enabled || !matcher) return;
  const start = performance.now();
  let processed = 0;
  while (scanQueue.length && processed < SCAN_BATCH_SIZE && performance.now() - start < SCAN_BUDGET_MS) {
    annotate(scanQueue.shift());
    processed++;
  }
  if (processed) updateBadge();
  if (scanQueue.length) {
    scanQueued = true;
    const version = scanVersion;
    setTimeout(() => {
      if (version !== scanVersion) return;
      pumpScanQueue();
    }, 0);
  }
}

function scan(root) {
  if (!settings.enabled || !matcher) return;
  if (root.matches?.(SKIP_SELECTOR)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let added = false;
  while (node) {
    const current = node;
    node = walker.nextNode();
    if (!skipNode(current)) {
      scanQueue.push(current);
      added = true;
    }
  }
  if (added && !scanQueued) {
    scanQueued = true;
    pumpScanQueue();
  }
}

function handleMutations(mutations) {
  if (!settings.enabled) return;
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    refreshPage();
    return;
  }
  for (const m of mutations) {
    if (m.type === 'characterData' && m.target?.nodeType === Node.TEXT_NODE) {
      annotate(m.target);
      updateBadge();
      continue;
    }
    for (const node of m.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      else if (node.nodeType === Node.TEXT_NODE) annotate(node);
    }
  }
  updateBadge();
}

let tooltip;
function showTooltip(el) {
  const term = index.termsById[el.dataset.termId];
  if (!term) return;
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'cf-tooltip';
    document.body.appendChild(tooltip);
  }
  tooltip.textContent = `${term.neutral || term.explanation} (${term.type})`;
  tooltip.style.display = 'block';
  const r = el.getBoundingClientRect();
  tooltip.style.top = (r.top + window.scrollY - tooltip.offsetHeight - 8) + 'px';
  tooltip.style.left = (r.left + window.scrollX) + 'px';
}

function hideTooltip() {
  if (tooltip) tooltip.style.display = 'none';
}

function init() {
  chrome.storage.sync.get(['settings', 'userTypeColors'], r => {
    loadSettings(r.settings, r.userTypeColors);
    matcher = buildMatcher();
    startObserver();
    if (settings.enabled) refreshPage();
    document.addEventListener('mouseover', e => { const t = e.target.closest('.cf-highlight'); if (t) showTooltip(t); });
    document.addEventListener('mouseout', e => { if (e.target.closest('.cf-highlight')) hideTooltip(); });
  });
}

if (IS_TOP_FRAME) init();

chrome.runtime.onMessage.addListener((msg, src, sendResponse) => {
  if (msg.type === 'GET_COUNT') {
    sendResponse({ count: document.querySelectorAll('.cf-highlight').length });
  } else if (msg.type === 'GET_TERMS') {
    const counts = Object.create(null);
    document.querySelectorAll('.cf-highlight').forEach(el => {
      const term = el.dataset.term;
      if (!term) return;
      counts[term] = (counts[term] || 0) + 1;
    });
    const list = Object.entries(counts)
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
    sendResponse({ terms: list });
  } else if (msg.type === 'RELOAD_SETTINGS') {
    chrome.storage.sync.get(['settings', 'userTypeColors'], r => {
      loadSettings(r.settings, r.userTypeColors);
      matcher = buildMatcher();
      clearHighlights(document);
      if (settings.enabled) refreshPage();
      else updateBadge();
    });
  }
});
