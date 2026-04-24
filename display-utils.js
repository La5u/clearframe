const ALL_CAPS_ACRONYMS = new Set([
  'ABBA',
  'AI',
  'BBC',
  'CBS',
  'CDC',
  'CEO',
  'EU',
  'FDA',
  'FBI',
  'GOP',
  'IRS',
  'LAX',
  'MLB',
  'NBA',
  'NHL',
  'NFL',
  'NYP',
  'NATO',
  'SEC',
  'UN',
  'UK',
  'USA',
  'UFC',
  'WWE'
]);

function lowerAllCapsLongWords(text) {
  if (!text) return text;
  return text.replace(/\b[A-Z]{2,}\b/g, word => ALL_CAPS_ACRONYMS.has(word) ? word : word.toLowerCase());
}

module.exports = {
  lowerAllCapsLongWords
};
