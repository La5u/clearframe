# ClearFrame

ClearFrame is a browser extension that highlights authorial choices in text and shows neutral alternatives where useful.

It uses the CSS Custom Highlight API, so it highlights text without inserting wrapper tags into the page.

## What It Covers

ClearFrame is not a full rhetoric parser. It is a local, phrase-driven detector for authorial choices that have visible surface markers.

That means it is good at loaded wording, sensational phrasing, framing and sourcing language, euphemism, distancing, passive constructions, and a small set of literary-device-like cues with obvious surface forms.

It is not trying to fully detect allegory, symbolism, irony, satire, foreshadowing, or general allusion. Those usually need more context than phrase matching can provide.

## Build

```sh
node build.js
```

Build outputs:
- `dist/` (Chrome MV3)
- `dist-firefox/` (Firefox MV3 with `browser_specific_settings`)

## Tests

```sh
npm test
```

Test fixtures:
- `test-all-terms.html` includes every term (141 matches expected).
- `test-all-types.html` includes every type at least once.

The build step also validates the data model:
- duplicate phrases cannot appear across different types
- every term type must exist in `data/type-colors.json`
- every configured subtype must have at least one term

## Detector Types

Current detector subtypes (grouped by broad color-coded category):

- aggression
- authority
- clickbait
- conflict
- colloquialism
- dehumanizing
- derogatory
- distancing
- euphemism
- exaggeration
- fear
- hype
- loaded
- loaded-framing
- minimizing
- moral
- negative-framing
- partisan
- passive
- reveal
- repetition
- rhetorical-question
- superlative
- tabloid-anger
- uncertainty
- unsourced

## Taxonomy

The taxonomy is intentionally two-level:
- broad category
- narrow subtype

Categories drive color in the UI. Subtypes drive the actual term list and tooltip label.

Current category map:
- yellow / sensationalism: `clickbait`, `hype`, `reveal`, `tabloid-anger`
- green / intensification: `exaggeration`, `superlative`
- gray / framing and sourcing: `unsourced`, `authority`, `uncertainty`, `loaded-framing`, `distancing`
- red / hostility: `aggression`, `derogatory`, `partisan`, `dehumanizing`
- pink / value judgment: `moral`, `loaded`
- orange / conflict and drama: `conflict`, `minimizing`, `negative-framing`
- purple / urgency and fear: `fear`
- blue / softening and agency hiding: `euphemism`, `passive`
- teal / style and voice: `colloquialism`, `repetition`, `rhetorical-question`

## Scope

ClearFrame is aimed at spotting the kinds of choices writers make to shape tone, emphasis, framing, and certainty. That includes:
- loaded or evaluative wording
- exaggeration and intensifiers
- hedging and uncertainty
- euphemism and distancing
- passive or indirect wording
- attribution and sourcing language
- conflict and moral framing
- emphasis such as all-caps, repeated punctuation, and attention hooks
- a small first pass at style and voice, including colloquialism, repetition, and limited rhetorical-question markers

Categories are color-based and broad on purpose:
- yellow: sensationalism
- green: intensification
- gray: framing and sourcing
- red: hostility
- pink: value judgment
- orange: conflict and drama
- purple: urgency and fear
- blue: softening and agency hiding
- teal: style and voice

Merged subtypes:
- `hype-marketing` is folded into `hype`
- `moral-labeling` is folded into `moral`

## Literary Devices

ClearFrame now includes a small first pass at literary-device-adjacent signals, but only where the match can be done locally and with low enough ambiguity.

Currently realistic device-style detectors:
- `colloquialism`
  Detects informal contractions or conversational wording such as `ain't`, `gotta`, `kinda`, `y'all`.
- `repetition`
  Detects stock repeated-emphasis phrases such as `again and again`, `over and over`, `time after time`.
- `rhetorical-question`
  Detects a narrow set of prompt-seeking endings such as `right?`, `correct?`, `isn't it?`.

Important limitation:
- these are partial detectors, not complete literary-device classification
- for example, most rhetorical questions will not be detected unless they use one of the explicit phrase markers in the term data
- the same applies to repetition: ClearFrame catches repeated stock phrases, not every repeated structure in prose

That tradeoff is deliberate. The extension prefers visible, explainable rules over broad but noisy guesses.

## Matching Model

The matcher is phrase-based and case-insensitive.

Core behavior:
- terms are normalized to lowercase with collapsed whitespace
- aliases are treated as exact alternate surface forms of the same subtype
- stemming is opt-in and only used for simple single-word variants
- longer phrases win over shorter prefixes during matching
- a single exact phrase is allowed in only one subtype
- hover tooltips are formatted as `neutral - type - category`

That last rule is enforced during the build. If the same normalized phrase appears in two different types, the build fails.

## Data

Terms are stored in `data/terms/*.json`. Each entry includes:
- `phrase` (required)
- `type` (required)
- `neutral` (optional)
- `aliases` (optional, exact alternate forms)
- `stemmable` (optional, opt-in stemming for simple variants)

Color categories and subtype groupings live in `data/type-colors.json`.

Example term:

```json
{
  "phrase": "far-left",
  "type": "partisan",
  "neutral": "left",
  "aliases": ["far left"]
}
```

Guidelines for adding terms:
- keep each exact phrase in one subtype only
- use `aliases` for punctuation or spacing variants, not for loosely related ideas
- prefer phrases over broad single words when a word is highly context-dependent
- only use `stemmable` when inflected forms are genuinely safe

## Architecture

Main files:
- `build.js` loads term data, validates taxonomy consistency, and writes `dist/` plus `dist-firefox/`.
- `term-utils.js` normalizes terms, expands aliases and stemmed variants, and validates duplicate phrases.
- `content.js` scans page text nodes, applies CSS highlights, tracks match counts, and renders hover tooltips.
- `popup.js` loads settings, renders the category buckets, and shows detected-term counts.

## Limits

Current intentional limits:
- no full natural-language parsing
- no semantic disambiguation for highly context-dependent words
- no deep literary-device inference
- no shadow-DOM-specific matching logic beyond what the page exposes in normal text nodes

These constraints keep the extension explainable, local, and fast.

## Notes

- `content.js` does the page scan, live mutation handling, and tooltip display.
- `background.js` keeps the badge in sync with the active tab.
- `popup.js` controls enable/disable, type colors, and detected-term summaries.
