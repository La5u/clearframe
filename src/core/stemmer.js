// Verbs whose past tense the spelling rules get wrong. Verbs in the first
// list do not change; the map holds "past participle" (participle defaults
// to the past form).
const UNCHANGED_VERBS = new Set('bet bid broadcast burst cast cost cut forecast hit hurt let put quit rid set shed shut slit split spread sunset thrust upset'.split(' '));
const IRREGULAR_PASTS = {
  beat: 'beat beaten', become: 'became become', begin: 'began begun', bite: 'bit bitten', blow: 'blew blown', break: 'broke broken',
  bring: 'brought', build: 'built', buy: 'bought', catch: 'caught', choose: 'chose chosen', come: 'came come', deal: 'dealt',
  do: 'did done', draw: 'drew drawn', drive: 'drove driven', eat: 'ate eaten', fall: 'fell fallen', feel: 'felt', fight: 'fought',
  find: 'found', fly: 'flew flown', forget: 'forgot forgotten', freeze: 'froze frozen', get: 'got', give: 'gave given', go: 'went gone',
  grow: 'grew grown', hang: 'hung', have: 'had', hide: 'hid hidden', hold: 'held', keep: 'kept', know: 'knew known', lay: 'laid',
  lead: 'led', leave: 'left', lose: 'lost', make: 'made', mean: 'meant', meet: 'met', pay: 'paid', ride: 'rode ridden', ring: 'rang rung',
  rise: 'rose risen', run: 'ran run', say: 'said', see: 'saw seen', seek: 'sought', sell: 'sold', send: 'sent', shake: 'shook shaken',
  shoot: 'shot', show: 'showed shown', sing: 'sang sung', sink: 'sank sunk', sit: 'sat', sleep: 'slept', speak: 'spoke spoken',
  spend: 'spent', stand: 'stood', steal: 'stole stolen', stick: 'stuck', strike: 'struck', swear: 'swore sworn', sweep: 'swept',
  swing: 'swung', take: 'took taken', teach: 'taught', tear: 'tore torn', tell: 'told', think: 'thought', throw: 'threw thrown',
  understand: 'understood', wake: 'woke woken', wear: 'wore worn', win: 'won', write: 'wrote written',
};
// Longer verbs stressed on the last syllable double their final consonant
// ("admitted", "beginning"); the length rule below only covers short words.
const DOUBLING_VERBS = new Set('abet admit begin commit compel control deter emit equip expel forget incur occur omit patrol permit prefer propel quit rebel recur refer regret submit transmit upset'.split(' '));

function isConsonant(code) {
  return code >= 97 && code <= 122 && ![97, 101, 105, 111, 117].includes(code);
}

function shouldDoubleFinalConsonant(word) {
  if (DOUBLING_VERBS.has(word)) {
    return true;
  }
  if (word.length < 3 || word.length > 4) {
    return false;
  }
  if (/(w|x|y)$/i.test(word) || /(ck|ch|sh|th|ph|gh|qu)$/i.test(word)) {
    return false;
  }
  const last = word.charCodeAt(word.length - 1), mid = word.charCodeAt(word.length - 2), prev = word.charCodeAt(word.length - 3);
  return isConsonant(last) && !isConsonant(mid) && isConsonant(prev);
}

export function pluralizeWord(w) {
  if (/(s|x|z|ch|sh)$/i.test(w)) {
    return `${w  }es`;
  }
  if (/[^aeiou]y$/i.test(w)) {
    return `${w.slice(0, -1)  }ies`;
  }
  return `${w  }s`;
}

export function pastTenseWord(word, participle = false) {
  if (UNCHANGED_VERBS.has(word)) {
    return word;
  }
  if (IRREGULAR_PASTS[word]) {
    const [past, pastParticiple = past] = IRREGULAR_PASTS[word].split(' ');
    return participle ? pastParticiple : past;
  }
  if (word.endsWith('e')) {
    return `${word  }d`;
  }
  if (/[^aeiou]y$/i.test(word)) {
    return `${word.slice(0, -1)  }ied`;
  }
  if (shouldDoubleFinalConsonant(word)) {
    return `${word + word[word.length - 1]  }ed`;
  }
  return `${word  }ed`;
}

export function ingWord(word) {
  if (word.length <= 2 || /(?:ee|oe|ye)$/.test(word)) {
    return `${word}ing`;
  }
  if (word.endsWith('ie')) {
    return `${word.slice(0, -2)  }ying`;
  }
  if (word.endsWith('e')) {
    return `${word.slice(0, -1)  }ing`;
  }
  if (shouldDoubleFinalConsonant(word)) {
    return `${word + word[word.length - 1]  }ing`;
  }
  return `${word  }ing`;
}

export function adverbWord(word) {
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) {
    return `${word.slice(0, -1)  }ily`;
  }
  if (word.endsWith('ic')) {
    return `${word  }ally`;
  }
  if (/[^aeiou]le$/i.test(word)) {
    return `${word.slice(0, -1)  }y`;
  }
  if (word.endsWith('ll')) {
    return `${word  }y`;
  }
  if (word.endsWith('ue')) {
    return `${word.slice(0, -1)  }ly`;
  }
  return `${word  }ly`;
}

const SAME_PLURAL = /(?:ics|news|series|species)$/;

// The singular of a noun or the base of a third-person verb ("groups",
// "criticizes"); words that only look plural are kept.
function singularWord(word) {
  if (!word.endsWith('s') || /(?:ss|us|is|os)$/.test(word) || SAME_PLURAL.test(word)) return word;
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(?:sses|xes|zzes|ches|shes)$/.test(word)) return word.slice(0, -2);
  return word.slice(0, -1);
}

function inflectWord(word, stemType, form) {
  if (stemType === 'adjective') return form === 'adverb' && !word.endsWith('ly') ? adverbWord(word) : word;
  if (stemType === 'noun') {
    const singular = singularWord(word);
    return form === 'plural' && !SAME_PLURAL.test(singular) ? pluralizeWord(singular) : singular;
  }
  // A verb written in the past or -ing form has no reliable base form, so it
  // is used as written.
  if (!UNCHANGED_VERBS.has(word) && !IRREGULAR_PASTS[word] && /(?<!e)ed$|^\w{3,}ing$/.test(word)) return word;
  const base = singularWord(word);
  if (form === 'third') return base.endsWith('o') ? `${base}es` : pluralizeWord(base);
  if (form === 'past' || form === 'participle') return pastTenseWord(base, form === 'participle');
  return form === 'ing' ? ingWord(base) : base;
}

/**
 * Puts a replacement phrase, written in any form, into the given form of its
 * stem type: '' (base), 'plural', 'third', 'past', 'participle', 'ing' or
 * 'adverb'. Verbs inflect their first word ("push out" -> "pushed out"),
 * skipping leading adverbs ("angrily confront"); nouns their last word, or the
 * one before "of" ("piece of work"); adjectives their last word.
 * @param {string} phrase @param {string} stemType @param {string} form
 */
export function inflectPhrase(phrase, stemType, form) {
  const words = phrase.split(' ');
  let head = words.length - 1;
  if (stemType === 'verb') head = words.findIndex((word, i) => i === words.length - 1 || !word.endsWith('ly'));
  else if (stemType === 'noun' && words.indexOf('of') > 0) head = words.indexOf('of') - 1;
  words[head] = inflectWord(words[head], stemType, form);
  return words.join(' ');
}

export function isWordChar(c) {
  const code = c.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

export function boundary(text, start, end) {
  return !isWordCharAt(text, start - 1) && !isWordCharAt(text, end);
}

export function isWordCharAt(text, index) {
  const c = text[index];
  if (!c) return false;
  if (c === '\'' || c === '’') {
    return isWordChar(text[index - 1] || ' ') && isWordChar(text[index + 1] || ' ');
  }
  return isWordChar(c);
}

