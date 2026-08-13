#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { assertSourcesAllowed, loadSourceRegistry } from './source-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertSourcesAllowed(['wiki-neutrality-corpus'], loadSourceRegistry(ROOT), 'evaluation');
const archive = path.join(ROOT, 'research', 'raw', 'bias_data.zip');
const result = spawnSync('unzip', ['-p', archive, 'bias_data/WNC/biased.word.test'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
if (result.status !== 0) throw new Error(result.stderr || 'Unable to read WNC test split');
const records = result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 600).map((row, index) => {
  const columns = row.split('\t');
  return { id: `wnc-holdout-${index + 1}`, domain: 'wikipedia', sourceText: columns[3], targetText: columns[4], detect: true, source: 'wiki-neutrality-corpus', split: 'test' };
});
const out = path.join(ROOT, 'research', 'cache', 'benchmark', 'wnc-holdout.jsonl');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
console.log(`Wrote ${records.length} held-out examples`);
