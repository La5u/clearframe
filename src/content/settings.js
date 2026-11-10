// Owns the current settings. content.js loads them; the other modules read
// them through getSettings() when they need them.
import { DEFAULT_SETTINGS, normalizeSettings } from '../core/settings-utils.js';

let settings = normalizeSettings(DEFAULT_SETTINGS);

export function getSettings() {
  return settings;
}

export function setSettings(rawSettings = {}, rawTypeColors = {}) {
  settings = normalizeSettings(rawSettings, rawTypeColors);
}

export function isFeedbackEnabled() {
  return settings.feedbackEnabled === true;
}
