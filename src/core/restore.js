/**
 * Recover a text node's original wording after the page edited text that
 * ClearFrame had already reworded. The page's edit is located by diffing the
 * displayed text against the current text, then spliced into the original.
 * Returns null when the page edited inside a rewritten span, because the
 * original wording there can no longer be reconstructed.
 *
 * @param {{originalText: string, displayedText: string, records: Array<{startOffset: number, endOffset: number, sourceText: string, replacementText: string}>}} result
 * @param {string} currentText
 * @returns {string | null}
 */
export function recoverOriginalText(result, currentText) {
  const displayed = result.displayedText;
  if (currentText === displayed) return result.originalText;
  const max = Math.min(displayed.length, currentText.length);
  let prefix = 0;
  while (prefix < max && displayed[prefix] === currentText[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && displayed[displayed.length - 1 - suffix] === currentText[currentText.length - 1 - suffix]) suffix++;
  const changedEnd = displayed.length - suffix;

  const rewritten = result.records.filter(record => record.sourceText !== record.replacementText);
  if (rewritten.some(record => record.startOffset <= changedEnd && prefix <= record.endOffset)) return null;
  const toOriginal = offset => rewritten.reduce((position, record) =>
    record.endOffset <= offset ? position + record.sourceText.length - record.replacementText.length : position, offset);

  return result.originalText.slice(0, toOriginal(prefix)) +
    currentText.slice(prefix, currentText.length - suffix) +
    result.originalText.slice(toOriginal(changedEnd));
}
