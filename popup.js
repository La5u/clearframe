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
  yellow: '#fef9c3',
  green: '#dcfce7',
  gray: '#f3f4f6',
  red: '#fee2e2',
  pink: '#fce7f3',
  orange: '#ffedd5',
  purple: '#f3e8ff',
  blue: '#dbeafe',
  teal: '#ccfbf1'
};
const DEFAULT_SETTINGS = { enabled: true, replaceTerms: false, types: { superlative: false }, userTypeColors: {} };
let userTypeColors = {};
let settings = { ...DEFAULT_SETTINGS, types: { ...DEFAULT_SETTINGS.types } };

function loadSettings(rawSettings = {}, rawTypeColors = {}) {
  const nextSettings = { ...DEFAULT_SETTINGS, ...rawSettings };
  if (!nextSettings.types || Object.keys(nextSettings.types).length === 0) {
    nextSettings.types = { superlative: false };
  }
  userTypeColors = { ...(nextSettings.userTypeColors || {}), ...rawTypeColors };
  nextSettings.userTypeColors = userTypeColors;
  settings = nextSettings;
}

function getSettings() {
  const s = {
    enabled: els.enabled.checked,
    replaceTerms: els.replaceTerms.checked,
    types: {}
  };
  document.querySelectorAll('.type-chip').forEach(chip => {
    s.types[chip.dataset.type] = chip.dataset.enabled === 'true';
  });
  return s;
}

function saveSettings(reload = false) {
  const s = getSettings();
  s.userTypeColors = userTypeColors;
  chrome.storage.sync.set({ settings: s });
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
  return getColorHex(color) + '80';
}

function getChipBg(color) {
  return COLOR_MAP[color] || '#fff';
}

function createTypeChip(type) {
  const chip = document.createElement('button');
  chip.className = 'type-chip';
  chip.dataset.type = type;
  chip.dataset.category = getCategory(type);
  chip.dataset.enabled = String(settings.types?.[type] !== false);
  chip.type = 'button';
  chip.style.background = getChipBg(getEffectiveColor(type));
  if (chip.dataset.enabled !== 'true') chip.classList.add('disabled');

  const label = document.createElement('span');
  label.className = 'type-chip-label';
  label.textContent = type;
  chip.appendChild(label);
  return chip;
}

function renderColorGroups() {
  els.colorGroups.innerHTML = '';

  const byColor = {};
  for (const type of Object.keys(types)) {
    const color = userTypeColors[type] || types[type];
    (byColor[color] ||= []).push(type);
  }

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

function setupDragDrop() {
  const chips = document.querySelectorAll('.type-chip');
  let draggingType = null;
  let draggingEl = null;
  let overZone = null;
  let dragMoved = false;

  function setOverZone(zone) {
    if (overZone === zone) return;
    if (overZone) overZone.classList.remove('drag-over');
    overZone = zone;
    if (overZone) overZone.classList.add('drag-over');
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
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const zone = el ? el.closest('.drop-zone') : null;
    dragMoved = true;
    setOverZone(zone);
  }

  function onPointerUp(e) {
    if (!draggingEl) return;
    if (draggingEl.releasePointerCapture) {
      try { draggingEl.releasePointerCapture(e.pointerId); } catch {}
    }
    draggingEl.classList.remove('dragging');
    if (dragMoved && overZone) {
      applyDrop(draggingType, overZone.dataset.color);
    } else if (!dragMoved) {
      toggleChip(draggingEl);
    }
    setOverZone(null);
    draggingType = null;
    draggingEl = null;
    dragMoved = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }

  chips.forEach(chip => {
    chip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      draggingType = chip.dataset.type;
      draggingEl = chip;
      dragMoved = false;
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
