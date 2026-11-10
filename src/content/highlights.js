// Owns the CSS Custom Highlight registry entries and the highlight
// stylesheet: draws records' ranges under their highlight names, with colours
// and strengths from the settings.
import { ALL_CAPS_HIGHLIGHT_NAME, HIGHLIGHT_PREFIX, STRENGTHS, getHighlightName } from '../core/analyze.js';
import { getSettings } from './settings.js';

const { types: TYPE_MAP, colors: COLOR_RGB, underlines: UNDERLINE_RGB, intensity: TYPE_INTENSITY } = ClearFrame;
const SELECTED_HIGHLIGHT_NAME = 'clearframe-selected';
const MONOCHROME_RGB = '140, 140, 140';
const TYPE_HIGHLIGHT_NAMES = Object.keys(TYPE_MAP).flatMap(type => Object.keys(STRENGTHS).flatMap(strength => [getHighlightName(type, 'highlight', strength), getHighlightName(type, 'underline', strength)]));
const SUPPORTS_HIGHLIGHTS = !!(globalThis.Highlight && globalThis.CSS?.highlights);
const highlightSets = new Map();
/** @type {string | null} ':root' where highlight inheritance works, '' otherwise. */
let highlightScope = null;

function getColor(type) {
  const settings = getSettings();
  return settings.monochrome ? 'gray' : settings.userTypeColors?.[type] || TYPE_MAP[type] || 'gray';
}

export function clearHighlightPresentation() {
  if (SUPPORTS_HIGHLIGHTS) {
    for (const name of [...TYPE_HIGHLIGHT_NAMES, ALL_CAPS_HIGHLIGHT_NAME, SELECTED_HIGHLIGHT_NAME]) {
      CSS.highlights.delete(name);
    }
  }
  highlightSets.clear();
}

function buildHighlightRule(name) {
  const settings = getSettings();
  if (settings.monochrome && name === ALL_CAPS_HIGHLIGHT_NAME) return `::highlight(${name}){background-color:transparent;text-decoration:underline;text-decoration-color:rgba(0,0,0,.65);text-decoration-thickness:1px;text-underline-offset:2px}`;
  if (name === ALL_CAPS_HIGHLIGHT_NAME) return `::highlight(${name}){background-color:transparent;text-decoration:underline;text-decoration-color:rgba(125,211,252,.42);text-decoration-thickness:.75px;text-underline-offset:2px}`;
  const underline = name.endsWith('-underline');
  const base = name.slice(HIGHLIGHT_PREFIX.length, underline ? -'-underline'.length : undefined);
  const strength = Object.values(STRENGTHS).find(item => item.suffix && base.endsWith(item.suffix)) || STRENGTHS.high;
  const typeName = strength.suffix ? base.slice(0, -strength.suffix.length) : base;
  const color = getColor(typeName);
  // Monochrome uses a darker grey than the colour palette's grey group, so
  // the fainter confidence levels stay visible on white pages.
  const rgb = settings.monochrome && !underline ? MONOCHROME_RGB
    : (underline ? UNDERLINE_RGB : COLOR_RGB)[color] || (underline ? UNDERLINE_RGB.gray : COLOR_RGB.gray);
  const intensity = TYPE_INTENSITY[typeName] ?? 0.65;
  const alpha = (Math.max(0.08, Math.min(underline ? 0.84 : 0.32, (underline ? 0.84 : 0.32) * intensity)) * strength.alpha).toFixed(3);
  return underline
    ? `::highlight(${name}){background-color:transparent;text-decoration:underline;text-decoration-color:rgba(${rgb},${alpha});text-decoration-thickness:1px;text-underline-offset:1px}`
    : `::highlight(${name}){background-color:rgba(${rgb},${alpha})}`;
}

export function renderHighlights(records) {
  clearHighlightPresentation();
  if (!SUPPORTS_HIGHLIGHTS) return;
  const rangesByName = new Map();
  for (const record of records) {
    if (!record.highlightName || record.range.collapsed) continue;
    const ranges = rangesByName.get(record.highlightName) || [];
    ranges.push(record.range);
    rangesByName.set(record.highlightName, ranges);
  }
  for (const [name, ranges] of rangesByName) {
    const highlight = new Highlight(...ranges);
    highlightSets.set(name, highlight); CSS.highlights.set(name, highlight);
  }
  syncHighlightStyles();
}

// Every ::highlight rule is matched against every element on each restyle,
// so many rules slow down every restyle the page does. Chromium's highlight
// inheritance lets rules on :root reach all text at almost no cost, so there
// the sheet holds every name and changes only with the settings. Firefox has
// no highlight inheritance and keeps universal rules for the names in use.
export function syncHighlightStyles() {
  if (!highlightSets.size) return;
  let style = document.getElementById('cf-highlight-styles');
  if (!style) {
    style = document.createElement('style'); style.id = 'cf-highlight-styles';
  }
  if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  if (highlightScope === null) {
    style.textContent = `:root::highlight(${SELECTED_HIGHLIGHT_NAME}){background-color:rgb(1, 2, 3)}`;
    highlightScope = document.body && getComputedStyle(document.body, `::highlight(${SELECTED_HIGHLIGHT_NAME})`).backgroundColor === 'rgb(1, 2, 3)' ? ':root' : '';
  }
  const names = highlightScope ? [...TYPE_HIGHLIGHT_NAMES, ALL_CAPS_HIGHLIGHT_NAME] : [...highlightSets.keys()];
  const rules = names.map(name => highlightScope + buildHighlightRule(name)).join('\n')
    + `\n${highlightScope}::highlight(${SELECTED_HIGHLIGHT_NAME}){background-color:CanvasText;color:Canvas}`;
  if (style.textContent !== rules) style.textContent = rules;
}

// Returns true when a highlight name disappeared, so the styles need a sync.
export function removeResultHighlights(result) {
  if (!SUPPORTS_HIGHLIGHTS) return false;
  let namesChanged = false;
  for (const record of result?.records || []) {
    const highlight = highlightSets.get(record.highlightName);
    if (!highlight) continue;
    highlight.delete(record.range);
    if (highlight.size === 0) {
      highlightSets.delete(record.highlightName); CSS.highlights.delete(record.highlightName); namesChanged = true;
    }
  }
  return namesChanged;
}

// Returns true when a highlight name appeared, so the styles need a sync.
export function addResultHighlights(result) {
  if (!SUPPORTS_HIGHLIGHTS) return false;
  let namesChanged = false;
  for (const record of result?.records || []) {
    if (!record.highlightName || record.range.collapsed) continue;
    let highlight = highlightSets.get(record.highlightName);
    if (!highlight) {
      highlight = new Highlight(); highlightSets.set(record.highlightName, highlight);
      CSS.highlights.set(record.highlightName, highlight); namesChanged = true;
    }
    highlight.add(record.range);
  }
  return namesChanged;
}

// Scrolls a match into view and marks it, for the popup's term navigation.
export function showSelectedRecord(record) {
  record.node.parentElement?.scrollIntoView({ block: 'center', behavior: 'auto' });
  if (SUPPORTS_HIGHLIGHTS && !record.range.collapsed) {
    CSS.highlights.set(SELECTED_HIGHLIGHT_NAME, new Highlight(record.range));
  }
}
