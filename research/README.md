# ClearFrame research data

Large corpora are build-time evidence and are excluded from extension packages.
Run `npm run data:download` to fetch enabled Priority-1 sources into `raw/` and
write SHA-256 receipts. A source is not redistribution-safe merely because its
download script or paper is open; `sources.json` records corpus-specific caveats.

## Isolation policy

`babe` is evaluation-only. Mining and compilation scripts call the shared source
policy guard, which throws if an evaluation-only source appears in rule
provenance. BABE must not influence vocabulary, thresholds, candidate selection,
error-driven iteration, or model choice. Its results are reported separately only
after a candidate rule release is frozen.

## Promotion policy

Promotion criteria are source- and feature-specific; ClearFrame does not use a
universal precision cutoff. WNC substitutions retain transition consistency as
ranking evidence and require document diversity. MAGPIE idioms use repeated, majority-idiomatic annotations
and ship as `exploratory` because literal readings remain possible. Rewording has
a separate, stricter gate and remains off until meaning and part of speech are
preserved.

Congressional Record (GST) phrases measure which party says a phrase, not
whether it is loaded. `npm run mine:gst` writes equal Republican and Democratic
batches to `research/reports/` for review. A GST rule is approved only when two
independent reviewers agree it is loaded framing and it ships as half of a pair
in `data/mirror-pairs.json`; the build rejects it otherwise.

Recent Congressional Record speech (`crec-govinfo`, public domain) follows the
same rule. Its sources are marked `requiresMirror` in `sources.json`, and the
build rejects any rule from them that is not half of a tested pair.

Wikipedia "Words to watch" candidates are side-neutral by design, but still
need two reviewers to agree on news-text precision; contentious labels follow
the mirror rule. NewsWCL50 is evaluation-only: `npm run evaluate:balance`
compares flag rates on left, centre and right outlets' wording for the same
events.

Luna review agents should inspect borderline candidates, semantic conflicts, and
new rule families rather than every occurrence.

## Quarantine

`research/quarantine/` holds generated rules that must not ship. SemEval-2020
propaganda rules live there: they were politically asymmetric and the corpus is
not cleared for redistribution. Sources whose `redistribution` is not
`allowed` in `sources.json` are rejected as provenance for approved rules;
they may appear only in a rule's `corroboratedBy` list.
