#!/usr/bin/env node
// Mine politically balanced candidates from the Gentzkow-Shapiro-Taddy
// partisan-phrase release. Partisanship measures which party says a phrase,
// not whether it is loaded, so output is review material only: equal batches
// per party, ranked within each party so the more talkative side cannot
// dominate selection.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { assertSourcesAllowed, loadSourceRegistry } from './source-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'gst-congress-partisan-phrases';
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const FROM = Number(args.from || 104), TO = Number(args.to || 114);
const PER_PARTY = Number(args['per-party'] || 150);
const MIN_SESSIONS = Number(args['min-sessions'] || 3);
const MIN_AGREEMENT = Number(args['min-agreement'] || 0.8);
const output = args.out || path.join(ROOT, 'research', 'reports', 'gst-candidates.jsonl');

const registry = loadSourceRegistry(ROOT);
assertSourcesAllowed([SOURCE], registry, 'rule-mining');
const archive = path.join(ROOT, 'research', 'raw', registry.get(SOURCE).archive);
if (!fs.existsSync(archive)) throw new Error(`Missing ${archive}; run npm run data:download -- ${SOURCE}`);

const phrases = new Map();
for (let session = FROM; session <= TO; session++) {
  const member = `partisan_phrases_${String(session).padStart(3, '0')}.txt`;
  const result = spawnSync('unzip', ['-p', archive, member], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${member}: ${result.stderr}`);
  for (const line of result.stdout.split(/\r?\n/).slice(1)) {
    const [stem, value] = line.split('|');
    const score = Number(value);
    if (!stem || !Number.isFinite(score)) continue;
    const item = phrases.get(stem) || { stem, scores: [] };
    item.scores.push({ session, score });
    phrases.set(stem, item);
  }
}

const candidates = [...phrases.values()].map(({ stem, scores }) => {
  const mean = scores.reduce((sum, item) => sum + item.score, 0) / scores.length;
  const party = mean > 0 ? 'R' : 'D';
  const agreeing = scores.filter(item => Math.sign(item.score) === Math.sign(mean)).length;
  return { stem, party, sessions: scores.length, signAgreement: agreeing / scores.length, meanPartisanship: mean, firstSession: scores[0].session, lastSession: scores.at(-1).session };
}).filter(item => item.sessions >= MIN_SESSIONS && item.signAgreement >= MIN_AGREEMENT);

const records = [];
for (const party of ['R', 'D']) {
  const side = candidates.filter(item => item.party === party);
  // Normalize by the party's median strength so rankings are comparable across sides.
  const strengths = side.map(item => Math.abs(item.meanPartisanship)).sort((a, b) => a - b);
  const median = strengths[Math.floor(strengths.length / 2)] || 1;
  side.map(item => ({ ...item, relativeStrength: Math.abs(item.meanPartisanship) / median }))
    .sort((a, b) => b.relativeStrength * b.sessions - a.relativeStrength * a.sessions)
    .slice(0, PER_PARTY)
    .forEach((item, rank) => records.push({ id: `gst-${party}-${item.stem.replace(/\s+/g, '-')}`, ...item, rank: rank + 1, source: SOURCE, status: 'candidate' }));
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
console.log(`sessions ${FROM}-${TO}: ${phrases.size} phrases, ${candidates.length} stable; wrote ${records.length} (${PER_PARTY} per party) to ${path.relative(ROOT, output)}`);
