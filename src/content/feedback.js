// Owns the optional feedback tools: the verdict buttons in a pinned tooltip
// and the "Suggest wording" panel for selected text. Records are stored in
// chrome.storage.local only.
import { isFeedbackEnabled } from './settings.js';
import { PAGE_CONTEXT, clearElementContexts, getElementContext, isLikelyHeadline } from './scanner.js';

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
    wording: record.wording,
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

/** @param {HTMLElement} tooltip */
export function appendFeedbackActions(tooltip, record) {
  const actions = document.createElement('div'); actions.className = 'cf-feedback-actions';
  const status = document.createElement('span'); status.className = 'cf-feedback-status';
  for (const [label, verdict] of [['Wrong context', 'wrong-context'], ['Wrong category', 'wrong-category'], ['Bad reword', 'bad-reword'], ['Too broad', 'too-broad'], ['Bad rule', 'bad-rule']]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', event => { event.stopPropagation(); saveFeedback(record, verdict, status); });
    actions.appendChild(button);
  }
  actions.appendChild(status); tooltip.appendChild(actions);
}

export function hideSuggestion() {
  document.getElementById('cf-suggestion')?.remove();
}

function selectionContext(range) {
  const node = range.startContainer;
  const text = node.nodeType === Node.TEXT_NODE ? node.nodeValue || '' : node.textContent || '';
  const offset = node.nodeType === Node.TEXT_NODE ? range.startOffset : 0;
  return text.slice(Math.max(0, offset - 120), Math.min(text.length, offset + 240)).replace(/\s+/g, ' ').trim();
}

function saveSuggestion(wording, context, element, status) {
  const elementContext = getElementContext(element);
  clearElementContexts();
  const item = {
    schemaVersion: 1, wording, context, pageContext: PAGE_CONTEXT, hostname: location.hostname,
    matchContext: { headline: isLikelyHeadline(elementContext, wording), conversational: elementContext.conversational },
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

/** @param {MouseEvent} event */
export function handleSelectionSuggestion(event) {
  if (event.target instanceof Element && event.target.closest('#cf-tooltip,#cf-suggestion')) return;
  // Remove a stale panel even if settings changed before the storage event
  // reached this content script. The setting is checked again immediately
  // before creating a new one.
  hideSuggestion();
  if (!isFeedbackEnabled()) return;
  const selection = getSelection();
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
