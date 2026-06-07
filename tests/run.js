#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { buildMatcher, extractText, findMatches, loadTerms } from '../src/core/term-utils.js';
import { ALL_CAPS_TERM_ID, findAllCapsMatches } from '../src/core/all-caps.js';
import { getAllCapsAction, getContextualAllCapsAction, lowerAllCapsLongWords, matchReplacementCase } from '../src/core/display-utils.js';
import { COMMON_SHORT_WORDS } from '../src/core/commonShortWords.js';
import { chooseReplacementTerm, getReplacementSourceText, resolveMatchGroups } from '../src/core/match-plan.js';
import { normalizeSettings } from '../src/core/settings-utils.js';
import { EXPECTED_COUNTS } from './fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TERMS_DIR = path.join(ROOT, 'data', 'terms');
const index = loadTerms(TERMS_DIR);
const matcher = buildMatcher(index);
const colorConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'type-colors.json'), 'utf8'));

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
assert.strictEqual(getAllCapsAction('AM'), null);
assert.strictEqual(getAllCapsAction('I AM'), 'all-caps');
assert.strictEqual(lowerAllCapsLongWords('5 AM'), '5 AM');
assert.strictEqual(lowerAllCapsLongWords('I AM'), 'i am');
assert.strictEqual(getContextualAllCapsAction('abc I', 4, 5), null);
assert.strictEqual(getContextualAllCapsAction('abc A', 4, 5), 'all-caps');
assert.strictEqual(getContextualAllCapsAction('abc. I', 5, 6), null);
assert.strictEqual(getContextualAllCapsAction('I', 0, 1), null);
assert.deepStrictEqual(findAllCapsMatches('I DO NOT'), [
  { start: 2, end: 8, termId: ALL_CAPS_TERM_ID, virtual: true },
]);
assert.deepStrictEqual(findAllCapsMatches('abc A'), [
  { start: 4, end: 5, termId: ALL_CAPS_TERM_ID, virtual: true },
]);
assert.deepStrictEqual(findAllCapsMatches('With A Custom Assistant'), []);
assert.deepStrictEqual(findAllCapsMatches('NOT A REAL HAMSTER'), [
  { start: 0, end: 18, termId: ALL_CAPS_TERM_ID, virtual: true },
]);
assert.deepStrictEqual(findAllCapsMatches('abc I'), []);
assert.deepStrictEqual(findAllCapsMatches('5 AM'), []);
assert.deepStrictEqual(findAllCapsMatches('I AM'), [
  { start: 0, end: 4, termId: ALL_CAPS_TERM_ID, virtual: true },
]);
assert.ok(COMMON_SHORT_WORDS.size >= 100);
assert.ok([...COMMON_SHORT_WORDS].every(word => word.length === 2 || word.length === 3));
assert.ok([...COMMON_SHORT_WORDS].every(word => word === word.toUpperCase()));
assert.ok(!COMMON_SHORT_WORDS.has('A'));
assert.ok(!COMMON_SHORT_WORDS.has('ONLY'));
assert.strictEqual(lowerAllCapsLongWords('THE US AND YOU'), 'the us and you');
assert.strictEqual(matchReplacementCase('revealed', 'disclosed'), 'disclosed');
assert.strictEqual(matchReplacementCase('Revealed', 'disclosed'), 'Disclosed');
assert.strictEqual(matchReplacementCase('REVEALED', 'disclosed'), 'DISCLOSED');

const allCapsTestTerm = { phrase: 'caps emphasis', hasNeutral: true, remove: false };
const getAction = ({ remove, hasNeutral }, { removeTerms = false, replaceTerms = true } = {}) => {
  if (remove && removeTerms) {
    return 'removed';
  }
  return replaceTerms && hasNeutral ? 'replaced' : 'highlighted';
};
const groupedAllCapsOverlap = resolveMatchGroups([
  { start: 0, end: 7, termId: 'finally' },
  { start: 0, end: 7, termId: '__clearframe_all_caps__', virtual: true },
  { start: 0, end: 7, termId: 'third-type' },
]);
assert.deepStrictEqual(
  groupedAllCapsOverlap[0].termIds,
  ['finally', 'third-type', '__clearframe_all_caps__'],
);

const exclusiveTerm = chooseReplacementTerm(
  [index.termsById.exclusive, allCapsTestTerm],
  term => getAction(term, { removeTerms: true }),
  allCapsTestTerm.phrase,
);
assert.strictEqual(exclusiveTerm.phrase, 'exclusive');
assert.strictEqual(getAction(exclusiveTerm, { removeTerms: true }), 'removed');

const finallyTerm = chooseReplacementTerm(
  [index.termsById.finally, allCapsTestTerm],
  term => getAction(term, { removeTerms: false }),
  allCapsTestTerm.phrase,
);
const finallySource = getReplacementSourceText(
  finallyTerm,
  [index.termsById.finally, allCapsTestTerm],
  'FINALLY',
  allCapsTestTerm.phrase,
  lowerAllCapsLongWords,
);
assert.strictEqual(finallyTerm.phrase, 'finally');
assert.strictEqual(matchReplacementCase(finallySource, finallyTerm.neutral), 'now');

const neverTerm = chooseReplacementTerm(
  [index.termsById.never, allCapsTestTerm],
  term => getAction(term, { removeTerms: false }),
  allCapsTestTerm.phrase,
);
assert.strictEqual(neverTerm.phrase, allCapsTestTerm.phrase);
assert.strictEqual(lowerAllCapsLongWords('NEVER'), 'never');
assert.ok(colorConfig.colors.yellow.types.includes('all-caps'));

const disabledTypes = new Set(['clickbait', 'reveal']);
const filteredMatcher = buildMatcher(index, term => !disabledTypes.has(term.type));
const filteredText = 'The secret was revealed in a reveal.';
assert.deepStrictEqual(
  findMatches(filteredMatcher, filteredText, index.termsById, index.regexTerms, false, term => !disabledTypes.has(term.type)),
  [],
  'disabled types must exclude regex-backed terms',
);

assert.deepStrictEqual(
  normalizeSettings({ types: {} }).types,
  { absolute: false, exaggeration: false, superlative: false },
);
assert.deepStrictEqual(
  normalizeSettings({ types: { loaded: false } }).types,
  { absolute: false, exaggeration: false, superlative: false, loaded: false },
);
assert.deepStrictEqual(
  normalizeSettings({ userTypeColors: { hype: 'red' } }, { moral: 'blue' }).userTypeColors,
  { hype: 'red', moral: 'blue' },
);
