# ClearFrame

Browser extension that highlights authorial choices in text and shows neutral alternatives. Uses the CSS Custom Highlight API (no DOM pollution).

## Quick Start

```sh
npm install
npm run build     # outputs dist/ (Chrome) and dist-firefox/
npm test          # runs match-count regression tests
npm run ci        # build + typecheck + lint + test
```

## Detector Types

Color-coded categories track types of manipulation:

- **yellow** sensationalism: all-caps, clickbait, hype, reveal
- **green** intensification: absolute, exaggeration, superlative
- **gray** framing & sourcing: unsourced, authority, uncertainty, loaded-framing, distancing
- **red** hostility: aggression, derogatory
- **pink** value judgment: moral, loaded
- **orange** conflict & drama: conflict, minimizing, negative-framing
- **purple** urgency & fear: fear
- **blue** softening & agency hiding: euphemism, passive
- **brown** dysphemism: dysphemism
- **teal** style & voice: colloquialism, idiom, repetition, rhetorical-question

Disabled by default: `absolute`, `exaggeration`, `superlative`.

## Data Model

Terms live in `data/terms/*.csv`:

```csv
phrase,type,neutral,aliases,stemmable,regex,remove
ain't,colloquialism,is not,,,,,
exclusive,clickbait,,,adjective,,true
```

- `aliases`: pipe-separated alternate forms
- `stemmable`: `noun|verb|adjective` — auto-generates regex for inflections (plural, past, -ing, adverb)
- `regex`: custom pattern for context-sensitive matches
- `remove`: mark term for deletion in remove-mode
- Every normalized phrase must be unique across all types (enforced at build)

## Architecture

| File | Role |
|---|---|
| `build.js` | Loads CSV terms, validates taxonomy, bundles with esbuild |
| `src/content.js` | Scans text nodes, matches phrases via trie+regex, applies CSS highlights, replaces text, shows hover tooltips |
| `src/core/matcher.js` | Trie-based phrase matcher with longest-match and word-boundary detection |
| `src/core/term-utils.js` | CSV parser, alias/stem expansion, duplicate validation |
| `src/core/stemmer.js` | Lightweight inflection for plural/past/-ing/adverb |
| `src/popup.js` | Customize/Detected tab UI, type toggle, drag-to-recolor |
| `src/background.js` | Badge sync across tabs |
| `data/type-colors.json` | Color-to-subtype mapping |

## Intentional Limits

- Phrase-based, no NLP or semantic disambiguation
- No deep literary-device inference (irony, satire, allusion)
- No shadow DOM penetration
- `chrome.storage.sync` — user settings only (term index is bundled)

## TypeScript

The codebase is JS with `tsc --noEmit checkJs` and type declarations in `src/types/`. Run `npm run typecheck`.
