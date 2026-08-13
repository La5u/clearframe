#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findContextualMatches } from '../src/core/contextual.js';
import { readJsonl } from './rule-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webis = readJsonl(path.join(ROOT, 'research', 'cache', 'normalized', 'webis-clickbait-2022.jsonl'));
let pronounHeadlines = 0, constructedDirectAddress = 0, barePronounIgnored = 0, quoteDetections = 0;
for (const row of webis) {
  const headline = String(row.headline || '');
  const hasPronoun = /\b(?:you|your|yours|yourself|yourselves)\b/iu.test(headline);
  if (hasPronoun) pronounHeadlines++;
  const matches = findContextualMatches(headline, { headline: true, pageContext: 'publication' });
  if (matches.some(match => match.termId === '__clearframe_direct_address__')) constructedDirectAddress++;
  else if (hasPronoun) barePronounIgnored++;
  if (matches.some(match => match.termId === '__clearframe_quoted_wording__')) quoteDetections++;
}

let savedHeadlines = 0, savedDirectAddress = 0, savedQuoteDetections = 0;
for (const file of fs.readdirSync(path.join(ROOT, 'tests', 'fixtures')).filter(file => /newssite.*\.html$/.test(file))) {
  const html = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', file), 'utf8');
  for (const match of html.matchAll(/<(?:h1|h2|h3)[^>]*>([\s\S]*?)<\/(?:h1|h2|h3)>/giu)) {
    const text = match[1].replace(/<[^>]+>/g, ' ').replace(/&(?:#39|apos);/gi, "'").replace(/&quot;/gi, '"').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    savedHeadlines++;
    const matches = findContextualMatches(text, { headline: true, pageContext: 'publication' });
    if (matches.some(item => item.termId === '__clearframe_direct_address__')) savedDirectAddress++;
    if (matches.some(item => item.termId === '__clearframe_quoted_wording__')) savedQuoteDetections++;
  }
}

console.log(JSON.stringify({
  webis: { headlines: webis.length, pronounHeadlines, constructedDirectAddress, barePronounIgnored, quoteDetections },
  savedNews: { headlines: savedHeadlines, constructedDirectAddress: savedDirectAddress, quoteDetections: savedQuoteDetections },
}, null, 2));
