const fs = require('fs');
const path = require('path');

const {
  shouldDoubleFinalConsonant,
  pluralizeWord,
  pastTenseWord,
  ingWord,
  adverbWord
} = require('./stemmer');

const {
  buildMatcher,
  findMatches,
  normalize
} = require('./matcher');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildStemRegex(word, stemType) {
  const variants = stemVariants(word, stemType).map(escapeRegex);
  return `\\b(?:${variants.join('|')})\\b`;
}

function stemVariants(word, stemType) {
  const out = new Set([word]);
  const consonantY = /[^aeiou]y$/;

  if (stemType === 'noun') {
    out.add(pluralWord(word, consonantY));
  } else if (stemType === 'adjective') {
    out.add(adverbWord(word));
  } else if (stemType === 'verb') {
    out.add(pluralWord(word, consonantY));
    out.add(pastTenseWord(word));
    out.add(ingWord(word));
  }
  return [...out];
}

function pluralWord(w, consonantY) {
  if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es';
  if (consonantY.test(w)) return w.slice(0, -1) + 'ies';
  return w + 's';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const input = text.replace(/^\ufeff/, '');

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && input[i + 1] === '\n') i++;
      continue;
    }

    field += ch;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseBooleanCell(value) {
  return /^(1|true|yes)$/i.test(String(value).trim());
}

function splitAliases(value) {
  if (!value) return [];
  return String(value)
    .split('|')
    .map(alias => alias.trim())
    .filter(Boolean);
}

function hyphenVariants(value) {
  if (!value.includes('-')) return [];
  const spaceVariant = value.replace(/-/g, ' ');
  return spaceVariant === value ? [] : [spaceVariant];
}

function parseStemTypeCell(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'true') return 'verb';
  if (['noun', 'verb', 'adjective'].includes(raw)) return raw;
  throw new Error(`Unsupported stem type "${value}"`);
}

function loadTerms(dataDir) {
  const terms = {};
  const entries = [];
  const regexTerms = [];
  const phraseTypes = new Map();

  function addTerm(phrase, term, source) {
    const existingType = phraseTypes.get(phrase);
    if (existingType && existingType !== term.type) {
      throw new Error(`Duplicate term phrase "${phrase}" in ${source} conflicts with type "${existingType}"`);
    }
    phraseTypes.set(phrase, term.type);
    if (!terms[phrase]) {
      const hasNeutral = term.remove === true || term.neutral !== '';
      terms[phrase] = {
        phrase,
        type: term.type,
        neutral: term.remove === true ? '' : (term.neutral || ''),
        hasNeutral,
        stemType: term.stemType || '',
        regex: term.regex || '',
        remove: term.remove === true
      };
      if (term.regex) {
        regexTerms.push({ termId: phrase, pattern: term.regex });
      } else {
        entries.push({ phraseNorm: phrase, termId: phrase, length: phrase.length });
      }
    }
  }

  for (const file of fs.readdirSync(dataDir).filter(file => file.endsWith('.csv')).sort()) {
    const rows = parseCsv(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    if (!rows.length) continue;

    const [headerRow, ...bodyRows] = rows;
    const headers = headerRow.map(cell => cell.trim());
    const columnIndex = new Map(headers.map((name, index) => [name, index]));

    for (const required of ['phrase', 'type']) {
      if (!columnIndex.has(required)) {
        throw new Error(`Missing required column "${required}" in ${file}`);
      }
    }

    for (const row of bodyRows) {
      if (!row.some(cell => cell.trim().length > 0)) continue;

      const term = {
        phrase: row[columnIndex.get('phrase')] || '',
        type: row[columnIndex.get('type')] || '',
        neutral: row[columnIndex.get('neutral')] || '',
        aliases: splitAliases(row[columnIndex.get('aliases')] || ''),
        stemType: parseStemTypeCell(row[columnIndex.get('stemmable')] || ''),
        regex: row[columnIndex.get('regex')] || '',
        remove: parseBooleanCell(row[columnIndex.get('remove')] || '')
      };
      if (term.stemType && !term.regex) {
        term.regex = buildStemRegex(normalize(term.phrase), term.stemType);
      }

      const phrase = normalize(term.phrase);
      addTerm(phrase, term, file);
      for (const variant of hyphenVariants(term.phrase)) {
        const normalizedVariant = normalize(variant);
        if (normalizedVariant && normalizedVariant !== phrase) addTerm(normalizedVariant, term, file);
      }
      for (const alias of term.aliases || []) {
        const normalizedAlias = normalize(alias);
        if (normalizedAlias && normalizedAlias !== phrase) addTerm(normalizedAlias, term, file);
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

function extractText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

module.exports = {
  buildMatcher,
  buildStemRegex,
  extractText,
  findMatches,
  loadTerms,
  normalize,
  stemVariants
};
