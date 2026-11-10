// Interprets data/terms/exceptions.json (validated by loadTerms). A clause
// matches when every test in it passes; a term is dropped when any of its
// `unless` clauses matches. Text windows around a match:
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
    if (key === 'headline') return view => view.headline === value;
    const pattern = parseRulePattern(value);
    return view => pattern.test(view[key]);
  });
}

export function createLexicalFilter({ terms = {}, shared = {}, contexts = {}, types = {} } = {}) {
  const compileList = list => list.map(compileClause);
  const sharedClauses = new Map(Object.entries(shared).map(([name, list]) => [name, compileList(list)]));
  const termClauses = new Map(Object.entries(terms).map(([phrase, list]) => [phrase,
    list.flatMap(item => typeof item === 'string' ? sharedClauses.get(item) || [] : [compileClause(item)])]));
  const derivedContexts = new Map(Object.entries(contexts).map(([name, list]) => [name, compileList(list)]));
  const typeContexts = new Map(Object.entries(types));
  const matchesAny = (clauses, view) => clauses.some(tests => tests.every(test => test(view)));

  return function shouldKeepLexicalMatch(term, sourceText, fullText, { headline = false, conversational = false, pageContext = 'publication' } = {}, start = fullText.indexOf(sourceText)) {
    const end = start + sourceText.length;
    // Windows are sliced on demand: most terms have no clauses. Rules are
    // written with single spaces, so source whitespace runs read as one space.
    const flat = text => text.replace(/\s+/g, ' ');
    const view = {
      headline,
      match: flat(sourceText),
      get before() { return flat(fullText.slice(Math.max(0, start - 40), start)); },
      get after() { return flat(fullText.slice(end, end + 40)); },
      get nearby() { return flat(fullText.slice(Math.max(0, start - 40), end + 40)); },
      get textBefore() { return flat(fullText.slice(0, start)); },
    };
    const unless = termClauses.get(term?.phrase || '');
    if (unless && matchesAny(unless, view)) return false;
    const allowed = term?.contexts?.length ? term.contexts : typeContexts.get(term?.type) || [];
    if (!allowed.length) return true;
    const available = new Set([headline ? 'headline' : 'body', pageContext]);
    if (conversational) available.add('conversation');
    return allowed.some(context => available.has(context) || matchesAny(derivedContexts.get(context) || [], view));
  };
}
