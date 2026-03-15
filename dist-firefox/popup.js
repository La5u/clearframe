globalThis.ClearFrame = { types: {"clickbait":"yellow","sensational":"yellow","hype":"yellow","reveal":"yellow","tabloid-anger":"yellow","exaggeration":"green","superlative":"green","hype-marketing":"green","unsourced":"gray","authority":"gray","uncertainty":"gray","framing":"gray","vague":"gray","jargon":"gray","loaded-framing":"gray","distancing":"gray","aggressive":"red","aggression":"red","derogatory":"red","partisan":"red","dehumanizing":"red","moral":"pink","loaded":"pink","moral-labeling":"pink","conflict":"orange","drama":"orange","disaster":"orange","minimizing":"orange","negative-framing":"orange","emotional":"purple","fear":"purple","euphemism":"blue","passive":"blue"}, colorConfig: {"colors":{"yellow":{"name":"Yellow","types":["clickbait","sensational","hype","reveal","tabloid-anger"]},"green":{"name":"Green","types":["exaggeration","superlative","hype-marketing"]},"gray":{"name":"Gray","types":["unsourced","authority","uncertainty","framing","vague","jargon","loaded-framing","distancing"]},"red":{"name":"Red","types":["aggressive","aggression","derogatory","partisan","dehumanizing"]},"pink":{"name":"Pink","types":["moral","loaded","moral-labeling"]},"orange":{"name":"Orange","types":["conflict","drama","disaster","minimizing","negative-framing"]},"purple":{"name":"Purple","types":["emotional","fear"]},"blue":{"name":"Blue","types":["euphemism","passive"]}}} };'use strict';

const { types, colorConfig } = ClearFrame;
const els = {
  enabled: document.getElementById('enabled'),
  colorGroups: document.getElementById('color-groups'),
  counter: document.getElementById('counter'),
  resetBtn: document.getElementById('reset-btn'),
  tabButtons: Array.from(document.querySelectorAll('.tab-btn')),
  tabPanels: Array.from(document.querySelectorAll('.tab-panel')),
  termList: document.getElementById('term-list')
};
const COLOR_MAP = { yellow: '#fef9c3', green: '#dcfce7', gray: '#f3f4f6', red: '#fee2e2', pink: '#fce7f3', orange: '#ffedd5', purple: '#f3e8ff', blue: '#dbeafe' };

let userTypeColors = {};
let settings = { enabled: true, types: {} };

function getSettings() {
  const s = { enabled: els.enabled.checked, types: {} };
  document.querySelectorAll('.type-chip').forEach(chip => {
    s.types[chip.dataset.type] = chip.dataset.enabled === 'true';
  });
  return s;
}

function saveSettings(s) {
  s.userTypeColors = userTypeColors;
  chrome.storage.sync.set({ settings: s });
}

function save() { saveSettings(getSettings()); }

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

function renderColorGroups() {
  els.colorGroups.innerHTML = '';
  
  const byColor = {};
  for (const type of Object.keys(types)) {
    const color = userTypeColors[type] || types[type];
    (byColor[color] ||= []).push(type);
  }

  for (const [color, config] of Object.entries(colorConfig.colors)) {
    const group = document.createElement('div');
    group.className = 'color-group';
    group.style.background = getColorBg(color);
    
    const header = document.createElement('div');
    header.className = 'color-group-header';
    header.textContent = '';
    group.appendChild(header);
    
    const list = document.createElement('div');
    list.className = 'type-list drop-zone';
    list.dataset.color = color;
    
    const listTypes = (byColor[color] || []).sort();
    for (const type of listTypes) list.appendChild(createTypeChip(type));
    
    group.appendChild(list);
    els.colorGroups.appendChild(group);
  }
  
  setupDragDrop();
}

function createTypeChip(type) {
  const chip = document.createElement('button');
  chip.className = 'type-chip';
  chip.dataset.type = type;
  chip.dataset.enabled = String(settings.types?.[type] !== false);
  chip.draggable = true;
  chip.type = 'button';
  chip.style.background = getChipBg(getEffectiveColor(type));
  if (chip.dataset.enabled !== 'true') chip.classList.add('disabled');
  
  const label = document.createElement('span');
  label.className = 'type-chip-label';
  label.textContent = type;
  
  chip.appendChild(label);
  return chip;
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

function setupDragDrop() {
  const chips = document.querySelectorAll('.type-chip');
  const zones = document.querySelectorAll('.drop-zone');
  let draggingType = null;
  let draggingEl = null;
  let overZone = null;

  function setOverZone(zone) {
    if (overZone === zone) return;
    if (overZone) overZone.classList.remove('drag-over');
    overZone = zone;
    if (overZone) overZone.classList.add('drag-over');
  }

  function applyDrop(type, newColor) {
    if (!type || !newColor) return;
    userTypeColors[type] = newColor;
    save();
    renderColorGroups();
    sendToActiveTab({ type: 'RELOAD_SETTINGS' });
  }

  function onPointerMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const zone = el ? el.closest('.drop-zone') : null;
    setOverZone(zone);
  }

  function onPointerUp(e) {
    if (!draggingEl) return;
    if (draggingEl.releasePointerCapture) {
      try { draggingEl.releasePointerCapture(e.pointerId); } catch {}
    }
    draggingEl.classList.remove('dragging');
    if (overZone) {
      applyDrop(draggingType, overZone.dataset.color);
    } else {
      setOverZone(null);
    }
    draggingType = null;
    draggingEl = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }

  chips.forEach(chip => {
    chip.draggable = false;
    chip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      draggingType = chip.dataset.type;
      draggingEl = chip;
      chip.classList.add('dragging');
      if (chip.setPointerCapture) chip.setPointerCapture(e.pointerId);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });
    chip.addEventListener('click', () => {
      const enabled = chip.dataset.enabled === 'true';
      chip.dataset.enabled = String(!enabled);
      chip.classList.toggle('disabled', enabled);
      save();
      updateCount();
    });
  });
}

function updateCount() {
  sendToActiveTab({ type: 'GET_COUNT' }, res => {
    els.counter.textContent = (res?.count || 0) + ' words highlighted';
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

function setupTabs() {
  if (!els.tabButtons.length) return;
  els.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      els.tabButtons.forEach(b => b.classList.toggle('active', b === btn));
      els.tabPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.panel === target));
      if (target === 'terms') updateTermsList();
    });
  });
}

els.resetBtn.addEventListener('click', () => {
  userTypeColors = {};
  saveSettings(getSettings());
  renderColorGroups();
  sendToActiveTab({ type: 'RELOAD_SETTINGS' });
});

function init() {
  try {
    chrome.storage.sync.get(['settings', 'userTypeColors'], r => {
      settings = { enabled: true, types: {}, userTypeColors: {}, ...(r.settings || {}) };
      userTypeColors = { ...(settings.userTypeColors || {}), ...(r.userTypeColors || {}) };
      settings.userTypeColors = userTypeColors;
      els.enabled.checked = settings.enabled !== false;
      
      renderColorGroups();
      
      els.enabled.addEventListener('change', () => { save(); updateCount(); });
      setupTabs();
      updateCount();
      updateTermsList();
    });
  } catch (e) {
    console.error('ClearFrame init error:', e);
    els.colorGroups.innerHTML = '<p style="color:red">Error: Run as Chrome Extension</p>';
  }
}

init();
