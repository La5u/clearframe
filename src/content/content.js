const CLEARFRAME_ATTR = 'data-clearframe-processed';
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);

const DEFAULT_SETTINGS = {
  enabled: true,
  highlightOnly: true,
  disabledTermIds: [],
  categories: {
    media: true,
    politics: true,
    tech: true,
    corporate: true,
    clickbait: true
  },
  modes: {
    replace: true,
    highlight: true
  }
};

let indexData = null;
let settings = { ...DEFAULT_SETTINGS };
let compiledMatcher = null;
let scanScheduled = false;
let badgeUpdateScheduled = false;
let pendingScanRoots = [];
let pendingScanSet = new Set();
let activeWalker = null;
let tooltipEl = null;

const MATCH_TERM_KEY = '$';
const SCAN_BUDGET_MS = 8;

function isWordChar(char) {
  return /[A-Za-z0-9']/u.test(char);
}

function hasWordBoundary(text, start, end) {
  const prev = start > 0 ? text[start - 1] : ' ';
  const next = end < text.length ? text[end] : ' ';
  return !isWordChar(prev) && !isWordChar(next);
}

function mergeSettings(next) {
  const disabledTermIds = Array.isArray(next?.disabledTermIds) ? next.disabledTermIds : DEFAULT_SETTINGS.disabledTermIds;
  return {
    ...DEFAULT_SETTINGS,
    ...next,
    disabledTermIds,
    categories: {
      ...DEFAULT_SETTINGS.categories,
      ...(next?.categories || {})
    },
    modes: {
      ...DEFAULT_SETTINGS.modes,
      ...(next?.modes || {})
    }
  };
}

async function loadIndex() {
  if (indexData) {
    return indexData;
  }

  if (globalThis.CLEARFRAME_TERMS_INDEX) {
    indexData = globalThis.CLEARFRAME_TERMS_INDEX;
    return indexData;
  }

  const response = await fetch(chrome.runtime.getURL('terms-index.json'));
  if (!response.ok) {
    throw new Error(`Unable to load terms index: ${response.status}`);
  }
  indexData = await response.json();
  return indexData;
}

async function loadSettings() {
  const result = await chrome.storage.sync.get(['settings']);
  settings = mergeSettings(result.settings);
}

function compileEnabledBuckets() {
  if (!indexData) {
    return;
  }

  const root = Object.create(null);
  const disabledSet = new Set(settings.disabledTermIds || []);

  for (const [firstChar, entries] of Object.entries(indexData.buckets)) {
    for (const entry of entries) {
      const term = indexData.termsById[entry.termId];
      if (!term) {
        continue;
      }

      if (!settings.categories[term.category]) {
        continue;
      }

      if (!settings.modes[term.mode]) {
        continue;
      }

      if (disabledSet.has(term.id)) {
        continue;
      }

      let node = root;
      for (const char of entry.phraseNorm) {
        node[char] ||= Object.create(null);
        node = node[char];
      }
      node[MATCH_TERM_KEY] = term.id;
    }
  }

  compiledMatcher = root;
}

function shouldSkipNode(node) {
  const parent = node.parentElement;
  if (!parent) {
    return true;
  }

  if (parent.closest('[data-clearframe-mark]')) {
    return true;
  }

  if (parent.isContentEditable) {
    return true;
  }

  return SKIP_TAGS.has(parent.tagName);
}

function findMatches(textLower) {
  if (!compiledMatcher) {
    return [];
  }

  const matches = [];
  let i = 0;

  while (i < textLower.length) {
    let node = compiledMatcher[textLower[i]];
    if (!node) {
      i += 1;
      continue;
    }

    let matched = null;
    let cursor = i + 1;

    if (node[MATCH_TERM_KEY] && hasWordBoundary(textLower, i, cursor)) {
      matched = { start: i, end: cursor, termId: node[MATCH_TERM_KEY] };
    }

    while (cursor < textLower.length) {
      node = node[textLower[cursor]];
      if (!node) {
        break;
      }
      cursor += 1;

      if (node[MATCH_TERM_KEY] && hasWordBoundary(textLower, i, cursor)) {
        matched = { start: i, end: cursor, termId: node[MATCH_TERM_KEY] };
      }
    }

    if (matched) {
      matches.push(matched);
      i = matched.end;
      continue;
    }

    i += 1;
  }

  return matches;
}

function makeTooltip(term, originalText) {
  return `${term.type} [${term.category}] | ${originalText} -> ${term.neutral}. ${term.explanation}`;
}

function getTooltip() {
  if (tooltipEl?.isConnected) {
    return tooltipEl;
  }

  tooltipEl = document.createElement('div');
  tooltipEl.className = 'clearframe-tooltip';
  tooltipEl.hidden = true;
  document.documentElement.appendChild(tooltipEl);
  return tooltipEl;
}

function hideTooltip() {
  if (!tooltipEl) {
    return;
  }

  tooltipEl.hidden = true;
  tooltipEl.classList.remove('is-visible');
}

function positionTooltip(mark) {
  const tooltip = getTooltip();
  tooltip.textContent = mark.dataset.tooltip || '';
  tooltip.hidden = false;

  const rect = mark.getBoundingClientRect();
  const padding = 12;
  const maxWidth = Math.max(0, Math.min(420, window.innerWidth - padding * 2));
  tooltip.style.maxWidth = `${maxWidth}px`;
  tooltip.style.left = '0px';
  tooltip.style.top = '0px';
  tooltip.classList.add('is-visible');

  const tooltipRect = tooltip.getBoundingClientRect();
  const centeredLeft = rect.left + (rect.width - tooltipRect.width) / 2;
  const left = Math.min(
    Math.max(padding, centeredLeft),
    window.innerWidth - tooltipRect.width - padding
  );
  const showAbove = rect.top >= tooltipRect.height + padding + 8;
  const top = showAbove
    ? rect.top - tooltipRect.height - 8
    : Math.min(rect.bottom + 8, window.innerHeight - tooltipRect.height - padding);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(padding, top)}px`;
}

function handleTooltipEvent(event) {
  const mark = event.target.closest('[data-clearframe-mark]');
  if (!mark) {
    hideTooltip();
    return;
  }

  positionTooltip(mark);
}

function framingGroup(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('euphemism')) {
    return 'euphemism';
  }
  if (
    value.includes('clickbait') ||
    value.includes('emotional') ||
    value.includes('sensational') ||
    value.includes('fear framing') ||
    value.includes('dramatic') ||
    value.includes('escalation')
  ) {
    return 'clickbait';
  }
  if (
    value.includes('aggression') ||
    value.includes('attack') ||
    value.includes('loaded') ||
    value.includes('passive') ||
    value.includes('derogatory') ||
    value.includes('dysphemism') ||
    value.includes('conflict')
  ) {
    return 'loaded';
  }
  if (value.includes('unsourced') || value.includes('authority')) {
    return 'attribution';
  }
  if (
    value.includes('hype') ||
    value.includes('vague') ||
    value.includes('abstraction') ||
    value.includes('branding') ||
    value.includes('marketing')
  ) {
    return 'hype';
  }
  return 'other';
}

function annotateTextNode(node) {
  if (node[CLEARFRAME_ATTR]) {
    return;
  }

  if (shouldSkipNode(node)) {
    return;
  }

  const text = node.nodeValue;
  if (!text || text.trim().length < 2) {
    return;
  }

  const textLower = text.toLowerCase();
  const matches = findMatches(textLower);
  if (matches.length === 0) {
    return;
  }

  const fragment = document.createDocumentFragment();
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)));
    }

    const originalText = text.slice(match.start, match.end);
    const term = indexData.termsById[match.termId];

    const span = document.createElement('span');
    span.setAttribute('data-clearframe-mark', '1');
    span.className = 'clearframe-mark';
    span.dataset.termId = term.id;
    span.dataset.category = term.category;
    span.dataset.mode = term.mode;
    span.dataset.type = term.type;
    span.dataset.framing = framingGroup(term.type);
    span.dataset.original = originalText;
    span.dataset.tooltip = makeTooltip(term, originalText);
    span.tabIndex = 0;
    const shouldReplace = term.mode === 'replace' && !settings.highlightOnly;
    span.textContent = shouldReplace ? term.neutral : originalText;

    fragment.appendChild(span);
    cursor = match.end;
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }

  node[CLEARFRAME_ATTR] = true;
  node.parentNode.replaceChild(fragment, node);
}

function clearExistingMarks() {
  const marks = document.querySelectorAll('[data-clearframe-mark]');
  for (const mark of marks) {
    const original = mark.dataset.original || mark.textContent || '';
    mark.replaceWith(document.createTextNode(original));
  }

  hideTooltip();
}

function updateBadgeCount() {
  badgeUpdateScheduled = false;
  const count = document.querySelectorAll('[data-clearframe-mark]').length;
  const runtime = globalThis.chrome && chrome.runtime;
  if (!runtime || typeof runtime.sendMessage !== 'function') {
    return;
  }

  try {
    const maybePromise = runtime.sendMessage({
      type: 'CLEARFRAME_BADGE_COUNT',
      count
    });

    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {
        // Ignore if runtime is unavailable during extension reloads.
      });
    }
  } catch (_) {
    // Ignore messaging errors from invalidated contexts.
  }
}

function scheduleBadgeCountUpdate() {
  if (badgeUpdateScheduled) {
    return;
  }

  badgeUpdateScheduled = true;
  requestAnimationFrame(updateBadgeCount);
}

function scanDocument(root = document.body) {
  if (!root || !settings.enabled) {
    scheduleBadgeCountUpdate();
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];

  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  for (const node of nodes) {
    annotateTextNode(node);
  }

  scheduleBadgeCountUpdate();
}

function scheduleScanWork() {
  if (scanScheduled) {
    return;
  }

  scanScheduled = true;
  requestAnimationFrame(() => {
    scanScheduled = false;
    runScanWork();
  });
}

function getNextWalker() {
  while (pendingScanRoots.length > 0) {
    const root = pendingScanRoots.shift();
    pendingScanSet.delete(root);

    if (!root?.isConnected) {
      continue;
    }

    return document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  }

  return null;
}

function runScanWork() {
  if (!settings.enabled) {
    activeWalker = null;
    pendingScanRoots = [];
    pendingScanSet.clear();
    scheduleBadgeCountUpdate();
    return;
  }

  const deadline = performance.now() + SCAN_BUDGET_MS;

  while (performance.now() < deadline) {
    if (!activeWalker) {
      activeWalker = getNextWalker();
      if (!activeWalker) {
        scheduleBadgeCountUpdate();
        return;
      }
    }

    const nextNode = activeWalker.nextNode();
    if (!nextNode) {
      activeWalker = null;
      continue;
    }

    annotateTextNode(nextNode);
  }

  scheduleBadgeCountUpdate();
  scheduleScanWork();
}

function queueScan(target = document.body) {
  if (!target) {
    scheduleScanWork();
    return;
  }

  for (let i = pendingScanRoots.length - 1; i >= 0; i -= 1) {
    const pendingRoot = pendingScanRoots[i];
    if (!pendingRoot?.isConnected) {
      pendingScanRoots.splice(i, 1);
      pendingScanSet.delete(pendingRoot);
      continue;
    }

    if (pendingRoot === target || pendingRoot.contains?.(target)) {
      scheduleScanWork();
      return;
    }

    if (target.contains?.(pendingRoot)) {
      pendingScanRoots.splice(i, 1);
      pendingScanSet.delete(pendingRoot);
    }
  }

  pendingScanSet.add(target);
  pendingScanRoots.push(target);
  scheduleScanWork();
}

function watchMutations() {
  const observer = new MutationObserver((mutations) => {
    if (!settings.enabled) {
      return;
    }

    for (const mutation of mutations) {
      for (const addedNode of mutation.addedNodes) {
        if (addedNode.nodeType === Node.TEXT_NODE) {
          annotateTextNode(addedNode);
          continue;
        }

        if (addedNode.nodeType === Node.ELEMENT_NODE) {
          queueScan(addedNode);
        }
      }
    }

    scheduleBadgeCountUpdate();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function bindTooltipEvents() {
  document.addEventListener('pointerover', handleTooltipEvent);
  document.addEventListener('focusin', handleTooltipEvent);
  document.addEventListener('pointerout', (event) => {
    if (event.target.closest('[data-clearframe-mark]')) {
      hideTooltip();
    }
  });
  document.addEventListener('focusout', (event) => {
    if (event.target.closest('[data-clearframe-mark]')) {
      hideTooltip();
    }
  });
  window.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('resize', hideTooltip);
}

function refreshFromSettings(nextSettings) {
  settings = mergeSettings(nextSettings);
  compileEnabledBuckets();
  clearExistingMarks();
  activeWalker = null;
  pendingScanRoots = [];
  pendingScanSet.clear();

  if (settings.enabled) {
    queueScan(document.body);
    return;
  }

  scheduleBadgeCountUpdate();
}

async function init() {
  await Promise.all([loadIndex(), loadSettings()]);
  compileEnabledBuckets();

  if (settings.enabled) {
    queueScan(document.body);
  }

  bindTooltipEvents();
  watchMutations();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.settings) {
      return;
    }

    refreshFromSettings(changes.settings.newValue);
  });
}

init().catch((err) => {
  console.error('ClearFrame init failed', err);
});
