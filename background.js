'use strict';

let activeTabId = null;
const pageCounts = new Map();

function setBadge(count) {
  const text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ text });
  if (count > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  }
}

function setBadgeForTab(tabId, url) {
  activeTabId = tabId;
  setBadge(pageCounts.get(url) || 0);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'COUNT') {
    const count = msg.count || 0;
    const url = sender.tab?.url;
    const tabId = sender.tab?.id;
    if (url) pageCounts.set(url, count);
    if (tabId === activeTabId) {
      setBadge(count);
    }
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, tab => {
    setBadgeForTab(tabId, tab?.url || '');
  });
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId !== activeTabId || info.status !== 'complete') return;
  chrome.tabs.get(tabId, tab => {
    setBadgeForTab(tabId, tab?.url || '');
  });
});
