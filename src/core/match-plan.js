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
  return { ...match, termIds: match.termIds || [match.termId] };
}

export function resolveMatchGroups(matches) {
  const accepted = [];
  for (const match of matches.sort(compareMatches)) {
    const exact = accepted.find(item => sameSpan(item, match));
    if (exact) {
      if (!exact.termIds.includes(match.termId)) {
        exact.termIds.push(match.termId);
      }
      continue;
    }

    const overlapping = accepted.reduce((acc, item, index) => (overlaps(match, item) ? acc.concat(index) : acc), []);
    if (!overlapping.length) {
      accepted.push(groupFor(match));
      continue;
    }
    if (match.virtual) {
      continue;
    }
    for (let i = overlapping.length - 1; i >= 0; i--) {
      if (accepted[overlapping[i]].virtual) {
        accepted.splice(overlapping[i], 1);
      }
    }
    if (!accepted.some(item => overlaps(match, item))) {
      accepted.push(groupFor(match));
    }
  }
  return accepted.sort(compareMatches);
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
