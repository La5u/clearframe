#!/usr/bin/env node
// Political-balance diagnostic on NewsWCL50: the same ten 2018 events were
// annotated in left, centre and right outlets. Compare how often ClearFrame
// flags each side's annotated wording. A large gap is a prompt to inspect the
// flagged terms, not a fairness score: the outlets may genuinely differ.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCsv, loadTerms } from '../src/core/term-utils.js';
import { buildMatcher, findMatches } from '../src/core/matcher.js';
import { shouldKeepLexicalMatch } from '../src/core/context-filter.js';
import { approvedRuleTerms } from './rule-utils.js';
import { assertSourcesAllowed, loadSourceRegistry } from './source-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'newswcl50';
const registry = loadSourceRegistry(ROOT);
assertSourcesAllowed([SOURCE], registry, 'evaluation');
const input = path.join(ROOT, 'research', 'raw', registry.get(SOURCE).archive);
if (!fs.existsSync(input)) throw new Error(`Missing ${input}; run npm run data:download -- --include-evaluation ${SOURCE}`);

const [header, ...rows] = parseCsv(fs.readFileSync(input, 'utf8').replace(/^sep=,\r?\n/, ''));
const col = Object.fromEntries(header.map((name, index) => [name, index]));
const SIDES = { LL: 'left', L: 'left', M: 'centre', R: 'right', RR: 'right' };
const index = loadTerms(path.join(ROOT, 'data', 'terms'), approvedRuleTerms(ROOT));
const matcher = buildMatcher(index);

const stats = {};
for (const row of rows) {
  const side = SIDES[row[col.publisher_id]];
  const mention = row[col.code_mention] || '';
  if (!side || !mention.trim()) continue;
  const bucket = (stats[side] ||= { mentions: 0, flagged: 0, flaggedHigh: 0, terms: {} });
  bucket.mentions++;
  // Annotated mentions come from article bodies; apply the extension's own context rules.
  const context = { headline: false, pageContext: 'publication' };
  const matches = findMatches(matcher, mention, index.termsById, index.regexTerms, () => true,
    (termId, start, end) => shouldKeepLexicalMatch(index.termsById[termId], mention.slice(start, end), mention, context, start));
  if (matches.length) bucket.flagged++;
  // Below-high confidence renders faint; this rate counts only full-strength highlights.
  if (matches.some(match => (index.termsById[match.termId]?.confidence || 'high') === 'high')) bucket.flaggedHigh++;
  for (const match of matches) {
    const phrase = index.termsById[match.termId]?.phrase || match.termId;
    bucket.terms[phrase] = (bucket.terms[phrase] || 0) + 1;
  }
}

const report = Object.fromEntries(Object.entries(stats).map(([side, bucket]) => [side, {
  mentions: bucket.mentions,
  flagged: bucket.flagged,
  rate: Number((bucket.flagged / bucket.mentions).toFixed(4)),
  highConfidenceRate: Number((bucket.flaggedHigh / bucket.mentions).toFixed(4)),
  topTerms: Object.entries(bucket.terms).sort((a, b) => b[1] - a[1]).slice(0, 15),
}]));
const out = path.join(ROOT, 'research', 'reports', 'balance-newswcl50.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
for (const side of ['left', 'centre', 'right']) {
  const item = report[side];
  if (item) console.log(`${side.padEnd(6)} ${item.flagged}/${item.mentions} mentions flagged (${(item.rate * 100).toFixed(1)}%, full-strength ${(item.highConfidenceRate * 100).toFixed(1)}%): ${item.topTerms.slice(0, 8).map(([term, count]) => `${term}×${count}`).join(', ')}`);
}
