'use strict';

const { index, types: TYPE_MAP } = ClearFrame;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE']);
const SKIP_SELECTOR = 'nav,button,select,option,[role=navigation],[role=menu],[aria-hidden=true]';

let settings = { enabled: true, types: {}, userTypeColors: {} };
let matcher = null;
const IS_TOP_FRAME = window.top === window;

function isWordChar(c) { return /[a-z0-9']/i.test(c); }

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
      node.$ = term;
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
      matched = { start: i, end: cursor, termId: node.$.phrase };
    }

    while (cursor < lower.length) {
      node = node[lower[cursor]];
      if (!node) break;
      cursor++;
      if (node.$ && boundary(lower, i, cursor)) {
        matched = { start: i, end: cursor, termId: node.$.phrase };
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
      SKIP_TAGS.has(p.tagName) || p.closest(SKIP_SELECTOR)) return true;
  return false;
}

function updateBadge() {
  const count = document.querySelectorAll('.cf-highlight').length;
  chrome.runtime.sendMessage({ type: 'COUNT', count }).catch(() => {});
}

let rescanTimer = null;
function scheduleRescan() {
  if (rescanTimer) return;
  rescanTimer = setTimeout(() => {
    rescanTimer = null;
    scan(document.body);
  }, 400);
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
    span.dataset.term = term.phrase;
    span.dataset.type = term.type;
    frag.appendChild(span);
    cursor = m.end;
  }
  if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
  textNode.cf = true;
  textNode.parentNode.replaceChild(frag, textNode);
}

function scan(root) {
  if (!settings.enabled || !matcher) return;
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) annotate(node);
  updateBadge();
}

function handleMutations(mutations) {
  if (!settings.enabled) return;
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      else if (node.nodeType === Node.TEXT_NODE) annotate(node);
    }
  }
  scheduleRescan();
  updateBadge();
}

let tooltip;
function showTooltip(el) {
  const term = index.termsById[el.dataset.term];
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
    settings = { enabled: true, types: {}, userTypeColors: {}, ...(r.settings || {}) };
    if (r.userTypeColors) settings.userTypeColors = r.userTypeColors;
    matcher = buildMatcher();
    if (settings.enabled) {
      clearHighlights(document);
      scan(document.body);
      new MutationObserver(handleMutations).observe(document.body, { childList: true, subtree: true });
    }
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
      settings = { enabled: true, types: {}, userTypeColors: {}, ...(r.settings || {}) };
      if (r.userTypeColors) settings.userTypeColors = r.userTypeColors;
      matcher = buildMatcher();
      document.querySelectorAll('.cf-highlight').forEach(el => {
        el.className = 'cf-highlight cf-' + getColor(el.dataset.type);
      });
    });
  }
});
