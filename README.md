# ClearFrame

ClearFrame is a browser extension that highlights biased or loaded language and shows neutral alternatives.

It scans pages progressively so the badge count rises as text is processed, and it remembers counts per page URL when you switch tabs.

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

## Notes

- `content.js` does the page scan and live mutation handling.
- `background.js` stores badge counts per page URL so returning to a page restores its last known count.
- `popup.js` controls enable/disable, type colors, and detected-term summaries.
