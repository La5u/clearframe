'use strict';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'COUNT') {
    const count = msg.count || 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    if (count > 0) {
      chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
    }
  }
});

chrome.tabs.onActivated.addListener(() => chrome.action.setBadgeText({ text: '' }));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') chrome.action.setBadgeText({ text: '' });
});
