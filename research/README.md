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

Luna review agents should inspect borderline candidates, semantic conflicts, and
new rule families rather than every occurrence.
