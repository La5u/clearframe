import fs from 'fs';
import path from 'path';
import { normalize } from './matcher.js';
import { adverbWord, pastTenseWord, ingWord } from './stemmer.js';

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildStemRegex(word, stemType) {
  return `\\b(?:${stemVariants(word, stemType).map(escapeRegex).join('|')})\\b`;
}

export function stemVariants(word, stemType) {
  const out = new Set([word]), cy = /[^aeiou]y$/;
  if (stemType === 'noun') {
    out.add(pluralWord(word, cy));
  } else if (stemType === 'adjective') {
    out.add(adverbWord(word));
  } else if (stemType === 'verb') {
    out.add(pluralWord(word, cy)); out.add(pastTenseWord(word)); out.add(ingWord(word));
  }
  return [...out];
}

function pluralWord(w, consonantY) {
  if (/(s|x|z|ch|sh)$/.test(w)) {
    return `${w  }es`;
  }
  if (consonantY.test(w)) {
    return `${w.slice(0, -1)  }ies`;
  }
  return `${w  }s`;
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

export function loadTerms(dataDir) {
  const terms = {}, entries = [], regexTerms = [], phraseTypes = new Map();

  function addTerm(phrase, term, source) {
    const existingType = phraseTypes.get(phrase);
    if (existingType && existingType !== term.type) {
      throw new Error(`Duplicate term phrase "${phrase}" in ${source} conflicts with type "${existingType}"`);
    }
    phraseTypes.set(phrase, term.type);
    if (terms[phrase]) {
      return;
    }
    const hasNeutral = term.neutral !== '';
    terms[phrase] = { phrase, type: term.type, neutral: term.neutral || '', hasNeutral, stemType: term.stemType || '', regex: term.regex || '', remove: term.remove === true };
    if (term.regex) {
      regexTerms.push({ termId: phrase, pattern: term.regex });
    } else {
      entries.push({ phraseNorm: phrase, termId: phrase, length: phrase.length });
    }
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
    const phI = idx('phrase'), tyI = idx('type'), neI = headers.indexOf('neutral'), alI = headers.indexOf('aliases'), stI = headers.indexOf('stemmable'), reI = headers.indexOf('regex'), rmI = headers.indexOf('remove');

    for (const row of bodyRows) {
      if (!row.some(c => c.trim().length > 0)) {
        continue;
      }
      const term = {
        phrase: row[phI] || '',
        type: row[tyI] || '',
        neutral: neI >= 0 ? row[neI] || '' : '',
        aliases: splitAliases(alI >= 0 ? row[alI] || '' : ''),
        stemType: parseStemTypeCell(stI >= 0 ? row[stI] || '' : ''),
        regex: reI >= 0 ? row[reI] || '' : '',
        remove: rmI >= 0 ? parseBooleanCell(row[rmI] || '') : false,
      };
      if (term.stemType && !term.regex) {
        term.regex = buildStemRegex(normalize(term.phrase), term.stemType);
      }
      const phrase = normalize(term.phrase);
      addTerm(phrase, term, file);
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

  const buckets = {};
  for (const entry of entries) {
    (buckets[entry.phraseNorm[0]] ||= []).push(entry);
  }
  Object.values(buckets).forEach(arr => arr.sort((a, b) => b.length - a.length));
  return { termsById: terms, buckets, regexTerms };
}

export function extractText(html) {
  return html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ');
}

export { buildMatcher, findMatches } from './matcher.js';
export { adverbWord, pastTenseWord, ingWord } from './stemmer.js';
