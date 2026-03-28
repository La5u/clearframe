'use strict';

function setBadge(count) {
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
      setBadge(0);
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'GET_COUNT' }, res => {
      if (chrome.runtime.lastError) {
        setBadge(0);
        return;
      }
      setBadge(res?.count || 0);
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'COUNT' || !sender.tab?.id) return;

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.id === sender.tab.id) {
      setBadge(msg.count || 0);
    }
  });
});

chrome.tabs.onActivated.addListener(refreshActiveBadge);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') {
    refreshActiveBadge();
  }
});

refreshActiveBadge();
