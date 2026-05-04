import { ALL_CAPS_ACRONYMS } from './acronyms.js';
import { COMMON_SHORT_WORDS } from './commonShortWords.js';

const ALL_CAPS_MIN_LENGTH = 4;
const ALL_CAPS_WORD = /^[A-Z]+(?:'[A-Z]+)*$/;
const ALL_CAPS_WORD_GLOBAL = /\b[A-Z]+(?:'[A-Z]+)*\b/g;

export function getAllCapsAction(text) {
  const normalized = String(text || '').toUpperCase();
  if (COMMON_SHORT_WORDS.has(normalized)) return 'all-caps';
  if (normalized.length < ALL_CAPS_MIN_LENGTH) return null;
  if (ALL_CAPS_ACRONYMS.has(normalized)) return null;
  return normalized.length >= ALL_CAPS_MIN_LENGTH && ALL_CAPS_WORD.test(normalized) ? 'all-caps' : null;
}

export function lowerAllCapsLongWords(text) {
  if (!text) return text;
  return text.replace(ALL_CAPS_WORD_GLOBAL, word => {
    if (ALL_CAPS_ACRONYMS.has(word)) return word;
    if (word.length >= ALL_CAPS_MIN_LENGTH) return word.toLowerCase();
    return COMMON_SHORT_WORDS.has(word) ? word.toLowerCase() : word;
  });
}

export function matchReplacementCase(sourceText, replacement) {
  if (!replacement) return replacement;
  if (!sourceText) return replacement;
  if (sourceText === sourceText.toUpperCase()) return replacement.toUpperCase();
  if (sourceText[0] === sourceText[0].toUpperCase() && sourceText.slice(1) === sourceText.slice(1).toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
  }
  return replacement.toLowerCase();
}
