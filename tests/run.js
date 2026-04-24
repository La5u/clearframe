#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { buildMatcher, extractText, findMatches, loadTerms } = require('../term-utils');
const { lowerAllCapsLongWords } = require('../display-utils');
const { EXPECTED_COUNTS } = require('./fixtures');

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

assert.strictEqual(lowerAllCapsLongWords('THIS IS IMPORTANT'), 'this is important');
assert.strictEqual(lowerAllCapsLongWords('USA AND NATO'), 'USA and NATO');
assert.strictEqual(lowerAllCapsLongWords('AD FEATURE'), 'ad feature');
assert.strictEqual(lowerAllCapsLongWords('NOW SEE'), 'now see');
assert.strictEqual(lowerAllCapsLongWords('ALSO MIXED Case EXTRAORDINARY'), 'also mixed Case extraordinary');
assert.strictEqual(lowerAllCapsLongWords('EXCLUSIVE'), 'exclusive');
