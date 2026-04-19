#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { buildMatcher, extractText, findMatches, loadTerms } = require('./term-utils');

const ROOT = __dirname;
const EXPECTED_COUNTS = {
  'newssite.html': 373,
  'newssite2.html': 71,
  'newssite3.html': 288,
  'newssite10th.html': 349,
  'newssite10thnypost.html': 74,
  'test-all-types.html': 147,
  'test-all-terms.html': 146
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
