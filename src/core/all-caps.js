import { ALL_CAPS_ACRONYMS } from './acronyms.js';
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

// Words that make a short caps node read as a sentence ("I DO NOT") rather than a label ("LATEST NEWS").
const SENTENCE_WORDS = new Set(['I', 'NOT', 'YOU', 'IS', 'ARE', 'WAS', 'A', 'THE', 'DO', "DON'T", 'WILL', 'CAN', 'WE', 'MY', 'IT', "IT'S"]);
// Short words that are emphasis rather than acronyms when capitalized alone.
const EMPHASIS_WORDS = new Set(['NOT', 'NEVER', 'MUST', 'ALL', 'EVERY', 'ONLY', 'REAL', 'HUGE', 'VERY', 'EVER', 'STILL', 'JUST', 'NO']);

// Real pages are full of caps that are not shouting: acronyms (US, ICE, NYPD),
// section labels (POLITICS, LATEST NEWS), and kickers ("WATCH:").
function isEmphasis(text, run) {
  const value = text.slice(run.start, run.end);
  const words = value.match(/[A-Z0-9]+(?:'[A-Z0-9]+)*/g) || [];
  const bare = text.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9'’]+$/g, '');
  if (words.length <= 3 && value === bare && !words.some(word => SENTENCE_WORDS.has(word))) return false;
  // Kickers and bylines: "WATCH:", "ROB CRILLY:", "W. JAMES ANTLE:".
  if (/^[\sA-Z.'’-]*$/.test(text.slice(0, run.start)) && /^\s*:/.test(text.slice(run.end))) return false;
  if (words.length === 1) {
    const [word] = words;
    return EMPHASIS_WORDS.has(word) || (word.length >= 6 && !ALL_CAPS_ACRONYMS.has(word) && /[AEIOUY]/.test(word));
  }
  if (words.length === 2 && words.every(word => word.length <= 4 && !EMPHASIS_WORDS.has(word) && !SENTENCE_WORDS.has(word))) return false;
  return true;
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
  return matches.filter(run => isEmphasis(String(text || ''), run));
}
