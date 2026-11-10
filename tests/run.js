#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { extractText, loadExceptions, loadTerms } from '../src/core/term-utils.js';
import { buildMatcher, findMatches } from '../src/core/matcher.js';
import { adverbWord, inflectPhrase } from '../src/core/stemmer.js';
import { ALL_CAPS_TERM_ID, findAllCapsMatches } from '../src/core/all-caps.js';
import { getAllCapsAction, getContextualAllCapsAction, lowerAllCapsLongWords, matchReplacementCase } from '../src/core/display-utils.js';
import { COMMON_SHORT_WORDS } from '../src/core/commonShortWords.js';
import { chooseAction, chooseReplacementTerm, getReplacementSourceText, resolveMatchGroups } from '../src/core/match-plan.js';
import { normalizeSettings } from '../src/core/settings-utils.js';
import { EXPECTED_COUNTS } from './fixtures.js';
import { assertSourcesAllowed, loadSourceRegistry } from '../tools/source-policy.js';
import { loadRuleRecords } from '../tools/rule-utils.js';
import { approvedRuleTerms } from '../tools/rule-utils.js';
import { classifyPageContext, findContextualMatches } from '../src/core/contextual.js';
import { createLexicalFilter } from '../src/core/context-filter.js';
import { recoverOriginalText } from '../src/core/restore.js';
import { createAnalyzer } from '../src/core/analyze.js';
import { assertSourcesShippable } from '../tools/source-policy.js';
import { candidateConfidence, uniqueRecordIds } from '../tools/rule-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TERMS_DIR = path.join(ROOT, 'data', 'terms');
const index = loadTerms(TERMS_DIR, approvedRuleTerms(ROOT));
const matcher = buildMatcher(index);
const shouldKeepLexicalMatch = createLexicalFilter(index.exceptions);
assert.ok(findMatches(matcher, 'The shocking warning was finally revealed.', index.termsById, index.regexTerms).length >= 3);
for (const text of ['That is a proverb.', 'The minor signed the form.', 'He swung an axe at the door.', 'Boil the hot water.', 'Netflix licensed it exclusively.']) {
  assert.deepStrictEqual(findMatches(matcher, text, index.termsById, index.regexTerms), [], `no match expected in: ${text}`);
}
assert.ok(findMatches(matcher, 'A minor glitch delayed launch.', index.termsById, index.regexTerms).length === 1);
assert.ok(findMatches(matcher, 'Meta axes 8,000 jobs.', index.termsById, index.regexTerms).length === 1);
const colorConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'type-colors.json'), 'utf8'));
const sourceRegistry = loadSourceRegistry(ROOT);
assert.throws(() => assertSourcesAllowed(['babe'], sourceRegistry, 'rule-mining'), /Evaluation-only source/);
assert.doesNotThrow(() => assertSourcesAllowed(['babe'], sourceRegistry, 'evaluation'));
assert.doesNotThrow(() => loadRuleRecords(ROOT));
assert.throws(() => assertSourcesShippable(['semeval-propaganda-2020'], sourceRegistry, 'probe'), /not cleared for redistribution/);
assert.doesNotThrow(() => assertSourcesShippable(['clearframe-manual', 'magpie-idioms'], sourceRegistry, 'probe'));
assert.ok(!approvedRuleTerms(ROOT).some(term => term.provenance.includes('semeval-propaganda-2020')), 'SemEval rules never ship');

// Page edits outside rewritten spans keep the original; edits inside them cannot be recovered.
const rewrittenNode = { originalText: 'Boil hot water.', displayedText: 'Boil trouble.', records: [{ startOffset: 5, endOffset: 12, sourceText: 'hot water', replacementText: 'trouble' }] };
assert.strictEqual(recoverOriginalText(rewrittenNode, 'Boil trouble.'), 'Boil hot water.');
assert.strictEqual(recoverOriginalText(rewrittenNode, 'Boil trouble. It is ready.'), 'Boil hot water. It is ready.');
assert.strictEqual(recoverOriginalText(rewrittenNode, 'Now: Boil trouble.'), 'Now: Boil hot water.');
assert.strictEqual(recoverOriginalText(rewrittenNode, 'Boil big trouble.'), null);
const removedNode = { originalText: 'A shocking twist ends.', displayedText: 'A  twist ends.', records: [{ startOffset: 2, endOffset: 2, sourceText: 'shocking', replacementText: '' }] };
assert.strictEqual(recoverOriginalText(removedNode, 'A  twist ends. Update.'), 'A shocking twist ends. Update.');

// The content script's per-text analysis: display text plus one entry per
// detection as "source>replacement action highlightName". Mode is highlight,
// reword (replaceTerms) or remove (removeTerms).
const { analyze } = createAnalyzer({ index });
const ANALYZE_SETTINGS = { highlight: normalizeSettings({}), reword: normalizeSettings({ replaceTerms: true }), remove: normalizeSettings({ removeTerms: true }) };
const PUBLICATION = { pageContext: 'publication' };
// Long nodes must stay within the scanner's responsiveness budget (best of three).
const performanceSettings = normalizeSettings({ sensitivity: 'all' });
for (const [phrase, repeats, expected] of /** @type {Array<[string, number, number]>} */ ([
  ['We must go. ', 1700, 1700], ['a, ', 7000, 0], ['no jobs, no homes and no hope. ', 650, 650],
])) {
  const text = phrase.repeat(repeats);
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    const plan = analyze(text, PUBLICATION, performanceSettings);
    best = Math.min(best, performance.now() - start);
    assert.strictEqual(plan.displayText, text);
    assert.strictEqual(plan.entries.length, expected, `long text detections: ${phrase}`);
  }
  assert.ok(best <= 60, `linear analysis: ${JSON.stringify(phrase)} × ${repeats} took ${best.toFixed(1)} ms (budget 60 ms)`);
  console.log(`linear analysis ${JSON.stringify(phrase)} × ${repeats}: ${best.toFixed(1)} ms`);
}

// Open-quote state preserves the old prefix regexes, including apostrophes and odd whitespace.
const speechPatterns = [/“[^”]*$/u, /‘[^’]*$/u, /(?:^|[\s(])'[^']*$/u, /^(?:[^"]*"[^"]*")*[^"]*"[^"]*$/u];
for (const text of [
  'We must go. “We must go.” We must go.',
  `He said 'we can't go' and "we must go".`,
  `‘We’re ready,’ she said. (‘We must go.’)`,
  `“outer “inner” after” 'one' 'two' "one" "two`,
  `We\n\t 'must' go.\u00a0\u00a0"We must go".`,
]) {
  for (const start of [...text].map((_, i) => i).reverse()) {
    const before = text.slice(0, start).replace(/\s+/g, ' ');
    assert.strictEqual(shouldKeepLexicalMatch(index.termsById.we, text[start], text, PUBLICATION, start),
      !speechPatterns.some(pattern => pattern.test(before)), `quote state at ${start}: ${text}`);
  }
}

for (const [precision, judged, confidence] of /** @type {Array<[number, number, string]>} */ ([
  [1, 1, 'contextual'], [1, 5, 'contextual'], [0.75, 6, 'medium'],
  [1, 7, 'medium'], [0.9, 8, 'high'], [0.75, 8, 'medium'], [0.5, 8, 'reject'],
])) assert.strictEqual(candidateConfidence(precision, judged), confidence, `mining confidence: ${precision} on ${judged} judgments`);
assert.strictEqual(candidateConfidence(0.6, 12, 4, 0.75), 'contextual', 'headline evidence can rescue contextual candidates');
const collisionRecords = ['llm-shake-up', 'llm-shake-up', 'llm-shake-up-2', 'llm-shake-up'].map(id => ({ id }));
uniqueRecordIds(collisionRecords, ['llm-shake-up']);
assert.deepStrictEqual(collisionRecords.map(record => record.id), ['llm-shake-up-3', 'llm-shake-up-4', 'llm-shake-up-2', 'llm-shake-up-5'], 'mining IDs avoid reserved IDs and natural suffix collisions');
/** @type {Array<[string, string, object, string, string[]]>} */
const ANALYZE_CASES = [
  ['The committee met on Tuesday.', 'reword', PUBLICATION, 'The committee met on Tuesday.', []],
  ['Meta axes 8,000 jobs.', 'highlight', PUBLICATION, 'Meta axes 8,000 jobs.', ['axes>axes highlighted clearframe-dysphemism']],
  ['Meta axes 8,000 jobs.', 'reword', PUBLICATION, 'Meta cuts 8,000 jobs.', ['axes>cuts replaced clearframe-dysphemism-underline']],
  ['EXCLUSIVE: Chilling details emerge.', 'remove', PUBLICATION, 'Details emerge.', ['EXCLUSIVE: > removed null', 'Chilling d>D removed null']],
  ['A SHOCKING twist.', 'reword', PUBLICATION, 'A shocking twist.', ['SHOCKING>shocking replaced clearframe-all-caps-underline']],
  ['A SHOCKING twist.', 'highlight', { ...PUBLICATION, capsLabel: true }, 'A SHOCKING twist.', []],
  // Same span: the lexical term decides, on caps-normalized wording.
  ['The report was CHILLING.', 'reword', PUBLICATION, 'The report was chilling.', ['CHILLING>chilling replaced clearframe-fear']],
  ['The report was CHILLING.', 'remove', PUBLICATION, 'The report was.', [' CHILLING> removed null']],
  // A caps run wider than the lexical term is only caps-normalized, never removed.
  ['This is CHILLING NEWS for everyone.', 'remove', PUBLICATION, 'This is CHILLING NEWS for everyone.', ['CHILLING NEWS>CHILLING NEWS highlighted clearframe-fear']],
  ['This is CHILLING NEWS for everyone.', 'reword', PUBLICATION, 'This is chilling news for everyone.', ['CHILLING NEWS>chilling news replaced clearframe-fear']],
  ['Is this the end of DEVASTATING cuts?', 'reword', { ...PUBLICATION, headline: true }, 'Is this the end of devastating cuts?', ['Is this the end of DEVASTATING cuts?>Is this the end of devastating cuts? replaced clearframe-clickbait']],
  ['Is this the end of DEVASTATING cuts?', 'reword', { ...PUBLICATION, headline: true, preserveText: true }, 'Is this the end of DEVASTATING cuts?', ['Is this the end of DEVASTATING cuts?>Is this the end of DEVASTATING cuts? highlighted clearframe-clickbait']],
  // Replacements take the matched form: irregular, participle, already plural.
  ['Meta axed 8,000 jobs.', 'reword', PUBLICATION, 'Meta cut 8,000 jobs.', ['axed>cut replaced clearframe-dysphemism-underline']],
  ['War erupted. It has erupted.', 'reword', { ...PUBLICATION, headline: true }, 'War began. It has begun.', ['erupted>began replaced clearframe-conflict-underline', 'erupted>begun replaced clearframe-conflict-underline']],
  ['Hordes of fans met a horde of tourists.', 'reword', PUBLICATION, 'Large groups of fans met a large group of tourists.', ['Hordes>Large groups replaced clearframe-derogatory-underline', 'horde>large group replaced clearframe-derogatory-underline']],
  // Bylines keep their capitals; shouting is lowercased, headings get Title Case.
  ["It's ugly: MAUREEN CALLAHAN", 'reword', PUBLICATION, "It's ugly: MAUREEN CALLAHAN", []],
  ['But as HAVIV RETTIG GUR writes, the war is NOT over.', 'reword', PUBLICATION, 'But as HAVIV RETTIG GUR writes, the war is not over.', ['NOT>not replaced clearframe-all-caps-underline']],
  ['THIS IS BIG NEWS FOR EVERYONE', 'reword', PUBLICATION, 'This is big news for everyone', ['THIS IS BIG NEWS FOR EVERYONE>This is big news for everyone replaced clearframe-all-caps-underline']],
  ['WAR IN THE MIDDLE EAST', 'reword', PUBLICATION, 'War in the Middle East', ['WAR IN THE MIDDLE EAST>War in the Middle East replaced clearframe-all-caps-underline']],
  // A capitalised term inside a name or title is only highlighted.
  ['Compared to 2003’s Shock and Awe invasion', 'remove', { ...PUBLICATION, headline: true }, 'Compared to 2003’s Shock and Awe invasion', ['Shock>Shock highlighted clearframe-clickbait']],
];
for (const [text, mode, context, displayText, entries] of ANALYZE_CASES) {
  const plan = analyze(text, context, ANALYZE_SETTINGS[mode]);
  assert.strictEqual(plan.displayText, displayText, `${mode}: ${text}`);
  assert.deepStrictEqual(plan.entries.map(entry => `${entry.sourceText}>${entry.replacementText} ${entry.action} ${entry.highlightName}`), entries, `${mode}: ${text}`);
  for (const entry of plan.entries) assert.strictEqual(plan.displayText.slice(entry.start, entry.end), entry.replacementText, `${mode}: ${text} offsets`);
}
assert.deepStrictEqual(analyze('Meta axes 8,000 jobs.', PUBLICATION, normalizeSettings({ replaceTerms: true, types: { dysphemism: false } })).entries, [], 'disabled types are not detected');
// Sensitivity keeps high, high+medium, or everything; headlinesOnly skips body text.
/** @type {Array<[string, object, Record<string, string[]>]>} */
const SENSITIVITY_CASES = [
  ['The alleged shocking scandal.', {}, { strong: ['scandal'], standard: ['alleged', 'scandal'], all: ['alleged', 'scandal'] }],
  ['Even critics could call the alleged scandal fair', { headline: true }, { strong: ['scandal', 'fair'], standard: ['alleged', 'scandal', 'fair'], all: ['Even critics could', 'alleged', 'scandal', 'fair'] }],
  ['From shabby room to luxury retreat', { headline: true }, { strong: [], standard: [], all: ['From shabby room to luxury retreat'] }],
];
for (const [text, context, expected] of SENSITIVITY_CASES) {
  for (const [sensitivity, wordings] of Object.entries(expected)) {
    assert.deepStrictEqual(analyze(text, { ...PUBLICATION, ...context }, normalizeSettings({ sensitivity })).entries.map(entry => entry.wording), wordings, `${sensitivity}: ${text}`);
  }
}
assert.deepStrictEqual(analyze('The alleged scandal.', PUBLICATION, normalizeSettings({ headlinesOnly: true })), { displayText: 'The alleged scandal.', entries: [] }, 'headlinesOnly skips body text');
assert.strictEqual(analyze('The alleged scandal.', { ...PUBLICATION, headline: true }, normalizeSettings({ headlinesOnly: true })).entries.length, 2, 'headlinesOnly keeps headlines');
// Remove mode tidies the text around a removal; swapping each entry's
// replacementText back for its sourceText restores the exact original.
for (const [text, displayText] of [
  ['EXCLUSIVE - Ewan speaks out', 'Ewan speaks out'],
  ['The heartbreaking consequences of it', 'The consequences of it'],
  ["Twins' 'heartbreaking' diagnosis", "Twins' diagnosis"],
  ['She was a shocking sight. Chilling moment fans clash with police', 'She was a sight. Moment fans clash with police'],
  ['Fans left in shock, then fury', 'Fans left in, then fury'],
]) {
  const plan = analyze(text, { ...PUBLICATION, headline: true }, ANALYZE_SETTINGS.remove);
  assert.strictEqual(plan.displayText, displayText, `remove: ${text}`);
  const rebuilt = plan.entries.reduceRight((value, entry) => value.slice(0, entry.start) + entry.sourceText + value.slice(entry.end), plan.displayText);
  assert.strictEqual(rebuilt, text, `remove restores: ${text}`);
  const records = plan.entries.map(entry => ({ ...entry, startOffset: entry.start, endOffset: entry.end }));
  const node = { originalText: text, displayedText: plan.displayText, records };
  assert.strictEqual(recoverOriginalText(node, plan.displayText), text);
  assert.strictEqual(recoverOriginalText(node, `${plan.displayText} Update.`), `${text} Update.`);
  for (const entry of plan.entries) assert.strictEqual(plan.displayText.slice(entry.start, entry.end), entry.replacementText, `remove offsets: ${text}`);
  assert.ok(plan.entries.every(entry => entry.sourceText.includes(entry.wording)), `wording inside the removed span: ${text}`);
}
// Phrases match across any whitespace run (newline, tab, nbsp, repeated or blank-line gaps);
// offsets stay on the original text and never start or end on whitespace.
for (const [text, wording] of [
  ['It came out of\nthe blue.', 'out of\nthe blue'], ['He came under\tfire again.', 'under\tfire'], ['Critics hit  back at him.', 'hit  back'],
  ['It was a\u00a0 passed\u00a0away\r\n', 'passed\u00a0away'],
  ['a\n\nout of\n\nthe blue', 'out of\n\nthe blue'], ['  out of the blue', 'out of the blue'], ['out of the blue\n', 'out of the blue'],
]) {
  const found = findMatches(matcher, text, index.termsById, index.regexTerms).map(match => text.slice(match.start, match.end));
  assert.ok(found.includes(wording), `matches ${JSON.stringify(wording)} in ${JSON.stringify(text)}, got ${JSON.stringify(found)}`);
  assert.ok(found.every(match => match === match.trim()), `no match on whitespace edges in ${JSON.stringify(text)}`);
}
assert.deepStrictEqual(findMatches(matcher, 'out of\nthe bluebird', index.termsById, index.regexTerms), [], 'word boundary still applies after whitespace');
assert.strictEqual(findContextualMatches('One of the most\ndramatic moments in\nhistory', { headline: true }).length, 1, 'contextual patterns cross source whitespace');
// Headline rules see the same wording (these are low-confidence cues, so every sensitivity level is needed).
for (const [text, wording] of [['Why you\nneed\nto care', 'need\nto'], ['Third\ntime lucky', 'Third\ntime lucky']]) {
  assert.ok(analyze(text, { ...PUBLICATION, headline: true }, normalizeSettings({ sensitivity: 'all' })).entries.some(entry => entry.sourceText === wording), `headline ${JSON.stringify(text)}`);
}
for (const [text, mode, displayText, source] of [
  ['It was a collateral\ndamage case.', 'reword', 'It was a civilian harm case.', 'collateral\ndamage'],
  ['COLLATERAL  DAMAGE rose.', 'reword', 'Civilian harm rose.', 'COLLATERAL  DAMAGE'],
  ['He passed\u00a0 away today.', 'reword', 'He died today.', 'passed\u00a0 away'],
  ['A breath\ttaking view', 'remove', 'A view', 'breath\ttaking '],
]) {
  const plan = analyze(text, PUBLICATION, mode === 'remove' ? normalizeSettings({ removeTerms: true, types: { exaggeration: true } }) : ANALYZE_SETTINGS[mode]);
  assert.strictEqual(plan.displayText, displayText, `${mode}: ${JSON.stringify(text)}`);
  assert.deepStrictEqual(plan.entries.map(entry => entry.sourceText), [source], `${mode} source: ${JSON.stringify(text)}`);
  assert.strictEqual(plan.entries.reduceRight((value, entry) => value.slice(0, entry.start) + entry.sourceText + value.slice(entry.end), plan.displayText), text, `${mode} restores: ${JSON.stringify(text)}`);
}
// [phrase, stem type, form, expected]
for (const [phrase, stemType, form, expected] of [
  ['cut', 'verb', 'past', 'cut'], ['hit', 'verb', 'ing', 'hitting'], ['quit', 'verb', 'ing', 'quitting'], ['spread', 'verb', 'third', 'spreads'],
  ['begin', 'verb', 'past', 'began'], ['begin', 'verb', 'participle', 'begun'], ['begin', 'verb', 'ing', 'beginning'], ['admit', 'verb', 'past', 'admitted'],
  ['agree', 'verb', 'ing', 'agreeing'], ['bury', 'verb', 'past', 'buried'], ['dodge', 'verb', 'ing', 'dodging'], ['go', 'verb', 'third', 'goes'],
  ['push out', 'verb', 'past', 'pushed out'], ['angrily confront', 'verb', 'third', 'angrily confronts'],
  ['criticizes', 'verb', '', 'criticize'], ['criticizes', 'verb', 'past', 'criticized'], ['ignored', 'verb', 'ing', 'ignored'],
  ['large groups', 'noun', '', 'large group'], ['large groups', 'noun', 'plural', 'large groups'], ['large group', 'noun', 'plural', 'large groups'],
  ['piece of work', 'noun', 'plural', 'pieces of work'], ['news', 'noun', 'plural', 'news'], ['very bad', 'adjective', 'adverb', 'very badly'],
]) assert.strictEqual(inflectPhrase(phrase, stemType, form), expected, `inflect ${phrase} (${stemType}, ${form || 'base'})`);

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
  start: 0, end: 13, termId: 'breaking', termIds: ['breaking', ALL_CAPS_TERM_ID], virtual: false, structural: true, expanded: true,
}], 'a lexical match must not hide a wider all-caps detection');
assert.deepStrictEqual(findAllCapsMatches('abc A'), [], 'a lone title-case "A" is not shouting');
// Live news pages: acronyms, section labels, and kickers are not emphasis.
for (const text of ['US', 'Send us your questions on how the US economy is shaping', 'ICE agents who shot man', 'Beth LaBerge/KQED', 'LGBTQ', 'POLITICS', 'LATEST NEWS', 'HUFFPOST PERSONAL', 'WATCH: Federal agents search home', 'LIVE UPDATES: talks resume', 'NASCAR', 'Calling This Toothpaste A Miracle', 'US ICE agents arrive']) {
  assert.deepStrictEqual(findAllCapsMatches(text), [], `not emphasis: ${text}`);
}
for (const text of ['Oklahoma EXPOSES Texas', 'I did NOT do it', 'THIS IS HUGE NEWS FOR EVERYONE', 'They are FURIOUS']) {
  assert.strictEqual(findAllCapsMatches(text).length, 1, `emphasis: ${text}`);
}
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
assert.ok(findMatches(matcher, 'secretly eye-wateringly', index.termsById, index.regexTerms).some(match => match.termId === 'secretly'));
assert.ok(findMatches(matcher, 'secretly eye-wateringly', index.termsById, index.regexTerms).some(match => match.termId === 'eye-wateringly'));
for (const sample of [
  'but at what cost?', 'tragic', 'the surprising mistakes you are making', 'anyone can do it',
  'apocalypse', 'turns heads', 'turned sour', 'dodgy', 'startling revelations', 'sparks rows',
  'urgent warning', 'drastically', 'fuming', 'panicked', 'fires back',
  'feel the pinch', 'olive branch', 'lifted the lid on', 'set the record straight',
]) {
  assert.ok(findMatches(matcher, sample, index.termsById, index.regexTerms).length, `Daily Mail gap must match: ${sample}`);
}
assert.ok(!findContextualMatches('The mistakes you are making', { headline: true }).some(match => match.termId === '__clearframe_direct_address__'), 'direct address is a word list now, not a contextual pattern');

// Rhetorical devices found by word lists and exceptions.json (imperative, direct address,
// inclusive pronoun, modality) or by structure (tricolon, anaphora): [type, text, context,
// wordings found at "everything"]. Headlines show the word devices at the default level,
// body text only at "everything"; comments and quoted speech never.
/** @type {Array<[string, string, object, string[]]>} */
const DEVICE_CASES = [
  ['imperative', 'Find out why prices rise', { headline: true }, ['Find out']],
  ['imperative', 'Imagine a city without cars', { headline: true }, ['Imagine']],
  ['imperative', 'Don\'t miss the final', { headline: true }, ['Don\'t miss']],
  ['imperative', 'BREAKING: Get ready for snow', { headline: true }, ['Get']],
  ['imperative', 'Read on. See inside for details', { headline: true }, ['Read on', 'See']],
  ['imperative', 'Watch brand Rolex unveils a new model', { headline: true }, []],
  ['imperative', 'Meet the Press returns on Sunday', { headline: true }, []],
  ['imperative', 'Check: £20 off all items', { headline: true }, []],
  ['imperative', 'Voters watch closely as results arrive', { headline: true }, []],
  ['imperative', 'Use of force was justified, report finds', { headline: true }, []],
  ['imperative', '"Find out more," the minister said', { headline: true }, []],
  ['imperative', 'Fans find out the truth', { headline: true }, []],
  ['imperative', 'Get ready for snow', { headline: true, conversational: true }, []],
  ['imperative', 'Come clean Hilary Duff gets wet and wild', { headline: true }, []],
  ['imperative', 'Come rain or shine, the festival continues', { headline: true }, []],
  ['imperative', 'Come what may, the team returns', { headline: true }, []],
  ['imperative', 'Act II opens tonight', { headline: true }, []],
  ['imperative', 'Ask Amy answers readers', { headline: true }, []],
  ['imperative', 'Buy orders rise', { headline: true }, []],
  ['imperative', 'Click fraud costs advertisers millions', { headline: true }, []],
  ['imperative', 'Discover card profits rise', { headline: true }, []],
  ['imperative', 'Download speeds fall', { headline: true }, []],
  ['imperative', 'Give and take defines the talks', { headline: true }, []],
  ['imperative', 'Grab bag contains three prizes', { headline: true }, []],
  ['imperative', 'Imagine Dragons announce tour', { headline: true }, []],
  ['imperative', 'Join operation fails in database', { headline: true }, []],
  ['imperative', 'Look alike contest returns', { headline: true }, []],
  ['imperative', 'Meet results published', { headline: true }, []],
  ['imperative', 'See All Columnists', { headline: true }, []],
  ['imperative', 'See all articles', { headline: true }, []],
  ['imperative', 'Start date announced', { headline: true }, []],
  ['imperative', 'Stay order blocks demolition', { headline: true }, []],
  ['imperative', 'Get out of jail free card sold', { headline: true }, []],
  ['imperative', 'Keep net found on riverbank', { headline: true }, []],
  ['imperative', 'Find spot recorded by archaeologists', { headline: true }, []],
  ['imperative', 'Follow up appointments delayed', { headline: true }, []],
  ['imperative', 'Picture quality improves', { headline: true }, []],
  ['imperative', 'Spot prices rise', { headline: true }, []],
  ['imperative', 'Wait times grow', { headline: true }, []],
  ['imperative', 'Take home pay falls', { headline: true }, []],
  ['imperative', 'Tell tale signs of wear', { headline: true }, []],
  ['imperative', 'Try scorer injured', { headline: true }, []],
  ['imperative', 'Watch brand Rolex unveils a model', { headline: true }, []],
  ['imperative', 'Meet the Press returns', { headline: true }, []],
  ['imperative', 'Think tank warns of cuts', { headline: true }, []],
  ['imperative', 'Check: prices fall', { headline: true }, []],
  ['imperative', 'Come to the meeting', { headline: true }, ['Come']],
  ['imperative', 'Act responsibly', { headline: true }, ['Act']],
  ['imperative', 'Ask your doctor', { headline: true }, ['Ask']],
  ['imperative', 'Beware falling rocks', { headline: true }, ['Beware']],
  ['imperative', 'Buy fresh bread', { headline: true }, ['Buy']],
  ['imperative', 'Choose a candidate', { headline: true }, ['Choose']],
  ['imperative', 'Click here for details', { headline: true }, ['Click']],
  ['imperative', 'Consider the evidence', { headline: true }, ['Consider']],
  ['imperative', 'Discover the truth', { headline: true }, ['Discover']],
  ['imperative', 'Download the report', { headline: true }, ['Download']],
  ['imperative', 'Enjoy the show', { headline: true }, ['Enjoy']],
  ['imperative', 'Explore the city', { headline: true }, ['Explore']],
  ['imperative', 'Find the answer', { headline: true }, ['Find']],
  ['imperative', 'Follow the instructions', { headline: true }, ['Follow']],
  ['imperative', 'Forget the rumours', { headline: true }, ['Forget']],
  ['imperative', 'Get ready', { headline: true }, ['Get']],
  ['imperative', 'Give generously', { headline: true }, ['Give']],
  ['imperative', 'Grab a seat', { headline: true }, ['Grab']],
  ['imperative', 'Imagine a better future', { headline: true }, ['Imagine']],
  ['imperative', 'Join the club', { headline: true }, ['Join']],
  ['imperative', 'Keep the receipt', { headline: true }, ['Keep']],
  ['imperative', 'Learn the facts', { headline: true }, ['Learn']],
  ['imperative', 'Listen carefully', { headline: true }, ['Listen']],
  ['imperative', 'Look closely', { headline: true }, ['Look']],
  ['imperative', 'Meet the candidates', { headline: true }, ['Meet']],
  ['imperative', 'Remember the victims', { headline: true }, ['Remember']],
  ['imperative', 'See the difference', { headline: true }, ['See']],
  ['imperative', 'Start saving today', { headline: true }, ['Start']],
  ['imperative', 'Stay safe', { headline: true }, ['Stay']],
  ['imperative', 'Take a look', { headline: true }, ['Take']],
  ['imperative', 'Tell the truth', { headline: true }, ['Tell']],
  ['imperative', 'Think carefully', { headline: true }, ['Think']],
  ['imperative', 'Try this recipe', { headline: true }, ['Try']],
  ['imperative', 'Wait for the signal', { headline: true }, ['Wait']],
  ['imperative', 'Watch the video', { headline: true }, ['Watch']],
  ['imperative', 'Enter the competition', { headline: true }, ['Enter']],
  ['imperative', 'Subscribe today', { headline: true }, ['Subscribe']],
  ['imperative', 'Spot the difference', { headline: true }, ['Spot']],
  ['imperative', 'Picture a better future', { headline: true }, ['Picture']],
  ['direct-address', 'How you can save £50', { headline: true }, ['you']],
  ['direct-address', 'Your pension is at risk', { headline: true }, ['Your']],
  ['direct-address', "What you'll need to know", { headline: true }, ["you'll"]],
  ['direct-address', 'Is this you? Treat yourself', { headline: true }, ['you', 'yourself']],
  ['direct-address', 'Youth unemployment hits a high', { headline: true }, []],
  ['direct-address', 'The YouTube video went viral', { headline: true }, []],
  ['direct-address', '“I love you,” she said', { headline: true }, []],
  ['direct-address', 'How you can save £50', { headline: true, conversational: true }, []],
  ['direct-address', 'How you can save £50', { headline: true, pageContext: 'discussion' }, []],
  ['inclusive-pronoun', 'We must protect our future', { headline: true }, ['We', 'our']],
  ['inclusive-pronoun', "Let's talk about us", { headline: true }, ["Let's", 'us']],
  ['inclusive-pronoun', "It is ours, and we're ready", { headline: true }, ['ours', "we're"]],
  ['inclusive-pronoun', 'We did it ourselves', {}, ['We', 'ourselves']],
  ['inclusive-pronoun', 'US officials said the US-led talks failed', { headline: true }, []],
  ['inclusive-pronoun', 'Bonus plans at Lotus and Focus', { headline: true }, []],
  ['inclusive-pronoun', 'He said "we won" in a statement', { headline: true }, []],
  ['modality', 'Schools must reopen, he should resign', { headline: true }, ['must', 'should']],
  ['modality', 'We need to talk. She has to go', { headline: true }, ['need to', 'has to']],
  ['modality', "Britain ought to act and cannot afford to wait; it mustn't fail", { headline: true }, ['ought to', 'cannot afford to', "mustn't"]],
  ['modality', 'The ministers must not delay; they should not, and shouldn’t', { headline: true }, ['must not', 'should not', 'shouldn’t']],
  ['modality', 'A must-have bag and a must-see film', { headline: true }, []],
  ['modality', 'The cinema is a must for fans', { headline: true }, []],
  ['modality', 'The need to protect children is clear', { headline: true }, []],
  ['modality', 'The Post had to flee during the airstrike', { headline: true }, []],
  ['modality', 'The day I had to ban him', {}, []],
  ['modality', 'We have to act. She has to go. They need to prepare.', { headline: true }, ['have to', 'has to', 'need to']],
  ['modality', 'Add mustard and pass the shoulders', { headline: true }, []],
  ['tricolon', 'He offered blood, sweat and tears.', {}, ['blood, sweat and tears']],
  ['tricolon', 'Faster, cheaper and safer.', {}, ['Faster, cheaper and safer']],
  ['tricolon', 'No jobs, no homes, no hope', {}, ['No jobs, no homes, no hope']],
  ['tricolon', 'I came, I saw, I conquered.', {}, ['I came, I saw, I conquered']],
  ['tricolon', 'Of the people, by the people, for the people.', {}, ['Of the people, by the people, for the people']],
  ['tricolon', 'London, Paris and New York are big cities.', {}, []],
  ['tricolon', 'In March, the minister said, and the rest followed.', {}, []],
  ['tricolon', 'Apples, oranges, pears and plums.', {}, []],
  ['tricolon', 'Monday, Tuesday and Wednesday were dry.', {}, []],
  ['tricolon', 'Sales were 3,000, 4,000 and 5,000 units.', {}, []],
  ['tricolon', 'He bought bread, milk and eggs at the shop.', {}, []],
  ['tricolon', 'Faster, cheaper and safer.', { conversational: true }, []],
  ['anaphora', 'We will fight on the beaches. We will fight in the hills.', {}, ['We will fight', 'We will fight']],
  ['anaphora', 'No more cuts. No more lies. No more excuses.', {}, ['No more', 'No more', 'No more']],
  ['anaphora', 'Never again will we forget; never again will we fail.', {}, ['Never again', 'never again']],
  ['anaphora', 'Every child matters, every child deserves a chance.', {}, ['Every child', 'every child']],
  ['anaphora', 'The dog barked. The cat ran.', {}, []],
  ['anaphora', 'He said no. He said yes.', {}, []],
  ['anaphora', 'It was cold. It was dark.', {}, []],
  ['anaphora', 'Huntley had been ill. Huntley died in hospital.', {}, []],
  ['anaphora', 'We will fight on the beaches. We will fight in the hills.', { conversational: true }, []],
];
for (const [type, text, context, wordings] of DEVICE_CASES) {
  const plan = analyze(text, { ...PUBLICATION, ...context }, normalizeSettings({ sensitivity: 'all' }));
  const entries = plan.entries.filter(entry => entry.terms.some(term => term.type === type));
  assert.deepStrictEqual(entries.map(entry => entry.wording), wordings, `${type}: ${text}`);
  for (const entry of entries) assert.strictEqual(text.slice(entry.start, entry.end), entry.wording, `${type} offsets: ${text}`);
}
// Default level: word devices only in headlines, anaphora yes, tricolon only at "everything".
const standardTypes = (text, context) => analyze(text, { ...PUBLICATION, ...context }, normalizeSettings({})).entries.map(entry => entry.term.type);
assert.deepStrictEqual(standardTypes('Come clean about the payments', { headline: true }), ['imperative']);
assert.ok(!standardTypes('Come clean Hilary Duff gets wet and wild', { headline: true }).includes('imperative'));
assert.deepStrictEqual(standardTypes('You must act', { headline: true }), ['direct-address', 'modality']);
assert.deepStrictEqual(standardTypes('You must act', {}), []);
assert.deepStrictEqual(standardTypes('We will fight on the beaches. We will fight in the hills.', {}), ['anaphora', 'anaphora']);
assert.deepStrictEqual(standardTypes('Faster, cheaper and safer', {}), []);
assert.deepStrictEqual(standardTypes('Hope is a must', { headline: true }), []);
// They are only ever highlighted, and an older type keeps its span.
for (const mode of ['reword', 'remove']) {
  const plan = analyze('Find out how you must act: no jobs, no homes, no hope', { ...PUBLICATION, headline: true }, normalizeSettings({ sensitivity: 'all', [mode === 'remove' ? 'removeTerms' : 'replaceTerms']: true }));
  assert.ok(plan.entries.length && plan.entries.every(entry => entry.action === 'highlighted'), mode);
}
assert.deepStrictEqual(analyze('Act now, we must win', { ...PUBLICATION, headline: true }, normalizeSettings({})).entries.map(entry => `${entry.wording}:${entry.term.type}`), ['Act now:clickbait', 'must:modality'], 'clickbait imperatives keep their longer span and label');
assert.strictEqual(analyze("'Our' plan, they said", { ...PUBLICATION, headline: true }, normalizeSettings({ sensitivity: 'all', types: { quote: true } })).entries.map(entry => entry.term.type).join(), 'quote', 'a word inside a scare quote is not a device of its own');
assert.strictEqual(normalizeSettings({}).types.modality, undefined, 'new devices are on by default');
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
  const matches = findMatches(matcher, row.text, index.termsById, index.regexTerms, () => true,
    (termId, start, end) => shouldKeepLexicalMatch(index.termsById[termId], row.text.slice(start, end), row.text, context, start));
  assert.strictEqual(matches.some(match => index.termsById[match.termId]?.phrase === row.term), row.match,
    `context matrix failed for ${row.term}: ${row.text}`);
}
// Live-site false positives (October 2026 news report): literal and proper-noun senses.
function headlineTerms(text) {
  const context = { headline: true, pageContext: 'publication' };
  return findMatches(matcher, text, index.termsById, index.regexTerms, () => true,
    (termId, start, end) => shouldKeepLexicalMatch(index.termsById[termId], text.slice(start, end), text, context, start))
    .map(match => index.termsById[match.termId].phrase);
}
for (const [text, phrase] of [
  ['GOP Senator Argues Trump May Be Breaking The Law', 'breaking'],
  ["Why Florida's record-breaking economy could soon be in jeopardy", 'breaking'],
  ['Orangutan family released back into the wild', 'wild'],
  ['Secret Service chief says threats are up', 'secret'],
  ["Iran's Revolutionary Guards behind threats", 'revolutionary'],
  ["The company behind ICE's new electric shock gloves", 'shock'],
  ['Airport came under fire from Houthi rebels', 'under fire'],
  ['Remnants fuel severe storms for the West Coast', 'severe'],
]) assert.ok(!headlineTerms(text).includes(phrase), `literal sense must not match: ${text}`);
for (const [text, phrase] of [
  ['BREAKING: ICE raids home', 'breaking'],
  ['Hearing turmoil in wild racially-charged rant', 'wild'],
  ['Coach under fire after debacle', 'under fire'],
  ['Michael Douglas reveals secret affair', 'secret'],
]) assert.ok(headlineTerms(text).includes(phrase), `loaded sense must still match: ${text}`);
const questions = text => findContextualMatches(text, { headline: true, pageContext: 'publication' }).filter(match => match.termId === '__clearframe_headline_question__');
assert.strictEqual(questions('Is it time to drop him in the lineup?').length, 1);
assert.strictEqual(questions('Who is James Talarico?').length, 0, 'explainer questions are not rhetorical');
assert.strictEqual(questions('Tell us: have you called off a wedding?').length, 0, 'reader callouts are not rhetorical');
assert.deepStrictEqual(questions('Wall Street is going 23 hours. Who takes the keys at 2 a.m.?'), [], 'abbreviations do not start a question');
assert.strictEqual(questions('Will Smith is cold. Is it time to drop him?')[0]?.start, 20);
const arcs = text => findContextualMatches(text, { headline: true, pageContext: 'publication' }).filter(match => match.termId === '__clearframe_transformation__');
assert.strictEqual(arcs('From forgotten room to luxury retreat').length, 1);
assert.strictEqual(arcs('Combs rushed from New Jersey prison to hospital').length, 0);
assert.strictEqual(arcs('From $295K to $16.8M').length, 0);
for (const text of ['ROB CRILLY: How she caught his eye', 'W. JAMES ANTLE: Polls come under scrutiny', 'SCOTUS ruling', '👀 LATEST NEWS 👀']) {
  assert.deepStrictEqual(findAllCapsMatches(text), [], `byline, acronym, or label: ${text}`);
}

// Political symmetry: mirrored framings share a type; deferred terms flag neither side.
const mirrorPairs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mirror-pairs.json'), 'utf8'));
function bodyMatches(text) {
  const context = { headline: false, pageContext: 'publication' };
  return findMatches(matcher, text, index.termsById, index.regexTerms, () => true,
    (termId, start, end) => shouldKeepLexicalMatch(index.termsById[termId], text.slice(start, end), text, context, start));
}
// Type and confidence both shape the highlight, so a pair must match on both.
function mirrorStyle({ term, text }) {
  const match = bodyMatches(text).find(item => index.termsById[item.termId]?.phrase === term);
  assert.ok(match, `mirror term "${term}" is not flagged in: ${text}`);
  const { type, confidence = 'high' } = index.termsById[match.termId];
  return `${type} (${confidence})`;
}
for (const pair of mirrorPairs.pairs) {
  assert.strictEqual(mirrorStyle(pair.a), mirrorStyle(pair.b), `mirror pair "${pair.a.term}" / "${pair.b.term}" must share a type and confidence`);
}
for (const item of mirrorPairs.deferred) {
  for (const [phrase, text] of [[item.phrase, item.text], [item.mirror, item.mirrorText]]) {
    if (!phrase) continue;
    const start = text.toLowerCase().indexOf(phrase.toLowerCase());
    assert.ok(start >= 0, `deferred phrase "${phrase}" missing from its sample text`);
    // Generic terms inside the phrase (e.g. "regime") may still fire; the deferred phrase itself may not.
    assert.ok(!bodyMatches(text).some(match => match.start <= start && start + phrase.length <= match.end),
      `deferred term "${phrase}" must not be flagged until it has a mirror`);
  }
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
// data/terms/exceptions.json: [phrase, text, still flagged, context].
const HEAD = { headline: true }, BODY = { headline: false }, REDDIT = { headline: false, pageContext: 'discussion' };
/** @type {[string, string, boolean, ({ headline: boolean, pageContext?: string })?][]} */
const EXCEPTION_CASES = [
  ['far-left', 'Pictured at far left, the senator', false], ['far-left', 'A far-left group marched', true],
  ['far-right', 'Seen in the far right corner', false], ['far-right', 'The mayor (far right) spoke', false], ['far-right', 'A far-right party won', true],
  ['breaking', 'The bridge is breaking apart', false], ['breaking', 'BREAKING: vote delayed', true], ['breaking', 'Senators share breaking news today', true],
  ['wild', 'Released into the wild', false], ['wild', 'A wild card entry', false], ['wild', 'Fans erupt in wild rant', true],
  ['wild', 'Protecting wild life', false], ['wild', 'Star shows off wild lifestyle', true], ['wild', 'Wild horses spotted', false], ['wild', 'Wild horseplay at party', true],
  ['revolutionary', "Iran's Revolutionary Guards", false], ['revolutionary', 'A revolutionary gadget', true],
  ['secret', 'Secret Service chief speaks', false], ['secret', 'Star reveals secret affair', true],
  ['shock', 'Workers felt an electric shock', false], ['shock', 'New shock absorbers fitted', false], ['shock', 'A shock result in Ohio', true],
  ['under fire', 'Troops under fire from rebels', false], ['under fire', 'Troops came under fire', false], ['under fire', 'Police came under fire from gunmen', false],
  ['under fire', 'Convoy under fire as artillery pounds the road', false], ['under fire', 'Coach under fire after debacle', true],
  ['under fire', 'Minister came under fire from critics', true], ['under fire', 'Police under fire over handling of the case', true], ['under fire', 'Airport came under fire', true],
  ['evil', 'Resident Evil remake announced', false], ['evil', 'Evil Dead sequel', false], ['evil', 'This is pure evil', true], ['evil', 'A resident evil plot', true],
  ['evil', 'RESIDENT EVIL remake announced', false], ['evil', 'EVIL DEAD sequel', false], ['evil', 'Evil plan revealed', true],
  ['sack', 'She carried a sack of rice', false, BODY], ['sack', 'He had 3 sacks on Sunday', false, BODY], ['sack', 'Time to hit the sack', false, BODY], ['sack', 'Club to sack manager after defeat', true, BODY], ['sack', 'Board sacks chief executive', true, BODY], ['sacking', 'Calls grow for sacking of minister', true, BODY],
  ['sack', 'He was sacked eight times', false, BODY], ['sack', 'Allen sacked for a loss', false, BODY], ['sack', 'The QB was sacked by Watt for 9 yards', false, BODY],
  ['sack', 'The minister was sacked by the premier', true, BODY], ['sack', 'Was sacked by Watt for 9 yards', false, BODY],
  ['sack', 'Quarterback sacked twice for 12 yards', false, BODY], ['sack', 'The firm sacked 300 staff', true, BODY], ['sack', 'He was sacked twice by the club', true, BODY],
  ['severe', 'Severe storms hit Texas', false], ['severe', 'Severe criticism of the plan', true],
  ['exclusive', 'They signed an exclusive license', false, BODY], ['exclusive', 'An EXCLUSIVE interview', true, BODY], ['exclusive', 'Exclusive: the inside story', true],
  ['elite', 'Xbox Elite controller leaks', false], ['elite', 'Hasbro Elite figures', false], ['elite', 'An elite athlete', false], ['elite', 'The wealthy elite', true],
  ['legendary', 'Marvel Legendary series', false], ['legendary', 'Her legendary performance', true],
  ['miracle', 'Scotts Miracle cream brand', false], ['miracle', 'A miracle cure', true], ['miracle', 'Miraculous comeback for the team', true], ['miracle', 'Doctors Hail Miraculous Escape', true],
  ['come', 'Come clean Hilary Duff gets wet and wild', false],
  ['meet', 'Meet the Press returns', false], ['meet', 'Meet the maniacs who love middle seats', true],
  ['watch', 'Watch brand Rolex unveils a model', false], ['watch', 'Watch the moment he scores', true],
  ['think', 'Think tank warns of cuts', false], ['think', 'Think hard, Britain', true],
  ['must', 'A must-have bag', false], ['must', 'It is a must for fans', false], ['must', 'Schools must reopen', true],
  ['need to', 'The need to protect children', false], ['need to', 'Schools need to reopen', true],
  ['us', 'US officials said', false], ['us', 'The US-led talks', false], ['us', 'Visit us today', true], ['us', 'LET US PRAY FOR THE US ECONOMY', true],
  ['we', 'He said "we won" last night', false], ['we', 'We won last night', true], ['we', 'We won last night', false, { headline: true, conversational: true }],
  ['you', 'He said “you are kind', false], ['you', 'You are kind', true], ['you', 'You are kind', false, { headline: true, pageContext: 'video' }],
  ['find out', 'Find out why', true], ['find out', 'Fans find out why', false], ['find out', '"Find out why" he said', false],
  ['get', 'Get ready for winter', true], ['get', 'Get: £20', false], ['get', 'Get-out clause agreed', false], ['get', 'Get ready', false, { headline: true, conversational: true }],
  ['get', 'A get-together', false], ['get', 'act now to get ready', false],
  ['gotta', 'You gotta see this', true, BODY], ['gotta', 'You gotta see this', false, REDDIT],
];
for (const [phrase, text, flagged, context = HEAD] of EXCEPTION_CASES) {
  const found = findMatches(matcher, text, index.termsById, index.regexTerms, () => true,
    (termId, start, end) => shouldKeepLexicalMatch(index.termsById[termId], text.slice(start, end), text, context, start))
    .some(match => index.termsById[match.termId].phrase === phrase);
  assert.strictEqual(found, flagged, `exception for "${phrase}" in: ${text}`);
}
assert.ok(headlineTerms('A bargain, but at what cost?').includes('at what cost'), 'rhetorical stock phrases are lexical rules');
assert.deepStrictEqual(findContextualMatches('You said that the plan worked.', { headline: false }), []);
assert.strictEqual(
  findMatches(matcher, "She was 'terrified'.", index.termsById, index.regexTerms)[0]?.termId,
  'terrified',
  'quoted inflections must use the phrase matcher without per-rule regex scans',
);

const allCapsTestTerm = { phrase: 'caps emphasis', neutral: 'caps emphasis', remove: false };
const getAction = (term, { removeTerms = false, replaceTerms = true } = {}) => chooseAction(term, { removeTerms, replaceTerms });
assert.strictEqual(chooseAction(index.termsById.exclusive, { removeTerms: true, replaceTerms: true }, true), 'highlighted', 'protected text is never reworded');
const groupedAllCapsOverlap = resolveMatchGroups([
  { start: 0, end: 7, termId: 'finally' },
  { start: 0, end: 7, termId: '__clearframe_all_caps__', virtual: true },
  { start: 0, end: 7, termId: 'third-type' },
]);
assert.deepStrictEqual(
  groupedAllCapsOverlap[0].termIds,
  ['finally', 'third-type', '__clearframe_all_caps__'],
);
assert.ok(!groupedAllCapsOverlap[0].expanded, 'same-span groups may still reword the lexical term');
// "FINALLY COURT FINDS NO FRAUD": the caps run spans the headline, so "finally" must not reword or remove all of it.
const headlineGroup = resolveMatchGroups([
  { start: 0, end: 7, termId: 'finally' },
  { start: 0, end: 27, termId: '__clearframe_all_caps__', virtual: true },
]);
assert.strictEqual(headlineGroup.length, 1);
assert.ok(headlineGroup[0].expanded);

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
  findMatches(filteredMatcher, filteredText, index.termsById, index.regexTerms, term => !disabledTypes.has(term.type)),
  [],
  'disabled types must exclude regex-backed terms',
);

assert.deepStrictEqual(
  normalizeSettings({ types: {} }).types,
  { absolute: false, superlative: false, quote: false },
);
assert.deepStrictEqual(
  normalizeSettings({ types: { loaded: false } }).types,
  { absolute: false, superlative: false, quote: false, loaded: false },
);
assert.deepStrictEqual(
  normalizeSettings({ userTypeColors: { hype: 'red' } }, { moral: 'blue' }).userTypeColors,
  { hype: 'red', moral: 'blue' },
);
assert.strictEqual(normalizeSettings().monochrome, true, 'highlights are monochrome by default');
assert.strictEqual(normalizeSettings({ monochrome: false }).monochrome, false, 'a saved color choice is kept');
assert.strictEqual(normalizeSettings({ monochrome: true }).monochrome, true);
assert.strictEqual(normalizeSettings().feedbackEnabled, false);
assert.strictEqual(normalizeSettings({ feedbackEnabled: true }).feedbackEnabled, true);
assert.strictEqual(normalizeSettings({ feedbackEnabled: 'false' }).feedbackEnabled, false);
assert.strictEqual(normalizeSettings({ replaceTerms: 1, monochrome: 'true' }).replaceTerms, false);
assert.strictEqual(normalizeSettings({ types: { loaded: 'false' } }).types.loaded, false);
assert.deepStrictEqual(normalizeSettings([]), normalizeSettings());
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

// The three newer settings: defaults, accepted values, and fallbacks for anything else.
for (const [raw, expected] of /** @type {Array<[any, any]>} */ ([
  [undefined, { predictFirst: false, headlinesOnly: false, sensitivity: 'standard' }],
  [{}, { predictFirst: false, headlinesOnly: false, sensitivity: 'standard' }],
  [{ predictFirst: true, headlinesOnly: true, sensitivity: 'strong' }, { predictFirst: true, headlinesOnly: true, sensitivity: 'strong' }],
  [{ sensitivity: 'all' }, { predictFirst: false, headlinesOnly: false, sensitivity: 'all' }],
  [{ predictFirst: 'true', headlinesOnly: 1, sensitivity: 'loud' }, { predictFirst: false, headlinesOnly: false, sensitivity: 'standard' }],
])) {
  const { predictFirst, headlinesOnly, sensitivity } = normalizeSettings(raw);
  assert.deepStrictEqual({ predictFirst, headlinesOnly, sensitivity }, expected, JSON.stringify(raw));
}

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

const exceptionsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clearframe-exceptions-')), 'exceptions.json');
try {
  const exceptionTerms = { shock: { phrase: 'shock', type: 'clickbait' } };
  for (const [data, error] of [
    [{ terms: { shock: { unless: [{ after: '/(/iu' }] } } }, /term "shock".unless\[0\].after: invalid regex/],
    [{ terms: { shock: { unless: [{ after: '^gloves' }] } } }, /expected "\/pattern\/flags"/],
    [{ terms: { shock: { unless: [{ after: '/x/g' }] } } }, /flags "g" and "y" are not allowed/],
    [{ terms: { shocks: { unless: [{ after: '/x/u' }] } } }, /term "shocks": is not a term phrase/],
    [{ terms: { shock: { unless: ['missing'] } } }, /unknown shared pattern "missing"/],
    [{ terms: { shock: { unless: [{ afterr: '/x/u' }] } } }, /unknown field "afterr"/],
    [{ terms: { shock: { unless: [{}] } } }, /empty clause/],
    [{ term: {} }, /top level: unknown field "term"/],
    [{ types: { clickbait: { contexts: ['nowhere'] } } }, /unsupported context "nowhere"/],
    [{ types: { clickbait: { confidence: { body: 'rare' } } } }, /type "clickbait".confidence/],
    [{ types: { clickbait: { confidence: { sidebar: 'medium' } } } }, /type "clickbait".confidence/],
    [{ types: { clickbait: { unless: ['missing'] } } }, /unknown shared pattern "missing"/],
    [{ types: { clickbait: { only: [{ before: '/(/u' }] } } }, /type "clickbait".only\[0\].before: invalid regex/],
    [{ types: { clickbait: { note: 'nothing else' } } }, /needs contexts, only, unless or confidence/],
    [{ terms: { shock: { only: [{ conversational: 'no' }] } } }, /"conversational" must be true or false/],
    [{ terms: { shock: { note: 'empty' } } }, /needs "unless" or "only"/],
  ]) {
    fs.writeFileSync(exceptionsFile, JSON.stringify(data));
    assert.throws(() => loadExceptions(exceptionsFile, exceptionTerms), error);
  }
} finally {
  fs.rmSync(path.dirname(exceptionsFile), { recursive: true, force: true });
}
