export const IRREGULAR_VERB_FORMS = { break: { past: 'broke' }, sunset: { past: 'sunset' } };

function isConsonant(code) {
  return code >= 97 && code <= 122 && ![97, 101, 105, 111, 117].includes(code);
}

function shouldDoubleFinalConsonant(word) {
  if (word.length < 3 || word.length > 4) {
    return false;
  }
  if (/(w|x|y)$/i.test(word) || /(ck|ch|sh|th|ph|gh|qu)$/i.test(word)) {
    return false;
  }
  const last = word.charCodeAt(word.length - 1), mid = word.charCodeAt(word.length - 2), prev = word.charCodeAt(word.length - 3);
  return isConsonant(last) && !isConsonant(mid) && isConsonant(prev);
}

export function pluralizeWord(w) {
  if (/(s|x|z|ch|sh)$/i.test(w)) {
    return `${w  }es`;
  }
  if (/[^aeiou]y$/i.test(w)) {
    return `${w.slice(0, -1)  }ies`;
  }
  return `${w  }s`;
}

export function pastTenseWord(word) {
  if (IRREGULAR_VERB_FORMS[word]?.past) {
    return IRREGULAR_VERB_FORMS[word].past;
  }
  if (word.endsWith('e')) {
    return `${word  }d`;
  }
  if (/[^aeiou]y$/i.test(word)) {
    return `${word.slice(0, -1)  }ied`;
  }
  if (shouldDoubleFinalConsonant(word)) {
    return `${word + word[word.length - 1]  }ed`;
  }
  return `${word  }ed`;
}

export function ingWord(word) {
  if (word.endsWith('ie')) {
    return `${word.slice(0, -2)  }ying`;
  }
  if (word.endsWith('e')) {
    return `${word.slice(0, -1)  }ing`;
  }
  if (shouldDoubleFinalConsonant(word)) {
    return `${word + word[word.length - 1]  }ing`;
  }
  return `${word  }ing`;
}

export function adverbWord(word) {
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) {
    return `${word.slice(0, -1)  }ily`;
  }
  return `${word  }ly`;
}

export function isWordChar(c) {
  const code = c.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 39;
}

export function boundary(text, start, end) {
  return !isWordChar(start > 0 ? text[start - 1] : ' ') && !isWordChar(end < text.length ? text[end] : ' ');
}

export function isWordCharAt(text, index) {
  const c = text[index], code = c.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || c === '\'';
}

export function boundaryAt(text, start, end) {
  return !isWordCharAt(text, start - 1) && !isWordCharAt(text, end);
}
