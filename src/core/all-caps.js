import { getAllCapsAction, getContextualAllCapsAction } from './display-utils.js';

export const ALL_CAPS_TERM_ID = '__clearframe_all_caps__';

function getPrecedingIStart(text, start) {
  const match = text.slice(0, start).match(/\bI\s+$/);
  return match ? match.index : null;
}

function hasNextTitleCaseWord(text, end) {
  return /^\s+[A-Z][a-z]+(?:'[A-Za-z]+)?\b/.test(text.slice(end));
}

function isContextualAllCaps(text, start, end) {
  if (text.slice(start, end) === 'A' && (/-levels?\b/i.test(text.slice(end, end + 8)) || /\b(?:an|grade|grade of|earned|received|scored|got)\s+$/i.test(text.slice(Math.max(0, start - 20), start)))) {
    return false;
  }
  if (text.slice(start, end) === 'A' && hasNextTitleCaseWord(text, end)) {
    return false;
  }
  return !!getContextualAllCapsAction(text, start, end);
}

export function findAllCapsMatches(text, termId = ALL_CAPS_TERM_ID) {
  const matches = [];
  let pending = null;
  for (const m of String(text || '').matchAll(/\b[A-Z0-9]+(?:'[A-Z0-9]+)*\b/g)) {
    if (typeof m.index !== 'number' || !m[0]) {
      continue;
    }
    let start = m.index;
    const end = m.index + m[0].length;
    if (!getAllCapsAction(m[0]) && !isContextualAllCaps(text, start, end)) {
      const phraseStart = m[0] === 'AM' ? getPrecedingIStart(text, start) : null;
      if (phraseStart === null || !getAllCapsAction(text.slice(phraseStart, end))) {
        continue;
      }
      start = phraseStart;
    }
    if (pending && pending.start === start) {
      pending.end = end; continue;
    }
    if (pending && /^[\s:;,.!?'"()[\]{}-]+$/.test(text.slice(pending.end, start))) {
      pending.end = end; continue;
    }
    if (pending) {
      matches.push(pending);
    }
    pending = { start, end, termId, virtual: true };
  }
  if (pending) {
    matches.push(pending);
  }
  return matches;
}
