'use strict';
import { DEFAULT_SETTINGS, normalizeSettings, normalizeHostname, isPaused } from './core/settings-utils.js';
import { normalize } from './core/matcher.js';

const { types, labels, colorConfig } = ClearFrame;
const $ = id => /** @type {HTMLElement} */ (document.getElementById(id));
const input = id => /** @type {HTMLInputElement} */ ($(id));
const TOGGLE_IDS = { predictFirst: 'predict-first', replaceTerms: 'replace-terms', headlinesOnly: 'headlines-only', studyMode: 'study-mode' };
const radios = /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('input[name=sensitivity]')]);
let settings = normalizeSettings(DEFAULT_SETTINGS);
let activeTabId = null;
let hostname = '';
let ownAnalyzePage = false;
let pageRequest = 0;
const openDevices = new Set();
// ?tab=<id> targets another tab (used to test the popup in a tab).
const tabParam = Number(new URLSearchParams(location.search).get('tab')) || null;

async function sendToTab(message) {
  if (typeof activeTabId !== 'number') return null;
  return new Promise(resolve => chrome.tabs.sendMessage(activeTabId, message, res => resolve(chrome.runtime.lastError ? null : res ?? null)));
}

async function saveSettings() {
  settings = normalizeSettings(settings);
  await chrome.storage.sync.set({ settings });
  await sendToTab({ type: 'APPLY_SETTINGS', settings });
  await updatePage();
}

const h = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };

function renderDevice({ term, effects, count, wordings }, index) {
  const body = h('div', { id: `device-${index}`, hidden: !openDevices.has(term), className: 'device-body' },
    ...effects.map(effect => h('p', { className: 'effect', textContent: effect })),
    ...wordings.map(item => {
      const row = h('button', { type: 'button', className: 'term-row' }, h('span', { textContent: item.term }), h('span', { className: 'term-count', textContent: String(item.count) }));
      row.addEventListener('click', () => sendToTab({ type: 'NAVIGATE_TERM', term: item.term, device: term }));
      return row;
    }));
  const head = h('button', { type: 'button', className: 'device-head' }, h('span', { textContent: term }), h('span', { className: 'term-count', textContent: String(count) }));
  head.setAttribute('aria-controls', body.id); head.setAttribute('aria-expanded', String(!body.hidden));
  head.addEventListener('click', () => {
    body.hidden = !body.hidden; head.setAttribute('aria-expanded', String(!body.hidden));
    openDevices[body.hidden ? 'delete' : 'add'](term);
  });
  return h('div', {}, head, body);
}

async function updatePage() {
  const request = ++pageRequest;
  const paused = isPaused(settings, hostname, ownAnalyzePage);
  $('count-row').hidden = paused;
  $('devices').hidden = paused;
  if (paused) {
    $('page-note').textContent = 'Paused';
    $('devices').replaceChildren();
    return;
  }
  const res = await sendToTab({ type: 'GET_TERMS' });
  if (request !== pageRequest) return;
  const devices = res?.devices || [];
  $('detected-count').textContent = res ? String(devices.reduce((sum, device) => sum + device.count, 0)) : '-';
  $('page-note').textContent = !res ? 'ClearFrame cannot read this page. Browser pages, extension stores and PDF viewers are off limits.'
    : devices.length ? 'Select a group for its wordings. Select a wording to jump to it.' : 'No flagged wording found on this page.';
  if (res && devices.length && settings.studyMode) $('page-note').textContent = 'Select a device for its effect and wordings. Select a wording to jump to it.';
  $('devices').replaceChildren(...devices.map(renderDevice));
}

function renderColorGroups() {
  const focusedType = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.type : undefined;
  $('color-groups').replaceChildren();
  for (const [color, config] of Object.entries(colorConfig.colors)) {
    const group = h('div', { className: 'color-group' });
    group.style.background = settings.monochrome ? '#f1f1f1' : `${config.hex}cc`;
    const heading = h('div', { className: 'color-group-title', textContent: config.category });
    const list = h('div', { className: 'type-list' });
    for (const type of Object.keys(types).filter(type => types[type] === color).sort()) {
      const label = labels.types[type];
      const enabled = settings.types[type] !== false;
      const chip = h('button', { type: 'button', className: `type-chip${enabled ? '' : ' disabled'}`, textContent: settings.studyMode ? label.term : label.plain, title: `${label.plain}: ${label.effect}` });
      chip.dataset.type = type;
      chip.setAttribute('aria-pressed', String(enabled));
      chip.addEventListener('click', () => {
        settings.types[type] = settings.types[type] === false;
        chip.classList.toggle('disabled', !settings.types[type]);
        chip.setAttribute('aria-pressed', String(settings.types[type]));
        saveSettings();
      });
      list.appendChild(chip);
    }
    group.append(heading, list); $('color-groups').appendChild(group);
  }
  if (focusedType) {
    const chip = [...document.querySelectorAll('#color-groups button')].find(node => /** @type {HTMLElement} */ (node).dataset.type === focusedType);
    if (chip instanceof HTMLElement) chip.focus();
  }
}

function renderSettings() {
  input('extension-on').checked = !settings.paused;
  input('site-paused').checked = settings.pausedSites.includes(hostname);
  $('site-pause-row').hidden = !hostname;
  $('site-hostname').textContent = hostname;
  for (const [key, id] of Object.entries(TOGGLE_IDS)) input(id).checked = settings[key];
  input('colour-groups').checked = !settings.monochrome;
  $('study-options').hidden = !settings.studyMode;
  for (const radio of radios) radio.checked = radio.value === settings.sensitivity;
  renderColorGroups();
}

function renderDismissed(value) {
  const count = new Set((Array.isArray(value) ? value : []).filter(term => typeof term === 'string').map(normalize).filter(Boolean)).size;
  $('dismissed-count').textContent = `${count} dismissed wordings`;
  $('restore-dismissed').hidden = count === 0;
}

async function init() {
  const [synced, local, tabs] = await Promise.all([
    chrome.storage.sync.get('settings'), chrome.storage.local.get('dismissedTerms'),
    tabParam ? chrome.tabs.get(tabParam).then(tab => [tab]) : chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  settings = normalizeSettings(synced.settings);
  const tab = tabs[0]; activeTabId = tab?.id ?? null;
  try {
    const url = new URL(tab?.url || '');
    if (['http:', 'https:'].includes(url.protocol)) hostname = normalizeHostname(url.hostname);
    ownAnalyzePage = url.href.split(/[?#]/)[0] === chrome.runtime.getURL('analyze.html');
  } catch {}
  $('popup-version').textContent = `v${chrome.runtime.getManifest().version}`;
  renderSettings(); renderDismissed(local.dismissedTerms); updatePage();
  input('extension-on').addEventListener('change', () => { settings.paused = !input('extension-on').checked; saveSettings(); });
  input('site-paused').addEventListener('change', () => {
    settings.pausedSites = settings.pausedSites.filter(site => site !== hostname);
    if (hostname && input('site-paused').checked) settings.pausedSites.push(hostname);
    saveSettings();
  });
  for (const [key, id] of Object.entries(TOGGLE_IDS)) input(id).addEventListener('change', () => {
    settings[key] = input(id).checked;
    renderSettings(); saveSettings();
  });
  input('colour-groups').addEventListener('change', () => { settings.monochrome = !input('colour-groups').checked; renderColorGroups(); saveSettings(); });
  for (const radio of radios) radio.addEventListener('change', () => { settings.sensitivity = radio.value; saveSettings(); });
  $('restore-dismissed').addEventListener('click', () => chrome.storage.local.set({ dismissedTerms: [] }));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.dismissedTerms) renderDismissed(changes.dismissedTerms.newValue);
  if (area === 'sync' && changes.settings) {
    settings = normalizeSettings(changes.settings.newValue);
    renderSettings();
    // The content script also receives this change; its COUNT message refreshes the list.
    updatePage();
  }
});
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'COUNT' && sender.tab?.id === activeTabId) updatePage();
});
init().catch(error => { console.error('ClearFrame init error:', error); $('page-note').textContent = 'Could not load ClearFrame settings.'; });
