#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadTerms } from '../src/core/term-utils.js';
import { normalize } from '../src/core/matcher.js';
import { readJsonl } from './rule-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(ROOT, 'research', 'cache', 'normalized', 'magpie-idioms.jsonl');
const output = path.join(ROOT, 'data', 'rules', 'magpie-idioms.jsonl');
const rows = readJsonl(input);
const stats = new Map();
for (const row of rows) {
  const phrase = normalize(row.expression || '');
  if (!phrase) continue;
  const item = stats.get(phrase) || { total: 0, idiomatic: 0, literal: 0, documents: new Set() };
  item.total++;
  if (row.label === 'i') item.idiomatic++;
  if (row.label === 'l') item.literal++;
  item.documents.add(row.documentId);
  stats.set(phrase, item);
}

const existing = new Set(Object.keys(loadTerms(path.join(ROOT, 'data', 'terms')).termsById));
for (const file of fs.readdirSync(path.join(ROOT, 'data', 'rules')).filter(file => file.endsWith('.jsonl') && file !== path.basename(output))) {
  for (const record of readJsonl(path.join(ROOT, 'data', 'rules', file))) existing.add(normalize(record.phrase));
}
const placeholder = /\b(?:someone|somebody|something|one's|somewhere)\b|[*/]/i;
const records = [...stats.entries()].filter(([phrase, item]) =>
  !existing.has(phrase) && !placeholder.test(phrase) && item.idiomatic >= 3 && item.documents.size >= 2 && item.idiomatic > item.literal
).map(([phrase, item]) => ({
  id: `magpie-${phrase.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  phrase,
  type: 'idiom',
  status: 'approved',
  confidence: 'exploratory',
  dimensions: { figurativeLanguage: 0.8 },
  evidence: { occurrences: item.total, idiomaticOccurrences: item.idiomatic, literalOccurrences: item.literal, idiomaticShare: item.idiomatic / item.total, documents: item.documents.size },
  sources: ['magpie-idioms'],
})).sort((a, b) => b.evidence.idiomaticOccurrences - a.evidence.idiomaticOccurrences || a.phrase.localeCompare(b.phrase));
fs.writeFileSync(output, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
console.log(`Generated ${records.length} exploratory MAGPIE idiom rules`);
