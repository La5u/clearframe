export const DEFAULT_SETTINGS = {
  enabled: true,
  replaceTerms: false,
  removeTerms: false,
  types: { absolute: false, exaggeration: false, superlative: false },
  userTypeColors: {},
};

export function normalizeSettings(rawSettings = {}, rawTypeColors = {}) {
  const next = { ...DEFAULT_SETTINGS, ...rawSettings };
  next.types = { ...DEFAULT_SETTINGS.types, ...(rawSettings.types || {}) };
  next.userTypeColors = { ...(next.userTypeColors || {}), ...rawTypeColors };
  return next;
}
