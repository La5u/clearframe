# ClearFrame

Browser extension that helps readers notice authorial choices, clickbait, and persuasion cues in online text.

## Product Direction

ClearFrame is a local, user-controlled persuasion filter for the web. It highlights clickbait, emotional pressure, vague sourcing, inflated certainty, and other framing choices while keeping the evidence visible.

The reader stays in control:

- Pages are analyzed locally as they load and change.
- Matches identify specific wording rather than assigning a political bias score.
- Rewording and removal are optional.
- Categories and colors remain customizable.
- Highlights can use category colors or one monochrome color.

ClearFrame exposes linguistic pressure without telling readers what to believe.

## Quick Start

```sh
npm install
npm run build     # outputs dist/ (Chrome) and dist-firefox/
npm test          # runs match-count regression tests
npm run ci        # build + size check + typecheck + test
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

Approved scalable rules live in `data/rules/*.jsonl`. Each record retains its
source, evidence, semantic dimensions, approval state, and an independently
reviewed reword. Large corpora stay in git-ignored `research/raw/`; build-time
scripts normalize and mine them, while only compact approved rules ship.

Legacy hand-authored terms remain in `data/terms/*.csv` during migration:

Terms live in `data/terms/*.csv`:

```csv
phrase,type,neutral,aliases,stemmable,regex,remove,contexts
ain't,colloquialism,is not,,,,,
exclusive,clickbait,,,adjective,,true,headline
```

- `aliases`: pipe-separated alternate forms
- `stemmable`: `noun|verb|adjective` — auto-generates regex for inflections (plural, past, -ing, adverb)
- `regex`: custom pattern for context-sensitive matches
- `remove`: mark term for deletion in remove-mode
- `contexts`: optional pipe-separated allowlist such as `headline` or `evaluative`; there is no second exclusion list
- `colloquialism` rules default to publication pages, so ordinary Reddit and YouTube language is not flagged
- Every normalized phrase must be unique across all types (enforced at build)

## Architecture

| File | Role |
|---|---|
| `build.js` | Loads CSV terms, validates taxonomy, bundles with esbuild |
| `src/content.js` | Watches page text, matches phrases, owns per-node results, and renders highlights/tooltips |
| `src/core/matcher.js` | Trie-based phrase matcher with longest-match and word-boundary detection |
| `src/core/term-utils.js` | CSV parser, alias/stem expansion, duplicate validation |
| `src/core/stemmer.js` | Lightweight inflection for plural/past/-ing/adverb |
| `src/popup.js` | Customize/Detected tab UI, type toggle, drag-to-recolor |
| `src/background.js` | Badge sync across tabs |
| `data/type-colors.json` | Color-to-subtype mapping |
| `data/rules/*.jsonl` | Provenance-aware approved rules compiled at build time |
| `research/sources.json` | Pinned corpus roles, licenses, URLs, and isolation policy |
| `tools/mine-wnc.js` | Mines repeated minimal WNC edits into non-executable candidates |

## Research pipeline

```sh
npm run data:download       # Priority-1 sources; large files are git-ignored
npm run data:normalize      # common JSONL research cache
npm run mine:wnc -- research/raw/bias_data.zip
npm run rules:magpie       # exact idioms; detection-only
npm run rules:propaganda   # repeated short SemEval spans; context-labelled
npm run benchmark:build     # held-out WNC benchmark
npm run evaluate:babe      # sealed external diagnostic; never rule generation
npm run bench               # 10,000-rule phrase-matcher budget
npm run bench:browsers      # matching core in installed Chromium and Firefox
```

The build rejects any rule citing an evaluation-only source such as BABE and any
corpus-derived approval that fails the evidence gates. Chrome and Firefox ZIPs
also fail CI at 50 MB. See `CLEARFRAME_TAXONOMY.md`, `research/README.md`, and
`FUTURE_DATA_PLAN.md`.

## Analysis Flow

The current implementation analyzes pages automatically:

```text
Page loads or visible text changes
        ↓
Analyze page text locally
        ↓
Local phrase and pattern rules
        ↓
Highlights or optional rewording
        ↓
Original wording remains inspectable
```

The design should:

- Keep automatic analysis responsive on dynamic pages.
- Prefer high-confidence patterns over isolated-word judgments.
- Make every rewording reversible and keep original wording inspectable.
- Optional feedback tools let readers classify bad matches and suggest selected wording; records stay in `chrome.storage.local` and can be copied from General.
- Keep preferences in `chrome.storage.sync`; the term index remains bundled.
- Avoid opaque political scores, fact-checking claims, and automatic moral judgments.

## Intentional Limits

- Phrase-based, no NLP or semantic disambiguation
- No deep literary-device inference (irony, satire, allusion)
- No shadow DOM penetration
- `chrome.storage.sync` — user settings only (term index is bundled)

## TypeScript

The codebase is JS with `tsc --noEmit checkJs` and type declarations in `src/types/`. Run `npm run typecheck`.
