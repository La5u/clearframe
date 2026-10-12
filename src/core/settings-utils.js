export const DEFAULT_SETTINGS = {
  replaceTerms: false,
  removeTerms: false,
  monochrome: true,
  feedbackEnabled: false,
  types: { absolute: false, exaggeration: false, superlative: false, quote: false },
  userTypeColors: {},
};

/**
 * @param {any} rawSettings
 * @param {any} rawTypeColors
 */
export function normalizeSettings(rawSettings = {}, rawTypeColors = {}) {
  const raw = /** @type {any} */ (rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings) ? rawSettings : {});
  const legacyColors = rawTypeColors && typeof rawTypeColors === 'object' && !Array.isArray(rawTypeColors) ? rawTypeColors : {};
  const { enabled: _legacyEnabled, siteEnabled: _legacySiteEnabled, ...supported } = raw;
  const next = { ...DEFAULT_SETTINGS, ...supported };
  for (const key of ['replaceTerms', 'removeTerms', 'monochrome', 'feedbackEnabled']) {
    next[key] = raw[key] === undefined ? DEFAULT_SETTINGS[key] : raw[key] === true;
  }
  const rawTypes = raw.types && typeof raw.types === 'object' && !Array.isArray(raw.types) ? raw.types : {};
  next.types = { ...DEFAULT_SETTINGS.types };
  for (const [type, enabled] of Object.entries(rawTypes)) {
    next.types[type] = enabled === true;
  }
  const colors = next.userTypeColors && typeof next.userTypeColors === 'object' && !Array.isArray(next.userTypeColors) ? next.userTypeColors : {};
  next.userTypeColors = { ...colors, ...legacyColors };
  return next;
}
