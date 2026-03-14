#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'terms');

const ALLOWED_TYPES = new Set([
  'euphemism',
  'aggressive', 'aggression', 'moral', 'derogatory', 'loaded',
  'sensational', 'clickbait', 'superlative', 'exaggeration', 'reveal', 'hype',
  'framing', 'unsourced', 'uncertainty', 'authority',
  'emotional', 'fear',
  'conflict', 'drama', 'disaster',
  'vague'
]);

const DEFAULT_SETTINGS = {
  enabled: true,
  types: {}
};

const ALL_CAPS_TERM_ID = '__clearframe_all_caps__';
const ALL_CAPS_TERM = Object.freeze({
  id: ALL_CAPS_TERM_ID,
  phrase: 'ALL CAPS',
  neutral: 'lowercase',
  type: 'caps emphasis',
  category: 'clickbait',
  explanation: 'Caps normalized.',
  mode: 'replace',
  rewrite: {
    replacement: '',
    strategy: 'normalize-lowercase'
  }
});

function normalizePhrase(phrase) {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeTerm(term) {
  const literals = [
    ...(typeof term.phrase === 'string' ? [term.phrase] : []),
    ...((term.aliases || []).filter(Boolean)),
    ...((term.match?.literals || []).filter(Boolean))
  ];
  const patterns = [
    ...((term.patterns || []).filter(Boolean)),
    ...((term.match?.patterns || []).filter(Boolean))
  ];
  const replacement = term.rewrite?.replacement ?? term.neutral ?? '';

  return {
    ...term,
    id: term.id ?? term.phrase,
    phrase: typeof term.phrase === 'string' ? term.phrase : literals[0] || term.id,
    neutral: replacement,
    match: { literals, patterns, context: { headlineOnly: Boolean(term.match?.context?.headlineOnly), skipSelectors: [] } },
    rewrite: { replacement, strategy: term.rewrite?.strategy || 'preserve-case' }
  };
}

function loadTerms(dataDir) {
  const termsById = {};
  const phraseEntries = new Map();
  const patternEntries = new Map();

  for (const file of fs.readdirSync(dataDir).filter((n) => n.endsWith('.json')).sort()) {
    const terms = readJson(path.join(dataDir, file));
    for (const term of terms) {
      const normalized = normalizeTerm(term);
      if (termsById[normalized.id]) continue;
      termsById[normalized.id] = { ...normalized, severity: normalized.severity ?? 3 };
      normalized.match.literals.map(normalizePhrase).filter(Boolean).forEach((p) => {
        phraseEntries.set(`${p}::${normalized.id}`, { phraseNorm: p, termId: normalized.id, length: p.length });
      });
      normalized.match.patterns.forEach((s) => patternEntries.set(`${s}::${normalized.id}`, { source: s, termId: normalized.id }));
    }
  }

  const buckets = {};
  for (const entry of phraseEntries.values()) {
    (buckets[entry.phraseNorm[0]] ||= []).push(entry);
  }
  Object.values(buckets).forEach((e) => e.sort((a, b) => b.length - a.length));

  return { termsById, buckets, patterns: Array.from(patternEntries.values()) };
}

function getTerm(indexData, termId) {
  return termId === ALL_CAPS_TERM_ID ? ALL_CAPS_TERM : indexData?.termsById?.[termId] || null;
}

function isWordChar(char) {
  return /[A-Za-z0-9']/u.test(char);
}

function hasWordBoundary(text, start, end) {
  const prev = start > 0 ? text[start - 1] : ' ';
  const next = end < text.length ? text[end] : ' ';
  return !isWordChar(prev) && !isWordChar(next);
}

function compileMatcher(indexData, settings) {
  const root = Object.create(null);
  const patterns = [];
  const MATCH_TERM_KEY = '$';

  const isTypeEnabled = (type) => {
    if (!settings?.types) return true;
    if (Object.keys(settings.types).length === 0) return true;
    return settings.types[type] !== false;
  };

  for (const entries of Object.values(indexData?.buckets || {})) {
    for (const entry of entries) {
      const term = getTerm(indexData, entry.termId);
      if (!term || !isTypeEnabled(term.type)) continue;
      let node = root;
      for (const char of entry.phraseNorm) {
        node[char] ||= Object.create(null);
        node = node[char];
      }
      node[MATCH_TERM_KEY] = term.id;
    }
  }

  return { root, patterns };
}

function collectLiteralMatches(compiledMatcher, textLower) {
  if (!compiledMatcher?.root) return [];
  const matches = [];
  const MATCH_TERM_KEY = '$';
  let index = 0;

  while (index < textLower.length) {
    let node = compiledMatcher.root[textLower[index]];
    if (!node) { index += 1; continue; }

    let matched = null;
    let cursor = index + 1;

    if (node[MATCH_TERM_KEY] && hasWordBoundary(textLower, index, cursor)) {
      matched = { start: index, end: cursor, termId: node[MATCH_TERM_KEY] };
    }

    while (cursor < textLower.length) {
      node = node[textLower[cursor]];
      if (!node) break;
      cursor += 1;
      if (node[MATCH_TERM_KEY] && hasWordBoundary(textLower, index, cursor)) {
        matched = { start: index, end: cursor, termId: node[MATCH_TERM_KEY] };
      }
    }

    if (matched) { matches.push(matched); index = matched.end; continue; }
    index += 1;
  }
  return matches;
}

function collectPatternMatches(compiledMatcher, text, textLower) {
  if (!compiledMatcher?.patterns?.length) return [];
  const matches = [];
  for (const { regex, termId, caseSensitive } of compiledMatcher.patterns) {
    regex.lastIndex = 0;
    const sourceText = caseSensitive ? text : textLower;
    let match;
    while ((match = regex.exec(sourceText))) {
      if (match[0].length === 0) { regex.lastIndex += 1; continue; }
      matches.push({ start: match.index, end: match.index + match[0].length, termId });
    }
  }
  return matches;
}

function mergeMatches(...groups) {
  const allMatches = groups.flat();
  if (!allMatches.length) return [];

  allMatches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });

  const merged = [];
  let i = 0;
  while (i < allMatches.length) {
    const match = allMatches[i];
    const spanMatches = [match];

    let j = i + 1;
    while (j < allMatches.length && allMatches[j].start === match.start && allMatches[j].end === match.end) {
      spanMatches.push(allMatches[j]);
      j++;
    }

    merged.push({ span: match, termIds: spanMatches.map(m => m.termId) });
    i = j;
  }

  return merged;
}

function findMatches(text, compiledMatcher) {
  const textLower = text.toLowerCase();
  return mergeMatches(collectLiteralMatches(compiledMatcher, textLower), collectPatternMatches(compiledMatcher, text, textLower));
}

function getReplacementText(term, originalText) {
  const rewrite = term?.rewrite || {};
  const replacement = rewrite.replacement ?? term?.neutral ?? '';
  if (rewrite.strategy === 'normalize-lowercase') return originalText.toLowerCase();
  if (rewrite.strategy === 'preserve-case') {
    if (originalText === originalText.toUpperCase() && /[A-Z]/.test(originalText)) return replacement.toUpperCase();
    if (originalText[0] && originalText[0] === originalText[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function decodeEntities(text) {
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function stripTags(html) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function extractHeadlineText(html) {
  const patterns = [
    /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
    /<header[^>]*>([\s\S]*?)<\/header>/gi,
    /<([a-z0-9]+)([^>]*(?:class|id|data-testid)="[^"]*(?:headline|title)[^"]*"[^>]*)>([\s\S]*?)<\/\1>/gi
  ];
  const parts = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      parts.push(stripTags(match[match.length - 1]));
    }
  }
  return parts.join(' ');
}

function filterIndex(index, predicate) {
  const termIds = new Set(Object.values(index.termsById).filter(predicate).map((term) => term.id));
  const buckets = {};
  Object.entries(index.buckets).forEach(([key, entries]) => {
    const filtered = entries.filter((entry) => termIds.has(entry.termId));
    if (filtered.length) buckets[key] = filtered;
  });
  return { ...index, termsById: Object.fromEntries(Object.entries(index.termsById).filter(([termId]) => termIds.has(termId))), buckets, patterns: index.patterns.filter((entry) => termIds.has(entry.termId)) };
}

function countMatches(text, index, settings) {
  return findMatches(text, compileMatcher(index, settings)).length;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const index = loadTerms(DATA_DIR);
const settings = structuredClone(DEFAULT_SETTINGS);
const nonHeadlineIndex = filterIndex(index, (term) => !term.match?.context?.headlineOnly);
const headlineIndex = filterIndex(index, (term) => term.match?.context?.headlineOnly);

const cases = [
  { file: 'newssite.html', min: 200 },
  { file: 'newssite2.html', min: 50, max: 200 },
  { file: 'newssite3.html', min: 150 }
];

for (const testCase of cases) {
  const html = fs.readFileSync(path.join(ROOT, testCase.file), 'utf8');
  const total = countMatches(stripTags(html), nonHeadlineIndex, settings) + countMatches(extractHeadlineText(html), headlineIndex, settings);
  assert(total >= testCase.min, `${testCase.file}: expected at least ${testCase.min} matches, got ${total}`);
  if (testCase.max) assert(total <= testCase.max, `${testCase.file}: expected at most ${testCase.max} matches, got ${total}`);
  console.log(`${testCase.file}: ${total} matches`);
}

const rewriteSettings = { ...DEFAULT_SETTINGS, highlightOnly: false };
const shocking = Object.values(index.termsById).find((term) => term.phrase.toLowerCase() === 'shocking');
assert(shocking, 'missing shocking term');
assert(getReplacementText(shocking, 'Shocking') === 'Surprising', 'preserve-case replacement failed');

const upperBreaking = Object.values(index.termsById).find((term) => term.phrase.toLowerCase() === 'breaking');
assert(upperBreaking, 'missing breaking uppercase term');

console.log('Fixture tests passed.');
