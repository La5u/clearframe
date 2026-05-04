'use strict';

function setBadge(count) {
  if (count == null) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ text });
  if (count > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  }
}

function refreshActiveBadge() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab?.id) {
      setBadge(null);
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'GET_COUNT' }, res => {
      if (chrome.runtime.lastError) {
        setBadge(null);
        return;
      }
      setBadge(typeof res?.count === 'number' ? res.count : 0);
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'COUNT' || !sender.tab?.id) return;

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.id === sender.tab.id) {
      setBadge(typeof msg.count === 'number' ? msg.count : 0);
    }
  });
});

chrome.tabs.onActivated.addListener(refreshActiveBadge);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    setBadge(null);
  }
  if (info.status === 'complete') {
    refreshActiveBadge();
  }
});

refreshActiveBadge();
