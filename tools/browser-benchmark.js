#!/usr/bin/env node
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { loadTerms } from '../src/core/term-utils.js';
import { approvedRuleTerms } from './rule-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runs = Math.max(1, Number(process.argv[2] || 5));
const expectedPhrase = 'clearframe phrase 4999';
const index = loadTerms(path.join(ROOT, 'data', 'terms'), approvedRuleTerms(ROOT));
index.termsById[expectedPhrase] = { phrase: expectedPhrase, type: 'loaded' };
(index.buckets.c ||= []).push({ phraseNorm: expectedPhrase, termId: expectedPhrase, length: expectedPhrase.length });
const payload = JSON.stringify({ termsById: index.termsById, buckets: index.buckets, regexTerms: index.regexTerms });
const waiters = new Map();

const page = `<!doctype html><meta charset="utf-8"><script type="module">
import { buildMatcher, findMatches } from '/src/core/matcher.js';
const index = ${payload};
const text = ('ordinary page text '.repeat(5000) + ' ${expectedPhrase} ').repeat(2);
const start = performance.now(), matcher = buildMatcher(index), buildMs = performance.now() - start, samples = [];
let matches = 0;
for (let i = 0; i < ${runs}; i++) { const at = performance.now(); matches = findMatches(matcher, text, index.termsById, index.regexTerms).length; samples.push(performance.now() - at); }
fetch('/result?browser=' + new URLSearchParams(location.search).get('browser'), { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ rules: Object.keys(index.termsById).length, characters: text.length, matches, buildMs: +buildMs.toFixed(2), matchMs: +(samples.reduce((a,b)=>a+b,0)/samples.length).toFixed(2) }) });
</script>`;

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/bench.html')) { res.writeHead(200, {'content-type':'text/html'}); res.end(page); return; }
  if (req.url?.startsWith('/src/core/')) {
    const file = path.resolve(ROOT, req.url.slice(1));
    if (file.startsWith(path.join(ROOT, 'src', 'core')) && fs.existsSync(file)) { res.writeHead(200, {'content-type':'text/javascript'}); res.end(fs.readFileSync(file)); return; }
  }
  if (req.url?.startsWith('/result?') && req.method === 'POST') {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { waiters.get(new URL(req.url, 'http://localhost').searchParams.get('browser'))?.(JSON.parse(body)); res.writeHead(204); res.end(); });
    return;
  }
  res.writeHead(404); res.end();
});

function runBrowser(name, executable, url) {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), `clearframe-${name}-`));
    const args = name === 'chromium'
      ? ['--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, `${url}?browser=${name}`]
      : ['--headless', '--profile', profile, `${url}?browser=${name}`];
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '', settled = false;
    child.stderr.on('data', data => { error += data; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${name} timed out: ${error.trim()}`)); }, 30000);
    waiters.set(name, result => { settled = true; clearTimeout(timer); child.kill('SIGTERM'); resolve({ browser: name, ...result }); });
    child.on('close', code => {
      waiters.delete(name); fs.rmSync(profile, { recursive: true, force: true });
      if (!settled) { clearTimeout(timer); reject(new Error(`${name} exited ${code}: ${error.trim()}`)); }
    });
  });
}

const browsers = [['chromium', '/usr/bin/chromium'], ['firefox', '/usr/bin/firefox']].filter(([, file]) => fs.existsSync(file));
server.listen(0, '127.0.0.1', async () => {
  try {
    if (!browsers.length) throw new Error('No Chromium or Firefox executable found');
    const url = `http://127.0.0.1:${server.address().port}/bench.html`;
    const results = await Promise.all(browsers.map(([name, executable]) => runBrowser(name, executable, url)));
    for (const result of results) { if (result.matches !== 2) throw new Error(`${result.browser}: expected 2 matches, got ${result.matches}`); console.log(JSON.stringify(result)); }
  } finally { server.close(); }
});
