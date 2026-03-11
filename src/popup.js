(function() {
  'use strict';

  const DEFAULT_SETTINGS = {
    enabled: true,
    darkMode: false,
    categories: {
      media: true,
      politics: true,
      tech: true,
      corporate: true,
      clickbait: true
    }
  };

  const els = {
    enabled: document.getElementById('enabled'),
    darkMode: document.getElementById('darkMode'),
    counter: document.getElementById('counter'),
    'cat-media': document.getElementById('cat-media'),
    'cat-politics': document.getElementById('cat-politics'),
    'cat-tech': document.getElementById('cat-tech'),
    'cat-corporate': document.getElementById('cat-corporate'),
    'cat-clickbait': document.getElementById('cat-clickbait')
  };

  function getSettings() {
    return {
      enabled: els.enabled.checked,
      darkMode: els.darkMode.checked,
      categories: {
        media: els['cat-media'].checked,
        politics: els['cat-politics'].checked,
        tech: els['cat-tech'].checked,
        corporate: els['cat-corporate'].checked,
        clickbait: els['cat-clickbait'].checked
      }
    };
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
      els['cat-media'].checked = settings.categories?.media !== false;
      els['cat-politics'].checked = settings.categories?.politics !== false;
      els['cat-tech'].checked = settings.categories?.tech !== false;
      els['cat-corporate'].checked = settings.categories?.corporate !== false;
      els['cat-clickbait'].checked = settings.categories?.clickbait !== false;
    });
  }

  function loadWordCount() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || tabs[0].id === chrome.tabs.TAB_ID_NONE) {
        els.counter.textContent = 'Cannot access page';
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEARFRAME_GET_COUNT' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          els.counter.textContent = 'No words detected';
          return;
        }
        els.counter.textContent = `${response.count} words highlighted`;
      });
    });
  }

  function setupListeners() {
    els.enabled.addEventListener('change', () => saveSettings(getSettings()));
    els.darkMode.addEventListener('change', () => {
      applyDarkMode(els.darkMode.checked);
      saveSettings(getSettings());
    });
    els['cat-media'].addEventListener('change', () => saveSettings(getSettings()));
    els['cat-politics'].addEventListener('change', () => saveSettings(getSettings()));
    els['cat-tech'].addEventListener('change', () => saveSettings(getSettings()));
    els['cat-corporate'].addEventListener('change', () => saveSettings(getSettings()));
    els['cat-clickbait'].addEventListener('change', () => saveSettings(getSettings()));
  }

  loadSettings();
  setupListeners();
  loadWordCount();
})();
