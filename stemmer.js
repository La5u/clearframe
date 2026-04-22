const IRREGULAR_VERB_FORMS = {
  break: { past: 'broke' },
  sunset: { past: 'sunset' }
};

function isConsonant(code) {
  return code >= 97 && code <= 122 && ![97, 101, 105, 111, 117].includes(code);
}

function shouldDoubleFinalConsonant(word) {
  if (word.length < 3 || word.length > 4) return false;
  if (/(w|x|y)$/i.test(word)) return false;
  if (/(ck|ch|sh|th|ph|gh|qu)$/i.test(word)) return false;
  const last = word.charCodeAt(word.length - 1);
  const mid = word.charCodeAt(word.length - 2);
  const prev = word.charCodeAt(word.length - 3);
  return isConsonant(last) && !isConsonant(mid) && isConsonant(prev);
}

function pluralizeWord(word) {
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + 'es';
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
  return word + 's';
}

function pastTenseWord(word) {
  if (IRREGULAR_VERB_FORMS[word]?.past) return IRREGULAR_VERB_FORMS[word].past;
  if (word.endsWith('e')) return word + 'd';
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ied';
  if (shouldDoubleFinalConsonant(word)) return word + word[word.length - 1] + 'ed';
  return word + 'ed';
}

function ingWord(word) {
  if (word.endsWith('ie')) return word.slice(0, -2) + 'ying';
  if (word.endsWith('e')) return word.slice(0, -1) + 'ing';
  if (shouldDoubleFinalConsonant(word)) return word + word[word.length - 1] + 'ing';
  return word + 'ing';
}

function adverbWord(word) {
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ily';
  return word + 'ly';
}

function isWordChar(c) {
  const code = c.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 39
  );
}

function boundary(text, start, end) {
  const prev = start > 0 ? text[start - 1] : ' ';
  const next = end < text.length ? text[end] : ' ';
  return !isWordChar(prev) && !isWordChar(next);
}

function isWordCharAt(text, index) {
  const c = text[index];
  const code = c.charCodeAt(0);
  if (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  ) {
    return true;
  }
  return c === '\'';
}

function boundaryAt(text, start, end) {
  return !isWordCharAt(text, start - 1) && !isWordCharAt(text, end);
}

module.exports = {
  IRREGULAR_VERB_FORMS,
  isConsonant,
  shouldDoubleFinalConsonant,
  pluralizeWord,
  pastTenseWord,
  ingWord,
  adverbWord,
  isWordChar,
  boundary,
  isWordCharAt,
  boundaryAt
};