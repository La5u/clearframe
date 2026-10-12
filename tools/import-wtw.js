#!/usr/bin/env node
// Turn the "Words to watch" boxes of Wikipedia's Manual of Style
// (CC BY-SA 4.0) into review candidates. The guideline targets wording, not
// sides, but each candidate still needs review for false positives in news
// text, and contentious labels need a mirror like any other side-taking term.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assertSourcesAllowed, loadSourceRegistry } from './source-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'wikipedia-words-to-watch';
const registry = loadSourceRegistry(ROOT);
assertSourcesAllowed([SOURCE], registry, 'rule-mining');
const input = path.join(ROOT, 'research', 'raw', registry.get(SOURCE).archive);
const output = process.argv[2] || path.join(ROOT, 'research', 'reports', 'wtw-candidates.jsonl');

// Section heading -> proposed ClearFrame type. Sections about dates, places,
// and obituary style concern encyclopedic precision, not persuasion.
const SECTION_TYPES = {
  'Puffery': 'hype',
  'Contentious labels': 'loaded-framing',
  'Unsupported attributions': 'unsourced',
  'Expressions of doubt': 'distancing',
  'Editorializing': 'loaded-framing',
  'Synonyms for said': 'distancing',
  'Euphemisms': 'euphemism',
  'Clichés and idioms': 'idiom',
};

const text = fs.readFileSync(input, 'utf8');
const records = [];
for (const section of text.split(/\n(?===+[^=])/)) {
  const heading = section.match(/^=+\s*(?:<span[^>]*><\/span>\s*)*(.+?)\s*=+/)?.[1].replace(/''/g, '').trim();
  const type = heading && SECTION_TYPES[heading];
  if (!type) continue;
  const box = section.match(/Words to watch: \{\{strong\|([\s\S]*?)&nbsp;/)?.[1];
  if (!box) continue;
  const items = box.replace(/\{\{nobreak\|([^}]*)\}\}/g, '$1').replace(/\{\{var\|([^}]*)\}\}/g, '$1').replace(/''/g, '')
    .split(',').map(item => item.trim()).filter(item => item && !/^[-\w]+-$|^-\w+$/.test(item));
  for (const phrase of items) {
    records.push({ id: `wtw-${phrase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, phrase: phrase.toLowerCase(), section: heading, proposedType: type, source: SOURCE, status: 'candidate' });
  }
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
console.log(`wrote ${records.length} candidates from ${Object.keys(SECTION_TYPES).length} sections to ${path.relative(ROOT, output)}`);
