import { ALL_CAPS_ACRONYMS } from './acronyms.js';
import { COMMON_SHORT_PHRASES, COMMON_SHORT_WORDS } from './commonShortWords.js';

const MIN = 4, WORD = /^[A-Z]+(?:'[A-Z]+)*$/, GLOBAL = /\b[A-Z]+(?:'[A-Z]+)*\b/g;
const CONTEXTUAL_SHORT_WORDS = new Set(['A']);
const SHORT_PHRASE_GLOBAL = /\bI\s+AM\b/g;

export function getAllCapsAction(text) {
  const n = String(text || '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (ALL_CAPS_ACRONYMS.has(n)) {
    return null;
  }
  if (COMMON_SHORT_PHRASES.has(n)) {
    return 'all-caps';
  }
  if (COMMON_SHORT_WORDS.has(n)) {
    return 'all-caps';
  }
  return n.length >= MIN && WORD.test(n) ? 'all-caps' : null;
}

export function getContextualAllCapsAction(text, start, end) {
  const value = String(text || '');
  const word = value.slice(start, end).toUpperCase();
  if (!CONTEXTUAL_SHORT_WORDS.has(word)) {
    return null;
  }
  return /[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*\s+$/.test(value.slice(0, start)) ? 'all-caps' : null;
}

export function lowerAllCapsLongWords(text) {
  if (!text) {
    return text;
  }
  return text.replace(SHORT_PHRASE_GLOBAL, phrase => phrase.toLowerCase()).replace(GLOBAL, word => {
    if (ALL_CAPS_ACRONYMS.has(word)) {
      return word;
    }
    if (word.length >= MIN) {
      return word.toLowerCase();
    }
    return COMMON_SHORT_WORDS.has(word) ? word.toLowerCase() : word;
  });
}

export function matchReplacementCase(src, replacement) {
  if (!replacement || !src) {
    return replacement;
  }
  if (src === src.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (src[0] === src[0].toUpperCase() && src.slice(1) === src.slice(1).toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
  }
  return replacement.toLowerCase();
}
