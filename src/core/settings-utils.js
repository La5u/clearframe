export const SENSITIVITIES = ['strong', 'standard', 'all'];

/** @type {import('../types/clearframe').ClearFrameSettings} */
export const DEFAULT_SETTINGS = {
  studyMode: false,
  paused: false,
  pausedSites: [],
  replaceTerms: false,
  monochrome: true,
  predictFirst: false,
  headlinesOnly: false,
  sensitivity: 'strong',
  types: { absolute: false, superlative: false, quote: false, 'direct-address': false, imperative: false, modality: false },
};

/** @param {any} rawSettings */
export function normalizeSettings(rawSettings = {}) {
  const raw = rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings) ? rawSettings : {};
  // Only supported settings survive; old preferences are tolerated and ignored.
  const next = { ...DEFAULT_SETTINGS };
  for (const key of ['studyMode', 'paused', 'replaceTerms', 'monochrome', 'predictFirst', 'headlinesOnly']) {
    next[key] = raw[key] === undefined ? DEFAULT_SETTINGS[key] : raw[key] === true;
  }
  next.sensitivity = SENSITIVITIES.includes(raw.sensitivity) ? raw.sensitivity : DEFAULT_SETTINGS.sensitivity;
  next.pausedSites = [...new Set((Array.isArray(raw.pausedSites) ? raw.pausedSites : [])
    .filter(site => typeof site === 'string').map(normalizeHostname).filter(Boolean))];
  const rawTypes = raw.types && typeof raw.types === 'object' && !Array.isArray(raw.types) ? raw.types : {};
  next.types = { ...DEFAULT_SETTINGS.types };
  for (const [type, enabled] of Object.entries(rawTypes)) next.types[type] = enabled === true;
  return next;
}

export function normalizeHostname(hostname) {
  return hostname.trim().toLowerCase().replace(/^www\./, '');
}

export function isPaused(settings, hostname = '', ownAnalyzePage = false) {
  return settings.paused === true || (!ownAnalyzePage && settings.pausedSites.includes(normalizeHostname(hostname)));
}
