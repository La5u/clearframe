// Owns the current settings. content.js loads them; the other modules read
// them through getSettings() when they need them.
import { normalize } from '../core/matcher.js';
import { DEFAULT_SETTINGS, normalizeSettings, isPaused } from '../core/settings-utils.js';

let settings = normalizeSettings(DEFAULT_SETTINGS);
let dismissedTerms = new Set();
let analysisSettings = { ...settings, dismissedTerms };

export function normalizeDismissedTerms(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(term => typeof term === 'string').map(normalize).filter(Boolean))];
}

export function setDismissedTerms(value) {
  dismissedTerms = new Set(normalizeDismissedTerms(value));
  analysisSettings = { ...settings, dismissedTerms };
}

export function getAnalysisSettings() {
  return analysisSettings;
}

export function getSettings() {
  return settings;
}

export function setSettings(rawSettings = {}) {
  settings = normalizeSettings(rawSettings);
  analysisSettings = { ...settings, dismissedTerms };
}

export function isPagePaused() {
  const ownAnalyzePage = location.href.split(/[?#]/)[0] === chrome.runtime.getURL('analyze.html');
  return isPaused(settings, location.hostname, ownAnalyzePage);
}
