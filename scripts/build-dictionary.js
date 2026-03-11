#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const DATA_DIR = path.join(ROOT, 'data', 'terms');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_FIREFOX_DIR = path.join(ROOT, 'dist-firefox');

const ALLOWED_CATEGORIES = new Set(['media', 'politics', 'tech', 'corporate', 'clickbait']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizePhrase(phrase) {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase();
}

function validateTerm(term, file) {
  for (const key of ['phrase', 'type', 'category', 'explanation']) {
    if (!(key in term)) {
      throw new Error(`${file}: missing required field '${key}'`);
    }
  }
  if (!ALLOWED_CATEGORIES.has(term.category)) {
    throw new Error(`${file}: invalid category '${term.category}'`);
  }
}

function loadTerms(dataDir) {
  const termsByPhrase = {};
  const phraseEntries = [];
  const files = fs.readdirSync(dataDir).filter((name) => name.endsWith('.json')).sort();

  if (!files.length) {
    throw new Error('No term files found in data/terms');
  }

  for (const file of files) {
    const terms = readJson(path.join(dataDir, file));
    if (!Array.isArray(terms)) {
      throw new Error(`${file}: top-level JSON must be an array`);
    }

    for (const term of terms) {
      validateTerm(term, file);
      const phraseNorm = normalizePhrase(term.phrase);

      if (termsByPhrase[phraseNorm]) {
        throw new Error(`Duplicate phrase: ${phraseNorm}`);
      }

      termsByPhrase[phraseNorm] = {
        phrase: phraseNorm,
        neutral: term.neutral || '',
        type: term.type,
        category: term.category,
        explanation: term.explanation
      };

      phraseEntries.push({
        phraseNorm,
        termId: phraseNorm,
        length: phraseNorm.length
      });

      for (const alias of term.aliases || []) {
        const aliasNorm = normalizePhrase(alias);
        if (aliasNorm && aliasNorm !== phraseNorm) {
          if (termsByPhrase[aliasNorm]) {
            throw new Error(`Duplicate alias: ${aliasNorm}`);
          }
          termsByPhrase[aliasNorm] = {
            phrase: aliasNorm,
            neutral: term.neutral || '',
            type: term.type,
            category: term.category,
            explanation: term.explanation
          };
          phraseEntries.push({
            phraseNorm: aliasNorm,
            termId: aliasNorm,
            length: aliasNorm.length
          });
        }
      }
    }
  }

  const buckets = {};
  for (const entry of phraseEntries) {
    (buckets[entry.phraseNorm[0]] ||= []).push(entry);
  }
  Object.values(buckets).forEach((entries) => entries.sort((a, b) => b.length - a.length));

  return {
    version: new Date().toISOString(),
    categories: Array.from(ALLOWED_CATEGORIES),
    termsById: termsByPhrase,
    buckets
  };
}

const SOURCE_FILES = ['manifest.json', 'content.css', 'content.js', 'popup.html', 'popup.js'];

function copySourceFiles(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const file of SOURCE_FILES) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function writeRuntimeIndex(destDir, index) {
  fs.writeFileSync(path.join(destDir, 'terms-index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
}

function writeEmbeddedIndex(destDir, index) {
  const contentJsPath = path.join(destDir, 'content.js');
  const contentJs = fs.readFileSync(contentJsPath, 'utf8');
  const embeddedIndex = `globalThis.CLEARFRAME_TERMS_INDEX = ${JSON.stringify(index)};\n`;
  fs.writeFileSync(contentJsPath, embeddedIndex + contentJs, 'utf8');
}

function buildTarget(srcDir, destDir, index, manifestFile) {
  fs.rmSync(destDir, { recursive: true, force: true });
  copySourceFiles(srcDir, destDir);
  writeRuntimeIndex(destDir, index);
  writeEmbeddedIndex(destDir, index);
  const manifest = readJson(path.join(srcDir, manifestFile));
  fs.writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function buildAll() {
  const index = loadTerms(DATA_DIR);

  buildTarget(SRC_DIR, DIST_DIR, index, 'manifest.json');
  buildTarget(SRC_DIR, DIST_FIREFOX_DIR, index, 'manifest.firefox.json');

  console.log(`Build OK: ${Object.keys(index.termsById).length} terms.`);
}

if (process.argv.includes('--check')) {
  const index = loadTerms(DATA_DIR);
  console.log(`Validation OK: ${Object.keys(index.termsById).length} terms loaded.`);
  process.exit(0);
}

buildAll();
