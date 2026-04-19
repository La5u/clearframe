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
shock,clickbait,,,,verb,true
```

If you are unsure, add the simplest base form and leave the replacement blank.
