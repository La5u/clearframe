import fs from 'fs';
import path from 'path';
import { normalize } from './matcher.js';
import { CLAUSE_FLAGS, CLAUSE_WINDOWS, parseRulePattern } from './context-filter.js';
import { adverbWord, pastTenseWord, pluralizeWord, ingWord } from './stemmer.js';

const ALLOWED_CONTEXTS = new Set(['headline', 'body', 'publication', 'discussion', 'video', 'conversation', 'evaluative']);
const SHOWN_IN = ['headline', 'body'];
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

  return { termsById: terms, regexTerms, exceptions: loadExceptions(path.join(dataDir, 'exceptions.json'), terms) };
}

const EXCEPTION_SECTIONS = new Set(['terms', 'shared', 'contexts', 'types']);

// Validates data/terms/exceptions.json and returns it without notes, in the
// shape createLexicalFilter() reads.
export function loadExceptions(file, termsById) {
  const out = { terms: {}, only: {}, shared: {}, contexts: {}, types: {} };
  if (!fs.existsSync(file)) return out;
  const source = path.basename(file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${source}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const fail = (where, message) => {
    throw new Error(`${source} ${where}: ${message}`);
  };
  const checkKeys = (where, value, allowed) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where, 'must be an object');
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) fail(where, `unknown field "${key}" (allowed: ${allowed.join(', ')})`);
    }
  };
  const checkClause = (where, clause) => {
    checkKeys(where, clause, [...CLAUSE_FLAGS, ...CLAUSE_WINDOWS]);
    if (!Object.keys(clause).length) fail(where, 'empty clause would match everything');
    for (const [key, value] of Object.entries(clause)) {
      if (CLAUSE_FLAGS.includes(key)) {
        if (typeof value !== 'boolean') fail(where, `"${key}" must be true or false`);
        continue;
      }
      try {
        parseRulePattern(value);
      } catch (error) {
        fail(`${where}.${key}`, `invalid regex: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return clause;
  };
  const clauseList = (where, list) => {
    if (!Array.isArray(list) || !list.length) fail(where, 'must be a non-empty list of clauses');
    return list.map((clause, i) => checkClause(`${where}[${i}]`, clause));
  };

  // Clauses, or names of `shared` lists.
  const unlessList = (where, list) => {
    if (!Array.isArray(list) || !list.length) fail(`${where}.unless`, 'must be a non-empty list');
    return list.map((item, i) => {
      if (typeof item !== 'string') return checkClause(`${where}.unless[${i}]`, item);
      if (!out.shared[item]) fail(`${where}.unless[${i}]`, `unknown shared pattern "${item}"`);
      return item;
    });
  };

  checkKeys('top level', data, [...EXCEPTION_SECTIONS]);
  for (const section of EXCEPTION_SECTIONS) {
    const value = data[section];
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) fail(`"${section}"`, 'must be an object');
  }
  for (const [name, entry] of Object.entries(data.shared || {})) {
    checkKeys(`shared "${name}"`, entry, ['note', 'unless']);
    out.shared[name] = clauseList(`shared "${name}".unless`, entry.unless);
  }
  const phrases = new Set(Object.values(termsById).map(term => term.phrase));
  for (const [phrase, entry] of Object.entries(data.terms || {})) {
    const where = `term "${phrase}"`;
    if (!phrases.has(phrase)) fail(where, 'is not a term phrase (use the normalized main phrase, not an alias)');
    checkKeys(where, entry, ['note', 'unless', 'only']);
    if (!entry.unless && !entry.only) fail(where, 'needs "unless" or "only"');
    out.terms[phrase] = entry.unless ? unlessList(where, entry.unless) : [];
    if (entry.only) out.only[phrase] = clauseList(`${where}.only`, entry.only);
  }
  for (const [name, entry] of Object.entries(data.contexts || {})) {
    if (!ALLOWED_CONTEXTS.has(name)) fail(`context "${name}"`, 'is not a supported context');
    checkKeys(`context "${name}"`, entry, ['note', 'when']);
    out.contexts[name] = clauseList(`context "${name}".when`, entry.when);
  }
  const types = new Set(Object.values(termsById).map(term => term.type));
  for (const [type, entry] of Object.entries(data.types || {})) {
    if (!types.has(type)) fail(`type "${type}"`, 'has no terms');
    checkKeys(`type "${type}"`, entry, ['note', 'contexts', 'only', 'unless', 'confidence']);
    const rule = {};
    if (entry.contexts) {
      if (!Array.isArray(entry.contexts) || !entry.contexts.length) fail(`type "${type}".contexts`, 'must be a non-empty list');
      for (const context of entry.contexts) {
        if (!ALLOWED_CONTEXTS.has(context)) fail(`type "${type}"`, `unsupported context "${context}"`);
      }
      rule.contexts = entry.contexts;
    }
    if (entry.only) rule.only = clauseList(`type "${type}".only`, entry.only);
    if (entry.unless) rule.unless = unlessList(`type "${type}"`, entry.unless);
    for (const [shown, confidence] of Object.entries(entry.confidence || {})) {
      if (!SHOWN_IN.includes(shown) || !CONFIDENCE_LEVELS.has(confidence)) fail(`type "${type}".confidence`, `"${shown}: ${confidence}" is not (${SHOWN_IN.join('|')}): (${[...CONFIDENCE_LEVELS].join('|')})`);
      (rule.confidence ||= {})[shown] = confidence;
    }
    if (!Object.keys(rule).length) fail(`type "${type}"`, 'needs contexts, only, unless or confidence');
    out.types[type] = rule;
  }
  return out;
}

export function extractText(html) {
  return html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ');
}
