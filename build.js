#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data', 'terms');

const COLOR_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'type-colors.json'), 'utf8'));

const TYPES = {};
for (const [color, config] of Object.entries(COLOR_CONFIG.colors)) {
  for (const type of config.types) {
    TYPES[type] = color;
  }
}

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
      terms[phrase] = { phrase, type: term.type, neutral: term.neutral || '', explanation: term.explanation || '' };
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

function build() {
  const index = loadTerms();
  const count = Object.keys(index.termsById).length;

  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const files = ['manifest.json', 'manifest.firefox.json', 'background.js', 'popup.html', 'popup.js', 'content.css'];
  files.forEach(f => fs.copyFileSync(path.join(ROOT, f), path.join(ROOT, 'dist', f)));
  fs.copyFileSync(path.join(ROOT, 'icon.png'), path.join(ROOT, 'dist', 'icon.png'));

  const code = `globalThis.ClearFrame = { index: ${JSON.stringify(index)}, types: ${JSON.stringify(TYPES)}, colorConfig: ${JSON.stringify(COLOR_CONFIG)} };`;
  const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'dist', 'content.js'), code + content);

  const popupCode = `globalThis.ClearFrame = { types: ${JSON.stringify(TYPES)}, colorConfig: ${JSON.stringify(COLOR_CONFIG)} };`;
  const popup = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'dist', 'popup.js'), popupCode + popup);

  fs.mkdirSync(path.join(ROOT, 'dist-firefox'), { recursive: true });
  const ffFiles = ['manifest.firefox.json', 'background.js', 'popup.html', 'popup.js', 'content.css'];
  ffFiles.forEach(f => fs.copyFileSync(path.join(ROOT, f), path.join(ROOT, 'dist-firefox', f === 'manifest.firefox.json' ? 'manifest.json' : f)));
  fs.copyFileSync(path.join(ROOT, 'icon.png'), path.join(ROOT, 'dist-firefox', 'icon.png'));
  fs.writeFileSync(path.join(ROOT, 'dist-firefox', 'content.js'), code + content);
  fs.writeFileSync(path.join(ROOT, 'dist-firefox', 'popup.js'), popupCode + popup);

  console.log(`Built: ${count} terms`);
}

build();
