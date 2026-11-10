'use strict';
import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings-utils.js';

const { types, labels, colorConfig } = ClearFrame;
const $ = (id) => /** @type {HTMLElement} */(document.getElementById(id));
// Setting key -> checkbox id. Everything else on the form is read separately.
const TOGGLE_IDS = { predictFirst: 'predict-first', replaceTerms: 'replace-terms', headlinesOnly: 'headlines-only', monochrome: 'monochrome', removeTerms: 'remove-terms', feedbackEnabled: 'feedback-enabled' };
const toggles = /** @type {Record<string, HTMLInputElement>} */ (Object.fromEntries(Object.entries(TOGGLE_IDS).map(([key, id]) => [key, $(id)])));
const radios = /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('input[name=sensitivity]')]);
const els = {
  feedbackToolsActions: $('feedback-tools-actions'),
  copyFeedback: /** @type {HTMLButtonElement} */ ($('copy-feedback')),
  feedbackCopyStatus: $('feedback-copy-status'),
  colorGroups: $('color-groups'),
  resetBtn: $('reset-btn'),
  detectedCount: $('detected-count'),
  pageNote: $('page-note'),
  devices: $('devices'),
};
const TABS = ['page', 'study', 'settings'];
const COLOR_MAP = Object.fromEntries(Object.entries(colorConfig.colors || {}).map(([color, config]) => [color, config.hex]));
let userTypeColors = {};
let settings = normalizeSettings(DEFAULT_SETTINGS);
let dragState = null;
let activeTabId = null;
const openDevices = new Set();
// ?tab=<id> targets another tab instead of the active one (used to test the popup in a tab).
const tabParam = Number(new URLSearchParams(location.search).get('tab')) || null;

function loadSettings(rawSettings = {}, rawTypeColors = {}) {
  settings = normalizeSettings(rawSettings, rawTypeColors); userTypeColors = settings.userTypeColors;
}

function getSettings() {
  /** @type {any} */
  const next = Object.fromEntries(Object.entries(toggles).map(([key, input]) => [key, input.checked]));
  next.sensitivity = radios.find(radio => radio.checked)?.value || DEFAULT_SETTINGS.sensitivity;
  next.types = {};
  document.querySelectorAll('.type-chip').forEach(chip => {
    const { type = '', enabled } = /** @type {HTMLElement} */(chip).dataset;
    next.types[type] = enabled === 'true';
  });
  return next;
}

function saveSettings() {
  const next = getSettings();
  next.userTypeColors = userTypeColors;
  settings = normalizeSettings(next);
  chrome.storage.sync.set({ settings: next }, () => {
    const writeError = chrome.runtime.lastError;
    if (writeError) {
      console.error('ClearFrame settings write failed:', writeError.message);
      return;
    }
    // Apply the new value immediately as well as persisting it. The storage
    // change event can be delayed while a selection event is already queued.
    sendToTab({ type: 'APPLY_SETTINGS', settings: next });
    // Migrate the legacy top-level color setting after its values have been
    // copied into settings.userTypeColors.
    chrome.storage.sync.remove('userTypeColors', () => {
      const removeError = chrome.runtime.lastError;
      if (removeError) {
        console.error('ClearFrame settings migration failed:', removeError.message);
        return;
      }
    });
  });
}

function updateFeedbackTools() {
  els.feedbackToolsActions.style.display = toggles.feedbackEnabled.checked ? 'block' : 'none';
}

async function copyFeedback() {
  const data = await chrome.storage.local.get({ clearframeFeedback: [], clearframeSuggestions: [] });
  const output = {
    feedback: Array.isArray(data.clearframeFeedback) ? data.clearframeFeedback : [],
    suggestions: Array.isArray(data.clearframeSuggestions) ? data.clearframeSuggestions : [],
  };
  const count = output.feedback.length + output.suggestions.length;
  try {
    await navigator.clipboard.writeText(JSON.stringify(output, null, 2));
    els.feedbackCopyStatus.textContent = `Copied ${count}`;
  } catch {
    els.feedbackCopyStatus.textContent = 'Copy failed';
  }
}

async function getTabId() {
  activeTabId = tabParam ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ?? null;
  return activeTabId;
}

// Resolves with the content script's answer, or null if the page has none.
async function sendToTab(message) {
  const id = await getTabId();
  if (typeof id !== 'number') return null;
  return new Promise(resolve => chrome.tabs.sendMessage(id, message, res => resolve(chrome.runtime.lastError ? null : res ?? null)));
}

function getEffectiveColor(type) {
  return userTypeColors[type] || types[type] || 'gray';
}
function getColorHex(c) {
  return COLOR_MAP[c] || '#ccc';
}
function getColorBg(c) {
  return `${getColorHex(c)}cc`;
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
  const res = await sendToTab({ type: 'GET_TERMS' });
  const devices = res?.devices || [];
  els.detectedCount.textContent = res ? String(devices.reduce((sum, device) => sum + device.count, 0)) : '-';
  els.pageNote.textContent = !res ? 'ClearFrame cannot read this page. Browser pages, extension stores and PDF viewers are off limits.'
    : devices.length ? 'Select a device for its effect and wordings. Select a wording to jump to it.' : 'No flagged wording found on this page.';
  els.devices.replaceChildren(...devices.map(renderDevice));
}

function setTopTab(name) {
  for (const key of TABS) {
    const active = key === name;
    $(`${key}-tab`).classList.toggle('active', active);
    $(`${key}-tab`).setAttribute('aria-selected', String(active));
    $(`${key}-panel`).classList.toggle('active', active);
  }
  if (name === 'page') updatePage();
}

function createTypeChip(type) {
  const chip = /** @type {any} */(document.createElement('button'));
  chip.className = 'type-chip'; chip.dataset.type = type;
  chip.dataset.enabled = String(settings.types?.[type] !== false); chip.type = 'button';
  chip.style.background = getColorHex(settings.monochrome ? 'gray' : getEffectiveColor(type));
  if (chip.dataset.enabled !== 'true') {
    chip.classList.add('disabled');
  }
  const text = labels?.types?.[type];
  const label = document.createElement('span'); label.className = 'type-chip-label'; label.textContent = text?.term || type;
  if (text) chip.title = `${text.plain}: ${text.effect}`;
  chip.appendChild(label);
  return chip;
}

function renderColorGroups() {
  els.colorGroups.innerHTML = '';
  const byColor = Object.keys(types).reduce((acc, type) => {
    const c = userTypeColors[type] || types[type]; (acc[c] ||= []).push(type); return acc;
  }, {});
  for (const color of Object.keys(colorConfig.colors)) {
    const config = colorConfig.colors[color];
    const group = document.createElement('div'); group.className = 'color-group'; group.style.background = getColorBg(color);
    const heading = document.createElement('div'); heading.className = 'color-group-title'; heading.textContent = config.category || config.name || color;
    const list = document.createElement('div'); list.className = 'type-list drop-zone'; list.dataset.color = color;
    (byColor[color] || []).sort().forEach(t => list.appendChild(createTypeChip(t)));
    group.appendChild(heading); group.appendChild(list); els.colorGroups.appendChild(group);
  }
  setupDragDrop();
}

function setOverZone(zone) {
  if (dragState?.overZone === zone) {
    return;
  } dragState?.overZone?.classList.remove('drag-over'); if (zone) {
    zone.classList.add('drag-over');
  } if (dragState) {
    dragState.overZone = zone;
  }
}

function applyDrop(type, newColor) {
  if (!type || !newColor) {
    return;
  } userTypeColors[type] = newColor; saveSettings(); renderColorGroups();
}

function toggleChip(chip) {
  const enabled = chip.dataset.enabled === 'true';
  chip.dataset.enabled = String(!enabled); chip.classList.toggle('disabled', enabled);
  saveSettings();
}

function onPointerMove(e) {
  if (!dragState) {
    return;
  } dragState.moved = true; setOverZone(document.elementFromPoint(e.clientX, e.clientY)?.closest('.drop-zone') || null);
}

function onPointerUp(e) {
  if (!dragState?.chip) {
    return;
  }
  const pe = /** @type {PointerEvent} */ (e);
  if (dragState.chip.releasePointerCapture) {
    try {
      dragState.chip.releasePointerCapture(pe.pointerId);
    } catch {}
  }
  dragState.chip.classList.remove('dragging');
  if (dragState.moved && dragState.overZone) {
    applyDrop(dragState.type, dragState.overZone.dataset.color);
  } else if (!dragState.moved) {
    toggleChip(dragState.chip);
  }
  setOverZone(null); dragState = null;
  window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp);
}

function setupDragDrop() {
  document.querySelectorAll('.type-chip').forEach(chip => {
    chip.addEventListener(/** @type {any} */ ('pointerdown'), /** @param {PointerEvent} e */ e => {
      if (e.button !== 0) {
        return;
      }
      /** @type {any} */ const c = chip;
      dragState = { chip, type: c.dataset.type, overZone: null, moved: false };
      chip.classList.add('dragging');
      if (chip.setPointerCapture) {
        chip.setPointerCapture(e.pointerId);
      }
      window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', onPointerUp);
    });
  });
}

els.resetBtn.addEventListener('click', () => {
  userTypeColors = {}; saveSettings(); renderColorGroups();
});

function init() {
  try {
    chrome.storage.sync.get(['settings', 'userTypeColors'], (/** @type {any} */ r) => {
      loadSettings(r.settings, r.userTypeColors);
      $('popup-version').textContent = `v${chrome.runtime.getManifest().version}`;
      for (const [key, input] of Object.entries(toggles)) input.checked = settings[key] === true;
      for (const radio of radios) radio.checked = radio.value === settings.sensitivity;
      updateFeedbackTools();
      renderColorGroups(); setTopTab('page');
      for (const [key, input] of Object.entries(toggles)) {
        input.addEventListener('change', () => {
          saveSettings();
          if (key === 'monochrome') renderColorGroups();
          if (key === 'feedbackEnabled') updateFeedbackTools();
        });
      }
      for (const radio of radios) radio.addEventListener('change', saveSettings);
      els.copyFeedback.addEventListener('click', copyFeedback);
      for (const key of TABS) $(`${key}-tab`).addEventListener('click', () => setTopTab(key));
    });
  } catch (e) {
    console.error('ClearFrame init error:', e); els.colorGroups.innerHTML = '<p style="color:red">Error: Run as Chrome Extension</p>';
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'COUNT' && sender.tab?.id === activeTabId) updatePage();
});

init();
