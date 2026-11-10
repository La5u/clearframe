#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadTerms, parseCsv } from '../src/core/term-utils.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings-utils.js';
import { createAnalyzer } from '../src/core/analyze.js';
import { approvedRuleTerms } from './rule-utils.js';
import { assertSourcesAllowed, loadSourceRegistry } from './source-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertSourcesAllowed(['babe'], loadSourceRegistry(ROOT), 'evaluation');
const archive = path.join(ROOT, 'research', 'raw', 'babe-evaluation-only.zip');
const member = '*/data/final_labels_SG2.csv';
if (!fs.existsSync(archive)) {
  console.error(`Missing ${path.relative(ROOT, archive)}; run npm run data:download:evaluation first.`);
  process.exit(1);
}
const extracted = spawnSync('unzip', ['-p', archive, member], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
if (extracted.status !== 0) throw new Error('Unable to read sealed BABE evaluation split');
const [header, ...rows] = parseCsv(extracted.stdout.replace(/;/g, ','));
const textIndex = header.indexOf('text'), labelIndex = header.indexOf('label_bias');
const index = loadTerms(path.join(ROOT, 'data', 'terms'), approvedRuleTerms(ROOT));
// Scores what the extension shows on a news page: default settings, body
// text, with rule exceptions and the structural detectors (--all enables
// every type).
const types = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'type-labels.json'), 'utf8')).types);
const settings = normalizeSettings(process.argv.includes('--all') ? { types: Object.fromEntries(types.map(type => [type, true])) } : DEFAULT_SETTINGS);
const { analyze } = createAnalyzer({ index });
let tp = 0, fp = 0, tn = 0, fn = 0;
for (const row of rows) {
  const expected = row[labelIndex] === 'Biased';
  const predicted = analyze(row[textIndex] || '', { headline: false, pageContext: 'publication' }, settings).entries.length > 0;
  if (expected && predicted) tp++; else if (expected) fn++; else if (predicted) fp++; else tn++;
}
const precision = tp / Math.max(1, tp + fp), recall = tp / Math.max(1, tp + fn);
const report = { dataset: 'BABE SG2', role: 'evaluation-only', rows: tp + fp + tn + fn, tp, fp, tn, fn, precision, recall, note: 'Phrase detection is not a sentence-bias classifier; this is an external coverage/specificity diagnostic only.' };
const out = path.join(ROOT, 'research', 'reports', 'babe-evaluation.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
