#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { assertSourcesAllowed, loadSourceRegistry } from './source-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'research', 'raw');
const OUT = path.join(ROOT, 'research', 'cache', 'normalized');
const registry = loadSourceRegistry(ROOT);
fs.mkdirSync(OUT, { recursive: true });

function unzip(archive, member, max = 200 * 1024 * 1024) {
  const result = spawnSync('unzip', ['-p', path.join(RAW, archive), member], { encoding: 'utf8', maxBuffer: max });
  if (result.status !== 0) throw new Error(`${archive}/${member}: ${result.stderr}`);
  return result.stdout;
}

function write(name, records) {
  fs.writeFileSync(path.join(OUT, `${name}.jsonl`), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
  console.log(`${name}: ${records.length}`);
}

assertSourcesAllowed(['magpie-idioms'], registry, 'normalization');
const magpie = unzip('magpie-idioms.zip', '*/MAGPIE_filtered_split_typebased.jsonl');
write('magpie-idioms', magpie.split(/\r?\n/).filter(Boolean).map(line => {
  const item = JSON.parse(line);
  return { id: item.id, documentId: item.document_id, expression: item.idiom, label: item.label, confidence: item.confidence, context: item.context, offsets: item.offsets, split: item.split, source: 'magpie-idioms' };
}));

assertSourcesAllowed(['webis-clickbait-2022'], registry, 'normalization');
const clickbait = ['train.jsonl', 'validation.jsonl'].flatMap(member => unzip('webis-clickbait-22.zip', member, 40 * 1024 * 1024).split(/\r?\n/).filter(Boolean).map(line => {
  const item = JSON.parse(line);
  return { id: item.uuid, platform: item.postPlatform, headline: (item.postText || []).join(' '), spoiler: item.spoiler, spoilerType: item.tags?.[0], source: 'webis-clickbait-2022', split: member.startsWith('train') ? 'train' : 'validation' };
}));
write('webis-clickbait-2022', clickbait);
