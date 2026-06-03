'use strict';
import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings-utils.js';

const { types, categories, colorConfig } = ClearFrame;
const $ = (id) => /** @type {HTMLElement} */(document.getElementById(id));
const els = {
  enabled: /** @type {HTMLInputElement} */ ($('enabled')),
  replaceTerms: /** @type {HTMLInputElement} */ ($('replace-terms')),
  removeTerms: /** @type {HTMLInputElement} */ ($('remove-terms')),
  colorGroups: $('color-groups'),
  resetBtn: $('reset-btn'),
  detectedCount: $('detected-count'),
  customizeTab: $('customize-tab'),
  detectedTab: $('detected-tab'),
  customizePanel: $('customize-panel'),
  detectedPanel: $('detected-panel'),
  termTabs: $('term-tabs'),
  termPanels: $('term-panels'),
  popupVersion: $('popup-version'),
  githubLink: /** @type {HTMLAnchorElement} */ ($('github-link')),
};
const COLOR_MAP = { yellow: '#fff7cc', green: '#e7f8ea', gray: '#f1f1f1', red: '#fde8e8', pink: '#fdebf3', orange: '#fff0df', purple: '#f2eaff', blue: '#e8f1ff', teal: '#e5faf7', brown: '#f2e6dc' };
let userTypeColors = {};
let settings = normalizeSettings(DEFAULT_SETTINGS);
let dragState = null;

function loadSettings(rawSettings = {}, rawTypeColors = {}) {
  settings = normalizeSettings(rawSettings, rawTypeColors); userTypeColors = settings.userTypeColors;
}

function getSettings() {
  const next = { enabled: els.enabled.checked, replaceTerms: els.replaceTerms.checked, removeTerms: els.removeTerms.checked, types: {} };
  document.querySelectorAll('.type-chip').forEach(chip => {
    next.types[/** @type {HTMLElement} */(chip).dataset.type] = /** @type {HTMLElement} */(chip).dataset.enabled === 'true';
  });
  return next;
}

function saveSettings(reload = false) {
  const next = getSettings();
  next.userTypeColors = userTypeColors;
  void chrome.storage.sync.set({ settings: next });
  if (reload) {
    sendToActiveTab({ type: 'RELOAD_SETTINGS' });
  }
}

function sendToActiveTab(message, onResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.id) {
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, message, res => {
      if (!chrome.runtime.lastError && onResponse) {
        onResponse(res);
      }
    });
  });
}

function getEffectiveColor(type) {
  return userTypeColors[type] || types[type] || 'gray';
}
function getCategory(type) {
  return categories?.[type] || 'General';
}
function getColorHex(c) {
  return COLOR_MAP[c] || '#ccc';
}
function getColorBg(c) {
  return `${getColorHex(c)}cc`;
}

function updateDetectedCount() {
  sendToActiveTab({ type: 'GET_COUNT' }, res => {
    const c = res?.count || 0; if (els.detectedCount) {
      els.detectedCount.textContent = `(${c})`;
    }
  });
}

function updateTermsList() {
  if (!els.termTabs || !els.termPanels) {
    return;
  }
  els.termTabs.textContent = ''; els.termPanels.textContent = '';
  sendToActiveTab({ type: 'GET_TERMS' }, res => {
    const groups = res?.groups || {}, panes = new Map();
    let firstAction = null, hasAny = false;
    for (const action of ['highlighted', 'replaced', 'removed']) {
      const items = groups[action] || [];
      if (items.length) {
        hasAny = true;
      }
      const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'term-tab'; tab.dataset.action = action; tab.textContent = `${action[0].toUpperCase()}${action.slice(1)} (${items.length})`;
      const panel = document.createElement('div'); panel.className = 'term-panel'; panel.dataset.action = action;
      const list = document.createElement('div'); list.className = 'term-list';
      if (items.length) {
        const frag = document.createDocumentFragment(); for (const item of items) {
          const row = document.createElement('button'); row.type = 'button'; row.className = 'term-row'; const name = document.createElement('span'); name.textContent = item.term; const count = document.createElement('span'); count.className = 'term-count'; count.textContent = String(item.count); row.appendChild(name); row.appendChild(count); row.addEventListener('click', () => sendToActiveTab({ type: 'NAVIGATE_TERM', term: item.term, action })); frag.appendChild(row);
        } list.appendChild(frag);
      } else {
        list.textContent = 'No matches.';
      }
      panel.appendChild(list); panes.set(action, { tab, panel });
      if (!firstAction) {
        firstAction = action;
      }
      els.termTabs.appendChild(tab); els.termPanels.appendChild(panel);
    }
    for (const { tab } of panes.values()) {
      tab.addEventListener('click', () => {
        for (const [name, p] of panes) {
          const a = name === tab.dataset.action; p.tab.classList.toggle('active', a); p.panel.classList.toggle('active', a);
        }
      });
    }
    if (hasAny && firstAction) {
      for (const [name, p] of panes) {
        const a = name === firstAction; p.tab.classList.toggle('active', a); p.panel.classList.toggle('active', a);
      } return;
    }
    els.termTabs.textContent = ''; els.termPanels.textContent = 'No matches on this page.';
  });
}

function setTopTab(name) {
  const c = name === 'customize';
  els.customizeTab?.classList.toggle('active', c); els.detectedTab?.classList.toggle('active', !c);
  els.customizeTab?.setAttribute('aria-selected', String(c)); els.detectedTab?.setAttribute('aria-selected', String(!c));
  els.customizePanel?.classList.toggle('active', c); els.detectedPanel?.classList.toggle('active', !c);
  if (!c) {
    updateTermsList();
  }
}

function createTypeChip(type) {
  const chip = /** @type {any} */(document.createElement('button'));
  chip.className = 'type-chip'; chip.dataset.type = type; chip.dataset.category = getCategory(type);
  chip.dataset.enabled = String(settings.types?.[type] !== false); chip.type = 'button';
  chip.style.background = getColorHex(getEffectiveColor(type));
  if (chip.dataset.enabled !== 'true') {
    chip.classList.add('disabled');
  }
  const label = document.createElement('span'); label.className = 'type-chip-label'; label.textContent = type;
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
  } userTypeColors[type] = newColor; saveSettings(true); renderColorGroups();
}

function toggleChip(chip) {
  const enabled = chip.dataset.enabled === 'true';
  chip.dataset.enabled = String(!enabled); chip.classList.toggle('disabled', enabled);
  saveSettings(true); setTimeout(updateDetectedCount, 0);
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
  userTypeColors = {}; saveSettings(true); renderColorGroups(); updateDetectedCount(); updateTermsList();
});

function init() {
  try {
    chrome.storage.sync.get(['settings', 'userTypeColors'], (/** @type {any} */ r) => {
      loadSettings(r.settings, r.userTypeColors);
      const ver = chrome.runtime.getManifest().version;
      if (els.popupVersion) {
        els.popupVersion.textContent = `v${ver}`;
      }
      if (els.githubLink) {
        els.githubLink.href = 'https://github.com/la5u/clearframe';
      }
      els.enabled.checked = settings.enabled !== false; els.replaceTerms.checked = settings.replaceTerms === true; els.removeTerms.checked = settings.removeTerms === true;
      renderColorGroups(); setTopTab('customize');
      els.enabled.addEventListener('change', () => {
        saveSettings(true); updateDetectedCount(); updateTermsList();
      });
      els.replaceTerms.addEventListener('change', () => {
        saveSettings(true); updateDetectedCount(); updateTermsList();
      });
      els.removeTerms.addEventListener('change', () => {
        saveSettings(true); updateDetectedCount(); updateTermsList();
      });
      els.customizeTab?.addEventListener('click', () => setTopTab('customize'));
      els.detectedTab?.addEventListener('click', () => setTopTab('detected'));
      updateDetectedCount(); updateTermsList();
    });
  } catch (e) {
    console.error('ClearFrame init error:', e); if (els.colorGroups) {
      els.colorGroups.innerHTML = '<p style="color:red">Error: Run as Chrome Extension</p>';
    }
  }
}

init();
