#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadSourceRegistry } from './source-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'research', 'raw');
const includeEvaluation = process.argv.includes('--include-evaluation');
const refreshLock = process.argv.includes('--refresh-lock');
const requested = new Set(process.argv.slice(2).filter(value => !value.startsWith('-')));
const registry = loadSourceRegistry(ROOT);
fs.mkdirSync(RAW_DIR, { recursive: true });

function selected(source) {
  if (requested.size && !requested.has(source.id)) return false;
  if (source.enabled === false) return false;
  return source.role !== 'evaluation-only' || includeEvaluation;
}

async function download(source) {
  const target = path.join(RAW_DIR, source.archive);
  const response = await fetch(source.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${source.id}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const digest = crypto.createHash('sha256').update(data).digest('hex');
  if (!refreshLock && source.sha256 && digest !== source.sha256) throw new Error(`${source.id}: SHA-256 mismatch`);
  if (!refreshLock && source.bytes && data.length !== source.bytes) throw new Error(`${source.id}: byte-size mismatch`);
  fs.writeFileSync(target, data);
  const receipt = {
    source: source.id,
    url: source.url,
    retrievedAt: new Date().toISOString(),
    bytes: data.length,
    sha256: digest,
    license: source.license,
  };
  fs.writeFileSync(`${target}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`${source.id}: ${(data.length / 1024 / 1024).toFixed(1)} MB`);
}

const failures = [];
for (const source of registry.values()) {
  if (!selected(source)) continue;
  try { await download(source); }
  catch (error) { failures.push(`${source.id}: ${error.message}`); }
}
if (failures.length) throw new Error(failures.join('\n'));
