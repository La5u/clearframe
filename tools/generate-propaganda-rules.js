#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalize } from '../src/core/matcher.js';
import { loadTerms } from '../src/core/term-utils.js';
import { readJsonl } from './rule-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rows = readJsonl(path.join(ROOT, 'research', 'cache', 'normalized', 'semeval-propaganda-2020.jsonl'));
const output = path.join(ROOT, 'data', 'rules', 'semeval-propaganda.jsonl');
const typeMap = {
  Loaded_Language: 'loaded',
  'Name_Calling,Labeling': 'derogatory',
  'Exaggeration,Minimisation': 'exaggeration',
  Doubt: 'uncertainty',
  Appeal_to_fear_prejudice: 'fear',
};
const stats = new Map();
for (const row of rows) {
  const label = row.labels?.[0], type = typeMap[label];
  const phrase = normalize(String(row.span || '').replace(/^[\s"'“‘]+|[\s"'”’.,!?;:]+$/g, ''));
  if (!type || !phrase || phrase.length > 60 || phrase.split(' ').length > 5) continue;
  const key = `${type}\t${phrase}`;
  const item = stats.get(key) || { phrase, type, label, occurrences: 0, documents: new Set() };
  item.occurrences++;
  item.documents.add(row.documentId);
  stats.set(key, item);
}
const existing = new Set(Object.keys(loadTerms(path.join(ROOT, 'data', 'terms')).termsById));
for (const file of fs.readdirSync(path.join(ROOT, 'data', 'rules')).filter(file => file.endsWith('.jsonl') && file !== path.basename(output))) {
  for (const record of readJsonl(path.join(ROOT, 'data', 'rules', file))) existing.add(normalize(record.phrase));
}
const reject = /^(?:our|we|us|they|it|this|that|never|bad|forced|severe|huge|sheer|american people|the american people|america|americans|russians|violence)$/i;
const records = [...stats.values()].filter(item =>
  item.occurrences >= 2 && item.documents.size >= 2 && !existing.has(item.phrase) && !reject.test(item.phrase)
).map(item => ({
  id: `semeval-${item.type}-${item.phrase.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  phrase: item.phrase,
  type: item.type,
  status: 'approved',
  confidence: item.occurrences >= 3 ? 'medium' : 'contextual',
  dimensions: item.type === 'fear' ? { emotionalIntensity: 0.8, persuasiveAppeal: 0.7 } : { loadedFraming: 0.7, subjectivity: 0.7 },
  evidence: { occurrences: item.occurrences, documents: item.documents.size, technique: item.label },
  sources: ['semeval-propaganda-2020'],
})).sort((a, b) => b.evidence.occurrences - a.evidence.occurrences || a.phrase.localeCompare(b.phrase));
fs.writeFileSync(output, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
console.log(`Generated ${records.length} contextual SemEval propaganda rules`);
