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
      accepted[accepted.length - 1] = {
        ...lexical,
        start: Math.min(last.start, match.start),
        end: Math.max(last.end, match.end),
        termIds: [...new Set([...(lexical.termIds || [lexical.termId]), ...(virtual.termIds || [virtual.termId])])],
        virtual: false,
        structural: true,
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
