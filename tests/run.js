#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { adverbWord, buildMatcher, extractText, findMatches, loadTerms } from '../src/core/term-utils.js';
import { ALL_CAPS_TERM_ID, findAllCapsMatches } from '../src/core/all-caps.js';
import { getAllCapsAction, getContextualAllCapsAction, lowerAllCapsLongWords, matchReplacementCase } from '../src/core/display-utils.js';
import { COMMON_SHORT_WORDS } from '../src/core/commonShortWords.js';
import { chooseReplacementTerm, getReplacementSourceText, resolveMatchGroups } from '../src/core/match-plan.js';
import { normalizeSettings } from '../src/core/settings-utils.js';
import { EXPECTED_COUNTS } from './fixtures.js';
import { assertSourcesAllowed, loadSourceRegistry } from '../tools/source-policy.js';
import { loadRuleRecords } from '../tools/rule-utils.js';
import { approvedRuleTerms } from '../tools/rule-utils.js';
import { classifyPageContext, findContextualMatches } from '../src/core/contextual.js';
import { shouldKeepLexicalMatch } from '../src/core/context-filter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TERMS_DIR = path.join(ROOT, 'data', 'terms');
const index = loadTerms(TERMS_DIR, approvedRuleTerms(ROOT));
const matcher = buildMatcher(index);
const colorConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'type-colors.json'), 'utf8'));
const sourceRegistry = loadSourceRegistry(ROOT);
assert.throws(() => assertSourcesAllowed(['babe'], sourceRegistry, 'rule-mining'), /Evaluation-only source/);
assert.doesNotThrow(() => assertSourcesAllowed(['babe'], sourceRegistry, 'evaluation'));
assert.doesNotThrow(() => loadRuleRecords(ROOT));

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
assert.deepStrictEqual(resolveMatchGroups([
  { start: 0, end: 8, termId: 'breaking' },
  { start: 0, end: 13, termId: ALL_CAPS_TERM_ID, virtual: true },
]), [{
  start: 0, end: 13, termId: 'breaking', termIds: ['breaking', ALL_CAPS_TERM_ID], virtual: false, structural: true,
}], 'a lexical match must not hide a wider all-caps detection');
assert.deepStrictEqual(findAllCapsMatches('abc A'), [
  { start: 4, end: 5, termId: ALL_CAPS_TERM_ID, virtual: true },
]);
assert.deepStrictEqual(findAllCapsMatches('at least an A and boys'), []);
assert.deepStrictEqual(findAllCapsMatches('best-ever A-level results'), []);
assert.deepStrictEqual(findAllCapsMatches('earned grade A'), []);
assert.deepStrictEqual(findAllCapsMatches('With A Custom Assistant'), []);
assert.deepStrictEqual(findAllCapsMatches('NOT A REAL HAMSTER'), [
  { start: 0, end: 18, termId: ALL_CAPS_TERM_ID, virtual: true },
]);
assert.deepStrictEqual(findAllCapsMatches('abc I'), []);
assert.ok(findContextualMatches('From forgotten room to luxury retreat', { headline: true }).some(match => match.termId === '__clearframe_transformation__'));
assert.ok(!findContextualMatches('Switching from Claude Code to Codex', { headline: true, pageContext: 'discussion' }).some(match => match.termId === '__clearframe_transformation__'));
assert.ok(findContextualMatches('One of the most dramatic moments in history', { headline: true }).some(match => match.termId === '__clearframe_history_claim__'));
assert.ok(findContextualMatches('Fans gasp as the result is revealed', { headline: true }).some(match => match.termId === '__clearframe_reaction_claim__'));
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
assert.strictEqual(adverbWord('drastic'), 'drastically');
assert.strictEqual(adverbWord('terrible'), 'terribly');
assert.ok(findMatches(matcher, 'secretly exclusively', index.termsById, index.regexTerms).some(match => match.termId === 'secretly'));
assert.ok(findMatches(matcher, 'secretly exclusively', index.termsById, index.regexTerms).some(match => match.termId === 'exclusively'));
for (const sample of [
  'but at what cost?', 'tragic', 'the surprising mistakes you are making', 'anyone can do it',
  'apocalypse', 'turns heads', 'turned sour', 'dodgy', 'startling revelations', 'sparks rows',
  'stealth tax trap', 'urgent warning', 'drastically', 'fuming', 'panicked', 'fires back',
  'feel the pinch', 'olive branch', 'lifted the lid on', 'set the record straight',
]) {
  assert.ok(findMatches(matcher, sample, index.termsById, index.regexTerms).length, `Daily Mail gap must match: ${sample}`);
}
assert.ok(findContextualMatches('The mistakes you are making', { headline: true }).some(match => match.termId === '__clearframe_direct_address__'));
assert.deepStrictEqual(findContextualMatches('You can change this setting', { headline: true }), [], 'bare conversational you is not clickbait');
assert.deepStrictEqual(findContextualMatches('What you need to know', { headline: true, conversational: true }), [], 'comment context suppresses direct address');
assert.ok(findContextualMatches("You won't believe this", { headline: true }).some(match => match.termId === '__clearframe_direct_address__'));
assert.ok(findContextualMatches("The 'miracle' cure", { headline: true }).some(match => match.termId === '__clearframe_quoted_wording__'));
for (const sample of ["don't do anything", "don't panic if it isn't ready", "James' plan", "students' work", "rock ’n’ roll", "the '90s", "a 6\" screen and 8\" tablet"]) {
  assert.ok(!findContextualMatches(sample, { headline: true }).some(match => match.termId === '__clearframe_quoted_wording__'), `apostrophe sanity check failed: ${sample}`);
}
assert.ok(findContextualMatches("'don't' is the disputed wording", { headline: true }).some(match => match.termId === '__clearframe_quoted_wording__'));
assert.ok(findContextualMatches('The “so-called expert” responds', { headline: true }).some(match => match.termId === '__clearframe_quoted_wording__'));
assert.ok(!findContextualMatches('“We will leave,” the minister said', { headline: true }).some(match => match.termId === '__clearframe_quoted_wording__'), 'ordinary attributed quotation is not a scare quote');

const contextMatrix = JSON.parse(fs.readFileSync(path.join(__dirname, 'context-matrix.json'), 'utf8'));
for (const row of contextMatrix) {
  const context = { headline: row.headline, pageContext: row.pageContext || 'publication' };
  const matches = findMatches(matcher, row.text, index.termsById, index.regexTerms, false, () => true,
    (termId, start, end) => shouldKeepLexicalMatch(index.termsById[termId], row.text.slice(start, end), row.text, context));
  assert.strictEqual(matches.some(match => index.termsById[match.termId]?.phrase === row.term), row.match,
    `context matrix failed for ${row.term}: ${row.text}`);
}
assert.ok(findContextualMatches('Even experts can make this mistake', { headline: true, pageContext: 'publication' }).some(match => match.termId === '__clearframe_even_framing__'));
assert.ok(!findContextualMatches('Even experts can make this mistake', { headline: true, pageContext: 'discussion' }).some(match => match.termId === '__clearframe_even_framing__'));
assert.ok(findContextualMatches('Questions were raised after records were deleted', { pageContext: 'publication' }).filter(match => match.termId === '__clearframe_passive_agency__').length === 2);
assert.ok(!findContextualMatches('Mistakes were made', { pageContext: 'discussion', conversational: true }).some(match => match.termId === '__clearframe_passive_agency__'));
assert.strictEqual(findContextualMatches('The “\'real\' story”', { headline: true }).filter(match => match.termId === '__clearframe_quoted_wording__').length, 1, 'nested quotes produce one outer detection');
assert.ok(!findContextualMatches('The “5” rating', { headline: true }).some(match => match.termId === '__clearframe_quoted_wording__'), 'numeric labels are not distancing');
assert.ok(!findContextualMatches('Is this normal?', { headline: true, pageContext: 'discussion' }).some(match => match.termId === '__clearframe_headline_question__'), 'Reddit-style questions are not automatically rhetorical');
assert.ok(!findContextualMatches('The “miracle” cure', { headline: true, pageContext: 'video' }).some(match => match.termId === '__clearframe_quoted_wording__'), 'video-title quotes are not automatically distancing');
assert.strictEqual(classifyPageContext('www.reddit.com'), 'discussion');
assert.strictEqual(classifyPageContext('youtube.com'), 'video');
assert.strictEqual(classifyPageContext('dailymail.com'), 'publication');
assert.strictEqual(shouldKeepLexicalMatch({ phrase: 'breaking' }, 'breaking', 'The bridge is breaking apart', { headline: false }), false);
assert.strictEqual(shouldKeepLexicalMatch({ phrase: 'breaking' }, 'BREAKING', 'BREAKING NEWS: vote delayed', { headline: true }), true);
assert.strictEqual(shouldKeepLexicalMatch({ phrase: 'elite' }, 'Elite', 'Xbox Elite 3 controller leaks', { headline: true }), false);
assert.strictEqual(shouldKeepLexicalMatch({ phrase: 'elite' }, 'elite', 'A corrupt elite captured the state', { headline: true }), true);
assert.ok(findContextualMatches('A bargain, but at what cost?', { headline: true }).some(match => match.termId === '__clearframe_headline_question__'));
assert.deepStrictEqual(findContextualMatches('You said that the plan worked.', { headline: false }), []);
assert.strictEqual(
  findMatches(matcher, "She was 'terrified'.", index.termsById, index.regexTerms)[0]?.termId,
  'terrified',
  'quoted inflections must use the phrase matcher without per-rule regex scans',
);

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
assert.strictEqual(normalizeSettings().monochrome, false);
assert.strictEqual(normalizeSettings({ monochrome: true }).monochrome, true);
assert.strictEqual(normalizeSettings().feedbackEnabled, false);
assert.strictEqual(normalizeSettings({ feedbackEnabled: true }).feedbackEnabled, true);
assert.deepStrictEqual(
  normalizeSettings({ enabled: true, siteEnabled: { 'https://example.com': true } }),
  normalizeSettings(),
  'legacy site activation must be discarded',
);
assert.deepStrictEqual(
  normalizeSettings(null, null),
  normalizeSettings(),
  'null settings must fall back to defaults',
);
assert.deepStrictEqual(
  normalizeSettings({ types: 'invalid', siteEnabled: 42, userTypeColors: false }),
  normalizeSettings(),
  'malformed nested settings must fall back to defaults',
);

const invalidTermsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clearframe-terms-'));
try {
  fs.writeFileSync(
    path.join(invalidTermsDir, 'invalid.csv'),
    'phrase,type,neutral,aliases,stemmable,regex,remove\nbad,hype,,,,(,\n',
  );
  assert.throws(
    () => loadTerms(invalidTermsDir),
    /Invalid regex for term "bad"/,
    'invalid term regexes must fail during build-time loading',
  );
} finally {
  fs.rmSync(invalidTermsDir, { recursive: true, force: true });
}

const invalidContextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clearframe-context-'));
try {
  fs.writeFileSync(path.join(invalidContextDir, 'invalid.csv'), 'phrase,type,contexts\nwrong,hype,unknown-place\n');
  assert.throws(() => loadTerms(invalidContextDir), /Unsupported context "unknown-place"/);
} finally {
  fs.rmSync(invalidContextDir, { recursive: true, force: true });
}
