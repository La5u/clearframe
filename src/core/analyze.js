// Detection and planning for one piece of text, without the DOM: runs the
// lexical matcher (with rule exceptions), all-caps and contextual detectors,
// resolves overlaps, and decides per match what to show (highlight, reword or
// remove) and under which highlight name. Shared by the content script and
// the Node evaluation tools.
import { buildMatcher, findMatches } from './matcher.js';
import { matchReplacementCase } from './display-utils.js';
import { pluralizeWord, pastTenseWord, ingWord, adverbWord, inflectPhrase } from './stemmer.js';
import { chooseAction, chooseReplacementTerm, getReplacementSourceText, resolveMatchGroups } from './match-plan.js';
import { ALL_CAPS_TERM_ID, findAllCapsMatches, restoreAllCapsCase } from './all-caps.js';
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

// Which form of its base phrase the matched text is (see inflectPhrase), or
// null for wording that is no inflection of it, such as an alias.
function getSourceForm(source, base, stemType) {
  if (source === base) return '';
  if (stemType === 'noun') return source === pluralizeWord(base) ? 'plural' : null;
  if (stemType === 'adjective') return source === adverbWord(base) ? 'adverb' : null;
  if (stemType !== 'verb') return null;
  if (source === pluralizeWord(base)) return 'third';
  if (source === pastTenseWord(base)) return 'past';
  return source === ingWord(base) ? 'ing' : null;
}

// "was axed", "has been quietly axed": a past participle, not a past tense.
const PARTICIPLE_BEFORE = /\b(?:am|is|are|was|were|be|been|being|has|have|had|having|get|gets|got|gotten|getting)\s+(?:\w+ly\s+)?$/i;

function applyStemmedReplacement(src, base, replacement, stemType, textBefore) {
  const form = stemType ? getSourceForm(src.replace(/\s+/g, ' ').toLowerCase(), base.toLowerCase(), stemType) : null;
  const next = form === null ? replacement
    : inflectPhrase(replacement, stemType, form === 'past' && PARTICIPLE_BEFORE.test(textBefore.slice(-40)) ? 'participle' : form);
  return matchReplacementCase(src, next);
}

function getReplacementForTerm(term, src, textBefore, restoreCase) {
  return term.phrase === ALL_CAPS_TERM.phrase
    ? restoreCase(src)
    : applyStemmedReplacement(src, term.phrase, term.neutral, term.stemType || '', textBefore);
}

function getReplacementText(term, src, action, textBefore, restoreCase) {
  if (action === 'removed') return '';
  if (action === 'replaced') return getReplacementForTerm(term, src, textBefore, restoreCase);
  return src;
}

// "2003's Shock and Awe invasion": a capitalised word inside a sentence that
// runs on into more capitalised words is part of a name or title, so it is
// only highlighted. Title Case headlines, with no lowercase words, are not
// sentences and keep the usual action.
function isPartOfTitle(text, start, end) {
  const before = text.slice(0, start), after = text.slice(end);
  if (!/^[A-Z][a-z]/.test(text.slice(start, end)) || /(?:^|[.!?:;"“‘'(|–—-])\s*$/.test(before)) return false;
  const joined = /^\s+(?:(?:and|of|the|&)\s+)?[A-Z][a-z]/.test(after) || /[A-Z][a-z][\w'’-]*\s+(?:(?:and|of|the|&)\s+)?$/.test(before);
  return joined && /(?:^|\s)(?!(?:and|from|into|with|that|this)\b)[a-z]{4,}/.test(`${before} ${after}`);
}

const CLOSING_QUOTE = { "'": "'", '‘': '’', '"': '"', '“': '”' };

/**
 * Widens a removal over the debris it would leave: quotes around only the
 * removed wording, a doubled space or a space before punctuation, and at the
 * start of a sentence an orphaned ":", "," or dash ("EXCLUSIVE: Ewan"). A
 * capitalised removed word passes its capital on to the next word. Returns
 * the original span [start, end) and the text that replaces it, so restoring
 * the original stays a plain swap.
 * @param {string} text @param {string} shownBefore display text before match.start
 * @param {number} cursor end of the previous entry @param {number} limit start of the next one
 */
function tidyRemoval(text, shownBefore, cursor, start, end, limit) {
  const capital = /^[A-Z]/.test(text.slice(start, end));
  if (start > cursor && CLOSING_QUOTE[text[start - 1]] && text[end] === CLOSING_QUOTE[text[start - 1]] && end < limit) {
    start--; end++; shownBefore = shownBefore.slice(0, -1);
  }
  if (/(?:^|[.!?:]\s)\s*$/.test(shownBefore)) {
    end += /^\s*(?:[:,;|–—-]+\s*)?/.exec(text.slice(end, limit))?.[0].length || 0;
    const next = text[end];
    return capital && end < limit && next && next !== next.toUpperCase()
      ? { start, end: end + 1, replacement: next.toUpperCase() }
      : { start, end, replacement: '' };
  }
  const space = /\s*$/.exec(text.slice(cursor, start))?.[0].length || 0;
  const after = text.slice(end, limit);
  if (space && (/^[,.;:!?)\]'’"”…]/.test(after) || end === text.length)) return { start: start - space, end, replacement: '' };
  if (space || /['‘"“(]$/.test(shownBefore)) end += /^\s*/.exec(after)?.[0].length || 0;
  return { start, end, replacement: '' };
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
    combined.forEach((match, i) => {
      const terms = getTermsForMatch(match);
      // An expanded group spans beyond its lexical term; only all-caps
      // normalization is safe across the whole range, otherwise highlight.
      const capsTerms = match.expanded ? terms.filter(item => item.phrase === ALL_CAPS_TERM.phrase) : [];
      const term = chooseReplacementTerm(capsTerms.length ? capsTerms : terms, termAction, ALL_CAPS_TERM.phrase);
      if (!term) return;
      const wording = text.slice(match.start, match.end);
      let action = match.expanded && !capsTerms.length ? 'highlighted' : termAction(term);
      if (action !== 'highlighted' && term.phrase !== ALL_CAPS_TERM.phrase && isPartOfTitle(text, match.start, match.end)) action = 'highlighted';
      const textBefore = text.slice(0, match.start);
      const restoreCase = src => restoreAllCapsCase(src, textBefore, text.slice(match.end));
      const replacementSource = getReplacementSourceText(term, terms, wording, ALL_CAPS_TERM.phrase, restoreCase);
      let span = { start: match.start, end: match.end, replacement: getReplacementText(term, replacementSource, action, textBefore, restoreCase) };
      if (action === 'removed') span = tidyRemoval(text, displayText + textBefore.slice(cursor), cursor, match.start, match.end, combined[i + 1]?.start ?? text.length);
      displayText += text.slice(cursor, span.start);
      const start = displayText.length;
      displayText += span.replacement;
      // sourceText and replacementText are the exact original and displayed
      // text of the entry; a tidied removal spans more than its wording.
      entries.push({ start, end: displayText.length, term, terms, action, wording, sourceText: text.slice(span.start, span.end), replacementText: span.replacement, highlightName: getHighlightNameForEntry(term, action, terms) });
      cursor = span.end;
    });
    displayText += text.slice(cursor);
    return { displayText, entries };
  }

  return { analyze, findLexicalMatches };
}
