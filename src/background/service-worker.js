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

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['settings'], (result) => {
    if (result.settings) {
      return;
    }

    chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== 'CLEARFRAME_BADGE_COUNT') {
    return;
  }

  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') {
    return;
  }

  const count = Number.isFinite(message.count) ? Math.max(0, Math.floor(message.count)) : 0;
  chrome.action.setBadgeBackgroundColor({ color: '#1d4ed8', tabId });
  chrome.action.setBadgeText({
    text: count > 0 ? String(Math.min(count, 999)) : '',
    tabId
  });
});
