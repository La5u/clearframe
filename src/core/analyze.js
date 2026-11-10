// Detection and planning for one piece of text, without the DOM: runs the
// lexical matcher (with rule exceptions), all-caps and contextual detectors,
// resolves overlaps, and decides per match what to show (highlight, reword or
// remove) and under which highlight name. Shared by the content script and
// the Node evaluation tools.
import { buildMatcher, findMatches } from './matcher.js';
import { lowerAllCapsLongWords, matchReplacementCase } from './display-utils.js';
import { pluralizeWord, pastTenseWord, ingWord, adverbWord } from './stemmer.js';
import { chooseAction, chooseReplacementTerm, getReplacementSourceText, resolveMatchGroups } from './match-plan.js';
import { ALL_CAPS_TERM_ID, findAllCapsMatches } from './all-caps.js';
import { CONTEXTUAL_TERMS, findContextualMatches } from './contextual.js';
import { createLexicalFilter } from './context-filter.js';

export const HIGHLIGHT_PREFIX = 'clearframe-';
export const ALL_CAPS_HIGHLIGHT_NAME = 'clearframe-all-caps-underline';
// Terms below high confidence render fainter, so a reader can weigh them
// less: medium (e.g. "alleged") at 75%, contextual and exploratory at 50%.
export const STRENGTHS = { high: { suffix: '', alpha: 1 }, medium: { suffix: '-medium', alpha: 0.75 }, low: { suffix: '-low', alpha: 0.5 } };
const TYPE_PRIORITY = ['derogatory', 'aggression', 'fear', 'loaded', 'moral', 'dysphemism', 'clickbait', 'loaded-framing', 'unsourced', 'euphemism', 'passive', 'negative-framing', 'conflict', 'exaggeration', 'superlative', 'hype', 'authority', 'uncertainty', 'distancing', 'minimizing', 'all-caps', 'absolute', 'repetition', 'rhetorical-question', 'colloquialism', 'idiom', 'reveal', 'quote'];
const ALL_CAPS_TERM = { phrase: 'caps emphasis', type: 'all-caps', neutral: 'Caps normalized.' };

function getTypeRank(type) {
  const index = TYPE_PRIORITY.indexOf(type);
  return index === -1 ? TYPE_PRIORITY.length : index;
}

export function getMostImportantType(terms) {
  let best = terms[0]?.type;
  for (const term of terms) {
    if (getTypeRank(term.type) < getTypeRank(best)) best = term.type;
  }
  return best;
}

export function getHighlightName(type, mode = 'highlight', strength = 'high') {
  return HIGHLIGHT_PREFIX + String(type).replace(/[^a-z0-9-]/gi, '-') + STRENGTHS[strength].suffix + (mode === 'underline' ? '-underline' : '');
}

export function getStrength(confidence = 'high') {
  return confidence === 'high' || confidence === 'medium' ? confidence : 'low';
}

// Overlapping terms draw at the strength of the most confident one.
function getEntryStrength(terms) {
  const strengths = terms.map(term => getStrength(term.confidence));
  return strengths.includes('high') ? 'high' : strengths.includes('medium') ? 'medium' : 'low';
}

function applyStemmedReplacement(src, base, replacement, stemType) {
  const source = src.toLowerCase(), normalizedBase = base.toLowerCase();
  let next = replacement;
  if (stemType === 'noun' && source === pluralizeWord(normalizedBase)) {
    next = pluralizeWord(replacement);
  } else if (stemType === 'verb') {
    if (source === pluralizeWord(normalizedBase)) next = pluralizeWord(replacement);
    else if (source === pastTenseWord(normalizedBase)) next = pastTenseWord(replacement);
    else if (source === ingWord(normalizedBase)) next = ingWord(replacement);
  } else if (stemType === 'adjective' && source === adverbWord(normalizedBase)) {
    next = adverbWord(replacement);
  }
  return matchReplacementCase(src, next);
}

function getReplacementForTerm(term, src) {
  return term.phrase === ALL_CAPS_TERM.phrase
    ? lowerAllCapsLongWords(src)
    : applyStemmedReplacement(src, term.phrase, term.neutral, term.stemType || '');
}

function getReplacementText(term, src, action) {
  if (action === 'removed') return '';
  if (action === 'replaced') return getReplacementForTerm(term, src);
  return src;
}

function getHighlightNameForEntry(term, action, terms) {
  if (action === 'removed') return null;
  const strength = getEntryStrength(terms.length ? terms : [term]);
  if (terms.length > 1) return getHighlightName(getMostImportantType(terms), 'highlight', strength);
  if (action === 'highlighted') return getHighlightName(term.type, 'highlight', strength);
  return term.phrase === ALL_CAPS_TERM.phrase ? ALL_CAPS_HIGHLIGHT_NAME : getHighlightName(term.type, 'underline', strength);
}

/**
 * @param {{index: {termsById: Record<string, any>, regexTerms?: any[], exceptions?: any}}} options
 */
export function createAnalyzer({ index }) {
  const shouldKeepLexicalMatch = createLexicalFilter(index.exceptions);
  // The trie holds only enabled types; rebuilt when a new settings object arrives.
  let matcher = null, matcherSettings = null;

  const isEnabled = (settings, type) => settings.types?.[type] !== false;

  function getTermById(id) {
    const term = index.termsById[id];
    if (term && !term.phrase) term.phrase = id;
    return term || CONTEXTUAL_TERMS[id] || (id === ALL_CAPS_TERM_ID ? ALL_CAPS_TERM : null);
  }

  function getTermsForMatch(match) {
    return (match.termIds || [match.termId]).map(getTermById).filter(Boolean);
  }

  // Phrase and pattern rules only, after rule exceptions, without overlap
  // resolution against the structural detectors.
  function findLexicalMatches(text, context, settings) {
    if (settings !== matcherSettings) {
      matcher = buildMatcher(index, term => isEnabled(settings, term.type));
      matcherSettings = settings;
    }
    return findMatches(matcher, text, index.termsById, index.regexTerms || [],
      term => isEnabled(settings, term.type),
      (termId, start, end) => shouldKeepLexicalMatch(getTermById(termId), text.slice(start, end), text, context, start));
  }

  /**
   * Returns the text to display and one entry per detection, with offsets
   * into displayText.
   * @param {string} text
   * @param {{headline?: boolean, conversational?: boolean, preserveText?: boolean, capsLabel?: boolean, pageContext?: string}} context
   * @param {{types?: Record<string, boolean>, replaceTerms?: boolean, removeTerms?: boolean}} settings
   */
  function analyze(text, context = {}, settings) {
    const matches = findLexicalMatches(text, context, settings);
    const allCaps = isEnabled(settings, ALL_CAPS_TERM.type) && !context.capsLabel ? findAllCapsMatches(text) : [];
    const contextual = findContextualMatches(text, context).filter(match => isEnabled(settings, getTermById(match.termId)?.type));
    const combined = resolveMatchGroups([...matches, ...allCaps, ...contextual]);
    let cursor = 0, displayText = '';
    const entries = [];
    const termAction = term => chooseAction(term, settings, context.preserveText === true);
    for (const match of combined) {
      const terms = getTermsForMatch(match);
      // An expanded group spans beyond its lexical term; only all-caps
      // normalization is safe across the whole range, otherwise highlight.
      const capsTerms = match.expanded ? terms.filter(item => item.phrase === ALL_CAPS_TERM.phrase) : [];
      const term = chooseReplacementTerm(capsTerms.length ? capsTerms : terms, termAction, ALL_CAPS_TERM.phrase);
      if (!term) continue;
      const sourceText = text.slice(match.start, match.end);
      const action = match.expanded && !capsTerms.length ? 'highlighted' : termAction(term);
      const replacementSource = getReplacementSourceText(term, terms, sourceText, ALL_CAPS_TERM.phrase, lowerAllCapsLongWords);
      const replacementText = getReplacementText(term, replacementSource, action);
      displayText += text.slice(cursor, match.start);
      const start = displayText.length;
      displayText += replacementText;
      entries.push({ start, end: displayText.length, term, terms, action, sourceText, replacementText, highlightName: getHighlightNameForEntry(term, action, terms) });
      cursor = match.end;
    }
    displayText += text.slice(cursor);
    return { displayText, entries };
  }

  return { analyze, findLexicalMatches };
}
