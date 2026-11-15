// Detection and planning for one piece of text, without the DOM: runs the
// lexical matcher (with rule exceptions), all-caps and contextual detectors,
// resolves overlaps, and decides per match what to show (highlight or reword)
// and under which highlight name. Shared by the content script and the Node
// evaluation tools.
import { buildMatcher, findMatches, normalize } from './matcher.js';
import { matchReplacementCase } from './display-utils.js';
import { pluralizeWord, pastTenseWord, ingWord, adverbWord, inflectPhrase } from './stemmer.js';
import { chooseAction, chooseReplacementTerm, getReplacementSourceText, resolveMatchGroups } from './match-plan.js';
import { ALL_CAPS_TERM_ID, findAllCapsMatches, restoreAllCapsCase } from './all-caps.js';
import { CONTEXTUAL_TERMS, QUOTED_WORDING_ID, findContextualMatches } from './contextual.js';
import { createLexicalFilter } from './context-filter.js';

export const HIGHLIGHT_PREFIX = 'clearframe-';
export const ALL_CAPS_HIGHLIGHT_NAME = 'clearframe-all-caps-underline';
// Terms below high confidence render fainter, so a reader can weigh them
// less: medium (e.g. "alleged") at 75%, contextual and exploratory at 50%.
export const STRENGTHS = { high: { suffix: '', alpha: 1 }, medium: { suffix: '-medium', alpha: 0.75 }, low: { suffix: '-low', alpha: 0.5 } };
const TYPE_PRIORITY = ['derogatory', 'aggression', 'fear', 'loaded', 'moral', 'dysphemism', 'clickbait', 'loaded-framing', 'unsourced', 'euphemism', 'passive', 'negative-framing', 'conflict', 'exaggeration', 'superlative', 'hype', 'authority', 'uncertainty', 'distancing', 'minimizing', 'all-caps', 'absolute', 'repetition', 'rhetorical-question', 'colloquialism', 'idiom', 'reveal', 'anaphora', 'tricolon', 'imperative', 'modality', 'direct-address', 'inclusive-pronoun', 'quote'];
// Pronoun, modal and imperative words are matched in the trie; a structural
// match (tricolon, anaphora) never takes over a span an older type already marks.
const NEW_STRUCTURAL = new Set(['anaphora', 'tricolon']);
const WORD_DEVICE_TYPES = new Set(['imperative', 'modality', 'direct-address', 'inclusive-pronoun']);
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

// Which term strengths each sensitivity level lets through.
const SENSITIVITY_STRENGTHS = { strong: ['high'], standard: ['high', 'medium'] };

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

function getHighlightNameForEntry(term, action, terms) {
  const strength = getEntryStrength(terms.length ? terms : [term]);
  if (terms.length > 1) return getHighlightName(getMostImportantType(terms), 'highlight', strength);
  if (action === 'highlighted') return getHighlightName(term.type, 'highlight', strength);
  return term.phrase === ALL_CAPS_TERM.phrase ? ALL_CAPS_HIGHLIGHT_NAME : getHighlightName(term.type, 'underline', strength);
}

/**
 * @param {{index: {termsById: Record<string, any>, regexTerms?: any[], exceptions?: any}}} options
 */
export function createAnalyzer({ index }) {
  const termsById = Object.fromEntries(Object.entries(index.termsById).map(([id, term]) => [id, { ...term, phrase: term.phrase || id }]));
  const shouldKeepLexicalMatch = createLexicalFilter(index.exceptions);
  // The trie holds only enabled types; rebuilt when a new settings object arrives.
  let matcher = null, matcherSettings = null;

  const isEnabled = (settings, type) => settings.types?.[type] !== false;
  // A term is used when its type is on and its strength passes the sensitivity.
  const isShown = (settings, confidence) => SENSITIVITY_STRENGTHS[settings.sensitivity]?.includes(getStrength(confidence)) ?? true;
  const isUsed = (settings, term) => isEnabled(settings, term.type) && isShown(settings, term.confidence) && !settings.dismissedTerms?.has(normalize(term.phrase || ''));

  function getTermById(id) {
    const term = termsById[id];
    return term || CONTEXTUAL_TERMS[id] || (id === ALL_CAPS_TERM_ID ? ALL_CAPS_TERM : null);
  }

  // A match can carry a confidence of its own (see getConfidenceIn); it only
  // applies when it is the match's one term.
  function getTermsForMatch(match) {
    const terms = (match.termIds || [match.termId]).map(getTermById).filter(Boolean);
    return match.confidence && terms.length === 1 ? [{ ...terms[0], confidence: match.confidence }] : terms;
  }

  // Phrase and pattern rules only, after rule exceptions, without overlap
  // resolution against the structural detectors.
  function findLexicalMatches(text, context, settings) {
    if (settings !== matcherSettings) {
      matcher = buildMatcher({ ...index, termsById }, term => isUsed(settings, term));
      matcherSettings = settings;
    }
    const matches = findMatches(matcher, text, termsById, index.regexTerms || [],
      term => isUsed(settings, term),
      (termId, start, end) => {
        const term = getTermById(termId);
        return isShown(settings, shouldKeepLexicalMatch.getConfidenceIn(term, context.headline)) && shouldKeepLexicalMatch(term, text.slice(start, end), text, context, start);
      });
    for (const match of /** @type {any[]} */ (matches)) {
      const term = getTermById(match.termId), confidence = shouldKeepLexicalMatch.getConfidenceIn(term, context.headline);
      if (confidence !== (term.confidence || 'high')) match.confidence = confidence;
    }
    return matches;
  }

  /**
   * Returns the text to display and one entry per detection, with offsets
   * into displayText.
   * @param {string} text
   * @param {{headline?: boolean, conversational?: boolean, preserveText?: boolean, capsLabel?: boolean, pageContext?: string}} context
   * @param {{types?: Record<string, boolean>, replaceTerms?: boolean, studyMode?: boolean, dismissedTerms?: Set<string>, paused?: boolean, sensitivity?: string, headlinesOnly?: boolean}} settings
   */
  function analyze(text, context = {}, settings) {
    if (settings.paused || (settings.headlinesOnly && !context.headline)) return { displayText: text, entries: [] };
    const allCaps = isUsed(settings, ALL_CAPS_TERM) && !context.capsLabel ? findAllCapsMatches(text) : [];
    const contextual = findContextualMatches(text, context).filter(match => isUsed(settings, getTermById(match.termId) || {}));
    // Pronoun, modal and imperative words inside a marked scare quote are the quote's, not a device of their own.
    const quotes = contextual.filter(match => match.termId === QUOTED_WORDING_ID);
    const overlaps = (a, b) => a.start < b.end && b.start < a.end;
    const matches = findLexicalMatches(text, context, settings).filter(match => !quotes.some(quote => WORD_DEVICE_TYPES.has(getTermById(match.termId).type) && overlaps(quote, match)));
    const occupied = [...matches, ...allCaps].filter(match => !WORD_DEVICE_TYPES.has(getTermById(match.termId)?.type)).sort((a, b) => a.start - b.start);
    let nextOccupied = 0;
    const patterns = contextual.sort((a, b) => a.start - b.start).filter(match => {
      if (!NEW_STRUCTURAL.has(getTermById(match.termId).type)) return true;
      while (nextOccupied < occupied.length && occupied[nextOccupied].end <= match.start) nextOccupied++;
      return nextOccupied === occupied.length || occupied[nextOccupied].start >= match.end;
    });
    const combined = resolveMatchGroups([...matches, ...allCaps, ...patterns]);
    let cursor = 0, displayText = '';
    const entries = [];
    const termAction = term => chooseAction(term, settings, context.preserveText === true);
    combined.forEach(match => {
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
      const span = { start: match.start, end: match.end, replacement: getReplacementText(term, replacementSource, action, textBefore, restoreCase) };
      displayText += text.slice(cursor, span.start);
      const start = displayText.length;
      displayText += span.replacement;
      // sourceText and replacementText are the exact original and displayed
      // text of the entry.
      entries.push({ start, end: displayText.length, term, terms, action, wording, sourceText: text.slice(span.start, span.end), replacementText: span.replacement, highlightName: getHighlightNameForEntry(term, action, terms) });
      cursor = span.end;
    });
    displayText += text.slice(cursor);
    return { displayText, entries };
  }

  return { analyze, findLexicalMatches };
}
