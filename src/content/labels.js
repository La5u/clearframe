// What a term is called and explains, from data/type-labels.json: a phrase's
// own label if it has one, else its type's.
const { categories: TYPE_CATEGORIES, labels: LABELS } = ClearFrame;

export function getLabel(term) {
  return LABELS?.phrases?.[term.phrase] || LABELS?.types?.[term.type] || { term: term.type, plain: TYPE_CATEGORIES?.[term.type] || 'General', effect: '' };
}
