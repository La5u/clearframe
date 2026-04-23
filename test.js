#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { buildMatcher, extractText, findMatches, loadTerms } = require('./term-utils');
const { lowerAllCapsLongWords, normalizeRenderedText } = require('./display-utils');

const ROOT = __dirname;
const EXPECTED_COUNTS = {
  'newssite.html': 397,
  'newssite2.html': 77,
  'newssite3.html': 312,
  'newssite10th.html': 368,
  'newssite10thnypost.html': 75,
  'test-all-types.html': 169,
  'test-all-terms.html': 135
};

function countMatches(html) {
  const index = loadTerms(path.join(ROOT, 'data', 'terms'));
  const matcher = buildMatcher(index);
  const text = extractText(html);
  return findMatches(matcher, text, index.termsById, index.regexTerms).length;
}

for (const [file, expected] of Object.entries(EXPECTED_COUNTS)) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const count = countMatches(html);
  assert.strictEqual(count, expected, `${file}: expected ${expected} matches, got ${count}`);
  console.log(`${file}: ${count} matches`);
}

assert.strictEqual(lowerAllCapsLongWords('THIS IS IMPORTANT'), 'THIS IS important');
assert.strictEqual(lowerAllCapsLongWords('USA AND NATO'), 'USA AND NATO');
assert.strictEqual(lowerAllCapsLongWords('ALSO MIXED Case EXTRAORDINARY'), 'ALSO MIXED Case extraordinary');
assert.strictEqual(normalizeRenderedText('THIS IS IMPORTANT', false), 'THIS IS IMPORTANT');
assert.strictEqual(normalizeRenderedText('THIS IS IMPORTANT', true), 'THIS IS important');
