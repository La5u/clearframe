export const DEFAULT_SETTINGS = {
  replaceTerms: false,
  removeTerms: false,
  monochrome: false,
  feedbackEnabled: false,
  types: { absolute: false, exaggeration: false, superlative: false },
  userTypeColors: {},
};

/**
 * @param {any} rawSettings
 * @param {any} rawTypeColors
 */
export function normalizeSettings(rawSettings = {}, rawTypeColors = {}) {
  const raw = /** @type {any} */ (rawSettings && typeof rawSettings === 'object' ? rawSettings : {});
  const legacyColors = rawTypeColors && typeof rawTypeColors === 'object' ? rawTypeColors : {};
  const { enabled: _legacyEnabled, siteEnabled: _legacySiteEnabled, ...supported } = raw;
  const next = { ...DEFAULT_SETTINGS, ...supported };
  next.types = { ...DEFAULT_SETTINGS.types, ...(raw.types && typeof raw.types === 'object' ? raw.types : {}) };
  next.userTypeColors = { ...(next.userTypeColors && typeof next.userTypeColors === 'object' ? next.userTypeColors : {}), ...legacyColors };
  return next;
}
