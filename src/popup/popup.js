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

function saveSettings(settings) {
  return chrome.storage.sync.set({ settings });
}

function createCheckbox(id, labelText, checked, onChange) {
  const label = document.createElement('label');
  label.className = 'row';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));

  const text = document.createElement('span');
  text.textContent = labelText;

  label.appendChild(input);
  label.appendChild(text);
  return label;
}

async function init() {
  const enabledInput = document.getElementById('enabled');
  const highlightOnlyInput = document.getElementById('highlight-only');
  const categoryList = document.getElementById('category-list');

  const { settings: raw } = await chrome.storage.sync.get(['settings']);
  const settings = mergeSettings(raw);

  enabledInput.checked = settings.enabled;
  highlightOnlyInput.checked = settings.highlightOnly;
  enabledInput.addEventListener('change', async () => {
    settings.enabled = enabledInput.checked;
    await saveSettings(settings);
  });
  highlightOnlyInput.addEventListener('change', async () => {
    settings.highlightOnly = highlightOnlyInput.checked;
    await saveSettings(settings);
  });

  for (const [category, enabled] of Object.entries(settings.categories)) {
    const label = createCheckbox(`cat-${category}`, category, enabled, async (next) => {
      settings.categories[category] = next;
      await saveSettings(settings);
    });
    categoryList.appendChild(label);
  }
}

init().catch((err) => console.error('popup init failed', err));
