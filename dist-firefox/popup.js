(function() {
  'use strict';

  const TYPES = [
    { id: 'euphemism', label: 'Euphemisms', color: 'blue' },
    { id: 'aggressive', label: 'Aggressive', color: 'red' },
    { id: 'aggression', label: 'Aggression', color: 'red' },
    { id: 'moral', label: 'Moral', color: 'red' },
    { id: 'derogatory', label: 'Derogatory', color: 'red' },
    { id: 'loaded', label: 'Loaded', color: 'red' },
    { id: 'partisan', label: 'Partisan', color: 'red' },
    { id: 'sensational', label: 'Sensational', color: 'yellow' },
    { id: 'clickbait', label: 'Clickbait', color: 'yellow' },
    { id: 'reveal', label: 'Reveal', color: 'yellow' },
    { id: 'hype', label: 'Hype', color: 'yellow' },
    { id: 'superlative', label: 'Superlative', color: 'green' },
    { id: 'exaggeration', label: 'Exaggeration', color: 'green' },
    { id: 'framing', label: 'Framing', color: 'gray' },
    { id: 'unsourced', label: 'Unsourced', color: 'gray' },
    { id: 'uncertainty', label: 'Uncertainty', color: 'gray' },
    { id: 'authority', label: 'Authority', color: 'gray' },
    { id: 'vague', label: 'Vague', color: 'gray' },
    { id: 'emotional', label: 'Emotional', color: 'purple' },
    { id: 'fear', label: 'Fear', color: 'purple' },
    { id: 'conflict', label: 'Conflict', color: 'orange' },
    { id: 'drama', label: 'Drama', color: 'orange' },
    { id: 'disaster', label: 'Disaster', color: 'orange' }
  ];

  const DEFAULT_SETTINGS = {
    enabled: true,
    darkMode: false,
    types: {}
  };

  const els = {
    enabled: document.getElementById('enabled'),
    darkMode: document.getElementById('darkMode'),
    counter: document.getElementById('counter'),
    typesContainer: document.getElementById('types-container')
  };

  function createTypeToggle(type) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <input type="checkbox" id="type-${type.id}" data-type="${type.id}">
      <label for="type-${type.id}">${type.label}</label>
    `;
    return row;
  }

  function initTypes() {
    TYPES.forEach(type => {
      els.typesContainer.appendChild(createTypeToggle(type));
    });
  }

  function getSettings() {
    const settings = {
      enabled: els.enabled.checked,
      darkMode: els.darkMode.checked,
      types: {}
    };
    TYPES.forEach(type => {
      const checkbox = document.getElementById(`type-${type.id}`);
      if (checkbox) {
        settings.types[type.id] = checkbox.checked;
      }
    });
    return settings;
  }

  function saveSettings(settings) {
    chrome.storage.sync.set({ settings });
  }

  function applyDarkMode(enabled) {
    document.body.classList.toggle('dark', enabled);
  }

  function loadSettings() {
    chrome.storage.sync.get(['settings'], (result) => {
      const settings = result.settings || DEFAULT_SETTINGS;
      els.enabled.checked = settings.enabled !== false;
      els.darkMode.checked = settings.darkMode === true;
      applyDarkMode(els.darkMode.checked);
      TYPES.forEach(type => {
        const checkbox = document.getElementById(`type-${type.id}`);
        if (checkbox) {
          const isEnabled = settings.types?.[type.id];
          checkbox.checked = isEnabled !== false;
        }
      });
    });
  }

  function updateBadge(count) {
    const text = count > 0 ? String(count) : '';
    chrome.action.setBadgeText({ text });
    if (count > 0) {
      chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
      chrome.action.setBadgeTextColor({ color: '#ffffff' });
    } else {
      chrome.action.setBadgeBackgroundColor({ color: '#666' });
    }
  }

  function loadWordCount() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || tabs[0].id === chrome.tabs.TAB_ID_NONE) {
        els.counter.textContent = 'Cannot access page';
        updateBadge(0);
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEARFRAME_GET_COUNT' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEARFRAME_SCAN' }, (res) => {
            const count = res?.count || 0;
            els.counter.textContent = `${count} words highlighted`;
            updateBadge(count);
          });
          return;
        }
        const count = response.count || 0;
        els.counter.textContent = `${count} words highlighted`;
        updateBadge(count);
      });
    });
  }

  function setupListeners() {
    els.enabled.addEventListener('change', () => saveSettings(getSettings()));
    els.darkMode.addEventListener('change', () => {
      applyDarkMode(els.darkMode.checked);
      saveSettings(getSettings());
    });
    TYPES.forEach(type => {
      const checkbox = document.getElementById(`type-${type.id}`);
      if (checkbox) {
        checkbox.addEventListener('change', () => saveSettings(getSettings()));
      }
    });
  }

  initTypes();
  loadSettings();
  setupListeners();
  loadWordCount();
})();
