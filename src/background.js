'use strict';

function setBadge(count) {
  if (count === null) {
    void chrome.action.setBadgeText({ text: '' }); return;
  }
  const text = count > 0 ? String(count) : '';
  void chrome.action.setBadgeText({ text });
  if (count > 0) {
    void chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  }
}

function refreshActiveBadge() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (typeof tab?.id !== 'number') {
      setBadge(null); return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'GET_COUNT' }, res => {
      if (chrome.runtime.lastError) {
        setBadge(null); return;
      }
      setBadge(typeof res?.count === 'number' ? res.count : 0);
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (msg.type !== 'COUNT' || typeof tabId !== 'number') {
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.id === tabId) {
      setBadge(typeof msg.count === 'number' ? msg.count : 0);
    }
  });
});

chrome.tabs.onActivated.addListener(refreshActiveBadge);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'loading' && info.status !== 'complete') {
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.id !== tabId) {
      return;
    }
    if (info.status === 'loading') {
      setBadge(null);
    } else {
      refreshActiveBadge();
    }
  });
});
refreshActiveBadge();
