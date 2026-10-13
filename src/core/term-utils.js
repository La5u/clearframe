import fs from 'fs';
import path from 'path';
import { normalize } from './matcher.js';
import { adverbWord, pastTenseWord, pluralizeWord, ingWord } from './stemmer.js';

const ALLOWED_CONTEXTS = new Set(['headline', 'body', 'publication', 'discussion', 'video', 'conversation', 'evaluative']);
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'contextual', 'exploratory']);

export function stemVariants(word, stemType) {
  const out = new Set([word]);
  if (stemType === 'noun') {
    out.add(pluralizeWord(word));
  } else if (stemType === 'adjective') {
    out.add(adverbWord(word));
  } else if (stemType === 'verb') {
    out.add(pluralizeWord(word)); out.add(pastTenseWord(word)); out.add(ingWord(word));
  }
  return [...out];
}

export function parseCsv(input) {
  const rows = []; let row = [], field = '', inQuotes = false;
  const text = input.replace(/^\ufeff/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true; continue;
    }
    if (ch === ',') {
      row.push(field); field = ''; continue;
    }
    if (ch === '\n' || ch === '\r') {
      row.push(field); rows.push(row); row = []; field = ''; if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      } continue;
    }
    field += ch;
  }
  if (field.length || row.length) {
    row.push(field); rows.push(row);
  }
  return rows;
}

function parseBooleanCell(value) {
  return /^(1|true|yes)$/i.test(String(value).trim());
}
function splitAliases(value) {
  return value ? String(value).split('|').map(a => a.trim()).filter(Boolean) : [];
}
function hyphenVariants(value) {
  return value.includes('-') ? [value.replace(/-/g, ' ')].filter(v => v !== value) : [];
}

function parseStemTypeCell(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return '';
  }
  if (raw === 'true') {
    return 'verb';
  }
  if (['noun', 'verb', 'adjective'].includes(raw)) {
    return raw;
  }
  throw new Error(`Unsupported stem type "${value}"`);
}

export function loadTerms(dataDir, extraTerms = []) {
  const terms = {}, regexTerms = [], phraseTypes = new Map();

  function addTerm(phrase, term, source) {
    for (const context of term.contexts || []) {
      if (!ALLOWED_CONTEXTS.has(context)) throw new Error(`Unsupported context "${context}" for term "${phrase}" in ${source}`);
    }
    const existingType = phraseTypes.get(phrase);
    if (existingType && existingType !== term.type) {
      throw new Error(`Duplicate term phrase "${phrase}" in ${source} conflicts with type "${existingType}"`);
    }
    phraseTypes.set(phrase, term.type);
    if (terms[phrase]) {
      return;
    }
    if (term.regex) {
      try {
        new RegExp(term.regex, 'giu');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid regex for term "${phrase}" in ${source}: ${message}`);
      }
    }
    terms[phrase] = { phrase: normalize(term.phrase), type: term.type, neutral: term.neutral || '', stemType: term.stemType || '', regex: term.regex || '', remove: term.remove === true, confidence: term.confidence || 'high', contexts: term.contexts || [] };
    if (term.regex) regexTerms.push({ termId: phrase, pattern: term.regex });
  }

  for (const file of fs.readdirSync(dataDir).filter(f => f.endsWith('.csv')).sort()) {
    const rows = parseCsv(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    if (!rows.length) {
      continue;
    }
    const [headerRow, ...bodyRows] = rows;
    const headers = headerRow.map(c => c.trim());
    const idx = (name) => {
      const i = headers.indexOf(name); if (i === -1) {
        throw new Error(`Missing required column "${name}" in ${file}`);
      } return i;
    };
    idx('phrase'); idx('type');
    const phI = idx('phrase'), tyI = idx('type'), neI = headers.indexOf('neutral'), alI = headers.indexOf('aliases'), stI = headers.indexOf('stemmable'), reI = headers.indexOf('regex'), rmI = headers.indexOf('remove'), cxI = headers.indexOf('contexts'), cfI = headers.indexOf('confidence');

    for (const row of bodyRows) {
      if (!row.some(c => c.trim().length > 0)) {
        continue;
      }
      // Extra cells mean a value landed in the wrong column (e.g. a stem type in `regex`).
      if (row.length > headers.length) {
        throw new Error(`Row "${row.join(',')}" in ${file} has ${row.length} cells; header has ${headers.length}`);
      }
      if (reI >= 0 && /^(?:noun|verb|adjective|true)$/i.test((row[reI] || '').trim())) {
        throw new Error(`Row "${row[phI]}" in ${file} has a stem type in the regex column`);
      }
      const term = {
        phrase: row[phI] || '',
        type: row[tyI] || '',
        neutral: neI >= 0 ? row[neI] || '' : '',
        aliases: splitAliases(alI >= 0 ? row[alI] || '' : ''),
        stemType: parseStemTypeCell(stI >= 0 ? row[stI] || '' : ''),
        regex: reI >= 0 ? row[reI] || '' : '',
        remove: rmI >= 0 ? parseBooleanCell(row[rmI] || '') : false,
        contexts: splitAliases(cxI >= 0 ? row[cxI] || '' : ''),
        confidence: cfI >= 0 ? (row[cfI] || '').trim() : '',
      };
      if (term.confidence && !CONFIDENCE_LEVELS.has(term.confidence)) {
        throw new Error(`Row "${row[phI]}" in ${file} has unknown confidence "${term.confidence}"`);
      }
      const phrase = normalize(term.phrase);
      addTerm(phrase, term, file);
      if (term.stemType && !term.regex) {
        for (const variant of stemVariants(phrase, term.stemType)) {
          if (variant !== phrase) addTerm(variant, term, file);
        }
      }
      for (const v of hyphenVariants(term.phrase)) {
        const nv = normalize(v); if (nv && nv !== phrase) {
          addTerm(nv, term, file);
        }
      }
      for (const alias of term.aliases || []) {
        const na = normalize(alias); if (na && na !== phrase) {
          addTerm(na, term, file);
        }
      }
    }
  }

  for (const term of extraTerms) {
    const phrase = normalize(term.phrase);
    addTerm(phrase, term, 'data/rules/*.jsonl');
    for (const variant of term.stemType && !term.regex ? stemVariants(phrase, term.stemType) : []) {
      if (variant !== phrase) addTerm(variant, term, 'data/rules/*.jsonl');
    }
    for (const alias of term.aliases || []) {
      const normalizedAlias = normalize(alias);
      if (normalizedAlias && normalizedAlias !== phrase) addTerm(normalizedAlias, term, 'data/rules/*.jsonl');
    }
  }

  return { termsById: terms, regexTerms };
}

export function extractText(html) {
  return html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ');
}
