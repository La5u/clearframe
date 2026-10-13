import { boundary } from './stemmer.js';

export function normalize(phrase) {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildMatcher(index, isTermEnabled = _term => true) {
  const root = Object.create(null);
  // Term IDs are the normalized phrases. Regex-only terms must stay out of
  // the literal trie or their lookahead/lookbehind constraints are bypassed.
  const regexIds = new Set((index.regexTerms || []).map(term => term.termId));
  for (const [termId, term] of Object.entries(index.termsById || {})) {
    if (regexIds.has(termId) || !isTermEnabled(term)) continue;
    let node = root;
    for (const ch of termId) {
      node = node[ch] ||= Object.create(null);
    }
    node.$ = termId;
  }
  return root;
}

export function collectPhraseMatches(matcher, text, keepMatch = (_termId, _start, _end) => true) {
  if (!matcher) {
    return [];
  }
  const matches = [], lower = text.toLowerCase();
  let pos = 0;
  while (pos < lower.length) {
    let node = matcher[lower[pos]];
    if (!node) {
      pos++; continue;
    }
    let matched = null, cursor = pos + 1;
    if (node.$ && boundary(lower, pos, cursor) && keepMatch(node.$, pos, cursor)) {
      matched = { start: pos, end: cursor, termId: node.$ };
    }
    while (cursor < lower.length) {
      node = node[lower[cursor]];
      if (!node) {
        break;
      }
      cursor++;
      if (node.$ && boundary(lower, pos, cursor) && keepMatch(node.$, pos, cursor)) {
        matched = { start: pos, end: cursor, termId: node.$ };
      }
    }
    if (matched) {
      matches.push(matched); pos = matched.end;
    } else {
      pos++;
    }
  }
  return matches;
}

const regexCache = new Map();

export function getRegexMatcher(pattern) {
  if (!pattern) {
    return null;
  }
  if (!regexCache.has(pattern)) {
    regexCache.set(pattern, new RegExp(pattern, 'giu'));
  }
  return regexCache.get(pattern);
}

export function collectRegexMatches(text, regexTerms, termsById, isTermEnabled = _term => true, keepMatch = (_termId, _start, _end) => true) {
  const matches = [];
  for (const term of regexTerms || []) {
    const td = termsById ? /** @type {any} */ (termsById[term.termId]) : null;
    if (td && !isTermEnabled(td)) {
      continue;
    }
    const pattern = term.pattern || td?.regex;
    const compiled = getRegexMatcher(pattern);
    if (!compiled) {
      continue;
    }
    compiled.lastIndex = 0;
    for (const m of text.matchAll(compiled)) {
      if (!m[0]) {
        continue;
      }
      const end = m.index + m[0].length;
      if (keepMatch(term.termId, m.index, end)) matches.push({ start: m.index, end, termId: term.termId });
    }
  }
  return matches;
}

export function collectMatches(matcher, text, termsById, regexTerms = [], isTermEnabled = _term => true, keepMatch = (_termId, _start, _end) => true) {
  const phrase = collectPhraseMatches(matcher, text, keepMatch);
  const regex = collectRegexMatches(text, regexTerms, termsById, isTermEnabled, keepMatch);
  return [...phrase, ...regex].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
}

export function findMatches(matcher, text, termsById, regexTerms = [], isTermEnabled = _term => true, keepMatch = (_termId, _start, _end) => true) {
  const all = collectMatches(matcher, text, termsById, regexTerms, isTermEnabled, keepMatch);
  const accepted = [];
  let cursor = 0;
  for (const m of all) {
    if (m.start >= cursor) {
      accepted.push(m); cursor = m.end;
    }
  }
  return accepted;
}
