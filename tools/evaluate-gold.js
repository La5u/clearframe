#!/usr/bin/env node
// Scores the pure detection pipeline against hand-labelled text blocks in
// tests/gold/*.jsonl. A reporting tool, not a CI gate.
//   npm run evaluate:gold              default settings (some types off)
//   npm run evaluate:gold -- --all     every type enabled
//   npm run evaluate:gold -- --sensitivity=strong|standard|all   (default: the extension default)
//   npm run evaluate:gold -- FILE...   other .jsonl files or directories
//   npm run evaluate:gold -- --top=30  longer error lists
//   npm run evaluate:gold -- --with-candidates[=medium|high]  dry run: also use unapproved candidate rules
//                                    (in memory only) at that confidence or better; default medium (= high + medium)
//   npm run evaluate:gold -- --exclude=modality,tricolon   score without detections of these types
import fs from 'fs';
import path from 'path';
import { loadTerms } from '../src/core/term-utils.js';
import { approvedRuleTerms, loadRuleRecords } from './rule-utils.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings-utils.js';
import { createAnalyzer, getMostImportantType } from '../src/core/analyze.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const inputs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const TYPES = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'type-labels.json'), 'utf8')).types);
const allTypes = process.argv.includes('--all');
const sensitivity = process.argv.find(arg => arg.startsWith('--sensitivity='))?.slice(14);
const excluded = (process.argv.find(arg => arg.startsWith('--exclude='))?.slice(10) || '').split(',').filter(Boolean);
const TOP = Number(process.argv.find(arg => arg.startsWith('--top='))?.slice(6)) || 10;

const withCandidates = process.argv.find(arg => arg.startsWith('--with-candidates'))?.split('=')[1] || (process.argv.includes('--with-candidates') ? 'medium' : '');
const candidates = withCandidates ? loadRuleRecords(ROOT).filter(record => record.status === 'candidate' && (withCandidates === 'high' ? ['high'] : ['high', 'medium']).includes(record.confidence)) : [];
const index = loadTerms(path.join(ROOT, 'data', 'terms'), [...approvedRuleTerms(ROOT), ...candidates.map(record => ({ phrase: record.phrase, type: record.type, neutral: '', aliases: record.aliases || [], stemType: record.stemType || '', regex: record.pattern || '', remove: false, confidence: record.confidence, contexts: record.contexts || [] }))]);
for (const record of candidates) if (record.exception) index.exceptions.terms[record.phrase] = record.exception.unless;
const settings = normalizeSettings({ ...(allTypes ? { types: Object.fromEntries(TYPES.map(type => [type, true])) } : DEFAULT_SETTINGS), ...(sensitivity && { sensitivity }) });
if (sensitivity && settings.sensitivity !== sensitivity) throw new Error(`unknown --sensitivity=${sensitivity}`);
for (const type of excluded) if (!TYPES.includes(type)) throw new Error(`unknown --exclude type ${type}`);
const isEnabled = type => settings.types?.[type] !== false;
const { analyze } = createAnalyzer({ index });

// The content script's analysis in highlight mode, so offsets are into the original text.
function detect(text, context) {
  return analyze(text, context, settings).entries.map(({ start, end, terms }) => {
    const types = terms.map(term => term.type);
    return { start, end, type: getMostImportantType(terms), types, rule: terms.map(term => term.phrase).join(' + ') };
  }).filter(entry => !excluded.includes(entry.type));
}

const files = (inputs.length ? inputs : [path.join(ROOT, 'tests', 'gold')]).flatMap(input => fs.statSync(input).isDirectory()
  ? fs.readdirSync(input).filter(file => file.endsWith('.jsonl')).sort().map(file => path.join(input, file)) : [input]);
const blocks = files.flatMap(file => fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line)));
for (const block of blocks) {
  for (const span of block.spans) {
    if (!TYPES.includes(span.type)) throw new Error(`${block.id}: unknown type ${span.type}`);
    if (span.text !== undefined && block.text.slice(span.start, span.end) !== span.text) throw new Error(`${block.id}: span ${span.start}-${span.end} is not "${span.text}"`);
  }
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const exact = (a, b) => a.start === b.start && a.end === b.end;

// One-to-one greedy pairing of gold and predicted spans in one block.
function pair(gold, predicted, same, typed) {
  const used = new Set(), pairs = [];
  for (const g of gold) {
    const p = predicted.find(item => !used.has(item) && same(g, item) && (!typed || item.types.includes(g.type)));
    if (p) { used.add(p); pairs.push([g, p]); }
  }
  return { pairs, missed: gold.filter(g => !pairs.some(([item]) => item === g)), extra: predicted.filter(p => !used.has(p)) };
}

const results = blocks.map(block => {
  const context = { headline: block.context === 'headline', conversational: block.context === 'conversation', pageContext: block.page || 'publication' };
  return { block, gold: block.spans.filter(span => isEnabled(span.type)), predicted: detect(block.text, context) };
});

const ratio = (a, b) => b ? a / b : 0;
const score = (tp, fp, fn) => { const p = ratio(tp, tp + fp), r = ratio(tp, tp + fn); return { p, r, f: ratio(2 * p * r, p + r) }; };
const pct = value => (value * 100).toFixed(1).padStart(5);
const fmt = ({ p, r, f }) => `P ${pct(p)}  R ${pct(r)}  F1 ${pct(f)}`;

function totals(same, typed, type = null) {
  let tp = 0, fp = 0, fn = 0;
  for (const { gold, predicted } of results) {
    const { pairs, missed, extra } = pair(gold, predicted, same, typed);
    tp += pairs.filter(([g]) => !type || g.type === type).length;
    fn += missed.filter(g => !type || g.type === type).length;
    fp += extra.filter(p => !type || p.type === type).length;
  }
  return { tp, fp, fn, ...score(tp, fp, fn) };
}

const reviewed = blocks.filter(block => block.reviewed === true).length;
const goldSpans = results.reduce((sum, item) => sum + item.gold.length, 0);
const predictedSpans = results.reduce((sum, item) => sum + item.predicted.length, 0);
console.log(`Gold: ${blocks.length} blocks, ${blocks.reduce((sum, block) => sum + block.spans.length, 0)} spans; reviewed ${reviewed}, unreviewed ${blocks.length - reviewed}${reviewed < blocks.length ? ' (scores are provisional)' : ''}`);
console.log(`Sensitivity: ${settings.sensitivity}${withCandidates ? `; DRY RUN with ${candidates.length} unapproved candidate rules (${withCandidates} confidence or better)` : ''}`);
console.log(`Settings: ${allTypes ? 'all types enabled' : `defaults (off: ${TYPES.filter(type => !isEnabled(type)).join(', ')}; their gold spans are left out)`}`);
console.log(`Scored: ${goldSpans} gold spans, ${predictedSpans} detections, ${results.filter(item => !item.gold.length).length} blocks without gold spans\n`);
for (const [label, typed] of [['Any type', false], ['Same type', true]]) {
  console.log(`${label.padEnd(10)} exact    ${fmt(totals(exact, typed))}`);
  console.log(`${''.padEnd(10)} overlap  ${fmt(totals(overlaps, typed))}`);
}

console.log('\nPer type (type must match)      gold  det   exact                        overlap');
for (const type of TYPES) {
  const goldCount = results.reduce((sum, item) => sum + item.gold.filter(span => span.type === type).length, 0);
  const detected = results.reduce((sum, item) => sum + item.predicted.filter(span => span.type === type).length, 0);
  if (!goldCount && !detected) continue;
  console.log(`  ${(type + (isEnabled(type) ? '' : ' (off)')).padEnd(28)} ${String(goldCount).padStart(5)} ${String(detected).padStart(4)}   ${fmt(totals(exact, true, type))}   ${fmt(totals(overlaps, true, type))}`);
}

function grouped(items, key) {
  const groups = new Map();
  for (const item of items) {
    const group = groups.get(key(item)) || { count: 0, examples: [] };
    group.count++; if (group.examples.length < 2) group.examples.push(item.example);
    groups.set(key(item), group);
  }
  return [...groups].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
}
const snippet = (text, span) => `${text.slice(Math.max(0, span.start - 25), span.start)}[${text.slice(span.start, span.end)}]${text.slice(span.end, span.end + 25)}`.replace(/\s+/g, ' ');
const falsePositives = [], falseNegatives = [], wrongType = [];
for (const { block, gold, predicted } of results) {
  const { pairs, missed, extra } = pair(gold, predicted, overlaps, false);
  falsePositives.push(...extra.map(p => ({ ...p, example: `${block.id} ${snippet(block.text, p)}` })));
  falseNegatives.push(...missed.map(g => ({ ...g, wording: block.text.slice(g.start, g.end).toLowerCase(), example: `${block.id} ${snippet(block.text, g)}` })));
  wrongType.push(...pairs.filter(([g, p]) => !p.types.includes(g.type)).map(([g, p]) => ({ key: `${p.rule} (${p.type}) vs gold ${g.type}`, example: `${block.id} ${snippet(block.text, g)}` })));
}
const show = (title, groups) => {
  console.log(`\n${title}`);
  for (const [key, group] of groups.slice(0, TOP)) console.log(`  ${String(group.count).padStart(3)}  ${key}\n         ${group.examples.join('\n         ')}`);
  if (groups.length > TOP) console.log(`  … ${groups.length - TOP} more`);
};
show('False positives by rule (detections overlapping no gold span)', grouped(falsePositives, p => `${p.rule} (${p.type})`));
show('False negatives by wording (gold spans no detection overlaps)', grouped(falseNegatives, g => `${g.wording} (${g.type})`));
show('Type disagreements (overlapping, different type)', grouped(wrongType, item => item.key));
