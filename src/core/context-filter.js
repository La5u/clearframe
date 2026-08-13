const PRODUCT_LABEL_TERMS = new Set(['elite', 'iconic', 'legendary', 'miracle', 'superstar']);
const PRODUCT_WORDS = /\b(?:xbox|playstation|pixel|iphone|galaxy|controller|gamepad|keyboard|mouse|laptop|phone|model|series|edition|package|trim|brand|product|album|film|show|team|unit|magazine|newspaper|records|studios)\b/iu;
const EVALUATIVE_NEARBY = /\b(?:corrupt|detached|entrenched|global|greedy|liberal|political|powerful|privileged|ruling|urban|wealthy)\b/iu;
const TYPE_CONTEXTS = { colloquialism: ['publication'] };

export function shouldKeepLexicalMatch(term, sourceText, fullText, { headline = false, conversational = false, pageContext = 'publication' } = {}) {
  const phrase = term?.phrase || '';
  const at = fullText.indexOf(sourceText);
  const nearby = fullText.slice(Math.max(0, at - 40), at + sourceText.length + 40);
  const available = new Set([headline ? 'headline' : 'body', pageContext]);
  if (conversational) available.add('conversation');
  if (EVALUATIVE_NEARBY.test(nearby)) available.add('evaluative');
  const contexts = term?.contexts?.length ? term.contexts : TYPE_CONTEXTS[term?.type] || [];
  if (contexts.length && !contexts.some(context => available.has(context))) return false;
  if (phrase === 'breaking' && !headline && !/\bbreaking\s+(?:news|update|story)\b/iu.test(fullText)) return false;
  if (phrase === 'woke' && /\bwoke\s+(?:up|from|to)\b/iu.test(nearby)) return false;
  if (PRODUCT_LABEL_TERMS.has(phrase) && /^[\p{Lu}\d]/u.test(sourceText)) {
    if (PRODUCT_WORDS.test(nearby) || /\b[A-Z][\p{L}\d-]+\s+$/u.test(fullText.slice(0, at))) return false;
  }
  return true;
}
