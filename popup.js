'use strict';

const { types, categories, colorConfig } = ClearFrame;
const els = {
  enabled: document.getElementById('enabled'),
  replaceTerms: document.getElementById('replace-terms'),
  colorGroups: document.getElementById('color-groups'),
  resetBtn: document.getElementById('reset-btn'),
  detectedCount: document.getElementById('detected-count'),
  termList: document.getElementById('term-list')
};
const COLOR_MAP = {
  yellow: '#fff7cc',
  green: '#e7f8ea',
  gray: '#f1f1f1',
  red: '#fde8e8',
  pink: '#fdebf3',
  orange: '#fff0df',
  purple: '#f2eaff',
  blue: '#e8f1ff',
  teal: '#e5faf7'
};
const DEFAULT_SETTINGS = { enabled: true, replaceTerms: false, types: { absolute: false, moral: false, superlative: false }, userTypeColors: {} };
let userTypeColors = {};
let settings = { ...DEFAULT_SETTINGS, types: { ...DEFAULT_SETTINGS.types } };
let dragState = null;

function loadSettings(rawSettings = {}, rawTypeColors = {}) {
  const nextSettings = { ...DEFAULT_SETTINGS, ...rawSettings };
  if (!nextSettings.types || Object.keys(nextSettings.types).length === 0) {
    nextSettings.types = { absolute: false, moral: false, superlative: false };
  }
  userTypeColors = { ...(nextSettings.userTypeColors || {}), ...rawTypeColors };
  nextSettings.userTypeColors = userTypeColors;
  settings = nextSettings;
}

function getSettings() {
  const next = {
    enabled: els.enabled.checked,
    replaceTerms: els.replaceTerms.checked,
    types: {}
  };
  document.querySelectorAll('.type-chip').forEach(chip => {
    next.types[chip.dataset.type] = chip.dataset.enabled === 'true';
  });
  return next;
}

function saveSettings(reload = false) {
  const next = getSettings();
  next.userTypeColors = userTypeColors;
  chrome.storage.sync.set({ settings: next });
  if (reload) sendToActiveTab({ type: 'RELOAD_SETTINGS' });
}

function sendToActiveTab(message, onResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, message, res => {
      if (chrome.runtime.lastError) return;
      if (onResponse) onResponse(res);
    });
  });
}

function getEffectiveColor(type) {
  return userTypeColors[type] || types[type] || 'gray';
}

function getCategory(type) {
  return categories?.[type] || 'General';
}

function updateDetectedCount() {
  sendToActiveTab({ type: 'GET_COUNT' }, res => {
    const count = res?.count || 0;
    if (els.detectedCount) {
      els.detectedCount.textContent = `(${count})`;
    }
  });
}

function updateTermsList() {
  if (!els.termList) return;
  els.termList.textContent = 'Loading...';
  sendToActiveTab({ type: 'GET_TERMS' }, res => {
    const terms = res?.terms || [];
    if (!terms.length) {
      els.termList.textContent = 'No matches on this page.';
      return;
    }
    const frag = document.createDocumentFragment();
    terms.forEach(t => {
      const row = document.createElement('div');
      row.className = 'term-row';
      const name = document.createElement('span');
      name.textContent = t.term;
      const count = document.createElement('span');
      count.className = 'term-count';
      count.textContent = String(t.count);
      row.appendChild(name);
      row.appendChild(count);
      frag.appendChild(row);
    });
    els.termList.innerHTML = '';
    els.termList.appendChild(frag);
  });
}

function getColorHex(color) {
  return COLOR_MAP[color] || '#ccc';
}

function getColorBg(color) {
  return `${getColorHex(color)}cc`;
}

function createTypeChip(type) {
  const chip = document.createElement('button');
  chip.className = 'type-chip';
  chip.dataset.type = type;
  chip.dataset.category = getCategory(type);
  chip.dataset.enabled = String(settings.types?.[type] !== false);
  chip.type = 'button';
  chip.style.background = getColorHex(getEffectiveColor(type));
  if (chip.dataset.enabled !== 'true') chip.classList.add('disabled');

  const label = document.createElement('span');
  label.className = 'type-chip-label';
  label.textContent = type;
  chip.appendChild(label);
  return chip;
}

function renderColorGroups() {
  els.colorGroups.innerHTML = '';
  const byColor = Object.keys(types).reduce((acc, type) => {
    const color = userTypeColors[type] || types[type];
    (acc[color] ||= []).push(type);
    return acc;
  }, {});

  for (const color of Object.keys(colorConfig.colors)) {
    const config = colorConfig.colors[color];
    const group = document.createElement('div');
    group.className = 'color-group';
    group.style.background = getColorBg(color);

    const heading = document.createElement('div');
    heading.className = 'color-group-title';
    heading.textContent = config.category || config.name || color;

    const list = document.createElement('div');
    list.className = 'type-list drop-zone';
    list.dataset.color = color;

    const listTypes = (byColor[color] || []).sort();
    for (const type of listTypes) {
      list.appendChild(createTypeChip(type));
    }

    group.appendChild(heading);
    group.appendChild(list);
    els.colorGroups.appendChild(group);
  }

  setupDragDrop();
}

function setOverZone(zone) {
  if (dragState?.overZone === zone) return;
  dragState?.overZone?.classList.remove('drag-over');
  if (zone) zone.classList.add('drag-over');
  if (dragState) dragState.overZone = zone;
}

function applyDrop(type, newColor) {
  if (!type || !newColor) return;
  userTypeColors[type] = newColor;
  saveSettings(true);
  renderColorGroups();
}

function toggleChip(chip) {
  const enabled = chip.dataset.enabled === 'true';
  chip.dataset.enabled = String(!enabled);
  chip.classList.toggle('disabled', enabled);
  saveSettings(true);
  setTimeout(updateDetectedCount, 0);
}

function onPointerMove(e) {
  if (!dragState) return;
  dragState.moved = true;
  setOverZone(document.elementFromPoint(e.clientX, e.clientY)?.closest('.drop-zone') || null);
}

function onPointerUp(e) {
  if (!dragState?.chip) return;
  if (dragState.chip.releasePointerCapture) {
    try { dragState.chip.releasePointerCapture(e.pointerId); } catch {}
  }
  dragState.chip.classList.remove('dragging');
  if (dragState.moved && dragState.overZone) applyDrop(dragState.type, dragState.overZone.dataset.color);
  else if (!dragState.moved) toggleChip(dragState.chip);
  setOverZone(null);
  dragState = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
}

function setupDragDrop() {
  document.querySelectorAll('.type-chip').forEach(chip => {
    chip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      dragState = { chip, type: chip.dataset.type, overZone: null, moved: false };
      chip.classList.add('dragging');
      if (chip.setPointerCapture) chip.setPointerCapture(e.pointerId);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });
  });
}

els.resetBtn.addEventListener('click', () => {
  userTypeColors = {};
  saveSettings(true);
  renderColorGroups();
  updateDetectedCount();
  updateTermsList();
});

function init() {
  try {
    chrome.storage.sync.get(['settings', 'userTypeColors'], r => {
      loadSettings(r.settings, r.userTypeColors);
      els.enabled.checked = settings.enabled !== false;
      els.replaceTerms.checked = settings.replaceTerms === true;
      renderColorGroups();

      els.enabled.addEventListener('change', () => { saveSettings(true); updateDetectedCount(); updateTermsList(); });
      els.replaceTerms.addEventListener('change', () => { saveSettings(true); updateDetectedCount(); updateTermsList(); });
      updateDetectedCount();
      updateTermsList();
    });
  } catch (e) {
    console.error('ClearFrame init error:', e);
    els.colorGroups.innerHTML = '<p style="color:red">Error: Run as Chrome Extension</p>';
  }
}

init();
