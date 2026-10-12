#!/usr/bin/env node
// Mine politically balanced candidates from recent Congressional Record floor
// speech (see tools/download-crec.js). Phrases are scored with the log-odds
// ratio with an informative Dirichlet prior (Monroe, Colaresi and Quinn 2008),
// which treats both parties identically. Like GST, this measures who says a
// phrase, not whether it is loaded: output is review material only, in equal
// batches per party.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assertSourcesAllowed, loadSourceRegistry } from './source-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'crec-govinfo';
const RAW = path.join(ROOT, 'research', 'raw', 'crec');
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const PER_PARTY = Number(args['per-party'] || 200);
const MIN_COUNT = Number(args['min-count'] || 20);
const MIN_SPEAKERS = Number(args['min-speakers'] || 8);
const MIN_YEARS = Number(args['min-years'] || 3);
const output = args.out || path.join(ROOT, 'research', 'reports', 'crec-candidates.jsonl');
assertSourcesAllowed([SOURCE], loadSourceRegistry(ROOT), 'rule-mining');

const STOPWORDS = new Set(`a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves also us let lets get got going go one two three many much may might must shall said says say`.split(/\s+/));
// Floor procedure and chamber vocabulary is partisan only because of who holds the gavel.
const PROCEDURAL = new Set(`gentleman gentlemen gentlewoman gentlelady yield yields yielded yielding speaker madam mr ms mrs president colleague colleagues floor bill bills chair chairman chairwoman committee committees subcommittee senator senators senate house representative representatives ranking minority majority leader clerk unanimous consent quorum motion resolution resolutions cloture vote votes voted voting rule rules reserve reserves balance time minutes minute pro tempore act legislation legislative recognize recognized rise thank thanks distinguished friend friends today tonight week year years district state states member members congress congressional caucus whip debate pending table tabled previous question order ordered adjourn printed record section title h r s hr res con intervening laid reconsider notified extraneous revise remarks subsection subparagraph paragraph clause striking inserting enactment pursuant amended nomination nominations nominee session following adding divided congressman congresswoman`.split(/\s+/));
const PRESIDENTS = ['obama', 'trump', 'biden', 'bush', 'clinton', 'harris', 'pence', 'vance'];

const surnames = new Set(PRESIDENTS);
const counts = { D: new Map(), R: new Map() };
const speakers = { D: new Map(), R: new Map() };
const years = new Map();
const examples = new Map();
const totals = { D: 0, R: 0 };

function bump(map, key, value = 1) {
  map.set(key, (map.get(key) || 0) + value);
}

function addSet(map, key, value) {
  const set = map.get(key) || new Set();
  set.add(value); map.set(key, set);
}

const HEADER = /^ {2}((?:Mr|Ms|Mrs|Miss|Dr)\. [A-Z][A-Za-z'\- ]*?|The [A-Z][A-Za-z ]+?)\. /;
function splitTurns(text, granuleSpeakers) {
  const byName = new Map(granuleSpeakers.map(speaker => [speaker.parsedName.toUpperCase(), speaker]));
  const turns = [];
  let current = null;
  for (const line of text.split('\n')) {
    const header = line.match(HEADER);
    if (header) {
      current = { speaker: byName.get(header[1].toUpperCase()) || null, lines: [line.slice(header[0].length)] };
      turns.push(current);
    } else if (current && !/^\s*\[/.test(line)) {
      current.lines.push(line);
    }
  }
  return turns.filter(turn => turn.speaker).map(turn => ({ speaker: turn.speaker, text: turn.lines.join(' ') }));
}

const files = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter(file => file.endsWith('.jsonl')) : [];
if (!files.length) throw new Error(`No downloaded speech in ${RAW}; run node tools/download-crec.js`);
const granules = files.flatMap(file => fs.readFileSync(path.join(RAW, file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)));
for (const granule of granules) {
  for (const speaker of granule.speakers) {
    for (const part of speaker.parsedName.replace(/^(?:Mr|Ms|Mrs|Miss|Dr)\.\s+/, '').replace(/\s+of\s+.*/, '').toLowerCase().split(/[\s-]+/)) surnames.add(part);
  }
}

for (const granule of granules) {
  const year = granule.packageId.slice(5, 9);
  for (const { speaker, text } of splitTurns(granule.text, granule.speakers)) {
    const party = speaker.party;
    if (party !== 'D' && party !== 'R') continue;
    for (const sentence of text.replace(/--/g, ', ').split(/[.!?;:()"]+/)) {
      const original = sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
      const words = original.map(word => word.toLowerCase());
      totals[party] += words.length;
      // A surname is a name only when capitalized mid-sentence ("Mr. Hunt"), not in "witch hunt".
      const isName = original.map((word, i) => i > 0 && surnames.has(words[i]) && /^[A-Z]/.test(word));
      for (let n = 1; n <= 4; n++) {
        for (let i = 0; i + n <= words.length; i++) {
          const gram = words.slice(i, i + n);
          if (STOPWORDS.has(gram[0]) || STOPWORDS.has(gram[n - 1])) continue;
          if (gram.some(word => PROCEDURAL.has(word)) || isName.slice(i, i + n).some(Boolean)) continue;
          if (n === 1 && gram[0].length < 4) continue;
          const phrase = gram.join(' ');
          bump(counts[party], phrase);
          addSet(speakers[party], phrase, speaker.bioGuideId);
          addSet(years, phrase, year);
          if (!examples.has(phrase)) {
            const at = sentence.toLowerCase().indexOf(phrase);
            if (at >= 0) examples.set(phrase, sentence.slice(Math.max(0, at - 80), at + phrase.length + 80).replace(/\s+/g, ' ').trim());
          }
        }
      }
    }
  }
}

// Log-odds ratio with an informative Dirichlet prior; positive z = Republican.
const ALPHA0 = 1000;
const all = new Set([...counts.D.keys(), ...counts.R.keys()]);
const grand = totals.D + totals.R;
const scored = [];
for (const phrase of all) {
  const d = counts.D.get(phrase) || 0, r = counts.R.get(phrase) || 0;
  if (d + r < MIN_COUNT || (years.get(phrase)?.size || 0) < MIN_YEARS) continue;
  const alpha = ALPHA0 * (d + r) / grand;
  const delta = Math.log((r + alpha) / (totals.R + ALPHA0 - r - alpha)) - Math.log((d + alpha) / (totals.D + ALPHA0 - d - alpha));
  const z = delta / Math.sqrt(1 / (r + alpha) + 1 / (d + alpha));
  const party = z > 0 ? 'R' : 'D';
  if ((speakers[party].get(phrase)?.size || 0) < MIN_SPEAKERS) continue;
  scored.push({ phrase, party, z, counts: { D: d, R: r }, speakers: { D: speakers.D.get(phrase)?.size || 0, R: speakers.R.get(phrase)?.size || 0 }, years: [...years.get(phrase)].sort() });
}

// --lookup=a|b reports specific phrases (e.g. a proposed mirror) without the batch thresholds.
if (args.lookup) {
  for (const phrase of args.lookup.toLowerCase().split('|')) {
    const d = counts.D.get(phrase) || 0, r = counts.R.get(phrase) || 0;
    const alpha = ALPHA0 * Math.max(d + r, 1) / grand;
    const delta = Math.log((r + alpha) / (totals.R + ALPHA0 - r - alpha)) - Math.log((d + alpha) / (totals.D + ALPHA0 - d - alpha));
    const z = delta / Math.sqrt(1 / (r + alpha) + 1 / (d + alpha));
    console.log(`${phrase}: D=${d} R=${r} z=${z.toFixed(2)} speakers D=${speakers.D.get(phrase)?.size || 0} R=${speakers.R.get(phrase)?.size || 0} years=${[...(years.get(phrase) || [])].sort().join(",")}`);
  }
  process.exit(0);
}

// Drop n-grams contained in a stronger same-party n-gram with nearly the same count.
const byPhrase = new Map(scored.map(item => [item.phrase, item]));
const kept = scored.filter(item => ![...byPhrase.values()].some(other => other !== item && other.party === item.party &&
  other.phrase.includes(item.phrase) && Math.abs(other.z) >= Math.abs(item.z) * 0.9 && (other.counts.D + other.counts.R) >= 0.8 * (item.counts.D + item.counts.R)));

const records = [];
for (const party of ['R', 'D']) {
  kept.filter(item => item.party === party).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, PER_PARTY)
    .forEach((item, rank) => records.push({ id: `crec-${party}-${item.phrase.replace(/\s+/g, '-')}`, ...item, z: Number(item.z.toFixed(2)), rank: rank + 1, example: examples.get(item.phrase), source: SOURCE, status: 'candidate' }));
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
console.log(`${granules.length} granules; words D=${totals.D} R=${totals.R}; ${scored.length} scored, ${kept.length} after nesting; wrote ${records.length} to ${path.relative(ROOT, output)}`);
