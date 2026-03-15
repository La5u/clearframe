#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data', 'terms');

const TYPES = {
  euphemism: 'blue',
  aggressive: 'red', aggression: 'red', moral: 'red', derogatory: 'red', loaded: 'red', partisan: 'red',
  sensational: 'yellow', clickbait: 'yellow', reveal: 'yellow', hype: 'yellow', superlative: 'yellow', exaggeration: 'yellow',
  framing: 'gray', unsourced: 'gray', uncertainty: 'gray', authority: 'gray', vague: 'gray',
  emotional: 'purple', fear: 'purple',
  conflict: 'orange', drama: 'orange', disaster: 'orange'
};

function normalize(phrase) {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isStemmableWord(word, term) {
  if (!term?.stemmable) return false;
  return /^[a-z]+$/.test(word);
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

function loadTerms() {
  const terms = {};
  const entries = [];
  function addTerm(phrase, term) {
    if (!terms[phrase]) {
      terms[phrase] = { phrase: phrase, type: term.type };
      entries.push({ phraseNorm: phrase, termId: phrase, length: phrase.length });
    }
  }
  for (const file of fs.readdirSync(DATA).filter(f => f.endsWith('.json'))) {
    const arr = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
    for (const term of arr) {
      const p = normalize(term.phrase);
      addTerm(p, term);
      if (isStemmableWord(p, term)) {
        for (const v of stemVariants(p)) addTerm(v, term);
      }
      for (const alias of term.aliases || []) {
        const a = normalize(alias);
        if (a && a !== p) addTerm(a, term);
      }
    }
  }
  const buckets = {};
  for (const e of entries) {
    (buckets[e.phraseNorm[0]] ||= []).push(e);
  }
  Object.values(buckets).forEach(arr => arr.sort((a, b) => b.length - a.length));
  return { termsById: terms, buckets };
}

function buildMatcher(index) {
  const root = Object.create(null);
  if (!index.buckets) return root;
  for (const entries of Object.values(index.buckets)) {
    for (const entry of entries) {
      const term = index.termsById[entry.termId];
      if (!term) continue;
      let node = root;
      for (const ch of entry.phraseNorm) {
        node = node[ch] ||= Object.create(null);
      }
      node.$ = term;
    }
  }
  return root;
}

function isWordChar(c) { return /[a-z0-9']/i.test(c); }

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
    if (!node) { index++; continue; }
    
    let matched = null;
    let cursor = index + 1;

    if (node.$ && boundary(lower, index, cursor)) {
      matched = { start: index, end: cursor, termId: node.$.phrase };
    }

    while (cursor < lower.length) {
      node = node[lower[cursor]];
      if (!node) break;
      cursor++;
      if (node.$ && boundary(lower, index, cursor)) {
        matched = { start: index, end: cursor, termId: node.$.phrase };
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
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');
  return text;
}

function countMatches(html) {
  const index = loadTerms();
  const matcher = buildMatcher(index);
  const text = extractText(html);
  return findMatches(matcher, text).length;
}

const files = ['newssite.html', 'newssite2.html', 'newssite3.html', 'newssite10th.html', 'newssite10thnypost.html', 'test-all-types.html', 'test-all-terms.html'];
for (const file of files) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const count = countMatches(html);
  console.log(`${file}: ${count} matches`);
}
