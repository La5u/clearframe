// Shared headless Chromium with the built extension loaded, driven over the
// DevTools protocol. Used by the live-site smoke test and the news report.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export class Cdp {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.events = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id) { this.events.push(message); return; }
      const pending = this.pending.get(message.id); this.pending.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error.message)); else pending?.resolve(message.result);
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

// Start Chromium with dist/ loaded and connect to its first page. Always call
// close(), which also removes the temporary profile.
export async function launchExtensionBrowser({ windowSize } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'clearframe-chromium-'));
  const browser = spawn(process.env.CHROMIUM_PATH || '/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', ...(windowSize ? [`--window-size=${windowSize}`] : []),
    `--user-data-dir=${profile}`, `--disable-extensions-except=${path.join(ROOT, 'dist')}`,
    `--load-extension=${path.join(ROOT, 'dist')}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const closed = new Promise(resolve => browser.once('close', resolve));
  let stderr = '';
  browser.stderr.on('data', data => { stderr += data; });
  let cdp = null;
  const close = async () => {
    cdp?.close();
    browser.kill('SIGTERM');
    await Promise.race([closed, delay(3000)]);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await delay(100);
    if (!fs.existsSync(portFile)) throw new Error(`Chromium did not start: ${stderr}`);
    const [port] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    const target = (await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())).find(item => item.type === 'page');
    if (!target) throw new Error('Chromium page target not found');
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    return { cdp, close };
  } catch (error) {
    await close();
    throw error;
  }
}
