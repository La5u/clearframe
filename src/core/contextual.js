export const CONTEXTUAL_TERMS = {
  '__clearframe_headline_question__': { phrase: 'headline question', type: 'rhetorical-question', confidence: 'medium' },
  '__clearframe_direct_address__': { phrase: 'direct address', type: 'clickbait', confidence: 'contextual' },
  '__clearframe_quoted_wording__': { phrase: 'quoted wording', type: 'quote', confidence: 'exploratory' },
  '__clearframe_transformation__': { phrase: 'from-to transformation', type: 'hype', confidence: 'contextual' },
  '__clearframe_history_claim__': { phrase: 'history superlative', type: 'superlative', confidence: 'contextual' },
  '__clearframe_list_promise__': { phrase: 'list promise', type: 'clickbait', confidence: 'contextual' },
  '__clearframe_reaction_claim__': { phrase: 'audience reaction', type: 'unsourced', confidence: 'contextual' },
  '__clearframe_even_framing__': { phrase: 'even framing', type: 'loaded-framing', confidence: 'contextual' },
  '__clearframe_passive_agency__': { phrase: 'passive agency', type: 'passive', confidence: 'contextual' },
};

function addMatches(matches, text, pattern, termId) {
  for (const match of text.matchAll(pattern)) {
    if (typeof match.index === 'number' && match[0]) {
      matches.push({ start: match.index, end: match.index + match[0].length, termId, virtual: true });
    }
  }
}

function isWordChar(char) {
  return !!char && /[\p{L}\p{N}]/u.test(char);
}

function addQuotedWording(matches, text) {
  const candidates = [];
  const pairs = [['“', '”'], ['‘', '’'], ['"', '"'], ["'", "'"]];
  for (const [open, close] of pairs) {
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(open, cursor);
      if (start < 0) break;
      let end = text.indexOf(close, start + 1);
      while (end >= 0 && open === close && isWordChar(text[end - 1]) && isWordChar(text[end + 1])) {
        end = text.indexOf(close, end + 1);
      }
      cursor = start + 1;
      if (end < 0) break;
      const content = text.slice(start + 1, end).trim();
      const outerBoundary = !isWordChar(text[start - 1]) && !isWordChar(text[end + 1]);
      const words = content.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
      const shortScareQuote = words.length >= 1 && words.length <= 6 && content.length <= 60 && !/[.!?,;:]\s*$/u.test(content);
      const validSingleQuote = open !== "'" || content.replace(/[^\p{L}\p{N}]/gu, '').length >= 2;
      if (outerBoundary && shortScareQuote && validSingleQuote && /\p{L}/u.test(content)) {
        candidates.push({ start, end: end + 1, termId: '__clearframe_quoted_wording__', virtual: true });
        cursor = end + 1;
      }
    }
  }
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  for (const candidate of candidates) {
    if (!candidates.some(other => other !== candidate && other.start <= candidate.start && other.end >= candidate.end)) matches.push(candidate);
  }
}

const DIRECT_ADDRESS_PATTERNS = [
  /\byou (?:won't|will not) believe\b/giu,
  /\bwhat you (?:need|must|should) (?:to )?know\b/giu,
  /\b(?:mistakes?|things?) you(?:'re| are) (?:making|doing)\b/giu,
  /\b(?:mistakes?|things?|signs?|reasons?) you (?:need|must|should|could|can)\b/giu,
  /\b(?:why|how) you (?:need|must|should|could|can|will|are|keep)\b/giu,
  /\bwill make you\b/giu,
];

export function classifyPageContext(hostname = '') {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  if (/(^|\.)reddit\.com$/.test(host)) return 'discussion';
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) return 'video';
  return 'publication';
}

export function findContextualMatches(text, { headline = false, conversational = false, pageContext = 'publication' } = {}) {
  const matches = [];
  if (pageContext === 'publication' && !conversational) {
    addMatches(matches, text, /\b(?:(?:mistakes?|errors?) (?:was|were|have been|had been) made|(?:concerns?|questions?) (?:was|were|have been|had been) raised|(?:jobs?|positions?) (?:was|were|have been|had been) (?:cut|eliminated)|(?:funds?|money) (?:was|were|have been|had been) (?:spent|lost)|(?:records?|evidence) (?:was|were|have been|had been) (?:removed|deleted|destroyed)|it was decided|(?:was|were) asked to resign)\b/giu, '__clearframe_passive_agency__');
  }
  if (!headline) return matches;
  if (pageContext === 'publication' && /\?\s*$/.test(text)) {
    // The question starts after the last sentence break; "a.m." or "U.S." are not breaks.
    const breaks = [...text.slice(0, -1).matchAll(/[.!?:]\s+(?=[\p{Lu}‘'"“])/gu)];
    const last = breaks[breaks.length - 1];
    const start = last ? last.index + last[0].length : text.search(/\S/);
    // Only yes/no questions invite the reader to supply an answer the article may not
    // support; who/what/why questions are usually explainers.
    if (/^(?:is|are|was|were|can|could|will|would|should|does|do|did|has|have|had|might|may)\b/iu.test(text.slice(start)) && !/^tell us\b/iu.test(text.trim())) {
      matches.push({ start, end: text.length, termId: '__clearframe_headline_question__', virtual: true });
    }
  }
  if (!conversational) {
    for (const pattern of DIRECT_ADDRESS_PATTERNS) addMatches(matches, text, pattern, '__clearframe_direct_address__');
  }
  if (pageContext === 'publication') addQuotedWording(matches, text);
  if (pageContext === 'publication') addMatches(matches, text, /\b[Ee]ven\s+(?:the\s+)?(?:[\p{Lu}][\p{L}'’-]*|experts?|critics?|supporters?|opponents?)\s+(?:can|could|does|did|is|was|will|has|had)\b/gu, '__clearframe_even_framing__');
  // A transformation arc opens the headline ("From forgotten room to luxury retreat");
  // mid-sentence "from X to Y" is usually a route, a range, or a list.
  if (pageContext !== 'discussion') addMatches(matches, text, /^\s*from\s+[^.!?;:$\d]{1,40}\s+to\s+[^.!?;:$\d]{1,40}/giu, '__clearframe_transformation__');
  addMatches(matches, text, /\bone of the most\s+[^.!?;:]{1,45}\s+in history\b/giu, '__clearframe_history_claim__');
  addMatches(matches, text, /\b(?:top|best)\s+(?:five|ten|\d+)\s+[^.!?;:]{1,45}\b(?:you|everyone|every\s+\w+)\s+needs?\b/giu, '__clearframe_list_promise__');
  addMatches(matches, text, /\b(?:fans|viewers|critics|users)\s+(?:gasp|rave|insist|slam|love|hate)\b/giu, '__clearframe_reaction_claim__');
  return matches;
}
