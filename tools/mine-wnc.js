#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { assertSourcesAllowed, loadSourceRegistry } from './source-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];
const output = process.argv[3] || path.join(ROOT, 'research', 'reports', 'wnc-candidates.jsonl');
if (!input) throw new Error('Usage: node tools/mine-wnc.js <parallel.tsv> [output.jsonl]');
assertSourcesAllowed(['wiki-neutrality-corpus'], loadSourceRegistry(ROOT), 'rule-mining');

const raw = input.endsWith('.zip')
  ? spawnSync('unzip', ['-p', input, 'bias_data/WNC/biased.full'], { encoding: 'utf8', maxBuffer: 300 * 1024 * 1024 })
  : { status: 0, stdout: fs.readFileSync(input, 'utf8') };
if (raw.status !== 0) throw new Error(`Could not read WNC input: ${raw.stderr || raw.status}`);
const rows = raw.stdout.split(/\r?\n/).filter(Boolean);
const pairs = new Map();
const word = /[\p{L}\p{N}'’-]+/gu;
for (const row of rows) {
  const columns = row.split('\t');
  const source = columns.length >= 5 ? columns[3] : columns[0];
  const target = columns.length >= 5 ? columns[4] : columns[1];
  if (!source || !target) continue;
  const a = source.match(word) || [], b = target.match(word) || [];
  let left = 0;
  while (left < a.length && left < b.length && a[left].toLowerCase() === b[left].toLowerCase()) left++;
  let ar = a.length - 1, br = b.length - 1;
  while (ar >= left && br >= left && a[ar].toLowerCase() === b[br].toLowerCase()) { ar--; br--; }
  const from = a.slice(left, ar + 1).join(' ').toLowerCase();
  const to = b.slice(left, br + 1).join(' ').toLowerCase();
  if (!from || !to || from.length > 80 || to.length > 80 || from === to) continue;
  const key = `${from}\t${to}`;
  const item = pairs.get(key) || { phrase: from, reword: to, occurrences: 0, documents: new Set(), documentCounts: new Map(), examples: [] };
  item.occurrences++;
  const documentId = columns[0] || `row-${pairs.size}`;
  item.documents.add(documentId);
  item.documentCounts.set(documentId, (item.documentCounts.get(documentId) || 0) + 1);
  if (item.examples.length < 3) item.examples.push({ source, target });
  pairs.set(key, item);
}

const phraseTotals = new Map();
for (const item of pairs.values()) phraseTotals.set(item.phrase, (phraseTotals.get(item.phrase) || 0) + item.occurrences);
const candidates = [...pairs.values()].map(item => {
  const transitionPrecision = item.occurrences / phraseTotals.get(item.phrase);
  const maxDocumentShare = Math.max(...item.documentCounts.values()) / item.occurrences;
  return ({
  id: `wnc-${item.phrase.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${item.reword.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  phrase: item.phrase,
  proposedReword: item.reword,
  evidence: { occurrences: item.occurrences, documents: item.documents.size, transitionPrecision, maxDocumentShare, examples: item.examples },
  eligible: item.occurrences >= 3 && item.documents.size >= 2 && maxDocumentShare <= 0.5,
  sources: ['wiki-neutrality-corpus'],
  status: 'candidate'
  });
}).sort((a, b) => b.evidence.occurrences - a.evidence.occurrences);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, candidates.map(item => JSON.stringify(item)).join('\n') + '\n');
console.log(`Mined ${candidates.length} candidates; ${candidates.filter(item => item.eligible).length} passed evidence gates`);
