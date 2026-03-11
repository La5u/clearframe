(function() {
  'use strict';

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);
  const GLOBAL_SKIP_SELECTOR = 'nav,footer,aside,button,select,option,[role="navigation"],[role="menu"],[aria-hidden="true"]';

  const DEFAULT_SETTINGS = {
    enabled: true,
    categories: {
      media: true,
      politics: true,
      tech: true,
      corporate: true,
      clickbait: true
    }
  };

  const MATCH_TERM_KEY = '$';

  let indexData = null;
  let settings = { ...DEFAULT_SETTINGS };
  let compiledMatcher = null;

  function isWordChar(char) {
    return /[A-Za-z0-9']/u.test(char);
  }

  function hasWordBoundary(text, start, end) {
    const prev = start > 0 ? text[start - 1] : ' ';
    const next = end < text.length ? text[end] : ' ';
    return !isWordChar(prev) && !isWordChar(next);
  }

  function compileMatcher() {
    const root = Object.create(null);
    if (!indexData?.buckets) return root;

    for (const entries of Object.values(indexData.buckets)) {
      for (const entry of entries) {
        const term = indexData.termsById[entry.termId];
        if (!term || !settings.categories[term.category]) continue;

        let node = root;
        for (const char of entry.phraseNorm) {
          node[char] ||= Object.create(null);
          node = node[char];
        }
        node[MATCH_TERM_KEY] = term.phrase;
      }
    }
    return root;
  }

  function findMatches(text) {
    if (!compiledMatcher) return [];
    const textLower = text.toLowerCase();
    const matches = [];
    let index = 0;

    while (index < textLower.length) {
      let node = compiledMatcher[textLower[index]];
      if (!node) {
        index += 1;
        continue;
      }

      let matched = null;
      let cursor = index + 1;

      if (node[MATCH_TERM_KEY] && hasWordBoundary(textLower, index, cursor)) {
        matched = { start: index, end: cursor, termId: node[MATCH_TERM_KEY] };
      }

      while (cursor < textLower.length) {
        node = node[textLower[cursor]];
        if (!node) break;
        cursor += 1;

        if (node[MATCH_TERM_KEY] && hasWordBoundary(textLower, index, cursor)) {
          matched = { start: index, end: cursor, termId: node[MATCH_TERM_KEY] };
        }
      }

      if (matched) {
        matches.push(matched);
        index = matched.end;
      } else {
        index += 1;
      }
    }
    return matches;
  }

  function framingGroup(type) {
    const value = String(type || '').toLowerCase();
    if (value.includes('euphemism')) return 'euphemism';
    if (
      value.includes('clickbait') ||
      value.includes('emotional') ||
      value.includes('sensational') ||
      value.includes('fear') ||
      value.includes('dramatic') ||
      value.includes('escalation') ||
      value.includes('caps') ||
      value.includes('hook') ||
      value.includes('superlative') ||
      value.includes('exaggeration') ||
      value.includes('intensifier') ||
      value.includes('reveal') ||
      value.includes('maximum') ||
      value.includes('relief') ||
      value.includes('hype') ||
      value.includes('moral') ||
      value.includes('amplification')
    ) return 'clickbait';
    if (
      value.includes('aggression') ||
      value.includes('attack') ||
      value.includes('loaded') ||
      value.includes('passive') ||
      value.includes('derogatory') ||
      value.includes('dysphemism') ||
      value.includes('conflict') ||
      value.includes('violence') ||
      value.includes('violent')
    ) return 'loaded';
    if (value.includes('unsourced') || value.includes('authority') || value.includes('uncertainty')) return 'attribution';
    return 'other';
  }

  let tooltipEl = null;

  function getTooltip() {
    if (tooltipEl && tooltipEl.isConnected) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'cf-tooltip';
    document.documentElement.appendChild(tooltipEl);
    return tooltipEl;
  }

  function showTooltip(mark, term) {
    const tooltip = getTooltip();
    tooltip.textContent = `${term.neutral || term.explanation} (${term.type})`;
    tooltip.style.display = 'block';
    
    const rect = mark.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const padding = 8;
    
    let top = rect.top - tooltipRect.height - 6;
    if (top < padding) {
      top = rect.bottom + 6;
    }
    
    tooltip.style.left = `${Math.min(rect.left, window.innerWidth - tooltipRect.width - padding)}px`;
    tooltip.style.top = `${top + window.scrollY}px`;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  function bindTooltipEvents() {
    document.addEventListener('mouseover', (e) => {
      const mark = e.target.closest('[data-cf-mark]');
      if (!mark) {
        hideTooltip();
        return;
      }
      const term = indexData.termsById[mark.dataset.termId];
      if (term) showTooltip(mark, term);
    });
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest('[data-cf-mark]')) hideTooltip();
    });
  }

  function shouldSkipNode(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest('[data-cf-mark]') || parent.isContentEditable) return true;
    if (SKIP_TAGS.has(parent.tagName)) return true;
    if (parent.closest(GLOBAL_SKIP_SELECTOR)) return true;
    return false;
  }

  function annotateTextNode(node) {
    if (node.$cfProcessed || shouldSkipNode(node)) return false;

    const text = node.nodeValue;
    if (!text || text.trim().length < 2) return false;

    const matches = findMatches(text);
    if (!matches.length) return false;

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    for (const match of matches) {
      if (match.start > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)));
      }

      const originalText = text.slice(match.start, match.end);
      const term = indexData.termsById[match.termId];

      const span = document.createElement('span');
      span.setAttribute('data-cf-mark', '1');
      span.setAttribute('data-term-id', term.phrase);
      span.className = 'cf-mark';
      span.setAttribute('data-framing', framingGroup(term.type));
      span.textContent = originalText;

      fragment.appendChild(span);
      cursor = match.end;
    }

    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    node.$cfProcessed = true;
    node.parentNode.replaceChild(fragment, node);
    return true;
  }

  function collectTextNodes(root) {
    if (!root) return [];
    if (root.nodeType === Node.TEXT_NODE) return [root];
    if (root.nodeType !== Node.ELEMENT_NODE) return [];

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function scanPage() {
    if (!settings.enabled || !compiledMatcher) return;
    const nodes = collectTextNodes(document.body);
    for (const node of nodes) {
      annotateTextNode(node);
    }
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['settings']);
      if (result.settings) {
        settings = { ...DEFAULT_SETTINGS, ...result.settings };
        if (result.settings.categories) {
          settings.categories = { ...DEFAULT_SETTINGS.categories, ...result.settings.categories };
        }
      }
    } catch (e) {}
  }

  function rebuildMatcher() {
    compiledMatcher = compileMatcher();
  }

  async function init() {
    indexData = globalThis.CLEARFRAME_TERMS_INDEX;
    if (!indexData) {
      console.error('ClearFrame: no terms index');
      return;
    }

    await loadSettings();
    rebuildMatcher();

    if (settings.enabled) {
      scanPage();
    }

    bindTooltipEvents();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.settings) {
        settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
        if (changes.settings.newValue?.categories) {
          settings.categories = { ...DEFAULT_SETTINGS.categories, ...changes.settings.newValue.categories };
        }
        rebuildMatcher();
        if (settings.enabled) {
          document.querySelectorAll('[data-cf-mark]').forEach(el => {
            el.replaceWith(document.createTextNode(el.textContent));
          });
          scanPage();
        }
      }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'CLEARFRAME_GET_COUNT') {
        const count = document.querySelectorAll('[data-cf-mark]').length;
        sendResponse({ count });
      }
    });
  }

  init();
})();
