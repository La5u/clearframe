// Owns the hover tooltip: finds the match under the pointer, shows its
// labels (with feedback buttons when pinned), reveals reworded text while
// hovered, and closes on selection, scroll or click elsewhere.
import { getStrength } from '../core/analyze.js';
import { isFeedbackEnabled } from './settings.js';
import { getNodeRecords, hasResults } from './store.js';
import { isPointInsideHoverReveal, restoreHoverReveal, revealOriginalText } from './reveal.js';
import { appendFeedbackActions, hideSuggestion } from './feedback.js';

const { categories: TYPE_CATEGORIES, labels: LABELS } = ClearFrame;
let activeHover = null;
let pinnedTooltipRecord = null;
let hoverFrame = 0;
let pendingHoverEvent = null;
let hoverSwitchTimer = 0;
let hoverSwitchRecord = null;
let tooltipAnchor = null;
const lastPointer = { x: 0, y: 0 };

// The technical term is shown first so readers learn the vocabulary; the
// plain label and effect sit behind the (i).
function getLabel(term) {
  return LABELS?.phrases?.[term.phrase] || LABELS?.types?.[term.type] || { term: term.type, plain: getCategory(term.type), effect: '' };
}

function getCategory(type) {
  return TYPE_CATEGORIES?.[type] || 'General';
}

// Let the pointer travel from the highlight into the tooltip (to reach the
// (i)) without the tooltip closing in the gap between them.
function isPointTowardTooltip(x, y) {
  const tooltip = document.getElementById('cf-tooltip');
  if (!activeHover || !tooltip || tooltip.style.display === 'none') return false;
  const tip = tooltip.getBoundingClientRect(), word = activeHover.range.getBoundingClientRect();
  return x >= Math.min(tip.left, word.left) - 2 && x <= Math.max(tip.right, word.right) + 2
    && y >= Math.min(tip.top, word.top) - 2 && y <= Math.max(tip.bottom, word.bottom) + 2;
}

function cancelHoverSwitch() {
  clearTimeout(hoverSwitchTimer); hoverSwitchTimer = 0; hoverSwitchRecord = null;
}

export function hideTooltip(force = false) {
  if (pinnedTooltipRecord && !force) return;
  cancelHoverSwitch();
  if (force) pinnedTooltipRecord = null;
  restoreHoverReveal(); activeHover = null;
  const tooltip = document.getElementById('cf-tooltip');
  if (tooltip) tooltip.style.display = 'none';
}

// For when feedback is turned off: a pinned tooltip may hold its buttons.
export function hideFeedbackInTooltip() {
  if (pinnedTooltipRecord) hideTooltip(true);
  document.querySelector('#cf-tooltip .cf-feedback-actions')?.remove();
}

function showTooltip(record, x, y) {
  let tooltip = document.getElementById('cf-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div'); tooltip.id = 'cf-tooltip'; document.body.appendChild(tooltip);
  }
  const terms = record.terms?.length ? record.terms : [{ type: record.type }];
  tooltip.textContent = '';
  const seen = new Set();
  for (const term of terms) {
    const label = getLabel(term);
    if (seen.has(label.term)) continue;
    seen.add(label.term);
    const row = document.createElement('div'); row.className = 'cf-term';
    const line = document.createElement('div'); line.className = 'cf-term-line';
    const name = document.createElement('span'); name.className = 'cf-term-name'; name.textContent = label.term;
    line.appendChild(name);
    if (term.confidence && term.confidence !== 'high') {
      const confidence = document.createElement('span'); confidence.className = 'cf-confidence'; confidence.textContent = ` · ${getStrength(term.confidence) === 'medium' ? 'medium' : 'low'} confidence`;
      line.appendChild(confidence);
    }
    const info = document.createElement('span'); info.className = 'cf-info'; info.textContent = 'i';
    info.tabIndex = 0; info.setAttribute('role', 'button'); info.setAttribute('aria-label', `In plain words: ${label.plain}`);
    const plain = document.createElement('div'); plain.className = 'cf-plain';
    const plainName = document.createElement('strong'); plainName.textContent = label.plain;
    plain.append(plainName, label.effect ? ` – ${label.effect}` : '');
    line.appendChild(info); row.append(line, plain);
    tooltip.appendChild(row);
  }
  tooltip.classList.toggle('pinned', pinnedTooltipRecord === record);
  if (pinnedTooltipRecord === record && isFeedbackEnabled()) appendFeedbackActions(tooltip, record);
  tooltip.style.display = 'block';
  revealOriginalText(record);
  const rect = record.range.getBoundingClientRect();
  tooltipAnchor = { record, left: rect.left, top: rect.top };
  const anchorLeft = Number.isFinite(rect.left) && rect.width > 0 ? rect.left : x;
  const anchorTop = Number.isFinite(rect.top) && rect.height > 0 ? rect.top : y;
  const anchorBottom = Number.isFinite(rect.bottom) && rect.height > 0 ? rect.bottom : y;
  const left = Math.min(Math.max(8, anchorLeft), Math.max(8, window.innerWidth - tooltip.offsetWidth - 8));
  // Measure with the plain explanations open, so an opened (i) still fits.
  tooltip.classList.add('cf-measure');
  const fullHeight = tooltip.offsetHeight;
  tooltip.classList.remove('cf-measure');
  const above = anchorTop - fullHeight - 8;
  tooltip.style.left = `${left}px`;
  // Anchor by the bottom edge when above the word, so opening the plain
  // explanation grows the tooltip upward instead of over the word. The
  // explanation opens on the far side of the (i), which keeps it under the pointer.
  tooltip.classList.toggle('cf-above', above >= 8);
  if (above >= 8) {
    tooltip.style.top = 'auto';
    tooltip.style.bottom = `${window.innerHeight - anchorTop + 8}px`;
  } else {
    tooltip.style.bottom = 'auto';
    tooltip.style.top = `${Math.min(anchorBottom + 8, Math.max(8, window.innerHeight - fullHeight - 8))}px`;
  }
}

function findRecordAtCaret(caret, x, y) {
  const node = caret?.offsetNode || caret?.startContainer;
  const offset = caret?.offset ?? caret?.startOffset;
  if (!node || typeof offset !== 'number') return null;
  const records = getNodeRecords(node);
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    // The caret snaps to the nearest text, even from blank space below a
    // paragraph, so the pointer must also be over the highlighted word.
    const caretHit = record.range.isPointInRange(node, offset) || (offset > 0 && record.range.isPointInRange(node, offset - 1));
    const slack = caretHit ? 4 : 2;
    if ([...record.range.getClientRects()].some(rect => x >= rect.left - slack && x <= rect.right + slack && y >= rect.top - slack && y <= rect.bottom + slack)) return record;
  }
  return null;
}

function findRecordAtPoint(x, y) {
  const position = /** @type {any} */ (document.caretPositionFromPoint?.(x, y));
  const range = /** @type {any} */ (document.caretRangeFromPoint?.(x, y));
  const direct = findRecordAtCaret(position, x, y) || findRecordAtCaret(range, x, y);
  if (direct) return direct;

  // Some sites place non-text descendants or a full-card link over the
  // visible text. Check the hit element's ancestors and the elements stacked
  // beneath it, without scanning every match on the page.
  const stack = document.elementsFromPoint(x, y);
  // Over ClearFrame's own tooltip, the text beneath it is not being pointed at.
  if (stack[0]?.closest('#cf-tooltip,#cf-suggestion')) return null;
  const candidates = new Set();
  for (let element = /** @type {Element | null} */ (stack[0] || null), depth = 0; element && depth < 5; depth++, element = element.parentElement) candidates.add(element);
  for (const element of stack.slice(1, 8)) candidates.add(element);
  for (const element of candidates) {
    for (const node of element.childNodes) {
      if (!(node instanceof Text)) continue;
      for (const record of getNodeRecords(node)) {
        if ([...record.range.getClientRects()].some(rect => x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2)) return record;
      }
    }
  }
  return null;
}

function processHoverMove(event) {
  const selection = getSelection();
  if (selection && !selection.isCollapsed) {
    if (activeHover || pinnedTooltipRecord) hideTooltip(true);
    return;
  }
  if (pinnedTooltipRecord || !hasResults()) return;
  const x = event.clientX, y = event.clientY;
  lastPointer.x = x; lastPointer.y = y;
  const record = findRecordAtPoint(x, y);
  if (record !== hoverSwitchRecord) cancelHoverSwitch();
  if (!record) {
    if (activeHover && !isPointInsideHoverReveal(x, y) && !isPointTowardTooltip(x, y)) hideTooltip();
    return;
  }
  if (activeHover === record) return;
  // On the way to the open tooltip's (i), the pointer may cross other
  // highlighted words; only switch if it rests on one.
  if (activeHover && isPointTowardTooltip(x, y)) {
    if (hoverSwitchRecord === record) return;
    hoverSwitchRecord = record;
    hoverSwitchTimer = window.setTimeout(() => {
      hoverSwitchTimer = 0; hoverSwitchRecord = null;
      if (!pinnedTooltipRecord && activeHover !== record && findRecordAtPoint(lastPointer.x, lastPointer.y) === record) {
        restoreHoverReveal(); activeHover = record; showTooltip(record, lastPointer.x, lastPointer.y);
      }
    }, 200);
    return;
  }
  restoreHoverReveal(); activeHover = record; showTooltip(record, x, y);
}

/** @param {MouseEvent} event */
export function handleHoverMove(event) {
  pendingHoverEvent = event;
  if (hoverFrame) return;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    const next = pendingHoverEvent; pendingHoverEvent = null;
    if (next) processHoverMove(next);
  });
}

/** @param {MouseEvent} event */
export function handleTooltipClick(event) {
  if (event.target instanceof Element && event.target.closest('#cf-tooltip')) return;
  // A drag-selection can still be non-collapsed when the browser dispatches a
  // click. Do not turn that selection into a term tooltip.
  const selection = getSelection();
  if (selection && !selection.isCollapsed) return;
  const record = findRecordAtPoint(event.clientX, event.clientY);
  if (record) {
    pinnedTooltipRecord = record; activeHover = record; showTooltip(record, event.clientX, event.clientY);
  } else if (pinnedTooltipRecord) {
    hideTooltip(true);
  }
}

// A finished text selection closes the tooltip and drops a pending hover.
/** @param {MouseEvent} event */
export function handleSelectionEnd(event) {
  if (event.target instanceof Element && event.target.closest('#cf-tooltip,#cf-suggestion')) return;
  const selection = getSelection();
  if (selection && !selection.isCollapsed) {
    pendingHoverEvent = null;
    if (hoverFrame) {
      cancelAnimationFrame(hoverFrame);
      hoverFrame = 0;
    }
    hideTooltip(true);
  }
}

// Auto-scrolling carousels and tickers fire scroll events constantly; only a
// scroll that moves the hovered text should dismiss its tooltip.
/** @param {Event} event */
export function handleScroll(event) {
  const target = event.target;
  const record = pinnedTooltipRecord || activeHover;
  const movesPage = target === document || target === document.documentElement || target === document.body;
  if (movesPage || !record || (target instanceof Node && target.contains(record.node))) {
    // Scroll anchoring scrolls the page when content above changes size, but
    // keeps the text in view where it was; that should not close the tooltip.
    const rect = record?.range.getBoundingClientRect();
    const moved = !rect || tooltipAnchor?.record !== record || Math.abs(rect.left - tooltipAnchor.left) > 1 || Math.abs(rect.top - tooltipAnchor.top) > 1;
    if (moved) hideTooltip(true);
  }
  hideSuggestion();
}
