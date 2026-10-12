import fs from 'fs';
import path from 'path';
import { assertSourcesAllowed, assertSourcesShippable, loadSourceRegistry } from './source-policy.js';

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${file}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
  });
}

// Missing evidence must fail the gate, not slip past an undefined comparison.
function atLeast(value, min) {
  return Number.isFinite(value) && value >= min;
}

function mirroredTerms(root) {
  const { pairs = [] } = JSON.parse(fs.readFileSync(path.join(root, 'data', 'mirror-pairs.json'), 'utf8'));
  return new Set(pairs.flatMap(pair => [pair.a.term, pair.b.term]));
}

export function loadRuleRecords(root, purpose = 'rule-compilation') {
  const registry = loadSourceRegistry(root);
  const dir = path.join(root, 'data', 'rules');
  const records = fs.readdirSync(dir).filter(file => file.endsWith('.jsonl')).sort()
    .flatMap(file => readJsonl(path.join(dir, file)));
  const ids = new Set();
  for (const record of records) {
    if (!record.id || !record.phrase || !record.type || !record.status || !Array.isArray(record.sources) || !record.sources.length) {
      throw new Error(`Invalid rule record ${record.id || '<unknown>'}`);
    }
    if (ids.has(record.id)) throw new Error(`Duplicate rule id "${record.id}"`);
    ids.add(record.id);
    assertSourcesAllowed(record.sources, registry, purpose);
    // Corroborating sources informed review but did not derive the rule; they
    // must still be registered and never evaluation-only.
    if (record.corroboratedBy !== undefined && !Array.isArray(record.corroboratedBy)) {
      throw new Error(`Rule "${record.id}" corroboratedBy must be an array`);
    }
    assertSourcesAllowed(record.corroboratedBy || [], registry, purpose);
    if (record.status === 'approved') {
      assertSourcesShippable(record.sources, registry, record.id);
    }
    if (record.status === 'approved' && record.sources.includes('wiki-neutrality-corpus')) {
      const evidence = record.evidence || {};
      if (!atLeast(evidence.occurrences, 3) || !atLeast(evidence.documents, 2) || !(Number.isFinite(evidence.maxDocumentShare) && evidence.maxDocumentShare <= 0.5)) {
        throw new Error(`Approved WNC rule "${record.id}" does not meet its source-specific evidence gates`);
      }
    }
    if (record.status === 'approved' && record.sources.includes('magpie-idioms')) {
      const evidence = record.evidence || {};
      if (!atLeast(evidence.idiomaticOccurrences, 3) || !atLeast(evidence.documents, 2) || !(Number.isFinite(evidence.idiomaticShare) && evidence.idiomaticShare > 0.5)) {
        throw new Error(`Approved MAGPIE rule "${record.id}" lacks majority idiomatic evidence`);
      }
    }
    if (record.status === 'approved' && record.sources.includes('gst-congress-partisan-phrases')) {
      const evidence = record.evidence || {};
      if (!atLeast(evidence.sessions, 3) || !(Number.isFinite(evidence.signAgreement) && evidence.signAgreement >= 0.8)) {
        throw new Error(`Approved GST rule "${record.id}" does not meet its source-specific evidence gates`);
      }
    }
    if (record.status === 'approved' && record.sources.includes('crec-govinfo')) {
      const evidence = record.evidence || {};
      if (!atLeast(evidence.speakers, 8) || !atLeast(evidence.years?.length, 3)) {
        throw new Error(`Approved CREC rule "${record.id}" does not meet its source-specific evidence gates`);
      }
    }
    // Partisanship sources are one-sided by definition, so their rules ship
    // only as half of a tested mirror pair.
    if (record.status === 'approved' && record.sources.some(id => registry.get(id)?.requiresMirror) && !mirroredTerms(root).has(record.phrase)) {
      throw new Error(`Approved rule "${record.id}" is not part of a pair in data/mirror-pairs.json`);
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
