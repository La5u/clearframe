#!/usr/bin/env node
import { performance } from 'perf_hooks';
import { buildMatcher, findMatches } from '../src/core/matcher.js';

const count = Number(process.argv[2] || 10000);
const termsById = {};
for (let i = 0; i < count; i++) {
  const phrase = `clearframe phrase ${i}`;
  termsById[phrase] = { phrase, type: 'loaded' };
}
const startBuild = performance.now();
const matcher = buildMatcher({ termsById });
const built = performance.now();
const text = `${'ordinary page text '.repeat(5000)}clearframe phrase ${count - 1}`;
const matches = findMatches(matcher, text, termsById);
const done = performance.now();
console.log(JSON.stringify({ rules: count, characters: text.length, matches: matches.length, buildMs: +(built - startBuild).toFixed(2), matchMs: +(done - built).toFixed(2) }));
if (done - built > 100) throw new Error('Phrase matching exceeded the 100 ms development budget');
