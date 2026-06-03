import { ALL_CAPS_ACRONYMS } from './acronyms.js';
import { COMMON_SHORT_WORDS } from './commonShortWords.js';

const MIN = 4, WORD = /^[A-Z]+(?:'[A-Z]+)*$/, GLOBAL = /\b[A-Z]+(?:'[A-Z]+)*\b/g;

export function getAllCapsAction(text) {
  const n = String(text || '').toUpperCase();
  if (ALL_CAPS_ACRONYMS.has(n)) {
    return null;
  }
  if (COMMON_SHORT_WORDS.has(n)) {
    return 'all-caps';
  }
  return n.length >= MIN && WORD.test(n) ? 'all-caps' : null;
}

export function lowerAllCapsLongWords(text) {
  if (!text) {
    return text;
  }
  return text.replace(GLOBAL, word => {
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
