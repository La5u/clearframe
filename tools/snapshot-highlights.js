#!/usr/bin/env node
// Golden snapshot of what the built extension highlights and rewrites on the
// saved pages in tests/fixtures, in a real headless Chromium.
//   npm run snapshot          print a summary, compare nothing
//   npm run snapshot:check    exit 1 if any snapshot differs
//   npm run snapshot:update   rewrite tests/snapshots/
// Run `npm run build` first; the snapshot is of dist/.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { delay, launchExtensionBrowser } from './chromium.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const SNAPSHOTS = path.join(ROOT, 'tests', 'snapshots');
const CONTEXT = 30;
const DIFF_LIMIT = 40;
const MODES = {
  highlight: {},
  reword: { replaceTerms: true },
  remove: { removeTerms: true },
};
const args = new Set(process.argv.slice(2));
const only = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const fixtures = fs.readdirSync(FIXTURES).filter(file => file.endsWith('.html') && (!only.length || only.includes(file))).sort();

// Fixtures are stored without scripts; strip any that slip in so a saved page
// can never change its own text between runs.
function serve() {
  const server = http.createServer((request, response) => {
    const file = path.join(FIXTURES, path.basename(decodeURIComponent(new URL(request.url, 'http://x').pathname)));
    if (!file.endsWith('.html') || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
    const html = fs.readFileSync(file, 'utf8').replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Allow only the fixture server (and the extension itself); fail everything else.
function blockNetwork(cdp, origin) {
  const blocked = [];
  const onMessage = cdp.ws.onmessage;
  cdp.ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method !== 'Fetch.requestPaused') { onMessage(event); return; }
    const { requestId, request } = message.params;
    const allowed = request.url.startsWith(origin) || /^(?:chrome-extension|data|blob):/.test(request.url);
    if (!allowed) blocked.push(request.url);
    cdp.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  };
  return blocked;
}

// Runs in the page. Highlights are listed in document order with context from
// the enclosing block; text nodes are listed so rewritten text can be compared.
const COLLECT = `(() => {
  const clean = value => value.replace(/\\s+/g, ' ');
  const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,td,th,dd,dt,blockquote,figcaption,div,section,article,body';
  const textAround = range => {
    const block = range.startContainer.parentElement?.closest(BLOCK) || document.body;
    const before = document.createRange(); before.setStart(block, 0); before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange(); after.setStart(range.endContainer, range.endOffset); after.setEnd(block, block.childNodes.length);
    return [clean(before.toString()).slice(-${CONTEXT}).trimStart(), clean(after.toString()).slice(0, ${CONTEXT}).trimEnd()];
  };
  const highlights = [];
  for (const [name, highlight] of CSS.highlights) {
    if (!name.startsWith('clearframe-')) continue;
    for (const range of highlight) highlights.push({ name: name.slice(11), range });
  }
  highlights.sort((a, b) => a.range.compareBoundaryPoints(Range.START_TO_START, b.range) || a.range.compareBoundaryPoints(Range.END_TO_END, b.range) || (a.name < b.name ? -1 : 1));
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement?.closest('script,style,#cf-tooltip,#cf-suggestion')) texts.push(node.nodeValue);
  }
  return {
    highlights: highlights.map(({ name, range }) => { const [before, after] = textAround(range); return name + ' | ' + before + '[' + clean(range.toString()) + ']' + after; }),
    texts,
  };
})()`;

const SIGNATURE = `document.readyState + ':' + [...CSS.highlights].reduce((sum, [, h]) => sum + h.size, 0) + ':' + (document.body?.textContent.length || 0)`;

async function load(cdp, url) {
  await cdp.send('Page.navigate', { url });
  let last = '', stable = 0;
  // Analysis runs on a 120 ms mutation timer, so wait for several quiet polls after load.
  for (let i = 0; i < 120 && stable < 4; i++) {
    await delay(150);
    const signature = await cdp.evaluate(SIGNATURE).catch(() => '');
    stable = signature.startsWith('complete') && signature === last ? stable + 1 : 0;
    last = signature;
  }
  if (stable < 4) throw new Error(`${url} did not settle`);
  return cdp.evaluate(COLLECT);
}

// Settings live in chrome.storage.sync; write them from the content script's
// isolated world of the current page, then wait for the change to land.
async function setSettings(cdp, overrides) {
  const context = [...cdp.events].reverse().find(event => event.method === 'Runtime.executionContextCreated'
    && event.params.context.auxData?.type === 'isolated' && event.params.context.name === 'ClearFrame')?.params.context.id;
  if (!context) throw new Error('ClearFrame content script context not found');
  const settings = { replaceTerms: false, removeTerms: false, ...overrides };
  const result = await cdp.send('Runtime.evaluate', { contextId: context, awaitPromise: true, returnByValue: true,
    expression: `chrome.storage.sync.get('settings').then(({ settings }) => chrome.storage.sync.set({ settings: { ...(settings || {}), ...${JSON.stringify(settings)} } })).then(() => 'ok')` });
  if (result.result?.value !== 'ok') throw new Error(`could not write settings: ${JSON.stringify(result.exceptionDetails || result.result)}`);
}

// LCS diff of two token arrays as ['=' | '-' | '+', token] pairs. Inputs are
// a snapshot file's lines or one text node's words, so the table stays small.
function diff(a, b) {
  const width = b.length + 1, table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  }
  const out = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push(['=', a[i]]); i++; j++; }
    else if (i < a.length && (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) out.push(['-', a[i++]]);
    else out.push(['+', b[j++]]);
  }
  return out;
}

// Each rewritten stretch of a text node as `~ context[old => new]context`;
// stretches separated only by whitespace are merged.
function describeChanges(before, after) {
  const clean = value => value.replace(/\s+/g, ' ');
  const tokens = value => value.match(/\s+|\S+/g) || [];
  const hunks = [];
  let oldPos = 0, newPos = 0, hunk = null, gap = null;
  for (const [op, token] of diff(tokens(before), tokens(after))) {
    if (op === '=') {
      if (hunk && !/^\s+$/.test(token)) { hunks.push(hunk); hunk = null; }
      else if (hunk) gap ||= { oldPos, newPos };
      oldPos += token.length; newPos += token.length;
      continue;
    }
    if (hunk && gap) gap = null;
    hunk ||= { oldStart: oldPos, newStart: newPos };
    if (op === '-') oldPos += token.length; else newPos += token.length;
    hunk.oldEnd = oldPos; hunk.newEnd = newPos;
  }
  if (hunk) hunks.push(hunk);
  return hunks.map(({ oldStart, oldEnd = oldStart, newStart, newEnd = newStart }) =>
    `~ ${clean(before.slice(Math.max(0, oldStart - CONTEXT), oldStart)).trimStart()}[${clean(before.slice(oldStart, oldEnd))} => ${clean(after.slice(newStart, newEnd))}]${clean(after.slice(newEnd, newEnd + CONTEXT)).trimEnd()}`);
}

function render(fixture, mode, page, originals) {
  const lines = [`# ${fixture} mode=${mode} highlights=${page.highlights.length}`, ...page.highlights];
  if (mode === 'highlight') return lines.join('\n') + '\n';
  if (page.texts.length !== originals.length) throw new Error(`${fixture} ${mode}: ${page.texts.length} text nodes, expected ${originals.length}`);
  const changed = page.texts.filter((text, i) => text !== originals[i]).length;
  const changes = page.texts.flatMap((text, i) => text === originals[i] ? [] : describeChanges(originals[i], text));
  lines.push(`# changed text nodes=${changed}`, ...changes);
  return lines.join('\n') + '\n';
}

const diffLines = (oldText, newText) => diff(oldText.split('\n'), newText.split('\n'))
  .filter(([op]) => op !== '=').map(([op, line]) => `${op} ${line}`);

const started = Date.now();
const server = await serve();
const origin = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/`;
const { cdp, close } = await launchExtensionBrowser({ windowSize: '1280,1600' });
let failures = 0;
try {
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const blocked = blockNetwork(cdp, origin);
  const originals = new Map();
  await load(cdp, origin + fixtures[0]);
  for (const [mode, overrides] of Object.entries(MODES)) {
    await setSettings(cdp, overrides);
    await delay(300);
    let highlights = 0, changed = 0;
    for (const fixture of fixtures) {
      cdp.events.length = 0;
      const page = await load(cdp, origin + fixture);
      if (mode === 'highlight') originals.set(fixture, page.texts);
      const snapshot = render(fixture, mode, page, originals.get(fixture));
      highlights += page.highlights.length;
      changed += Number(/changed text nodes=(\d+)/.exec(snapshot)?.[1] || 0);
      const file = path.join(SNAPSHOTS, `${fixture.replace(/\.html$/, '')}.${mode}.txt`);
      if (args.has('--update')) {
        fs.mkdirSync(SNAPSHOTS, { recursive: true }); fs.writeFileSync(file, snapshot);
      } else if (args.has('--check')) {
        const stored = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        if (stored === snapshot) continue;
        failures++;
        const diff = diffLines(stored, snapshot);
        const added = diff.filter(line => line.startsWith('+')).length;
        console.log(`\n${path.relative(ROOT, file)}: ${added} added, ${diff.length - added} removed`);
        console.log(diff.slice(0, DIFF_LIMIT).join('\n') + (diff.length > DIFF_LIMIT ? `\n… ${diff.length - DIFF_LIMIT} more` : ''));
      } else if (args.has('--stdout')) {
        process.stdout.write(snapshot);
      }
    }
    console.log(`${mode}: ${fixtures.length} fixtures, ${highlights} highlights${mode === 'highlight' ? '' : `, ${changed} changed text nodes`}`);
  }
  if (blocked.length) console.log(`blocked ${blocked.length} external requests`);
} finally {
  await close();
  server.close();
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (failures) console.log(`${failures} snapshot(s) differ (${seconds}s); if intended, run npm run snapshot:update and review the git diff`);
else console.log(`${args.has('--check') ? 'snapshots match' : args.has('--update') ? 'snapshots written' : 'done'} (${seconds}s)`);
process.exitCode = failures ? 1 : 0;
