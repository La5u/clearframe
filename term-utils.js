const fs = require('fs');
const path = require('path');

function normalize(phrase) {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isStemmableWord(word, term) {
  return !!term?.stemmable && /^[a-z]+$/.test(word);
}

function stemVariants(word) {
  const out = new Set([word]);
  const consonantY = /[^aeiou]y$/;
  const plural = w => {
    if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es';
    if (consonantY.test(w)) return w.slice(0, -1) + 'ies';
    return w + 's';
  };
  const past = w => {
    if (w.endsWith('e')) return w + 'd';
    if (consonantY.test(w)) return w.slice(0, -1) + 'ied';
    return w + 'ed';
  };
  const ing = w => {
    if (w.endsWith('ie')) return w.slice(0, -2) + 'ying';
    if (w.endsWith('e')) return w.slice(0, -1) + 'ing';
    return w + 'ing';
  };
  out.add(plural(word));
  out.add(past(word));
  out.add(ing(word));
  return [...out];
}

function loadTerms(dataDir) {
  const terms = {};
  const entries = [];

  function addTerm(phrase, term) {
    if (!terms[phrase]) {
      terms[phrase] = {
        phrase,
        type: term.type,
        neutral: term.neutral || '',
        explanation: term.explanation || ''
      };
      entries.push({ phraseNorm: phrase, termId: phrase, length: phrase.length });
    }
  }

  for (const file of fs.readdirSync(dataDir).filter(f => f.endsWith('.json'))) {
    const arr = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    for (const term of arr) {
      const phrase = normalize(term.phrase);
      addTerm(phrase, term);
      if (isStemmableWord(phrase, term)) {
        for (const variant of stemVariants(phrase)) addTerm(variant, term);
      }
      for (const alias of term.aliases || []) {
        const normalizedAlias = normalize(alias);
        if (normalizedAlias && normalizedAlias !== phrase) addTerm(normalizedAlias, term);
      }
    }
  }

  const buckets = {};
  for (const entry of entries) {
    (buckets[entry.phraseNorm[0]] ||= []).push(entry);
  }
  Object.values(buckets).forEach(arr => arr.sort((a, b) => b.length - a.length));

  return { termsById: terms, buckets };
}

function buildMatcher(index) {
  const root = Object.create(null);
  if (!index.buckets) return root;
  for (const entries of Object.values(index.buckets)) {
    for (const entry of entries) {
      if (!index.termsById[entry.termId]) continue;
      let node = root;
      for (const ch of entry.phraseNorm) {
        node = node[ch] ||= Object.create(null);
      }
      node.$ = entry.termId;
    }
  }
  return root;
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

function findMatches(matcher, text) {
  if (!matcher) return [];
  const lower = text.toLowerCase();
  const matches = [];
  let index = 0;

  while (index < lower.length) {
    let node = matcher[lower[index]];
    if (!node) {
      index++;
      continue;
    }

    let matched = null;
    let cursor = index + 1;

    if (node.$ && boundary(lower, index, cursor)) {
      matched = { start: index, end: cursor, termId: node.$ };
    }

    while (cursor < lower.length) {
      node = node[lower[cursor]];
      if (!node) break;
      cursor++;
      if (node.$ && boundary(lower, index, cursor)) {
        matched = { start: index, end: cursor, termId: node.$ };
      }
    }

    if (matched) {
      matches.push(matched);
      index = matched.end;
    } else {
      index++;
    }
  }

  return matches;
}

function extractText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

module.exports = {
  buildMatcher,
  extractText,
  findMatches,
  loadTerms,
  normalize
};
