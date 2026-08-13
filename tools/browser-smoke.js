#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { loadTerms } from '../src/core/term-utils.js';
import { approvedRuleTerms } from './rule-utils.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const urls = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://www.reddit.com/',
  'https://www.theguardian.com/international',
  'https://apnews.com/',
  'https://www.reuters.com/world/',
  'https://www.npr.org/sections/news/',
  'https://www.dailymail.com/home/index.html',
  'https://www.aljazeera.com/',
  'https://www.bbc.com/news',
  'https://edition.cnn.com/',
  'https://arstechnica.com/',
];
const disabledTypes = new Set(['absolute', 'exaggeration', 'superlative']);
const terms = Object.entries(loadTerms(path.join(ROOT, 'data', 'terms'), approvedRuleTerms(ROOT)).termsById)
  .filter(([term, data]) => term.length >= 4 && term.length <= 50 && !disabledTypes.has(data.type) && !data.contexts?.length)
  .map(([term]) => term).sort((a, b) => b.length - a.length);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'clearframe-smoke-'));
const browser = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
  `--user-data-dir=${profile}`, `--disable-extensions-except=${path.join(ROOT, 'dist')}`,
  `--load-extension=${path.join(ROOT, 'dist')}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const browserClosed = new Promise(resolve => browser.once('close', resolve));
let browserError = '';
browser.stderr.on('data', data => { browserError += data; });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let feedbackEnabledForRun = false;
async function waitForFile(file) {
  for (let i = 0; i < 100; i++) { if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8'); await delay(100); }
  throw new Error(`Chromium did not start: ${browserError}`);
}

class Cdp {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.events = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id) { const pending = this.pending.get(message.id); this.pending.delete(message.id); message.error ? pending?.reject(new Error(message.error.message)) : pending?.resolve(message.result); }
      else this.events.push(message);
    };
    this.ws.onclose = () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Chromium page target closed'));
      this.pending.clear();
    };
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    if (this.ws.readyState !== WebSocket.OPEN) throw new Error('Chromium page target closed');
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params })); return result;
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

const findNative = `(() => {
  const terms = ${JSON.stringify(terms)};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, parent = node.parentElement;
    if (!parent || parent.closest('script,style,noscript,textarea,input,code,nav,button,select,option,[role=navigation],[role=menu],[aria-hidden=true],#cf-tooltip,#clearframe-smoke')) continue;
    const text = node.nodeValue || '', lower = text.toLowerCase();
    for (const term of terms) {
      const at = lower.indexOf(term); if (at < 0) continue;
      const before = lower[at - 1] || ' ', after = lower[at + term.length] || ' ';
      if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
      const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + term.length);
      let rect = range.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || getComputedStyle(parent).visibility==='hidden') continue;
      if (rect.bottom < 0 || rect.top > innerHeight) { parent.scrollIntoView({block:'center',behavior:'instant'}); rect = range.getBoundingClientRect(); }
      const x = rect.left + Math.min(rect.width / 2, 12), y = rect.top + rect.height / 2;
      const hit=document.elementFromPoint(x,y);
      if (!hit || !(parent.contains(hit)||hit.contains(parent))) continue;
      return { term, text: text.trim().slice(0, 160), x, y, parent:parent.tagName, hit:hit?.tagName, hitClass:String(hit?.className||'').slice(0,80), related:!!hit&&(parent.contains(hit)||hit.contains(parent)) };
    }
  }
  return null;
})()`;

const tooltipState = `(() => { const tip = document.querySelector('#cf-tooltip'); if (!tip) return null; const r = tip.getBoundingClientRect(), s = getComputedStyle(tip); return { display:s.display, text:tip.textContent, left:r.left, top:r.top, right:r.right, bottom:r.bottom, onScreen:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight }; })()`;

async function hover(cdp, point) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await delay(350); return cdp.evaluate(tooltipState);
}

async function testSite(cdp, url) {
  cdp.events.length = 0;
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) { await delay(500); if (await cdp.evaluate(`document.readyState === 'complete' && !!document.body`)) break; }
  await delay(1800);
  const finalUrl = await cdp.evaluate('location.href');
  const page = await cdp.evaluate(`(() => { const body=document.body?.innerText||'', lower=body.toLowerCase(); return { title:document.title, bodyLength:body.length, sample:body.trim().slice(0,120), termSamples:${JSON.stringify(terms)}.filter(term=>lower.includes(term)).slice(0,8) }; })()`);
  const detectionCounts = await cdp.evaluate(`(() => { const wanted=['reveal','dodge','spark','nepo baby','sacked','disgruntled','glamorous','rages on','unprecedented']; const counts=Object.fromEntries(wanted.map(term=>[term,0])); for(const highlight of CSS.highlights?.values?.()||[]) for(const range of highlight) { const value=range.toString().toLowerCase(); for(const term of wanted) if(value.includes(term)) counts[term]++; } return counts; })()`);
  const hiddenOverlays = await cdp.evaluate(`(() => { let count=0; for(const el of document.querySelectorAll('body *')) { const r=el.getBoundingClientRect(), s=getComputedStyle(el); if ((s.position==='fixed'||s.position==='sticky') && s.pointerEvents!=='none' && r.width*r.height>innerWidth*innerHeight*.5) { el.style.setProperty('display','none','important'); count++; } } return count; })()`);
  let native = await cdp.evaluate(findNative);
  if (!native) {
    await cdp.evaluate('scrollTo(0, Math.min(900, document.documentElement.scrollHeight))'); await delay(1000);
    native = await cdp.evaluate(findNative);
  }
  const nativeTooltip = native ? await hover(cdp, native) : null;
  if (!feedbackEnabledForRun) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'F', code: 'KeyF', modifiers: 9 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F', code: 'KeyF', modifiers: 9 });
    await delay(350); feedbackEnabledForRun = true;
  }
  await cdp.evaluate(`(() => { const el=document.createElement('h2'); el.id='clearframe-smoke'; el.textContent='BREAKING NEWS: shocking warning reveals the secret'; el.style='position:fixed;left:20px;bottom:20px;z-index:2147483646;background:white;color:black;font:20px sans-serif;padding:8px;margin:0'; const suggestion=document.createElement('p'); suggestion.id='clearframe-suggestion-smoke'; suggestion.textContent='needlessly dramatic wording'; suggestion.style='position:fixed;left:20px;bottom:70px;z-index:2147483646;background:white;color:black;font:20px sans-serif'; document.body.append(el,suggestion); })()`);
  await delay(2000);
  const injected = await cdp.evaluate(`(() => { const n=document.querySelector('#clearframe-smoke').firstChild, at=n.nodeValue.indexOf('shocking'), r=document.createRange(); r.setStart(n,at);r.setEnd(n,at+8);const b=r.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2}; })()`);
  const injectionState = await cdp.evaluate(`(() => { const el=document.querySelector('#clearframe-smoke'), hit=document.elementFromPoint(${injected.x},${injected.y}); return { highlightStyle:!!document.querySelector('#cf-highlight-styles'), hit:hit?.id||hit?.tagName, connected:!!el?.isConnected }; })()`);
  const injectedTooltip = await hover(cdp, injected);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: injected.x, y: injected.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: injected.x, y: injected.y, button: 'left', clickCount: 1 });
  await delay(100);
  const feedbackButtons = await cdp.evaluate(`document.querySelectorAll('#cf-tooltip .cf-feedback-actions button').length`);
  let feedbackStatus = 'disabled';
  if (feedbackButtons) {
    await cdp.evaluate(`document.querySelector('#cf-tooltip .cf-feedback-actions button')?.click()`);
    await delay(150);
    feedbackStatus = await cdp.evaluate(`document.querySelector('#cf-tooltip .cf-feedback-status')?.textContent || ''`);
  }
  const suggestionState = await cdp.evaluate(`(() => { const node=document.querySelector('#clearframe-suggestion-smoke').firstChild, selection=getSelection(), range=document.createRange(); range.selectNodeContents(node); selection.removeAllRanges(); selection.addRange(range); const rect=range.getBoundingClientRect(); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:rect.right,clientY:rect.bottom})); return {x:rect.right,y:rect.bottom}; })()`);
  await delay(100);
  const suggestionButtons = await cdp.evaluate(`document.querySelectorAll('#cf-suggestion button').length`);
  let suggestionStatus = 'disabled';
  if (suggestionButtons) {
    await cdp.evaluate(`document.querySelector('#cf-suggestion button')?.click()`); await delay(150);
    suggestionStatus = await cdp.evaluate(`document.querySelector('#cf-suggestion .cf-feedback-status')?.textContent || ''`);
  }
  const errors = cdp.events.filter(event => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded').map(event =>
    event.params?.exceptionDetails?.exception?.description || event.params?.exceptionDetails?.text || event.params?.entry?.text,
  );
  const feedbackPass = feedbackButtons === 0 || (feedbackButtons === 5 && feedbackStatus === 'Saved locally');
  const suggestionPass = suggestionButtons === 0 || (suggestionButtons === 2 && suggestionStatus === 'Saved locally');
  const injectedPass = !!injectedTooltip && injectedTooltip.display !== 'none' && injectedTooltip.onScreen && feedbackPass && suggestionPass;
  const nativePass = !native || (!!nativeTooltip && nativeTooltip.display !== 'none' && nativeTooltip.onScreen);
  return { url, finalUrl, page, detectionCounts, hiddenOverlays, native, nativeTooltip, injectionState, injectedTooltip, feedbackButtons, feedbackStatus, suggestionState, suggestionButtons, suggestionStatus, errors, pass: injectedPass && nativePass };
}

let exitCode = 0;
try {
  const [port] = (await waitForFile(path.join(profile, 'DevToolsActivePort'))).trim().split(/\r?\n/);
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = targets.find(item => item.type === 'page');
  if (!target) throw new Error('Chromium page target not found');
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
  for (const url of urls) {
    try { const result = await testSite(cdp, url); console.log(JSON.stringify(result)); if (!result.pass) exitCode = 1; }
    catch (error) { console.log(JSON.stringify({ url, pass: false, error: error.message })); exitCode = 1; }
  }
  cdp.close();
} finally {
  browser.kill('SIGTERM');
  await Promise.race([browserClosed, delay(3000)]);
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
process.exitCode = exitCode;
