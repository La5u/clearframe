'use strict';
// Entry point: loads and applies settings, starts the analysis passes, and
// wires page events, keyboard shortcuts and popup messages to the modules
// that handle them. The pipeline runs page -> scanner -> analyze -> store
// (display text, records) -> highlights; see "Analysis Flow" in README.md.
import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings-utils.js';
import { getSettings, setSettings, setDismissedTerms } from './content/settings.js';
import { getNextRecord, getDeviceGroups, getTotalMatches } from './content/store.js';
import { showSelectedRecord } from './content/highlights.js';
import { analyzePage, startObserving } from './content/observer.js';
import { handleHoverMove, handleScroll, handleSelectionEnd, handleTooltipClick, hideTooltip } from './content/tooltip.js';

const RUNTIME_SHORTCUTS = { r: 'replaceTerms', p: 'predictFirst' };
// Set once settings were loaded: by init in the top frame, or by APPLY_SETTINGS.
let settingsReady = false;

function getSettingsKey(value) {
  return JSON.stringify(value);
}

/** @param {any} rawSettings */
function loadSettings(rawSettings = {}) {
  setSettings(rawSettings);
  settingsReady = true;
}

function applySettings(rawSettings = {}) {
  const previousKey = getSettingsKey(getSettings());
  loadSettings(rawSettings);
  if (previousKey !== getSettingsKey(getSettings()) && document.body) {
    analyzePage();
  }
}

function saveRuntimeSettings(nextSettings) {
  chrome.storage.sync.set({ settings: nextSettings }, () => {
    const error = chrome.runtime.lastError;
    if (error) console.error('ClearFrame settings write failed:', error.message);
  });
}

function handleKeyDown(event) {
  const target = event.target;
  if (target instanceof Element && (/** @type {HTMLElement} */ (target).isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat) return;
  const setting = RUNTIME_SHORTCUTS[event.key.toLowerCase()];
  if (!setting) return;
  const settings = getSettings();
  if (!settings.studyMode) return;
  event.preventDefault();
  saveRuntimeSettings(normalizeSettings({ ...settings, [setting]: !settings[setting] }));
}

function init() {
  loadSettings(DEFAULT_SETTINGS);
  let settingsLoaded = false, started = false;
  // Runs at document_start: analyze as soon as <body> exists, then follow the
  // parser through the page observer instead of waiting for DOMContentLoaded.
  const start = () => {
    if (started || !settingsLoaded || !document.body) return;
    started = true; bodyWatcher.disconnect();
    startObserving();
  };
  const bodyWatcher = new MutationObserver(start);
  bodyWatcher.observe(document, { childList: true, subtree: true });
  Promise.all([chrome.storage.sync.get('settings'), chrome.storage.local.get('dismissedTerms')]).then(([result, local]) => {
    loadSettings(result.settings);
    setDismissedTerms(local.dismissedTerms);
    settingsLoaded = true;
    start();
  });
  document.addEventListener('mousemove', handleHoverMove, { capture: true, passive: true });
  document.addEventListener('click', handleTooltipClick, true);
  document.addEventListener('mouseup', handleSelectionEnd, true);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('scroll', handleScroll, true);
  window.addEventListener('blur', () => { hideTooltip(true); });
}

if (window.top === window) init();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.dismissedTerms) {
    setDismissedTerms(changes.dismissedTerms.newValue);
    if (settingsReady && document.body) analyzePage();
  }
  if (areaName === 'sync' && changes.settings && settingsReady) applySettings(changes.settings.newValue || {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_COUNT') {
    sendResponse({ count: getTotalMatches() }); return;
  }
  if (message.type === 'GET_TERMS') {
    sendResponse({ devices: getDeviceGroups() }); return;
  }
  if (message.type === 'NAVIGATE_TERM') {
    const record = getNextRecord(message.term, message.device);
    if (record) showSelectedRecord(record);
    return;
  }
  if (message.type === 'APPLY_SETTINGS') {
    applySettings(message.settings);
    sendResponse({ ok: true }); return;
  }
});
