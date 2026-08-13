import fs from 'fs';
import path from 'path';
import { assertSourcesAllowed, loadSourceRegistry } from './source-policy.js';

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${file}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
  });
}

export function loadRuleRecords(root, purpose = 'rule-compilation') {
  const registry = loadSourceRegistry(root);
  const dir = path.join(root, 'data', 'rules');
  const records = fs.readdirSync(dir).filter(file => file.endsWith('.jsonl')).sort()
    .flatMap(file => readJsonl(path.join(dir, file)));
  const ids = new Set();
  for (const record of records) {
    if (!record.id || !record.phrase || !record.type || !record.status || !Array.isArray(record.sources)) {
      throw new Error(`Invalid rule record ${record.id || '<unknown>'}`);
    }
    if (ids.has(record.id)) throw new Error(`Duplicate rule id "${record.id}"`);
    ids.add(record.id);
    assertSourcesAllowed(record.sources, registry, purpose);
    if (record.status === 'approved' && record.sources.includes('wiki-neutrality-corpus')) {
      const evidence = record.evidence || {};
      if (evidence.occurrences < 3 || evidence.documents < 2 || evidence.maxDocumentShare > 0.5) {
        throw new Error(`Approved WNC rule "${record.id}" does not meet its source-specific evidence gates`);
      }
    }
    if (record.status === 'approved' && record.sources.includes('magpie-idioms')) {
      const evidence = record.evidence || {};
      if (evidence.idiomaticOccurrences < 3 || evidence.documents < 2 || evidence.idiomaticShare <= 0.5) {
        throw new Error(`Approved MAGPIE rule "${record.id}" lacks majority idiomatic evidence`);
      }
    }
    if (record.reword?.text && record.status === 'approved' && record.reword.reviewed !== true) {
      throw new Error(`Approved rule "${record.id}" has an unreviewed reword`);
    }
    if (record.status === 'approved' && record.contexts !== undefined && !Array.isArray(record.contexts)) {
      throw new Error(`Approved rule "${record.id}" contexts must be an allowlist`);
    }
  }
  return records;
}

export function approvedRuleTerms(root) {
  return loadRuleRecords(root).filter(record => record.status === 'approved').map(record => ({
    phrase: record.phrase,
    type: record.type,
    neutral: record.reword?.reviewed ? record.reword.text || '' : '',
    aliases: record.aliases || [],
    stemType: record.stemType || '',
    regex: record.pattern || '',
    remove: record.remove === true,
    confidence: record.confidence || 'high',
    provenance: record.sources,
    contexts: Array.isArray(record.contexts) ? record.contexts : [],
  }));
}
