const PRODUCT_LABEL_TERMS = new Set(['elite', 'iconic', 'legendary', 'miracle', 'superstar']);
const PRODUCT_WORDS = /\b(?:xbox|playstation|pixel|iphone|galaxy|controller|gamepad|keyboard|mouse|laptop|phone|model|series|edition|package|trim|brand|product|album|film|show|team|unit|magazine|newspaper|records|studios)\b/iu;
// Keep this list politically mirrored: each side's pejorative "elite" modifiers count.
const EVALUATIVE_NEARBY = /\b(?:billionaire|coastal|conservative|corporate|corrupt|detached|entrenched|global|greedy|liberal|political|powerful|privileged|rich|ruling|urban|wealthy)\b/iu;
const TYPE_CONTEXTS = { colloquialism: ['publication'] };

// Literal, proper-noun, or technical senses seen on live news pages. Each
// entry tests the text before and after the match.
// Position words: "far right corner", "pictured at far left", "(far right)".
const POSITIONAL = (before, after) => /^\s*(?:corner|side|column|lane|edge|end|hand|wing of the (?:building|stage)|of (?:the|this) (?:photo|image|picture|screen|page|frame|row|stage|field)|in (?:the|this) (?:photo|image|picture))\b/iu.test(after)
  || /^\s*[),]/u.test(after) && /(?:\(|\b(?:pictured|seen|standing|seated|sits|sitting|from)\b[^.]{0,20})\s*$/iu.test(before)
  || /\((?:\s*at)?\s*$/iu.test(before);
const LITERAL_SENSES = {
  'far-left': POSITIONAL,
  'far-right': POSITIONAL,
  breaking: (before, after) => !/^\s*(?::|news\b|update|story)/iu.test(after) && !!before.trim(),
  wild: (before, after) => /\b(?:the|into)\s+$/iu.test(before) || /^\s*(?:card|fire|life|animals?|horses?|'n|‘n)/iu.test(after),
  revolutionary: (_before, after) => /^\s*(?:guards?|war|army|front|committee|party)\b/iu.test(after),
  secret: (_before, after) => /^\s*service\b/iu.test(after),
  shock: (before, after) => /\b(?:electric|economic|price|oil|supply|culture|toxic|septic|anaphylactic|shell)\s+$/iu.test(before) || /^\s*(?:gloves?|therapy|absorbers?|wave|collars?)\b/iu.test(after),
  'under fire': (before, after) => /\b(?:came|come|comes|coming)\s+$/iu.test(before) || /^\s*from\b/iu.test(after),
  // Titles and names: "Resident Evil", "Evil Dead", "Evel Knievel" is spelled differently.
  evil: (before, after) => /\bResident\s+$/u.test(before) || /^\s*Dead\b/u.test(after),
  // American football: a quarterback "sacked eight times" or "sacked for a loss".
  sacked: (before, after) => /^\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twice|once)\b(?:\s+(?:times|more))?|^\s*for\s+(?:a\s+)?(?:loss|safety|\d)/iu.test(after) || /\b(?:quarterback|QB|was|got|been)\s+$/u.test(before) && /\b(?:times|loss|yards?|sacks?)\b/iu.test(after),
  severe: (_before, after) => /^\s*(?:storms?|thunderstorms?|weather|drought|flooding|turbulence|winds?|allerg)/iu.test(after),
};

export function shouldKeepLexicalMatch(term, sourceText, fullText, { headline = false, conversational = false, pageContext = 'publication' } = {}, start = fullText.indexOf(sourceText)) {
  const phrase = term?.phrase || '';
  const at = start;
  const literal = LITERAL_SENSES[phrase];
  if (literal && literal(fullText.slice(Math.max(0, at - 40), at), fullText.slice(at + sourceText.length, at + sourceText.length + 40))) return false;
  const nearby = fullText.slice(Math.max(0, at - 40), at + sourceText.length + 40);
  const available = new Set([headline ? 'headline' : 'body', pageContext]);
  if (conversational) available.add('conversation');
  if (EVALUATIVE_NEARBY.test(nearby)) available.add('evaluative');
  const contexts = term?.contexts?.length ? term.contexts : TYPE_CONTEXTS[term?.type] || [];
  if (contexts.length && !contexts.some(context => available.has(context))) return false;
  // "EXCLUSIVE" badges are clickbait; an "exclusive license" in body text is not.
  if (phrase === 'exclusive' && !headline && sourceText !== sourceText.toUpperCase()) return false;
  if (PRODUCT_LABEL_TERMS.has(phrase) && /^[\p{Lu}\d]/u.test(sourceText)) {
    if (PRODUCT_WORDS.test(nearby) || /\b[A-Z][\p{L}\d-]+\s+$/u.test(fullText.slice(0, at))) return false;
  }
  return true;
}
