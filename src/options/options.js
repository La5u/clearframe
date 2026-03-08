const DEFAULT_SETTINGS = {
  enabled: true,
  highlightOnly: true,
  disabledTermIds: [],
  categories: {
    media: true,
    politics: true,
    tech: true,
    corporate: true,
    clickbait: true
  },
  modes: {
    replace: true,
    highlight: true
  }
};

function mergeSettings(next) {
  const disabledTermIds = Array.isArray(next?.disabledTermIds) ? next.disabledTermIds : DEFAULT_SETTINGS.disabledTermIds;
  return {
    ...DEFAULT_SETTINGS,
    ...next,
    disabledTermIds,
    categories: {
      ...DEFAULT_SETTINGS.categories,
      ...(next?.categories || {})
    },
    modes: {
      ...DEFAULT_SETTINGS.modes,
      ...(next?.modes || {})
    }
  };
}

function flashSaved() {
  const el = document.getElementById('saved');
  el.textContent = 'Saved';
  setTimeout(() => {
    el.textContent = '';
  }, 1200);
}

async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
  flashSaved();
}

function framingGroup(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('euphemism')) return 'euphemism';
  if (
    value.includes('clickbait') ||
    value.includes('emotional') ||
    value.includes('sensational') ||
    value.includes('fear framing') ||
    value.includes('dramatic') ||
    value.includes('escalation')
  ) return 'clickbait';
  if (
    value.includes('aggression') ||
    value.includes('attack') ||
    value.includes('loaded') ||
    value.includes('passive') ||
    value.includes('derogatory') ||
    value.includes('dysphemism') ||
    value.includes('conflict')
  ) return 'loaded';
  if (value.includes('unsourced') || value.includes('authority')) return 'attribution';
  if (
    value.includes('hype') ||
    value.includes('vague') ||
    value.includes('abstraction') ||
    value.includes('branding') ||
    value.includes('marketing')
  ) return 'hype';
  return 'other';
}

async function loadTermIndex() {
  const response = await fetch(chrome.runtime.getURL('terms-index.json'));
  if (!response.ok) {
    throw new Error(`failed to load index: ${response.status}`);
  }
  return response.json();
}

function createCategoryControl(category, enabled, settings) {
  const label = document.createElement('label');
  label.className = 'row';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = enabled;
  input.addEventListener('change', async () => {
    settings.categories[category] = input.checked;
    await saveSettings(settings);
  });

  const text = document.createElement('span');
  text.textContent = category;

  label.appendChild(input);
  label.appendChild(text);
  return label;
}

async function init() {
  const enabledInput = document.getElementById('enabled');
  const highlightOnlyInput = document.getElementById('highlight-only');
  const modeReplace = document.getElementById('mode-replace');
  const modeHighlight = document.getElementById('mode-highlight');
  const categoriesRoot = document.getElementById('categories');
  const termSearch = document.getElementById('term-search');
  const termCategory = document.getElementById('term-category');
  const termList = document.getElementById('term-list');
  const termCount = document.getElementById('term-count');
  const enableVisibleBtn = document.getElementById('enable-visible');
  const disableVisibleBtn = document.getElementById('disable-visible');
  const resetOverridesBtn = document.getElementById('reset-overrides');

  const [{ settings: raw }, index] = await Promise.all([
    chrome.storage.sync.get(['settings']),
    loadTermIndex()
  ]);
  const settings = mergeSettings(raw);
  const allTerms = Object.values(index.termsById).sort((a, b) => a.phrase.localeCompare(b.phrase));

  enabledInput.checked = settings.enabled;
  highlightOnlyInput.checked = settings.highlightOnly;
  modeReplace.checked = settings.modes.replace;
  modeHighlight.checked = settings.modes.highlight;

  enabledInput.addEventListener('change', async () => {
    settings.enabled = enabledInput.checked;
    await saveSettings(settings);
  });
  highlightOnlyInput.addEventListener('change', async () => {
    settings.highlightOnly = highlightOnlyInput.checked;
    await saveSettings(settings);
  });

  modeReplace.addEventListener('change', async () => {
    settings.modes.replace = modeReplace.checked;
    await saveSettings(settings);
  });

  modeHighlight.addEventListener('change', async () => {
    settings.modes.highlight = modeHighlight.checked;
    await saveSettings(settings);
  });

  for (const [category, enabled] of Object.entries(settings.categories)) {
    categoriesRoot.appendChild(createCategoryControl(category, enabled, settings));
  }

  function getDisabledSet() {
    return new Set(settings.disabledTermIds || []);
  }

  function filterTerms() {
    const q = termSearch.value.trim().toLowerCase();
    const cat = termCategory.value;
    return allTerms.filter((term) => {
      if (cat !== 'all' && term.category !== cat) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        term.phrase.toLowerCase().includes(q) ||
        term.neutral.toLowerCase().includes(q) ||
        term.type.toLowerCase().includes(q) ||
        term.category.toLowerCase().includes(q)
      );
    });
  }

  async function renderTerms() {
    const filtered = filterTerms();
    const disabled = getDisabledSet();
    termList.innerHTML = '';

    for (const term of filtered) {
      const row = document.createElement('label');
      row.className = 'term-row';
      if (disabled.has(term.id)) {
        row.classList.add('ph-disabled');
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !disabled.has(term.id);
      checkbox.title = checkbox.checked ? 'Enabled' : 'Disabled';
      checkbox.addEventListener('change', async () => {
        const next = getDisabledSet();
        if (checkbox.checked) {
          next.delete(term.id);
        } else {
          next.add(term.id);
        }
        settings.disabledTermIds = Array.from(next).sort();
        await saveSettings(settings);
        renderTerms();
      });

      const phrase = document.createElement('div');
      phrase.textContent = term.phrase;
      phrase.title = term.explanation;

      const neutral = document.createElement('div');
      neutral.textContent = term.neutral;

      const meta = document.createElement('div');
      meta.textContent = `${term.category} · ${term.mode}`;

      const pill = document.createElement('span');
      pill.className = `term-pill ${framingGroup(term.type)}`;
      pill.textContent = term.type;

      row.appendChild(checkbox);
      row.appendChild(phrase);
      row.appendChild(neutral);
      row.appendChild(meta);
      row.appendChild(pill);
      termList.appendChild(row);
    }

    const enabledCount = filtered.length - filtered.filter((t) => disabled.has(t.id)).length;
    termCount.textContent = `${enabledCount}/${filtered.length} visible terms enabled (${allTerms.length} total)`;
  }

  enableVisibleBtn.addEventListener('click', async () => {
    const visibleIds = new Set(filterTerms().map((term) => term.id));
    const next = getDisabledSet();
    for (const id of visibleIds) {
      next.delete(id);
    }
    settings.disabledTermIds = Array.from(next).sort();
    await saveSettings(settings);
    renderTerms();
  });

  disableVisibleBtn.addEventListener('click', async () => {
    const visibleIds = filterTerms().map((term) => term.id);
    const next = getDisabledSet();
    for (const id of visibleIds) {
      next.add(id);
    }
    settings.disabledTermIds = Array.from(next).sort();
    await saveSettings(settings);
    renderTerms();
  });

  resetOverridesBtn.addEventListener('click', async () => {
    settings.disabledTermIds = [];
    await saveSettings(settings);
    renderTerms();
  });

  termSearch.addEventListener('input', renderTerms);
  termCategory.addEventListener('change', renderTerms);
  renderTerms();
}

init().catch((err) => console.error('options init failed', err));
