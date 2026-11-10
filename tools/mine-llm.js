#!/usr/bin/env node
// Offline rule mining with an LLM ("Terra") as the reader. The shipped extension
// stays rule-based; this only PROPOSES candidate rules (status "candidate") for
// the owner to approve. Stages, each resumable (Terra answers are cached on disk):
//   corpus     fetch public RSS/Atom feeds (titles + summaries) -> research/raw/llm-mining/corpus.jsonl
//   baseline   what the current analyzer already detects in the corpus
//   propose    Terra marks missed persuasive wording        [--pilot] [--batch=40] [--limit=N] [--effort=medium] [--parallel=4]
//   aggregate  group proposals by rule phrase, drop covered ones, apply the proposal gates
//   verify     Terra judges up to 12 real occurrences per candidate; precision, confidence, drafted exceptions
//   output     data/rules/llm-mined.jsonl + research/reports/llm-mining-review.md (with the gold dry-run)
//   all        every stage in order
// Corpus text is third-party: it stays in git-ignored research/raw and research/cache and never ships.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { loadTerms, stemVariants } from '../src/core/term-utils.js';
import { normalize } from '../src/core/matcher.js';
import { createAnalyzer } from '../src/core/analyze.js';
import { normalizeSettings } from '../src/core/settings-utils.js';
import { pastTenseWord, pluralizeWord, ingWord } from '../src/core/stemmer.js';
import { approvedRuleTerms, loadRuleRecords, readJsonl, candidateConfidence, uniqueRecordIds } from './rule-utils.js';
import { assertSourcesAllowed, loadSourceRegistry } from './source-policy.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = 'llm-assisted-corpus-mining';
const RAW = path.join(ROOT, 'research', 'raw', 'llm-mining');
const CACHE = path.join(ROOT, 'research', 'cache', 'llm-mining');
const REPORT = path.join(ROOT, 'research', 'reports', 'llm-mining-review.md');
const OUT = path.join(ROOT, 'data', 'rules', 'llm-mined.jsonl');
const UA = 'Mozilla/5.0 (compatible; feed-reader)';
const [command = 'help', ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const num = (name, fallback) => Number(args[name] ?? fallback);
const LABELS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'type-labels.json'), 'utf8')).types;
const TYPES = Object.keys(LABELS);
// Structural or off-limits for a phrase list: caps are detected by shape, quotes by punctuation.
const PROPOSABLE = TYPES.filter(type => !['all-caps', 'quote'].includes(type));
const MIN_PROPOSALS = 3, MIN_OUTLETS = 2, SAMPLE = 12;

const sha = text => crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); };
const writeJsonl = (file, rows) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n'); };
const tally = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);
const top = map => [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
const flat = text => text.replace(/\s+/g, ' ');
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(list, seed) { const random = rng(seed), out = [...list]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }

// ---------- analyzers ----------
const ALL_TYPES = Object.fromEntries(TYPES.map(type => [type, true]));
const SETTINGS = normalizeSettings({ types: ALL_TYPES, sensitivity: 'all' });
const contextOf = item => ({ headline: item.kind === 'headline', pageContext: 'publication' });
function existingIndex() { return loadTerms(path.join(ROOT, 'data', 'terms'), approvedRuleTerms(ROOT)); }
// An index holding only the given candidate terms (and their exceptions), for finding their occurrences.
function isolatedIndex(terms) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-empty-'));
  try { return loadTerms(dir, terms); } finally { fs.rmdirSync(dir); }
}
const detect = (analyzer, item) => analyzer.analyze(item.text, contextOf(item), SETTINGS).entries.map(entry => ({ start: entry.start, end: entry.end, text: entry.wording, rule: entry.terms.map(term => term.phrase).join(' + '), type: entry.term.type, confidence: entry.term.confidence || 'high' }));

// ---------- Terra ----------
let stopped = false;
const usageFile = path.join(CACHE, 'usage.json');
function countCall(kind) { const usage = readJson(usageFile, {}); usage[kind] = (usage[kind] || 0) + 1; writeJson(usageFile, usage); }
function runTerra(prompt, effort) {
  return new Promise(resolve => {
    const child = spawn('terra', ['-e', effort, prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 25 * 60 * 1000);
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', error => { clearTimeout(timer); resolve({ code: 1, out, err: String(error) }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}
function parseJson(text) {
  const body = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  return JSON.parse(start >= 0 ? body.slice(start, end + 1) : body);
}
// One Terra question with JSON validation and one re-ask. Returns null on a quota stop or two bad answers.
async function ask(kind, prompt, validate, effort) {
  let note = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (stopped) return null;
    const { code, out, err } = await runTerra(prompt + note, effort);
    countCall(kind);
    if (code === 75 || /usage limit/i.test(err)) { stopped = true; return null; }
    if (code !== 0) { console.error(`terra exit ${code}: ${err.slice(0, 200)}`); note = ''; continue; }
    try { const parsed = parseJson(out); validate(parsed); return { raw: out, parsed }; }
    catch (error) { note = `\n\nYour previous answer could not be used (${error.message}). Answer again with ONLY the JSON object in the format above, no commentary.`; }
  }
  console.error(`${kind}: no valid answer after a re-ask`);
  return null;
}
async function pool(jobs, size, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => { while (next < jobs.length && !stopped) await work(jobs[next++]); }));
}
function quotaStop(command) {
  console.error(`\nTerra usage limit reached (exit 75). Cached answers are kept. After the quota resets, resume with:\n  npm run mine:llm -- ${command}\nDone batches are skipped.`);
  process.exitCode = 75;
}

// ---------- 1. corpus ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', ndash: '–', mdash: '—' };
const decode = text => text.replace(/&#x([0-9a-f]+);|&#(\d+);|&([a-z]+);/gi, (all, hex, dec, name) => hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : ENTITIES[name.toLowerCase()] ?? all);
const clean = text => flat(decode(decode(text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]*>/g, ' '))).trim();
const tag = (xml, names) => { for (const name of names) { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml); if (m) return clean(m[1]); } return ''; };
function parseFeed(xml) {
  return [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map(([block]) => ({ title: tag(block, ['title']), summary: tag(block, ['description', 'summary', 'media:description']) }));
}
function trimSummary(summary, title) {
  if (/appeared first on|^https?:|^comments?$/i.test(summary) || summary.length < 40 || summary.toLowerCase().startsWith(title.toLowerCase().slice(0, 30))) return '';
  if (summary.length <= 400) return summary;
  const cut = summary.slice(0, 400), stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '));
  return stop > 120 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '…');
}
async function fetchFeed(url, file) {
  if (fs.existsSync(file) && !args.refresh) return fs.readFileSync(file, 'utf8');
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(25000), redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  fs.writeFileSync(file, text);
  return text;
}
async function buildCorpus() {
  const { outlets } = readJson(path.join(ROOT, 'research', 'llm-feeds.json'));
  fs.mkdirSync(path.join(RAW, 'feeds'), { recursive: true });
  const jobs = outlets.flatMap(o => o.feeds.map(([section, url]) => ({ ...o, section, url })));
  const failed = [], found = [];
  await pool(jobs, 6, async job => {
    const file = path.join(RAW, 'feeds', `${job.outlet}-${job.section}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.xml');
    try {
      const entries = parseFeed(await fetchFeed(job.url, file));
      if (!entries.length) throw new Error('no items');
      for (const { title, summary } of entries) {
        const base = { outlet: job.outlet, lean: job.lean, section: job.section };
        if (title.split(' ').length >= 4 && title.length <= 260) found.push({ ...base, kind: 'headline', text: title });
        const body = trimSummary(summary, title);
        if (body) found.push({ ...base, kind: 'summary', text: body });
      }
    } catch (error) { failed.push(`${job.outlet}/${job.section}: ${error.message}`); }
  });
  const seen = new Set(), unique = [];
  for (const item of shuffle(found, 7)) {
    const key = item.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!seen.has(key)) { seen.add(key); unique.push(item); }
  }
  // Largest per-outlet quota that keeps every outlet <= 14% of the corpus and the corpus <= max.
  const max = num('max', 4200), byOutlet = Map.groupBy(unique, item => item.outlet);
  let cap = Math.max(...[...byOutlet.values()].map(list => list.length)), total = 0;
  for (; cap > 1; cap--) { total = [...byOutlet.values()].reduce((sum, list) => sum + Math.min(list.length, cap), 0); if (cap <= 0.14 * total && total <= max) break; }
  const picked = shuffle([...byOutlet.values()].flatMap(list => list.slice(0, cap)), 11).map((item, i) => ({ id: `c${String(i + 1).padStart(4, '0')}`, ...item }));
  writeJsonl(path.join(RAW, 'corpus.jsonl'), picked);
  const count = key => top(picked.reduce((map, item) => (tally(map, item[key]), map), new Map()));
  const report = { total: picked.length, outlets: count('outlet'), lean: count('lean'), kind: count('kind'), failed, feedsOk: jobs.length - failed.length, feedsTried: jobs.length };
  writeJson(path.join(CACHE, 'corpus-report.json'), report);
  console.log(`corpus: ${picked.length} texts, ${report.outlets.length} outlets, ${report.feedsOk}/${report.feedsTried} feeds ok`);
  console.log('  outlets:', report.outlets.map(([name, n]) => `${name} ${n} (${(100 * n / picked.length).toFixed(1)}%)`).join(', '));
  console.log('  lean:', report.lean.map(([name, n]) => `${name} ${n}`).join(', '), '| kind:', report.kind.map(([name, n]) => `${name} ${n}`).join(', '));
  if (failed.length) console.log(`  failed feeds (${failed.length}):\n    ${failed.join('\n    ')}`);
}
const loadCorpus = () => { const corpus = readJsonl(path.join(RAW, 'corpus.jsonl')); if (!corpus.length) throw new Error('No corpus; run: npm run mine:llm -- corpus'); return corpus; };

// ---------- 2. baseline ----------
function buildBaseline() {
  const analyzer = createAnalyzer({ index: existingIndex() }), corpus = loadCorpus();
  const rows = corpus.map(item => ({ id: item.id, spans: detect(analyzer, item) }));
  writeJsonl(path.join(CACHE, 'baseline.jsonl'), rows);
  const hit = rows.filter(row => row.spans.length).length;
  console.log(`baseline: ${rows.reduce((sum, row) => sum + row.spans.length, 0)} detections in ${hit}/${corpus.length} texts (all types enabled, sensitivity all)`);
}
const loadBaseline = () => new Map(readJsonl(path.join(CACHE, 'baseline.jsonl')).map(row => [row.id, row.spans]));

// ---------- 3. propose ----------
const mark = (text, spans) => { let out = '', cursor = 0; for (const span of [...spans].sort((a, b) => a.start - b.start)) { if (span.start < cursor) continue; out += text.slice(cursor, span.start) + '⟦' + text.slice(span.start, span.end) + '⟧'; cursor = span.end; } return out + text.slice(cursor); };
const TYPE_LIST = PROPOSABLE.map(type => `- ${type}: ${LABELS[type].term} (${LABELS[type].plain}). ${LABELS[type].effect}`).join('\n');
function proposePrompt(items, baseline) {
  return `You are an experienced English teacher with a media-literacy class. We are building a word list for a close-reading tool: it highlights wording in news headlines and short summaries that a careful reader would point to as a DELIBERATE persuasive, emotive, evaluative or loaded choice, so that students can practise explaining what the wording does. It shows wording to examine, not verdicts about truth or politics.

Below are numbered texts (headlines or summaries) from English-language news outlets. Wording the tool ALREADY finds is wrapped in ⟦ ⟧. Concentrate on what the tool MISSES.

Task A: for each text, list every wording that is NOT already inside ⟦ ⟧ and that you would point to as a deliberate persuasive or loaded choice. The biggest gaps are: tabloid puffery and intensifiers, clickbait formulas and teasers, vague sourcing ("sources say", "fans think", "experts fear"), colloquialisms and slang in news register, evaluative verbs/adjectives/nouns where a neutral word exists, dramatic or violent metaphors, euphemisms, emotive labels, loaded framing.
Do NOT mark: routine reporting verbs (said, told, announced, confirmed), attribution to a named person or body, names, titles, places, plain factual descriptions, numbers, subject-matter words that simply name what the story is about (e.g. "murder" in a murder-trial report), or a quotation reproduced in full. Prefer short wordings (1-4 words). If a text has nothing, return an empty list for it.
For each wording return:
- "wording": copied EXACTLY, character for character, from the text (it may touch but must not be entirely inside a ⟦ ⟧).
- "rule": a proposed rule phrase: the lemma or base form, lower case, 1-4 words, generalisable (no names, no numbers), e.g. "slammed" -> "slam", "stunning looks" -> "stunning".
- "pos": "verb", "noun", "adjective", "adverb" or "phrase" (fixed expression) for the rule phrase.
- "type": exactly one of the device types below, or "new:<short-kebab-name>" if none fits (then also give "definition": one line).
- "scope": "general" if the wording is persuasive/loaded in most contexts, "here" if only in this text.
- "partisan": true only if it frames a political side, party, group or contested political position (a term the other side would word differently), otherwise false.
- "neutral": a faithful neutral alternative for the rule phrase in its base form, or null if there is none.
Task B: list in "false_positives" any ⟦ ⟧ wording that you think is NOT a persuasive/loaded choice in that text (copy it exactly, add a short "why").

Device types:
${TYPE_LIST}

Answer with ONLY one JSON object, no commentary:
{"items":[{"id":"c0001","proposals":[{"wording":"...","rule":"...","pos":"verb","type":"hype","scope":"general","partisan":false,"neutral":"..."}],"false_positives":[{"wording":"...","why":"..."}]}]}
Include every id given, in order.

Texts:
${items.map(item => `${item.id} [${item.kind}] ${mark(item.text, baseline.get(item.id) || [])}`).join('\n')}`;
}
async function propose() {
  const batch = args.pilot ? 30 : num('batch', 40), effort = args.effort || 'medium', corpus = loadCorpus(), baseline = loadBaseline();
  if (!baseline.size) throw new Error('No baseline; run: npm run mine:llm -- baseline');
  const dir = path.join(CACHE, 'propose');
  fs.mkdirSync(dir, { recursive: true });
  let jobs = [];
  for (let i = 0; i * batch < corpus.length; i++) jobs.push({ file: path.join(dir, `b${batch}-${String(i).padStart(3, '0')}.json`), items: corpus.slice(i * batch, (i + 1) * batch) });
  const total = jobs.length;
  jobs = jobs.filter(job => !fs.existsSync(job.file));
  if (args.pilot) jobs = jobs.slice(0, 1);
  else if (args.limit) jobs = jobs.slice(0, num('limit'));
  console.log(`propose: ${total} batches of ${batch}, ${total - jobs.length} cached or out of range -> running ${jobs.length} (parallel ${Math.min(num('parallel', 4), 4)}, effort ${effort})`);
  let done = 0;
  await pool(jobs, Math.min(num('parallel', 4), 4), async job => {
    const ids = job.items.map(item => item.id);
    const result = await ask('propose', proposePrompt(job.items, baseline), parsed => {
      if (!Array.isArray(parsed.items)) throw new Error('missing "items" array');
      const got = new Set(parsed.items.map(item => item.id));
      if (ids.some(id => !got.has(id))) throw new Error('some ids are missing');
    }, effort);
    if (!result) return;
    writeJson(job.file, { ids, raw: result.raw, parsed: result.parsed });
    console.log(`  batch ${path.basename(job.file)} done (${++done}/${jobs.length})`);
  });
  if (stopped) quotaStop('propose');
}

// ---------- 4. aggregate ----------
const cleanRule = rule => normalize(String(rule || '').replace(/[“”"‘’]/g, c => (c === '’' || c === '‘' ? "'" : '')).replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''));
const slugify = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function loadProposals(corpus, baseline) {
  const byId = new Map(corpus.map(item => [item.id, item])), proposals = [], falsePositives = [], stats = { raw: 0, notExact: 0, insideMarked: 0, badRule: 0, badType: 0 };
  for (const file of fs.existsSync(path.join(CACHE, 'propose')) ? fs.readdirSync(path.join(CACHE, 'propose')).sort() : []) {
    for (const entry of readJson(path.join(CACHE, 'propose', file)).parsed.items) {
      const item = byId.get(entry.id);
      if (!item) continue;
      const spans = baseline.get(item.id) || [], lower = flat(item.text).toLowerCase();
      for (const p of entry.proposals || []) {
        stats.raw++;
        const wording = flat(String(p.wording || '')).trim().toLowerCase(), rule = cleanRule(p.rule);
        const at = wording ? lower.indexOf(wording) : -1;
        if (at < 0) { stats.notExact++; continue; }
        // Offsets in the collapsed copy only matter for the overlap test; texts rarely contain odd whitespace.
        if (spans.some(span => span.start <= at && span.end >= at + wording.length)) { stats.insideMarked++; continue; }
        if (!/^[a-z][a-z0-9'’ -]{1,38}$/.test(rule) || rule.split(' ').length > 4) { stats.badRule++; continue; }
        const type = String(p.type || '').toLowerCase().trim();
        if (!PROPOSABLE.includes(type) && !/^new:[a-z][a-z0-9-]{2,30}$/.test(type)) { stats.badType++; continue; }
        proposals.push({ item, rule, wording, type, pos: String(p.pos || ''), scope: p.scope === 'here' ? 'here' : 'general', partisan: p.partisan === true, neutral: p.neutral ? cleanRule(p.neutral) : '', definition: type.startsWith('new:') ? String(p.definition || '') : '' });
      }
      for (const f of entry.false_positives || []) {
        const wording = flat(String(f.wording || '')).trim().toLowerCase();
        const span = spans.find(s => flat(s.text).toLowerCase() === wording);
        if (span) falsePositives.push({ item, rule: span.rule, type: span.type, wording, why: String(f.why || '') });
      }
    }
  }
  return { proposals, falsePositives, stats };
}
// Does an existing rule (CSV, JSONL, alias, stem variant, regex) already cover the whole phrase?
function coverage(analyzer, index, phrase, wordings) {
  if (index.termsById[phrase]) return { full: true, by: phrase };
  for (const text of [phrase, ...wordings]) for (const headline of [false, true]) {
    const spans = analyzer.analyze(text, { headline, pageContext: 'publication' }, SETTINGS).entries;
    const hit = spans.find(entry => entry.start <= 0 && entry.end >= text.length);
    if (hit) return { full: true, by: hit.terms.map(term => term.phrase).join(' + ') };
    if (spans.length) return { full: false, by: spans.map(entry => entry.terms.map(term => term.phrase).join(' + ')).join(', ') };
  }
  return null;
}
const plurality = map => { const [[value, n] = ['', 0]] = top(map); return { value, n }; };
function aggregate() {
  const corpus = loadCorpus(), baseline = loadBaseline(), { proposals, falsePositives, stats } = loadProposals(corpus, baseline);
  if (!proposals.length) throw new Error('No proposals cached; run the propose stage first');
  const groups = new Map();
  for (const p of proposals) {
    const g = groups.get(p.rule) || { rule: p.rule, items: new Map(), types: new Map(), scopes: new Map(), pos: new Map(), wordings: new Map(), neutrals: new Map(), partisan: 0, definitions: new Map() };
    if (!g.items.has(p.item.id)) {
      g.items.set(p.item.id, p.item);
      tally(g.types, p.type); tally(g.scopes, p.scope); tally(g.wordings, p.wording); if (p.pos) tally(g.pos, p.pos); if (p.neutral) tally(g.neutrals, p.neutral);
      if (p.partisan) g.partisan++;
      if (p.definition) tally(g.definitions, p.definition);
    }
    groups.set(p.rule, g);
  }
  // Fold inflected keys ("slams") into their base ("slam") when the base's part of speech says so.
  for (const base of [...groups.values()]) {
    const pos = plurality(base.pos).value;
    if (!['noun', 'verb', 'adjective'].includes(pos) || base.rule.includes(' ')) continue;
    for (const variant of stemVariants(base.rule, pos)) {
      const other = groups.get(variant);
      if (!other || other === base) continue;
      for (const [id, item] of other.items) if (!base.items.has(id)) base.items.set(id, item);
      for (const field of ['types', 'scopes', 'pos', 'wordings', 'neutrals', 'definitions']) for (const [k, n] of other[field]) tally(base[field], k, n);
      base.partisan += other.partisan; groups.delete(variant);
    }
  }
  const index = existingIndex(), analyzer = createAnalyzer({ index });
  const newTypes = new Map(), dropped = { covered: 0, thin: 0 }, candidates = [], coveredList = [];
  for (const g of groups.values()) {
    const n = g.items.size, outlets = new Set([...g.items.values()].map(item => item.outlet));
    for (const [type, count] of g.types) if (type.startsWith('new:')) {
      const t = newTypes.get(type) || { proposals: 0, rules: new Map(), definitions: new Map(), examples: [] };
      t.proposals += count; tally(t.rules, g.rule, count);
      for (const [d, c] of g.definitions) tally(t.definitions, d, c);
      if (t.examples.length < 4) t.examples.push(`${g.rule}: ${[...g.items.values()][0].text}`);
      newTypes.set(type, t);
    }
    if (n < MIN_PROPOSALS || outlets.size < MIN_OUTLETS) { dropped.thin++; continue; }
    const cover = coverage(analyzer, index, g.rule, [...g.wordings.keys()].slice(0, 3));
    if (cover?.full) { dropped.covered++; coveredList.push([g.rule, n, cover.by]); continue; }
    const type = plurality(g.types);
    candidates.push({
      rule: g.rule, proposals: n, outlets: outlets.size, outletNames: [...outlets], leans: top([...g.items.values()].reduce((map, item) => (tally(map, item.lean), map), new Map())),
      type: type.value, typeAgreement: +(type.n / n).toFixed(2), types: top(g.types), pos: plurality(g.pos).value, generalShare: +((g.scopes.get('general') || 0) / n).toFixed(2),
      partisan: g.partisan / n >= 0.34, wordings: top(g.wordings).slice(0, 6).map(([w]) => w), neutral: plurality(g.neutrals).value, definition: plurality(g.definitions).value,
      overlaps: cover?.by || '', itemIds: [...g.items.keys()],
    });
  }
  candidates.sort((a, b) => b.proposals - a.proposals || b.outlets - a.outlets || a.rule.localeCompare(b.rule));
  const fp = new Map();
  for (const f of falsePositives) { const g = fp.get(f.rule) || { rule: f.rule, type: f.type, count: 0, items: new Set(), examples: [] }; g.count++; g.items.add(f.item.id); if (g.examples.length < 3) g.examples.push({ text: f.item.text, wording: f.wording, why: f.why }); fp.set(f.rule, g); }
  const result = {
    stats: { ...stats, kept: proposals.length, distinctRules: groups.size, ...dropped, candidates: candidates.length, partisan: candidates.filter(c => c.partisan).length },
    candidates, coveredList: coveredList.sort((a, b) => b[1] - a[1]).slice(0, 40),
    newTypes: top(new Map([...newTypes].map(([k, v]) => [k, v.proposals]))).map(([name]) => ({ name, ...newTypes.get(name), rules: top(newTypes.get(name).rules).slice(0, 8), definitions: top(newTypes.get(name).definitions).slice(0, 2) })),
    falsePositives: [...fp.values()].map(g => ({ ...g, items: g.items.size })).sort((a, b) => b.count - a.count),
  };
  writeJson(path.join(CACHE, 'aggregate.json'), result);
  console.log(`aggregate: ${stats.raw} raw proposals -> ${proposals.length} usable (${stats.notExact} not exact text, ${stats.insideMarked} inside marked spans, ${stats.badRule} bad rule, ${stats.badType} bad type); ${groups.size} distinct rule phrases`);
  console.log(`  gate >=${MIN_PROPOSALS} proposals from >=${MIN_OUTLETS} outlets: ${dropped.thin} dropped thin, ${dropped.covered} already covered by an existing rule -> ${candidates.length} candidates (${result.stats.partisan} partisan, listed only)`);
}

// ---------- 5. verify ----------
function termFor(c) {
  const single = !c.rule.includes(' '), pos = c.pos;
  const term = { phrase: c.rule, type: c.type, neutral: '', aliases: [], stemType: '', regex: '', remove: false, confidence: 'high', contexts: [] };
  if ((single || pos === 'noun') && ['noun', 'verb', 'adjective'].includes(pos) && (single || pos === 'noun')) term.stemType = pos;
  else if (pos === 'verb') { const [first, ...others] = c.rule.split(' '); term.aliases = [pastTenseWord(first), pluralizeWord(first), ingWord(first)].map(form => [form, ...others].join(' ')); }
  if (c.contexts) term.contexts = c.contexts;
  return term;
}
function findOccurrences(c, corpus) {
  const term = termFor(c), index = isolatedIndex([term]), analyzer = createAnalyzer({ index }), found = [];
  for (const item of corpus) for (const match of analyzer.findLexicalMatches(item.text, contextOf(item), SETTINGS)) found.push({ item, start: match.start, end: match.end });
  return { found, analyzer, index };
}
function sampleOccurrences(found, seed) {
  const byOutlet = Map.groupBy(shuffle(found, seed), occ => occ.item.outlet), lists = shuffle([...byOutlet.values()], seed + 1), out = [];
  for (let round = 0; out.length < SAMPLE && lists.some(list => list.length > round); round++) for (const list of lists) if (list[round] && out.length < SAMPLE) out.push(list[round]);
  return out;
}
const context = occ => { const t = occ.item.text; return `${t.slice(0, occ.start)}«${t.slice(occ.start, occ.end)}»${t.slice(occ.end)}`; };
function verifyPrompt(batch) {
  return `Here is a quality check on proposed highlighting rules for a close-reading tool used in English lessons. Each rule below is a word or phrase. For every numbered occurrence (the phrase sits between « »), decide how it is used IN THAT SENTENCE:
- "loaded": the writer's choice of this wording is persuasive, emotive, evaluative, hyped, vaguely sourced, slangy or otherwise slanted, so a teacher could ask students what it does and what a plainer word would change.
- "neutral": a literal, technical, routine or name-like use (a title, a product, a standard term, a sport's own vocabulary, a straight description) where the wording does no persuasive work.
Judge each occurrence on its own; do not assume all uses of a phrase behave alike. For "neutral" say in "cue" the one to three words in the sentence that make it neutral (e.g. the following or preceding word, or the sense); for "loaded" use an empty cue.

${batch.map(c => `Rule: "${c.rule}"\n${c.sample.map((occ, i) => `${i + 1}. [${occ.item.kind}] ${context(occ)}`).join('\n')}`).join('\n\n')}

Answer with ONLY one JSON object, no commentary:
{"results":[{"rule":"...","judgments":[{"n":1,"verdict":"loaded","cue":""}]}]}
Give one judgment per occurrence, every rule in order.`;
}
function draftException(c, judgments) {
  const side = (occ, dir) => { const t = flat(occ.item.text), s = flat(occ.item.text.slice(0, occ.start)).length, e = s + flat(occ.item.text.slice(occ.start, occ.end)).length; const m = dir === 'after' ? /^\s*([\p{L}'-]+)/u.exec(t.slice(e)) : /([\p{L}'-]+)\s+$/u.exec(t.slice(0, s)); return m?.[1].toLowerCase(); };
  const loaded = c.judged.filter(j => j.verdict === 'loaded'), neutral = c.judged.filter(j => j.verdict === 'neutral');
  const clauses = [];
  for (const dir of ['after', 'before']) {
    const bad = new Set(loaded.map(j => side(j.occ, dir)));
    const counts = new Map();
    for (const j of neutral) { const w = side(j.occ, dir); if (w && w.length > 1 && !bad.has(w)) tally(counts, w); }
    const words = [...counts].filter(([, n]) => n >= 2).map(([w]) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (words.length) clauses.push(dir === 'after' ? { after: `/^\\s*(?:${words.join('|')})\\b/iu` } : { before: `/\\b(?:${words.join('|')})\\s+$/iu` });
  }
  return clauses.length ? { note: `Neutral uses seen in the mining sample: ${neutral.slice(0, 3).map(j => j.cue).filter(Boolean).join('; ') || 'see cues'}`, unless: clauses } : null;
}
function rescore(c, analyzer, index, exception) {
  if (!exception) return null;
  index.exceptions.terms[normalize(c.rule)] = exception.unless;
  const kept = c.judged.filter(j => analyzer.findLexicalMatches(j.occ.item.text, contextOf(j.occ.item), SETTINGS).some(m => m.start === j.occ.start));
  delete index.exceptions.terms[normalize(c.rule)];
  const loaded = kept.filter(j => j.verdict === 'loaded').length;
  return { kept: kept.length, loaded, droppedLoaded: c.judged.filter(j => j.verdict === 'loaded').length - loaded };
}
function assess(c) {
  const judged = c.judged.length, loaded = c.judged.filter(j => j.verdict === 'loaded').length, precision = judged ? loaded / judged : 0;
  c.precision = +precision.toFixed(3);
  let n = judged, p = precision, exception = null;
  const draft = precision < 0.9 && c.draft;
  if (draft) {
    const after = c.rescored;
    if (after && after.kept >= 5 && after.droppedLoaded === 0 && after.loaded / after.kept > precision) { exception = draft; n = after.kept; p = after.loaded / after.kept; c.precisionWithException = +p.toFixed(3); c.judgedWithException = n; }
  }
  const headlines = c.judged.filter(j => j.occ.item.kind === 'headline'), hp = headlines.filter(j => j.verdict === 'loaded').length / (headlines.length || 1);
  let confidence = candidateConfidence(p, n, headlines.length, hp);
  if (c.generalShare < 0.5 && confidence === 'high') confidence = 'medium';
  const reason = confidence === 'reject' ? `precision ${loaded}/${judged}=${(precision * 100).toFixed(0)}%${draft ? ' (exception did not rescue)' : ''}` : '';
  return { confidence, exception: confidence === 'reject' ? null : exception, reason, contexts: confidence === 'contextual' ? ['headline'] : undefined };
}
async function verify() {
  const corpus = loadCorpus(), agg = readJson(path.join(CACHE, 'aggregate.json'));
  if (!agg) throw new Error('No aggregate; run: npm run mine:llm -- aggregate');
  const index = existingIndex(), prepared = [], skipped = [];
  for (const cand of agg.candidates.filter(c => !c.partisan)) {
    const c = { ...cand }, term = termFor(c);
    try { loadTerms(path.join(ROOT, 'data', 'terms'), [...approvedRuleTerms(ROOT), term]); } catch (error) { skipped.push([c.rule, error.message]); continue; }
    const { found, analyzer, index: iso } = findOccurrences(c, corpus);
    c.occurrences = found.length; c.sample = sampleOccurrences(found, sha(c.rule).charCodeAt(0));
    if (!c.sample.length) { skipped.push([c.rule, 'no occurrences']); continue; }
    c.analyzer = analyzer; c.iso = iso; prepared.push(c);
  }
  void index;
  const perCall = num('verify-batch', 8), dir = path.join(CACHE, 'verify');
  fs.mkdirSync(dir, { recursive: true });
  const jobs = [];
  for (let i = 0; i < prepared.length; i += perCall) { const batch = prepared.slice(i, i + perCall); jobs.push({ batch, file: path.join(dir, `v-${sha(JSON.stringify(batch.map(c => [c.rule, c.sample.map(o => o.item.id + o.start)])))}.json`) }); }
  const todo = args.limit ? jobs.filter(j => !fs.existsSync(j.file)).slice(0, num('limit')) : jobs.filter(j => !fs.existsSync(j.file));
  console.log(`verify: ${prepared.length} candidates, ${jobs.length} calls (${jobs.length - todo.length} cached/out of range -> running ${todo.length})`);
  await pool(todo, Math.min(num('parallel', 4), 4), async job => {
    const result = await ask('verify', verifyPrompt(job.batch), parsed => {
      if (!Array.isArray(parsed.results) || parsed.results.length !== job.batch.length) throw new Error('"results" must hold one entry per rule');
      parsed.results.forEach((r, i) => { if (!Array.isArray(r.judgments) || r.judgments.length !== job.batch[i].sample.length) throw new Error(`rule ${i + 1} needs ${job.batch[i].sample.length} judgments`); });
    }, args.effort || 'medium');
    if (result) { writeJson(job.file, { raw: result.raw, parsed: result.parsed }); console.log(`  ${path.basename(job.file)} done`); }
  });
  if (stopped) quotaStop('verify');
  const verified = [], rejected = [];
  for (const job of jobs) {
    if (!fs.existsSync(job.file)) continue;
    job.batch.forEach((c, i) => {
      const judgments = readJson(job.file).parsed.results[i].judgments;
      c.judged = c.sample.map((occ, k) => ({ occ, verdict: judgments[k]?.verdict === 'loaded' ? 'loaded' : 'neutral', cue: String(judgments[k]?.cue || '').toLowerCase() }));
      c.draft = draftException(c, c.judged);
      c.rescored = rescore(c, c.analyzer, c.iso, c.draft);
      Object.assign(c, assess(c));
      const view = { ...c, sample: undefined, analyzer: undefined, iso: undefined, rescored: undefined, draft: undefined, judged: c.judged.map(j => ({ verdict: j.verdict, cue: j.cue, outlet: j.occ.item.outlet, kind: j.occ.item.kind, context: context(j.occ) })) };
      (c.confidence === 'reject' ? rejected : verified).push(view);
    });
  }
  writeJson(path.join(CACHE, 'verified.json'), { verified, rejected, skipped, partisan: agg.candidates.filter(c => c.partisan) });
  const byConf = verified.reduce((map, c) => (tally(map, c.confidence), map), new Map());
  console.log(`verify: ${verified.length} accepted (${top(byConf).map(([k, n]) => `${k} ${n}`).join(', ')}), ${rejected.length} rejected, ${skipped.length} skipped (${skipped.slice(0, 3).map(s => s.join(': ').slice(0, 80)).join(' | ')})`);
  if (jobs.length > todo.length + jobs.filter(j => fs.existsSync(j.file)).length - todo.length) console.log('  (some batches are still missing; re-run to finish)');
}

// ---------- 6. output ----------
function toRecord(c) {
  const word = c.rule.includes(' ') ? c.rule.split(' ')[0] : c.rule;
  const record = { id: `llm-${slugify(c.rule)}`, phrase: c.rule, type: c.type, status: 'candidate', confidence: c.confidence };
  const term = termFor(c);
  if (term.aliases.length) record.aliases = term.aliases;
  if (term.stemType) record.stemType = term.stemType;
  if (c.contexts) record.contexts = c.contexts;
  record.evidence = { proposals: c.proposals, outlets: c.outlets, occurrences: c.occurrences, judged: c.judged.length, precision: c.precision, typeAgreement: c.typeAgreement };
  if (c.precisionWithException !== undefined) Object.assign(record.evidence, { precisionWithException: c.precisionWithException, judgedWithException: c.judgedWithException });
  if (c.exception) record.exception = c.exception;
  if (c.neutral && c.neutral !== word + 'x') record.reword = { text: c.neutral, effect: 'suggested by the miner, unreviewed', reviewed: false };
  record.sources = [SOURCE];
  record.notes = 'LLM-assisted mining of public headlines; a candidate until approved. Move any "exception" into data/terms/exceptions.json when approving.';
  return record;
}
const dry = (sensitivity, withCandidates) => {
  // File-backed output also works in sandboxes that cannot create child-process pipes.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-gold-')), file = path.join(dir, 'output');
  const fd = fs.openSync(file, 'w');
  try {
    const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'evaluate-gold.js'), `--sensitivity=${sensitivity}`, '--top=0', ...(withCandidates ? ['--with-candidates=medium'] : [])], { stdio: ['ignore', fd, fd] });
    const result = fs.readFileSync(file, 'utf8');
    if (run.error || run.status !== 0) throw new Error(`evaluate-gold failed: ${run.error?.message || result.slice(0, 200)}`);
    return result.split('\n').filter(line => /^(Scored|Any type|Same type|\s+overlap|\s+exact)/.test(line)).join('\n');
  } finally {
    fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
function output() {
  const data = readJson(path.join(CACHE, 'verified.json')), agg = readJson(path.join(CACHE, 'aggregate.json'));
  if (!data) throw new Error('No verified candidates; run: npm run mine:llm -- verify');
  const registry = loadSourceRegistry(ROOT);
  assertSourcesAllowed([SOURCE], registry, 'rule-mining');
  const order = { high: 0, medium: 1, contextual: 2 };
  // Cached judgments may predate the minimum sample sizes used by verify.
  const accepted = data.verified.map(c => {
    const n = c.judgedWithException ?? c.judged.length;
    const confidence = c.confidence === 'high' && n < 8 ? (n >= 6 ? 'medium' : 'contextual')
      : c.confidence === 'medium' && n < 6 ? 'contextual' : c.confidence;
    return { ...c, confidence, ...(confidence === 'contextual' ? { contexts: ['headline'] } : {}) };
  }).sort((a, b) => order[a.confidence] - order[b.confidence] || b.precision - a.precision || b.proposals - a.proposals);
  // Records the owner already changed (approved or otherwise) are kept as they are.
  const kept = readJsonl(OUT).filter(record => record.status !== 'candidate');
  const records = accepted.filter(c => !kept.some(record => record.phrase === c.rule)).map(toRecord);
  uniqueRecordIds(records, kept.map(record => record.id));
  writeJsonl(OUT, [...kept, ...records]);
  loadRuleRecords(ROOT);
  const corpusReport = readJson(path.join(CACHE, 'corpus-report.json'), {}), usage = readJson(usageFile, {});
  const pct = c => `${c.judged.filter(j => j.verdict === 'loaded').length}/${c.judged.length}`;
  const lines = [`# LLM mining review sheet`, '', `Generated by \`npm run mine:llm\`. Candidates are in \`data/rules/llm-mined.jsonl\` with \`status: "candidate"\`; nothing here ships until you change a record to \`approved\` (and review its reword). ${accepted.length} candidates; Terra calls so far: ${Object.entries(usage).map(([k, n]) => `${k} ${n}`).join(', ')}.`, '',
    `Corpus: ${corpusReport.total} texts from ${corpusReport.outlets?.length} outlets; lean ${corpusReport.lean?.map(([k, n]) => `${k} ${n}`).join(', ')}. Precision is measured on up to ${SAMPLE} corpus occurrences per phrase judged by Terra in a separate call; it is an estimate, not a gold score.`, ''];
  lines.push('## Expected effect on the provisional gold set (candidates at medium or high confidence treated as approved, in memory only)', '', '```');
  for (const sensitivity of ['standard', 'all']) lines.push(`sensitivity ${sensitivity}, BEFORE:`, dry(sensitivity, false), `sensitivity ${sensitivity}, AFTER:`, dry(sensitivity, true), '');
  lines.push('```', '');
  const byType = Map.groupBy(accepted, c => c.type);
  lines.push('## Candidates by device type', '');
  for (const [type, list] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`### ${type} (${list.length})`, '');
    for (const c of list.sort((a, b) => order[a.confidence] - order[b.confidence] || b.proposals - a.proposals)) {
      const ex = c.judged.filter(j => j.verdict === 'loaded').slice(0, 2).map(j => '"' + j.context.replace(/\s+/g, ' ').slice(0, 150) + '"').join(' / ');
      lines.push(`- **${c.rule}** [${c.confidence}] precision ${pct(c)}${c.precisionWithException !== undefined ? ` (${(c.precisionWithException * 100).toFixed(0)}% with exception)` : ''}; ${c.proposals} proposals, ${c.outlets} outlets, ${c.occurrences} occurrences, type agreement ${(c.typeAgreement * 100).toFixed(0)}%${c.neutral ? `; neutral: ${c.neutral}` : ''}${c.overlaps ? `; overlaps existing: ${c.overlaps}` : ''}`);
      lines.push(`  - ${ex}`);
      if (c.exception) lines.push(`  - exception draft: \`${JSON.stringify({ [c.rule]: { unless: c.exception.unless } })}\``);
    }
    lines.push('');
  }
  lines.push('## Suggested new device types', '');
  for (const t of agg.newTypes.slice(0, 15)) lines.push(`- **${t.name}**: ${t.proposals} proposals. ${t.definitions[0]?.[0] || ''}`, `  - phrases: ${t.rules.map(([r, n]) => `${r} (${n})`).join(', ')}`, `  - e.g. ${t.examples.slice(0, 2).map(e => `"${e.slice(0, 160)}"`).join(' / ')}`);
  lines.push('', '## Partisan terms (need a mirror counterpart in data/mirror-pairs.json; not accepted)', '');
  for (const c of data.partisan) lines.push(`- **${c.rule}** (${c.proposals} proposals, ${c.outlets} outlets; proposers' lean: ${c.leans.map(([k, n]) => `${k} ${n}`).join(', ')}; type ${c.type}): ${c.wordings.slice(0, 3).join(', ')}`);
  lines.push('', '## Existing rules Terra repeatedly flagged as false positives', '');
  for (const f of agg.falsePositives.slice(0, 40)) lines.push(`- **${f.rule}** (${f.type}): flagged ${f.count} times in ${f.items} texts. ${f.examples.slice(0, 2).map(e => `"${e.text.slice(0, 130)}" [${e.wording}]${e.why ? ` - ${e.why.slice(0, 80)}` : ''}`).join(' / ')}`);
  lines.push('', '## Rejected candidates (for reference)', '');
  for (const c of data.rejected.slice(0, 80)) lines.push(`- ${c.rule} [${c.type}]: ${c.reason}${c.judged.find(j => j.verdict === 'neutral') ? `; neutral e.g. "${c.judged.find(j => j.verdict === 'neutral').context.slice(0, 110)}"` : ''}`);
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, lines.join('\n') + '\n');
  console.log(`output: wrote ${accepted.length} candidate records to ${path.relative(ROOT, OUT)} and the review sheet to ${path.relative(ROOT, REPORT)}`);
}


const stages = { corpus: buildCorpus, baseline: buildBaseline, propose, aggregate, verify, output };
if (command === 'all') { for (const name of Object.keys(stages)) { await stages[name](); if (stopped) break; } }
else if (stages[command]) await stages[command]();
else console.log(`usage: npm run mine:llm -- <${[...Object.keys(stages), 'all'].join('|')}> [--pilot] [--batch=40] [--limit=N] [--effort=medium] [--parallel=4] [--refresh] [--max=4200]`);
