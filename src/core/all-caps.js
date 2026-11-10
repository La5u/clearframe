import { ALL_CAPS_ACRONYMS } from './acronyms.js';
import { getAllCapsAction, getContextualAllCapsAction, lowerAllCapsLongWords } from './display-utils.js';

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

// Words that do not occur in a name or a label, so a run holding one reads as a phrase.
const PHRASE_WORDS = new Set([...SENTENCE_WORDS, ...EMPHASIS_WORDS, 'AN', 'AND', 'OR', 'BUT', 'OF', 'IN', 'ON', 'AT', 'TO', 'FOR', 'WITH', 'FROM', 'THIS', 'THAT', 'HE', 'SHE', 'THEY']);
const NAME_TOKEN = /^[A-Z][A-Z.'’-]*$/;
// A name or label set in capitals stands apart from the sentence: at the
// start, after punctuation or a byline verb ("by", "writes", "tell"), and
// followed by the end, punctuation, a possessive or a lowercase word.
const BYLINE_BEFORE = /(?:^|[:;,.!?…|•–—-]|\b(?:by|writes|says|tells?|told|and))\s*$/;
const BYLINE_AFTER = /^(?:\s*$|\s*[:;,.!?…|•–—)-]|['’]s\b|\s+[a-z])/;

// Grows a run over neighbouring short caps words a name may hold ("TOM",
// "DR", "GUR") and returns the span if it reads as a byline, name or label:
// "it's ugly: MAUREEN CALLAHAN", "as HAVIV RETTIG GUR writes", "- LIVE UPDATES".
function getBylineSpan(text, run) {
  let { start, end } = run;
  for (let m; (m = /(?:^|\s)([A-Z][A-Z.'’-]+) $/.exec(text.slice(Math.max(0, start - 12), start))) && !PHRASE_WORDS.has(m[1]);) start -= m[1].length + 1;
  for (let m; (m = /^ ([A-Z][A-Z.'’-]+)(?![\w'’])/.exec(text.slice(end))) && !PHRASE_WORDS.has(m[1]);) end += m[1].length + 1;
  const words = text.slice(start, end).split(' ');
  if (words.length < 2 || words.length > 4 || words.some(word => !NAME_TOKEN.test(word) || PHRASE_WORDS.has(word.replace(/[.]+$/, '')))) return null;
  const before = text.slice(0, start), after = text.slice(end);
  return (BYLINE_BEFORE.test(before) && BYLINE_AFTER.test(after)) || /^\s+(?:writes|says|reports|reviews)\b/.test(after) ? { start, end } : null;
}

// Real pages are full of caps that are not shouting: acronyms (US, ICE, NYPD),
// section labels (POLITICS, LATEST NEWS), kickers ("WATCH:") and bylines.
function isEmphasis(text, run) {
  const value = text.slice(run.start, run.end);
  const words = value.match(/[A-Z0-9]+(?:'[A-Z0-9]+)*/g) || [];
  const bare = text.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9'’]+$/g, '');
  if (words.length <= 3 && value === bare && !words.some(word => SENTENCE_WORDS.has(word))) return false;
  // Kickers and bylines: "WATCH:", "ROB CRILLY:", "W. JAMES ANTLE:".
  if (/^[\sA-Z.'’-]*$/.test(text.slice(0, run.start)) && /^\s*:/.test(text.slice(run.end))) return false;
  if (getBylineSpan(text, run)) return false;
  if (words.length === 1) {
    const [word] = words;
    return EMPHASIS_WORDS.has(word) || (word.length >= 6 && !ALL_CAPS_ACRONYMS.has(word) && /[AEIOUY]/.test(word));
  }
  if (words.length === 2 && words.every(word => word.length <= 4 && !EMPHASIS_WORDS.has(word) && !SENTENCE_WORDS.has(word))) return false;
  return true;
}

// "act NOW: TANYA JEFFERIES": a byline after a colon is cut off the run.
function trimBylineTail(text, run) {
  const colon = text.slice(run.start, run.end).lastIndexOf(':');
  if (colon < 0) return run;
  const tailStart = run.start + colon + 1 + (text.slice(run.start + colon + 1).match(/^\s*/)?.[0].length || 0);
  return tailStart < run.end && getBylineSpan(text, { ...run, start: tailStart }) ? { ...run, end: run.start + colon } : run;
}

const SMALL_WORDS = new Set(['A', 'AN', 'AND', 'AS', 'AT', 'BUT', 'BY', 'FOR', 'FROM', 'IN', 'INTO', 'OF', 'ON', 'OR', 'THE', 'TO', 'WITH']);
// Words that make a caps run read as a sentence rather than a heading or label.
const CLAUSE_WORDS = new Set(['I', 'YOU', 'WE', 'HE', 'SHE', 'THEY', 'IT', "IT'S", 'IS', 'ARE', 'WAS', 'WERE', 'DO', "DON'T", 'WILL', 'CAN', 'NOT', 'MY']);

/**
 * The wording shown for a caps run in reword mode: lowercase inside a
 * sentence, capitalised at the start of one, and Title Case when the run is
 * the whole text and reads as a heading or label ("War in the Middle East").
 * @param {string} value the caps run @param {string} before @param {string} after text around it
 */
export function restoreAllCapsCase(value, before = '', after = '') {
  const words = value.match(/[A-Z0-9]+(?:'[A-Z0-9]+)*/g) || [];
  if (!/[a-z]/.test(value) && !/[A-Za-z0-9]/.test(before + after) && words.length > 1 && !words.some(word => CLAUSE_WORDS.has(word))) {
    const lowered = lowerAllCapsLongWords(value);
    let index = 0;
    return value.replace(/[A-Z0-9]+(?:'[A-Z0-9]+)*/g, (word, offset) => {
      const first = index++ === 0;
      if (!first && SMALL_WORDS.has(word)) return word.toLowerCase();
      // Short words lowerAllCapsLongWords keeps in capitals may be acronyms.
      return lowered.slice(offset, offset + word.length) === word && word.length < 4 ? word : word[0] + word.slice(1).toLowerCase();
    });
  }
  const lowered = lowerAllCapsLongWords(value);
  return /(?:^|[.!?:])\s*['"‘“(]?\s*$/.test(before) ? lowered.replace(/[A-Za-z]/, letter => letter.toUpperCase()) : lowered;
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
  const value = String(text || '');
  return matches.map(run => trimBylineTail(value, run)).filter(run => isEmphasis(value, run));
}
