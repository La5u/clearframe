const { boundary, boundaryAt } = require('./stemmer');

function normalize(phrase) {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildMatcher(index, isTermEnabled = () => true) {
  const root = Object.create(null);
  if (!index.buckets) return root;

  for (const entries of Object.values(index.buckets)) {
    for (const entry of entries) {
      const term = index.termsById?.[entry.termId];
      if (!term || !isTermEnabled(term)) continue;

      let node = root;
      for (const ch of entry.phraseNorm) {
        node = node[ch] ||= Object.create(null);
      }
      node.$ = entry.termId;
    }
  }

  return root;
}

function collectPhraseMatches(matcher, text, useBoundaryAt = false) {
  if (!matcher) return [];

  const matches = [];
  const lower = text.toLowerCase();
  let indexPos = 0;

  while (indexPos < lower.length) {
    let node = matcher[lower[indexPos]];
    if (!node) {
      indexPos++;
      continue;
    }

    let matched = null;
    let cursor = indexPos + 1;

    const boundaryFn = useBoundaryAt ? boundaryAt : boundary;
    if (node.$ && boundaryFn(lower, indexPos, cursor)) {
      matched = { start: indexPos, end: cursor, termId: node.$ };
    }

    while (cursor < lower.length) {
      node = node[lower[cursor]];
      if (!node) break;
      cursor++;
      if (node.$ && boundaryFn(lower, indexPos, cursor)) {
        matched = { start: indexPos, end: cursor, termId: node.$ };
      }
    }

    if (matched) {
      matches.push(matched);
      indexPos = matched.end;
    } else {
      indexPos++;
    }
  }

  return matches;
}

const regexCache = new Map();

function getRegexMatcher(pattern) {
  if (!pattern) return null;
  if (!regexCache.has(pattern)) {
    regexCache.set(pattern, new RegExp(pattern, 'giu'));
  }
  return regexCache.get(pattern);
}

function collectRegexMatches(text, regexTerms, termsById = null) {
  const matches = [];
  for (const term of regexTerms || []) {
    const pattern = term.pattern || termsById?.[term.termId]?.regex;
    const compiled = getRegexMatcher(pattern);
    if (!compiled) continue;
    compiled.lastIndex = 0;
    for (const match of text.matchAll(compiled)) {
      if (!match[0]) continue;
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        termId: term.termId
      });
    }
  }
  return matches;
}

function collectMatches(matcher, text, termsById = null, regexTerms = [], useBoundaryAt = false) {
  const phraseMatches = collectPhraseMatches(matcher, text, useBoundaryAt);
  const regexMatches = collectRegexMatches(text, regexTerms, termsById);
  return [...phraseMatches, ...regexMatches].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
}

function findMatches(matcher, text, termsById = null, regexTerms = [], useBoundaryAt = false) {
  const matches = collectMatches(matcher, text, termsById, regexTerms, useBoundaryAt);
  const accepted = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.start < cursor) continue;
    accepted.push(match);
    cursor = match.end;
  }

  return accepted;
}

module.exports = {
  buildMatcher,
  collectPhraseMatches,
  collectRegexMatches,
  collectMatches,
  findMatches,
  getRegexMatcher,
  normalize,
  regexCache
};
