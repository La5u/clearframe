export function compareMatches(a, b) {
  if (a.start !== b.start) {
    return a.start - b.start;
  }
  const lengthDelta = (b.end - b.start) - (a.end - a.start);
  return lengthDelta !== 0 ? lengthDelta : Number(!!a.virtual) - Number(!!b.virtual);
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function sameSpan(a, b) {
  return a.start === b.start && a.end === b.end;
}

function groupFor(match) {
  return { ...match, termIds: match.termIds || [match.termId], structural: match.structural || match.virtual === true };
}

export function resolveMatchGroups(matches) {
  const accepted = [];
  for (const match of matches.sort(compareMatches)) {
    const last = accepted[accepted.length - 1];
    if (last && sameSpan(last, match)) {
      if (!last.termIds.includes(match.termId)) {
        last.termIds.push(match.termId);
      }
      continue;
    }
    if (!last || !overlaps(last, match)) {
      accepted.push(groupFor(match));
      continue;
    }
    if (last.structural || last.virtual || match.virtual) {
      const lexical = last.virtual ? match : last;
      const virtual = last.virtual ? last : match;
      const start = Math.min(last.start, match.start), end = Math.max(last.end, match.end);
      accepted[accepted.length - 1] = {
        ...lexical,
        start,
        end,
        termIds: [...new Set([...(lexical.termIds || [lexical.termId]), ...(virtual.termIds || [virtual.termId])])],
        virtual: false,
        structural: true,
        // The group now spans more than the lexical term, so that term's
        // reword/removal must not be applied to the whole range.
        expanded: !!lexical.expanded || start !== lexical.start || end !== lexical.end,
      };
      continue;
    }
  }
  return accepted;
}

export function chooseReplacementTerm(terms, getTermAction, allCapsPhrase) {
  return terms.find(term => term.phrase !== allCapsPhrase && getTermAction(term) === 'removed') ||
    terms.find(term => term.phrase !== allCapsPhrase && getTermAction(term) === 'replaced') ||
    terms.find(term => term.phrase === allCapsPhrase) ||
    terms[0];
}

export function getReplacementSourceText(term, terms, sourceText, allCapsPhrase, normalizeAllCaps) {
  return terms.some(item => item.phrase === allCapsPhrase) && term.phrase !== allCapsPhrase
    ? normalizeAllCaps(sourceText)
    : sourceText;
}

// Protected text (captions, transcripts) is only highlighted; otherwise the
// user's reword/remove settings decide.
export function chooseAction(term, { removeTerms = false, replaceTerms = false } = {}, preserveText = false) {
  if (preserveText) return 'highlighted';
  if (term.remove && removeTerms) return 'removed';
  if (replaceTerms && term.neutral) return 'replaced';
  return 'highlighted';
}
