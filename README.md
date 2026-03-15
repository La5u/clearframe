# ClearFrame

ClearFrame is a browser extension that highlights biased or loaded language and shows neutral alternatives.

## Build

```sh
node build.js
```

Build outputs:
- `dist/` (Chrome MV3)
- `dist-firefox/` (Firefox MV3 with `browser_specific_settings`)

## Tests

```sh
node test.js
```

Test fixtures:
- `test-all-terms.html` includes every term (176 matches expected).
- `test-all-types.html` includes every type at least once.

## Types

Current term types (from `data/terms/`):

- aggression
- authority
- clickbait
- conflict
- dehumanizing
- derogatory
- distancing
- euphemism
- exaggeration
- fear
- hype
- hype-marketing
- jargon
- loaded
- loaded-framing
- minimizing
- moral
- moral-labeling
- negative-framing
- partisan
- passive
- reveal
- superlative
- tabloid-anger
- uncertainty
- unsourced
- vague

## Data

Terms are stored in `data/terms/*.json`. Each entry includes:
- `phrase` (required)
- `type` (required)
- `neutral` (optional)
- `explanation` (optional)
- `aliases` (optional)
- `stemmable` (optional, opt-in stemming for simple variants)
