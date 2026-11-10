// Structural devices found in one text node: tricolon (three short parallel
// items) and anaphora (consecutive clauses opening with the same words).
// Both start with a cheap check that most text nodes fail without allocating,
// then make one linear pass.

const ITEM = /^[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,3}$/u;
const SPACE = /\s/;

// Sentence and clause ends: a terminator followed by white space or the end.
// "3.5" and "1,000" are not ends. `marks` lists the terminating characters.
function nextBreak(text, from, marks) {
  for (let i = from; i < text.length; i++) {
    if (marks.includes(text[i]) && (i + 1 === text.length || SPACE.test(text[i + 1]))) return i;
  }
  return -1;
}

const words = value => value.split(/\s+/);

// Items are lower case (names, dates and Title Case headlines are not
// tricolons) and similar in length; multi-word items must also repeat a
// first or last word ("no jobs, no homes, no hope").
function isParallel(items, startsSentence) {
  const parts = items.map(item => words(item.text));
  const counts = parts.map(part => part.length);
  if (Math.max(...counts) - Math.min(...counts) > 1) return false;
  for (const [i, { text }] of items.entries()) {
    if (!ITEM.test(text) || /\p{Lu}/u.test(text.replace(/\bI\b/g, 'i').slice(i === 0 && startsSentence ? 1 : 0))) return false;
  }
  if (Math.max(...counts) === 1) return true;
  const repeats = pick => new Set(parts.map(pick)).size < parts.length;
  return repeats(part => part[0].toLowerCase()) || repeats(part => part[part.length - 1].toLowerCase());
}

// The three items of one sentence if it is exactly one short list, else null.
function listIn(text, start, end) {
  const segments = [];
  let from = start, opening = start;
  while (opening < end && SPACE.test(text[opening])) opening++;
  for (let i = start; i <= end; i++) {
    if (i === end || (text[i] === ',' && !(/\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '')))) {
      segments.push({ start: from, end: i });
      from = i + 1;
    } else if ('"“”()[]'.includes(text[i])) return null;
  }
  if (segments.length < 2 || segments.length > 3) return null;
  const items = [];
  for (const [i, segment] of segments.entries()) {
    const raw = text.slice(segment.start, segment.end);
    let a = segment.start + raw.length - raw.trimStart().length, b = segment.end - (raw.length - raw.trimEnd().length);
    const last = i === segments.length - 1;
    const conjunction = /^(?:and|or)\s+/i.exec(text.slice(a, b));
    if (last && segments.length === 3 && conjunction) a += conjunction[0].length;
    if (last && segments.length === 2) {
      const split = /\s(?:and|or)\s/i.exec(text.slice(a, b));
      if (!split) return null;
      items.push({ start: a, end: a + split.index, text: text.slice(a, a + split.index) });
      a += split.index + split[0].length;
    }
    items.push({ start: a, end: b, text: text.slice(a, b) });
  }
  if (items.length !== 3 || items.some(item => item.start >= item.end)) return null;
  // "He offered blood, sweat and tears": single-word items after a short lead-in.
  if (items[1].text.indexOf(' ') < 0 && items[2].text.indexOf(' ') < 0 && items[0].text.includes(' ')) {
    const lead = items[0].text.lastIndexOf(' ') + 1;
    if (words(items[0].text).length <= 5) items[0] = { start: items[0].start + lead, end: items[0].end, text: items[0].text.slice(lead) };
  }
  return isParallel(items, items[0].start === opening) ? { start: items[0].start, end: items[2].end } : null;
}

export function findTricolons(text) {
  const comma = text.indexOf(',');
  if (comma < 0 || (text.indexOf(',', comma + 1) < 0 && text.indexOf(' and ', comma) < 0 && text.indexOf(' or ', comma) < 0)) return [];
  const found = [];
  let start = 0;
  while (start < text.length) {
    const stop = nextBreak(text, start, '.!?;:');
    const end = stop < 0 ? text.length : stop;
    const list = listIn(text, start, end);
    if (list) found.push(list);
    start = end + 1;
  }
  return found;
}

// Words that open many clauses without making a pattern of their own.
const FUNCTION_WORDS = new Set(('a an the this that these those he she it they i you we him her them his its their my your our ' +
  'will would can could shall may might and but or so yet nor if when while as because although though than then there here is are was were be been am has have had do does did ' +
  'of in on at to for from by with into about after before over under said says say what who which how why where').split(' '));

// First words of each clause: up to four, lower case, with offsets.
function openingWords(text, from, to) {
  const out = [];
  let i = from;
  while (i < to && out.length < 4) {
    while (i < to && !/[\p{L}\p{N}]/u.test(text[i])) {
      if (out.length) return out;
      i++;
    }
    const start = i;
    while (i < to && /[\p{L}\p{N}'’-]/u.test(text[i])) i++;
    if (i === start) break;
    // A closing quote or dash after the word is not part of it.
    let stop = i;
    while (stop > start + 1 && /['’-]/.test(text[stop - 1])) stop--;
    out.push({ word: text.slice(start, stop).toLowerCase(), start, end: stop });
    if (!SPACE.test(text[i] || ' ')) break;
    while (i < to && text[i] === ' ') i++;
  }
  return out;
}

// A single shared word is a pattern only for these; elsewhere it is mostly a name ("Huntley ... Huntley").
const SINGLE_OPENERS = new Set('every each no not never none nobody nothing always all some many more less together today tomorrow one'.split(' '));

// The shared opening of two clauses, trailing function words dropped, so
// "The ... The ..." and "He said ... He said ..." share nothing.
function sharedOpening(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n].word === b[n].word) n++;
  while (n > 0 && FUNCTION_WORDS.has(a[n - 1].word)) n--;
  return n === 1 && !SINGLE_OPENERS.has(a[0].word) ? 0 : n;
}

export function findAnaphora(text) {
  if (text.length < 24) return [];
  const first = nextBreak(text, 0, '.!?;,');
  if (first < 0 || nextBreak(text, first + 1, '.!?;,') < 0) return [];
  const found = [];
  let previous = null, start = 0, lastAdded = null;
  while (start < text.length) {
    const stop = nextBreak(text, start, '.!?;,');
    const end = stop < 0 ? text.length : stop;
    const current = openingWords(text, start, end);
    if (previous && current.length) {
      const n = sharedOpening(previous, current);
      if (n) {
        const spans = [previous, current].map(opening => ({ start: opening[0].start, end: opening[n - 1].end }));
        for (const span of spans) {
          if (!lastAdded || span.start > lastAdded.start) found.push(lastAdded = span);
        }
      }
    }
    if (current.length) previous = current;
    start = end + 1;
  }
  return found;
}
