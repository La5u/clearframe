#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { buildMatcher, extractText, findMatches, loadTerms } = require('./term-utils');

const ROOT = __dirname;

function countMatches(html) {
  const index = loadTerms(path.join(ROOT, 'data', 'terms'));
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
