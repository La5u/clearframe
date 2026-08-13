#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { parseCsv } from '../src/core/term-utils.js';
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

assertSourcesAllowed(['open-english-wordnet'], registry, 'normalization');
const wordnetMembers = spawnSync('unzip', ['-Z1', path.join(RAW, 'english-wordnet-2025-json.zip')], { encoding: 'utf8' }).stdout
  .split(/\r?\n/).filter(name => /^entries-[^.]+\.json$/.test(name));
write('open-english-wordnet', wordnetMembers.flatMap(member => {
  const entries = JSON.parse(unzip('english-wordnet-2025-json.zip', member, 20 * 1024 * 1024));
  return Object.entries(entries).flatMap(([lemma, byPartOfSpeech]) => Object.entries(byPartOfSpeech).map(([partOfSpeech, value]) => ({
    lemma,
    partOfSpeech,
    senses: (value.sense || []).map(sense => sense.synset),
    source: 'open-english-wordnet'
  })));
}));

assertSourcesAllowed(['emobank'], registry, 'normalization');
const emoRows = parseCsv(unzip('emobank.zip', '*/corpus/emobank.csv'));
const emoHeader = emoRows.shift();
write('emobank', emoRows.filter(row => row.length >= emoHeader.length).map(row => {
  const item = Object.fromEntries(emoHeader.map((key, index) => [key, row[index]]));
  return { id: item.id, text: item.text, split: item.split, vad: { valence: Number(item.V), arousal: Number(item.A), dominance: Number(item.D) }, source: 'emobank' };
}));

assertSourcesAllowed(['magpie-idioms'], registry, 'normalization');
const magpie = unzip('magpie-idioms.zip', '*/MAGPIE_filtered_split_typebased.jsonl');
write('magpie-idioms', magpie.split(/\r?\n/).filter(Boolean).map(line => {
  const item = JSON.parse(line);
  return { id: item.id, documentId: item.document_id, expression: item.idiom, label: item.label, confidence: item.confidence, context: item.context, offsets: item.offsets, split: item.split, source: 'magpie-idioms' };
}));

assertSourcesAllowed(['semeval-propaganda-2020'], registry, 'normalization');
const propagandaDir = path.join(ROOT, 'research', 'cache', 'extracted', 'propaganda');
fs.mkdirSync(propagandaDir, { recursive: true });
const tar = spawnSync('tar', ['-xzf', path.join(RAW, 'semeval-propaganda-2020.tgz'), '-C', propagandaDir]);
if (tar.status !== 0) throw new Error('Could not extract SemEval propaganda corpus');
const labelDir = path.join(propagandaDir, 'datasets', 'train-labels-task2-technique-classification');
const articleDir = path.join(propagandaDir, 'datasets', 'train-articles');
const articleCache = new Map();
write('semeval-propaganda-2020', fs.readdirSync(labelDir).filter(file => file.endsWith('.labels')).flatMap(file => {
  const documentId = file.match(/article(\d+)/)?.[1];
  if (!documentId) return [];
  if (!articleCache.has(documentId)) articleCache.set(documentId, fs.readFileSync(path.join(articleDir, `article${documentId}.txt`), 'utf8'));
  const text = articleCache.get(documentId);
  return fs.readFileSync(path.join(labelDir, file), 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    const [, technique, start, end] = line.split('\t');
    return { id: `${documentId}-${index}`, documentId, text, span: text.slice(Number(start), Number(end)), start: Number(start), end: Number(end), labels: [technique], source: 'semeval-propaganda-2020' };
  });
}));

assertSourcesAllowed(['webis-clickbait-2022'], registry, 'normalization');
const clickbait = ['train.jsonl', 'validation.jsonl'].flatMap(member => unzip('webis-clickbait-22.zip', member, 40 * 1024 * 1024).split(/\r?\n/).filter(Boolean).map(line => {
  const item = JSON.parse(line);
  return { id: item.uuid, platform: item.postPlatform, headline: (item.postText || []).join(' '), spoiler: item.spoiler, spoilerType: item.tags?.[0], source: 'webis-clickbait-2022', split: member.startsWith('train') ? 'train' : 'validation' };
}));
write('webis-clickbait-2022', clickbait);
