'use strict';
// Turns pasted text into headline and paragraph elements. The content script
// (content.js, loaded by analyze.html) highlights them like any web page.
const text = /** @type {HTMLTextAreaElement} */ (document.getElementById('text'));
const headline = /** @type {HTMLInputElement} */ (document.getElementById('headline'));
const output = /** @type {HTMLElement} */ (document.getElementById('output'));

function render() {
  const blocks = text.value.replace(/\r\n?/g, '\n').split(/\n[^\S\n]*\n\s*/).map(block => block.trim()).filter(Boolean);
  const nodes = [];
  if (headline.checked && blocks.length) {
    // The first line is the headline; the rest of its block, if any, is body text.
    const [first, ...rest] = (blocks.shift() || '').split('\n');
    nodes.push(['h1', first], ['p', rest.join('\n').trim()]);
  }
  nodes.push(...blocks.map(block => ['p', block]));
  // A single newline stays inside the paragraph and shows as a space.
  output.replaceChildren(...nodes.filter(([, content]) => content).map(([tag, content]) => Object.assign(document.createElement(tag), { textContent: content })));
}

document.getElementById('analyse')?.addEventListener('click', render);
