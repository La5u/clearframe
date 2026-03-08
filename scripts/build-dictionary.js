#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'terms');
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');
const CHECK_ONLY = process.argv.includes('--check');

const ALLOWED_CATEGORIES = new Set(['media', 'politics', 'tech', 'corporate', 'clickbait']);
const ALLOWED_MODES = new Set(['replace', 'highlight']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateTerm(term, file) {
  const required = [
    'id',
    'phrase',
    'neutral',
    'type',
    'category',
    'explanation',
    'mode',
    'enabledByDefault'
  ];

  for (const key of required) {
    if (!(key in term)) {
      throw new Error(`${file}: missing required field '${key}' in id=${term.id || 'unknown'}`);
    }
  }

  if (!ALLOWED_CATEGORIES.has(term.category)) {
    throw new Error(`${file}: invalid category '${term.category}' for id=${term.id}`);
  }

  if (!ALLOWED_MODES.has(term.mode)) {
    throw new Error(`${file}: invalid mode '${term.mode}' for id=${term.id}`);
  }

  if (!Array.isArray(term.aliases) && term.aliases !== undefined) {
    throw new Error(`${file}: aliases must be an array for id=${term.id}`);
  }

  if (typeof term.enabledByDefault !== 'boolean') {
    throw new Error(`${file}: enabledByDefault must be boolean for id=${term.id}`);
  }
}

function normalizePhrase(phrase) {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase();
}

function loadTerms() {
  const files = fs.readdirSync(DATA_DIR).filter((name) => name.endsWith('.json')).sort();
  if (files.length === 0) {
    throw new Error('No term files found in data/terms');
  }

  const termsById = {};
  const phraseEntries = [];
  const categoryDefaults = {};

  for (const file of files) {
    const fullPath = path.join(DATA_DIR, file);
    const terms = readJson(fullPath);
    if (!Array.isArray(terms)) {
      throw new Error(`${file}: top-level JSON must be an array`);
    }

    for (const term of terms) {
      validateTerm(term, file);

      if (termsById[term.id]) {
        throw new Error(`Duplicate term id: ${term.id}`);
      }

      const compact = {
        id: term.id,
        phrase: term.phrase,
        neutral: term.neutral,
        type: term.type,
        category: term.category,
        explanation: term.explanation,
        mode: term.mode,
        severity: term.severity ?? 3,
        enabledByDefault: term.enabledByDefault
      };

      termsById[term.id] = compact;
      categoryDefaults[term.category] = categoryDefaults[term.category] ?? term.enabledByDefault;

      const allPhrases = [term.phrase, ...(term.aliases || [])]
        .map(normalizePhrase)
        .filter(Boolean);

      for (const phraseNorm of allPhrases) {
        phraseEntries.push({
          phraseNorm,
          termId: term.id,
          length: phraseNorm.length
        });
      }
    }
  }

  const uniqueByPhraseAndId = new Map();
  for (const entry of phraseEntries) {
    uniqueByPhraseAndId.set(`${entry.phraseNorm}::${entry.termId}`, entry);
  }

  const deduped = Array.from(uniqueByPhraseAndId.values());
  const buckets = {};

  for (const entry of deduped) {
    const firstChar = entry.phraseNorm[0];
    if (!buckets[firstChar]) {
      buckets[firstChar] = [];
    }
    buckets[firstChar].push(entry);
  }

  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => b.length - a.length);
  }

  return {
    version: new Date().toISOString(),
    categories: Array.from(ALLOWED_CATEGORIES),
    categoryDefaults,
    termsById,
    buckets
  };
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
      continue;
    }

    if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  const index = loadTerms();

  if (CHECK_ONLY) {
    console.log(`Validation OK: ${Object.keys(index.termsById).length} terms loaded.`);
    return;
  }

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  copyDirRecursive(SRC_DIR, DIST_DIR);

  fs.writeFileSync(
    path.join(DIST_DIR, 'terms-index.json'),
    JSON.stringify(index, null, 2) + '\n',
    'utf8'
  );

  fs.writeFileSync(
    path.join(DIST_DIR, 'content', 'terms-index.js'),
    `globalThis.CLEARFRAME_TERMS_INDEX = ${JSON.stringify(index)};\n`,
    'utf8'
  );

  console.log(`Build OK: ${Object.keys(index.termsById).length} terms, ${Object.keys(index.buckets).length} buckets.`);
}

main();
