// Interprets data/terms/exceptions.json (validated by loadTerms). A clause
// matches when every test in it passes; a term is dropped when any of its
// `unless` clauses matches, or when it has `only` clauses and none matches.
// A type can carry the same two lists for all its terms. Yes/no tests, then
// text windows around a match:
export const CLAUSE_FLAGS = ['headline', 'conversational'];
export const CLAUSE_WINDOWS = ['before', 'after', 'match', 'nearby', 'textBefore'];

// Patterns are written as JS regex literals ("/.../iu") so the flags stay visible.
export function parseRulePattern(value) {
  const parts = typeof value === 'string' ? /^\/(.+)\/([a-z]*)$/su.exec(value) : null;
  if (!parts) throw new Error(`expected "/pattern/flags", got ${JSON.stringify(value)}`);
  if (/[gy]/.test(parts[2])) throw new Error(`flags "g" and "y" are not allowed in ${value}`);
  return new RegExp(parts[1], parts[2]);
}

function compileClause(clause) {
  return Object.entries(clause).map(([key, value]) => {
    if (CLAUSE_FLAGS.includes(key)) return view => view[key] === value;
    const pattern = parseRulePattern(value);
    return view => pattern.test(view[key]);
  });
}

export function createLexicalFilter({ terms = {}, only = {}, shared = {}, contexts = {}, types = {} } = {}) {
  const compileList = list => list.map(compileClause);
  const sharedClauses = new Map(Object.entries(shared).map(([name, list]) => [name, compileList(list)]));
  const compileUnless = list => list.flatMap(item => typeof item === 'string' ? sharedClauses.get(item) || [] : [compileClause(item)]);
  const termClauses = new Map(Object.entries(terms).map(([phrase, list]) => [phrase, compileUnless(list)]));
  const derivedContexts = new Map(Object.entries(contexts).map(([name, list]) => [name, compileList(list)]));
  const termOnly = new Map(Object.entries(only).map(([phrase, list]) => [phrase, compileList(list)]));
  const typeRules = new Map(Object.entries(types).map(([type, rule]) => [type, { ...rule, only: rule.only && compileList(rule.only), unless: rule.unless && compileUnless(rule.unless) }]));
  const matchesAny = (clauses, view) => clauses.some(tests => tests.every(test => test(view)));

  // Some types are fully shown only in headlines: their body matches carry a lower confidence.
  const getConfidenceIn = (term, headline) => typeRules.get(term?.type)?.confidence?.[headline ? 'headline' : 'body'] || term?.confidence || 'high';

  // Most text has single plain spaces, which `flat` would leave as they are;
  // knowing that once per text keeps long texts with many matches linear.
  let checkedText = null, plainText = false;

  function shouldKeepLexicalMatch(term, sourceText, fullText, { headline = false, conversational = false, pageContext = 'publication' } = {}, start = fullText.indexOf(sourceText)) {
    const end = start + sourceText.length;
    // Windows are sliced on demand: most terms have no clauses. Rules are
    // written with single spaces, so source whitespace runs read as one space.
    if (fullText !== checkedText) {
      checkedText = fullText; plainText = !/[^\S ]| {2}/.test(fullText);
    }
    const flat = text => plainText ? text : text.replace(/\s+/g, ' ');
    const view = {
      headline,
      conversational,
      match: flat(sourceText),
      get before() { return flat(fullText.slice(Math.max(0, start - 40), start)); },
      get after() { return flat(fullText.slice(end, end + 40)); },
      get nearby() { return flat(fullText.slice(Math.max(0, start - 40), end + 40)); },
      get textBefore() { return flat(fullText.slice(0, start)); },
    };
    const unless = termClauses.get(term?.phrase || ''), rule = typeRules.get(term?.type), required = termOnly.get(term?.phrase || '');
    if (unless && matchesAny(unless, view)) return false;
    if (required && !matchesAny(required, view)) return false;
    if (rule?.unless && matchesAny(rule.unless, view)) return false;
    if (rule?.only && !matchesAny(rule.only, view)) return false;
    const allowed = term?.contexts?.length ? term.contexts : rule?.contexts || [];
    if (!allowed.length) return true;
    const available = new Set([headline ? 'headline' : 'body', pageContext]);
    if (conversational) available.add('conversation');
    return allowed.some(context => available.has(context) || matchesAny(derivedContexts.get(context) || [], view));
  }

  return Object.assign(shouldKeepLexicalMatch, { getConfidenceIn });
}
