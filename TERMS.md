# Adding Terms

Use this file as the source of truth when editing `data/terms/*.csv`.

Rules:
- Add the base word or base phrase, not an inflected derivative.
- Do not enter surface inflections like `terrifying`, `raged`, `shocking`, or `clashes` when the lemma is `terrify`, `rage`, `shock`, or `clash`.
- Leave `neutral` blank unless you actually want a replacement in replace mode.
- Use `remove=true` only when the term should disappear in replace mode.
- Use `stemmable` for words that should match simple inflections, and set it to the word type:
  - `noun` for plural forms like `secret` -> `secrets`
  - `verb` for verb forms like `terrify` -> `terrifies`, `terrified`, `terrifying`
  - `adjective` for adverb-style forms like `eye-watering` -> `eye-wateringly`
- Do not add replacements by default just to fill the column.
- Prefer one clear exact phrase per row.
- Use `aliases` only for true surface-form variants.
- Use `regex` only for context-sensitive matches.
- Keep a term in only one subtype file unless the build rules explicitly allow otherwise.

Examples:

```csv
phrase,type,neutral,aliases,stemmable,regex,remove
terrify,fear,,,verb,,
secret,reveal,,,noun,,
eye-watering,exaggeration,,,adjective,,
up to,exaggeration,as much as,,,\bup to(?=\s+\d),
shock,clickbait,,,verb,,true
```

If you are unsure, add the simplest base form and leave the replacement blank.

## Labels

Each type in `data/type-colors.json` needs an entry in `data/type-labels.json`:
`term` (the technical name shown first, so readers learn it), `plain` (the
everyday name), and `effect` (one sentence on what the wording does to the
reader). The plain name and effect appear when hovering the (i). The build fails
if a type is missing.

## Confidence

An optional `confidence` column (`high`, `medium`, `contextual`, `exploratory`;
blank means `high`) marks terms that are often fine in news writing, such as
`alleged` or `probe`. Anything below `high` is drawn at half strength and the
tooltip names the level.

## Mirror rule

A term that frames one political side, group, or contested position must ship
with its mirror: the equivalent framing from the other side, with the same type
and confidence. Add both terms and a pair to `data/mirror-pairs.json`; `npm test`
fails if the two sides are not flagged identically.

If no sensible mirror exists, flag neither. Remove the term and add it to the
`deferred` list in `data/mirror-pairs.json` with the reason, so it can be
revisited. Tests also check deferred terms stay unflagged.

Device-based terms (passive voice, agency hiding, clickbait, hype, unnamed
sources) apply to whoever uses them and are not mirrored. Generic labels such as
`radical`, `extremist`, or `regime` are symmetric by construction; add a pair
proving it when in doubt.
