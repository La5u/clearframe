#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { buildMatcher, extractText, findMatches, loadTerms } from '../src/core/term-utils.js';
import { lowerAllCapsLongWords, matchReplacementCase } from '../src/core/display-utils.js';
import { normalizeSettings } from '../src/core/settings-utils.js';
import { EXPECTED_COUNTS } from './fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TERMS_DIR = path.join(ROOT, 'data', 'terms');
const index = loadTerms(TERMS_DIR);
const matcher = buildMatcher(index);

function countMatches(html) {
  const text = extractText(html);
  return findMatches(matcher, text, index.termsById, index.regexTerms).length;
}

for (const [file, expected] of Object.entries(EXPECTED_COUNTS)) {
  const filePath = path.join(__dirname, 'fixtures', file);
  const html = fs.readFileSync(filePath, 'utf8');
  const count = countMatches(html);
  assert.strictEqual(count, expected, `${file}: expected ${expected} matches, got ${count}`);
  console.log(`${file}: ${count} matches`);
}

assert.strictEqual(lowerAllCapsLongWords('EXCLUSIVE'), 'exclusive');
assert.strictEqual(lowerAllCapsLongWords('ITV BREAKING'), 'ITV breaking');
assert.strictEqual(lowerAllCapsLongWords('FIFA BREAKING'), 'FIFA breaking');
assert.strictEqual(lowerAllCapsLongWords("DON'T"), "don't");
assert.strictEqual(lowerAllCapsLongWords("IT'S NEW"), "it's new");
assert.strictEqual(matchReplacementCase('revealed', 'disclosed'), 'disclosed');
assert.strictEqual(matchReplacementCase('Revealed', 'disclosed'), 'Disclosed');
assert.strictEqual(matchReplacementCase('REVEALED', 'disclosed'), 'DISCLOSED');

assert.deepStrictEqual(
  normalizeSettings({ types: {} }).types,
  { absolute: false, moral: false, superlative: false }
);
assert.deepStrictEqual(
  normalizeSettings({ types: { loaded: false } }).types,
  { absolute: false, moral: false, superlative: false, loaded: false }
);
assert.deepStrictEqual(
  normalizeSettings({ userTypeColors: { hype: 'red' } }, { moral: 'blue' }).userTypeColors,
  { hype: 'red', moral: 'blue' }
);
