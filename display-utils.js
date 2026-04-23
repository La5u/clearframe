function lowerAllCapsLongWords(text) {
  if (!text) return text;
  return text.replace(/\b[A-Z]{6,}\b/g, word => word.toLowerCase());
}

function normalizeRenderedText(text, replaceTerms) {
  return replaceTerms ? lowerAllCapsLongWords(text) : text;
}

module.exports = {
  lowerAllCapsLongWords,
  normalizeRenderedText
};
