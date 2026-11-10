# ClearFrame

Browser extension that helps readers notice authorial choices, clickbait, and persuasion cues in online text.

## Product Direction

ClearFrame is a local, user-controlled persuasion filter for the web. It highlights clickbait, emotional pressure, vague sourcing, inflated certainty, and other framing choices while keeping the evidence visible.

The reader stays in control:

- Pages are analyzed locally as they load and change.
- Matches identify specific wording rather than assigning a political bias score.
- Rewording and removal are optional.
- Categories and colors remain customizable.
- Highlights are monochrome by default; category colors are optional.

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
- **slate** quotes: quote

Disabled by default: `absolute`, `exaggeration`, `superlative`, `quote`.

## Data Model

Approved scalable rules live in `data/rules/*.jsonl`. Each record retains its
source, evidence, semantic dimensions, approval state, and an independently
reviewed reword. Large corpora stay in git-ignored `research/raw/`; build-time
scripts normalize and mine them, while only compact approved rules ship.

Hand-authored terms live in `data/terms/*.csv`:

```csv
phrase,type,neutral,aliases,stemmable,regex,remove,contexts,confidence
ain't,colloquialism,is not,,,,,
exclusive,clickbait,,,adjective,,true,headline
```

- `aliases`: pipe-separated alternate forms
- `stemmable`: `noun|verb|adjective` — adds literal inflected forms (plural, past, -ing, adverb); in reword mode the `neutral` is put into the same form (`axed` → `cut`, `hordes` → `large groups`)
- `regex`: custom pattern for context-sensitive matches
- `remove`: mark term for deletion in remove-mode; the space next to it and, at a sentence start, an orphaned `:`, `,` or dash go with it (`EXCLUSIVE: Chilling details` → `Details`). A capitalised term inside a name or title mid-sentence (`Shock and Awe`) is only highlighted, in reword mode too
- `contexts`: optional pipe-separated allowlist such as `headline` or `evaluative`; there is no second exclusion list
- `confidence`: optional `medium|contextual|exploratory`; drawn at 75% (`medium`) or 50% strength
- `colloquialism` rules default to publication pages, so ordinary Reddit and YouTube language is not flagged (set under `types` in `data/terms/exceptions.json`)
- Exceptions ("electric shock", "Secret Service") go in `data/terms/exceptions.json`, keyed by phrase; see `TERMS.md`
- Every normalized phrase must be unique across all types (enforced at build)
- Politically one-sided terms need a mirror term; see `TERMS.md` and `data/mirror-pairs.json`

## Architecture

| File | Role |
|---|---|
| `build.js` | Loads CSV terms, validates taxonomy, bundles with esbuild |
| `src/content.js` | Watches page text, matches phrases, owns per-node results, and renders highlights/tooltips |
| `src/core/matcher.js` | Trie-based phrase matcher with longest-match and word-boundary detection |
| `src/core/term-utils.js` | CSV parser, alias/stem expansion, duplicate and exception validation |
| `src/core/context-filter.js` | Applies `data/terms/exceptions.json` and context allowlists to each match |
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
npm run mine:gst           # Congress partisan phrases 1995-2017; equal R/D review batches
npm run data:crec          # sample recent Congressional Record floor speech (public domain)
npm run mine:crec          # recent partisan phrases; equal R/D review batches
node tools/import-wtw.js   # Wikipedia "Words to watch" candidates (CC BY-SA)
npm run evaluate:balance   # NewsWCL50 left/centre/right flag-rate diagnostic
node tools/news-report.js  # live news front pages across the spectrum (CHROMIUM_PATH=...)
npm run smoke:sites        # tooltip, feedback, and reword checks on live sites
npm run evaluate:babe      # sealed external diagnostic; never rule generation
npm run bench               # 10,000-rule phrase-matcher budget
npm run bench:browsers      # matching core in installed Chromium and Firefox
```

The build rejects any rule citing an evaluation-only source such as BABE and any
corpus-derived approval that fails the evidence gates. Chrome and Firefox ZIPs
also fail CI at 50 MB. See `CLEARFRAME_TAXONOMY.md`, `research/README.md`, and
`FUTURE_DATA_PLAN.md`.

## Regression snapshots and accuracy

```sh
npm run snapshot:check     # build, then compare real-browser output with tests/snapshots/
npm run snapshot:update    # rewrite the snapshots after an intended change; review the git diff
npm run evaluate:gold      # precision/recall against tests/gold/ (add -- --all for every type)
```

**Snapshots** (`tools/snapshot-highlights.js`) load every page in `tests/fixtures/`
from a local server into one headless Chromium with `dist/` installed, with all
other network requests blocked and any `<script>` stripped. Each fixture is
recorded in three modes: highlight (defaults), reword (`replaceTerms`) and
remove (`removeTerms`). Every highlight becomes one line, `name | context[text]context`,
in document order; the reword and remove files also list each rewritten text
node as `~ context[old => new]context`. A full check takes about 30 seconds.
The browser is `CHROMIUM_PATH`, else `/usr/bin/chromium`, else the newest
Playwright Chromium in `~/.cache/ms-playwright`. This check is local only, not
part of `npm run ci`: it needs a Chromium that still accepts `--load-extension`
(branded Chrome no longer does), and that has not been verified on the GitHub runner.
Run it before and after any change to detection or rendering.

**Gold labels** (`tests/gold/*.jsonl`) hold one text block per line:

```json
{"id":"g001","source":"newssite.html","context":"headline","page":"publication","text":"…","spans":[{"start":11,"end":20,"type":"quote","text":"'awkward'"}],"reviewed":false}
```

`context` is `headline` or `body`, `page` is the page context (`publication`,
`discussion`, `video`), `type` is a type from `data/type-labels.json`, and `text`
on a span is a checked copy of the labelled wording; `note` is optional.
`tools/evaluate-gold.js` runs the content script's analyzer (`src/core/analyze.js`)
on each block and reports exact and overlap precision, recall and F1, overall and per type,
plus false positives by rule and misses by wording. Types that are off by
default are left out unless `--all` is given.

The 200 seed blocks were sampled from the six news fixtures (headlines and body
text, many with no loaded wording at all) and labelled by an AI model reading
them against `CLEARFRAME_TAXONOMY.md` and `data/type-labels.json`, not from
detector output. Conventions used: routine attribution ("police say", "court
told") and ordinary reporting verbs ("warns") are not marked; vague sources
("experts warn", "insiders say") are `unsourced`; words inside a full quotation
are not marked, but short quoted fragments that carry a judgment are `quote`. **None of the labels are reviewed yet** (`"reviewed": false`), so
the scores are provisional and the tool is a report, not a CI gate. Set
`reviewed` to `true` on each block once you agree with its spans.

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

The content script is a pipeline of small modules (`src/content.js` is the
entry point that loads settings and wires events and popup messages):

- `content/observer.js` runs a full pass on load and a debounced pass over the
  text nodes a `MutationObserver` saw the page change.
- `content/scanner.js` finds the text nodes to analyze and gives each one its
  element context (heading, link, caption, comment, protected text).
- `core/analyze.js` (pure, also used by the evaluation tools) turns a text, its
  context and the settings into a plan: the text to display and one entry per
  detection with its action (highlighted, replaced, removed) and highlight name.
- `content/store.js` writes the display text into the node, keeps one record
  (with a live `Range`) per entry, restores original text, and holds the
  per-term summary for the badge and popup.
- `content/highlights.js` draws the records' ranges in the CSS Custom Highlight
  registry and keeps the highlight stylesheet.
- Beside the pipeline: `content/tooltip.js` (hover and pinned tooltip),
  `content/reveal.js` (original wording under the pointer), `content/feedback.js`
  (feedback buttons and suggestion panel), `content/settings.js` (current settings).

The design should:

- Keep automatic analysis responsive on dynamic pages.
- Prefer high-confidence patterns over isolated-word judgments.
- Make every rewording reversible and keep original wording inspectable.
- Optional feedback tools let readers classify bad matches and suggest selected wording; records stay in `chrome.storage.local` and can be copied from General.
- Keep preferences in `chrome.storage.sync`; the term index remains bundled.
- Avoid opaque political scores, fact-checking claims, and automatic moral judgments.

Phrase rules match across source whitespace: a newline, tab, non-breaking space or
run of spaces between words counts as one space (blank lines too), and a match covers
the original text, so rewording and restoring replace the whole original span.

## Analyse pasted text

The popup's "Analyse pasted text" link opens `analyze.html`, a page for texts that are
not web pages (PDFs, handouts). Paste a text and press Analyse: a blank line starts a
paragraph, a single newline stays inside it and shows as a space, and the first line
becomes an `<h1>` (so headline rules apply) unless "First line is the headline" is
unticked. The page loads the same `content.js` and `content.css` as every web page, so
highlights, the tooltip, reword mode (Alt+Shift+R), the popup's Detected list and the
settings behave identically. `analyze.js` only builds the paragraphs. The text stays in
the page: nothing is stored or sent. It needs no extra permission.

## Intentional Limits

- Phrase-based, no NLP or semantic disambiguation
- No deep literary-device inference (irony, satire, allusion)
- No shadow DOM penetration
- `chrome.storage.sync` — user settings only (term index is bundled)

## TypeScript

The codebase is JS with `tsc --noEmit checkJs` and type declarations in `src/types/`. Run `npm run typecheck`.
