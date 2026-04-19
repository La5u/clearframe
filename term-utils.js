const fs = require('fs');
const path = require('path');

function normalize(phrase) {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase();
}

const IRREGULAR_VERB_FORMS = {
  break: { past: 'broke' },
  sunset: { past: 'sunset' }
};

function isConsonant(code) {
  return (
    (code >= 97 && code <= 122) &&
    ![97, 101, 105, 111, 117].includes(code)
  );
}

function shouldDoubleFinalConsonant(word) {
  if (word.length < 3 || word.length > 4) return false;
  if (/(w|x|y)$/i.test(word)) return false;
  if (/(ck|ch|sh|th|ph|gh|qu)$/i.test(word)) return false;
  const last = word.charCodeAt(word.length - 1);
  const mid = word.charCodeAt(word.length - 2);
  const prev = word.charCodeAt(word.length - 3);
  return isConsonant(last) && !isConsonant(mid) && isConsonant(prev);
}

function stemVariants(word, stemType) {
  const out = new Set([word]);
  const consonantY = /[^aeiou]y$/;
  const plural = w => {
    if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es';
    if (consonantY.test(w)) return w.slice(0, -1) + 'ies';
    return w + 's';
  };
  const past = w => {
    if (IRREGULAR_VERB_FORMS[w]?.past) return IRREGULAR_VERB_FORMS[w].past;
    if (w.endsWith('e')) return w + 'd';
    if (consonantY.test(w)) return w.slice(0, -1) + 'ied';
    if (shouldDoubleFinalConsonant(w)) return w + w[w.length - 1] + 'ed';
    return w + 'ed';
  };
  const ing = w => {
    if (w.endsWith('ie')) return w.slice(0, -2) + 'ying';
    if (w.endsWith('e')) return w.slice(0, -1) + 'ing';
    if (shouldDoubleFinalConsonant(w)) return w + w[w.length - 1] + 'ing';
    return w + 'ing';
  };
  const adverb = w => {
    if (w.endsWith('y') && !/[aeiou]y$/.test(w)) return w.slice(0, -1) + 'ily';
    return w + 'ly';
  };

  if (stemType === 'noun') {
    out.add(plural(word));
  } else if (stemType === 'adjective') {
    out.add(adverb(word));
  } else if (stemType === 'verb') {
    out.add(plural(word));
    out.add(past(word));
    out.add(ing(word));
  }
  return [...out];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildStemRegex(word, stemType) {
  const variants = stemVariants(word, stemType).map(escapeRegex);
  return `\\b(?:${variants.join('|')})\\b`;
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

function parseStemTypeCell(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'true') return 'verb';
  if (['noun', 'verb', 'adjective'].includes(raw)) return raw;
  throw new Error(`Unsupported stem type "${value}"`);
}

function collectPhraseMatches(matcher, text) {
  if (!matcher) return [];

  const lower = text.toLowerCase();
  const matches = [];
  let index = 0;

  while (index < lower.length) {
    let node = matcher[lower[index]];
    if (!node) {
      index++;
      continue;
    }

    let matched = null;
    let cursor = index + 1;

    if (node.$ && boundary(lower, index, cursor)) {
      matched = { start: index, end: cursor, termId: node.$ };
    }

    while (cursor < lower.length) {
      node = node[lower[cursor]];
      if (!node) break;
      cursor++;
      if (node.$ && boundary(lower, index, cursor)) {
        matched = { start: index, end: cursor, termId: node.$ };
      }
    }

    if (matched) {
      matches.push(matched);
      index = matched.end;
    } else {
      index++;
    }
  }

  return matches;
}

function compileRegexTerm(term) {
  if (!term?.regex) return null;
  return new RegExp(term.regex, 'giu');
}

function collectRegexMatches(text, regexTerms, termsById) {
  const matches = [];
  for (const term of regexTerms || []) {
    const compiled = compileRegexTerm(termsById?.[term.termId]);
    if (!compiled) continue;
    for (const match of text.matchAll(compiled)) {
      if (!match[0]) continue;
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        termId: term.termId
      });
    }
  }
  return matches;
}

function collectMatches(matcher, text, termsById = null, regexTerms = []) {
  const phraseMatches = collectPhraseMatches(matcher, text);
  const regexMatches = collectRegexMatches(text, regexTerms, termsById);
  return [...phraseMatches, ...regexMatches].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
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
      if (!term.regex && !term.stemType) {
        for (const alias of term.aliases || []) {
          const normalizedAlias = normalize(alias);
          if (normalizedAlias && normalizedAlias !== phrase) addTerm(normalizedAlias, term, file);
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

function buildMatcher(index) {
  const root = Object.create(null);
  if (!index.buckets) return root;
  for (const entries of Object.values(index.buckets)) {
    for (const entry of entries) {
      if (!index.termsById[entry.termId]) continue;
      let node = root;
      for (const ch of entry.phraseNorm) {
        node = node[ch] ||= Object.create(null);
      }
      node.$ = entry.termId;
    }
  }
  return root;
}

function isWordChar(text, index) {
  const c = text[index];
  const code = c.charCodeAt(0);
  if (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  ) {
    return true;
  }
  return c === '\'';
}

function boundary(text, start, end) {
  return !isWordChar(text, start - 1) && !isWordChar(text, end);
}

function findMatches(matcher, text, termsById = null, regexTerms = []) {
  const matches = collectMatches(matcher, text, termsById, regexTerms);
  const accepted = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.start < cursor) continue;
    accepted.push(match);
    cursor = match.end;
  }

  return accepted;
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
  extractText,
  findMatches,
  loadTerms,
  normalize
};
