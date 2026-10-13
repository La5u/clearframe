#!/usr/bin/env node
// Load the built extension in headless Chromium, visit live news front pages
// across the political spectrum, and record exactly what ClearFrame
// highlights: counts by type, top terms, and every match with its sentence,
// for false-positive and balance review. Results go to research/reports/.
import fs from 'fs';
import path from 'path';
import { delay, launchExtensionBrowser } from './chromium.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITES = [
  ['left', 'https://www.theguardian.com/us'],
  ['left', 'https://www.huffpost.com/'],
  ['left', 'https://www.motherjones.com/'],
  ['left', 'https://www.vox.com/'],
  ['centre', 'https://www.bbc.com/news'],
  ['centre', 'https://www.npr.org/sections/news/'],
  ['centre', 'https://www.axios.com/'],
  ['centre', 'https://thehill.com/'],
  ['right', 'https://www.foxnews.com/'],
  ['right', 'https://nypost.com/'],
  ['right', 'https://www.washingtonexaminer.com/'],
  ['right', 'https://www.dailywire.com/'],
  ['tabloid', 'https://www.dailymail.co.uk/home/index.html'],
];
const urls = process.argv.slice(2).length ? process.argv.slice(2).map(url => ['custom', url]) : SITES;
// Every highlighted range with its type and surrounding text. CSS highlights
// are the extension's rendered output, so this is what a reader would see.
const COLLECT = `(() => {
  const out = [];
  for (const [name, highlight] of CSS.highlights || []) {
    if (!name.startsWith('clearframe-') || name === 'clearframe-selected') continue;
    const base = name.replace(/^clearframe-/, '').replace(/-underline$/, '');
    const low = base.endsWith('-low'), type = low ? base.slice(0, -4) : base;
    for (const range of highlight) {
      const node = range.startContainer, text = node.nodeValue || '';
      const parent = node.parentElement;
      out.push({ type, low, match: range.toString(), context: text.slice(Math.max(0, range.startOffset - 90), range.endOffset + 90).replace(/\\s+/g, ' ').trim(),
        headline: !!parent?.closest('h1,h2,h3,h4,[class*=headline],[class*=title]'), link: !!parent?.closest('a') });
    }
  }
  const styles = document.getElementById('cf-highlight-styles')?.textContent || '';
  return { styles, title: document.title, url: location.href, textLength: (document.body?.innerText || '').length, badge: out.length, matches: out };
})()`;

async function visit(cdp, url) {
  cdp.events.length = 0;
  const started = Date.now();
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) { await delay(500); if (await cdp.evaluate(`document.readyState === 'complete' && !!document.body`).catch(() => false)) break; }
  // Scroll to trigger lazy-loaded sections, then let the mutation observer settle.
  for (let y = 0; y < 4; y++) { await cdp.evaluate(`scrollBy(0, innerHeight)`).catch(() => {}); await delay(700); }
  await cdp.evaluate(`scrollTo(0, 0)`).catch(() => {});
  await delay(2500);
  const result = await cdp.evaluate(COLLECT);
  const errors = cdp.events.filter(event => event.method === 'Runtime.exceptionThrown')
    .map(event => event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text)
    .filter(text => /clearframe|content\.js|chrome-extension/i.test(text || ''));
  return { ...result, seconds: (Date.now() - started) / 1000, extensionErrors: errors };
}

const report = [];
const { cdp, close } = await launchExtensionBrowser({ windowSize: '1366,900' });
try {
  for (const [leaning, url] of urls) {
    try {
      // Some pages never settle (endless challenges or streams); bound each visit.
      const result = await Promise.race([visit(cdp, url), delay(75000).then(() => { throw new Error('timed out after 75s'); })]);
      const byType = {}, byTerm = {};
      for (const match of result.matches) {
        byType[match.type] = (byType[match.type] || 0) + 1;
        const term = match.match.toLowerCase();
        byTerm[term] = (byTerm[term] || 0) + 1;
      }
      report.push({ leaning, ...result, byType, topTerms: Object.entries(byTerm).sort((a, b) => b[1] - a[1]).slice(0, 15) });
      const blocked = result.textLength < 2000 ? ' (likely blocked)' : '';
      console.log(`${leaning.padEnd(7)} ${url.padEnd(45)} ${String(result.matches.length).padStart(4)} matches / ${String(result.textLength).padStart(6)} chars${blocked}; errors: ${result.extensionErrors.length}`);
    } catch (error) {
      report.push({ leaning, url, error: error.message });
      console.log(`${leaning.padEnd(7)} ${url}: ERROR ${error.message}`);
    }
  }
} finally {
  await close();
}
const out = path.join(ROOT, 'research', 'reports', 'news-report.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`report: ${path.relative(ROOT, out)}`);
