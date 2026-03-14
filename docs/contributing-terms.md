# Contributing Terms

## File layout
- Add terms in `data/terms/<type-group>.json`.
- Pattern-based groups: `euphemism`, `aggressive`, `sensational`, `framing`, `emotional`, `conflict`, `vague`.

## Entry format
```json
{
  "phrase": "collateral damage",
  "neutral": "civilian harm",
  "type": "euphemism",
  "explanation": "Term that dehumanizes civilian harm.",
  "aliases": []
}
```

## Available types
| Group | Type | Color |
|-------|------|-------|
| Euphemism | `euphemism` | Red |
| Aggressive | `aggressive`, `aggression`, `moral`, `derogatory`, `loaded` | Orange |
| Sensational | `sensational`, `clickbait`, `superlative`, `exaggeration`, `reveal`, `hype` | Yellow |
| Framing | `framing`, `unsourced`, `uncertainty`, `authority` | Green |
| Emotional | `emotional`, `fear` | Blue |
| Conflict | `conflict`, `drama`, `disaster` | Purple |
| Vague | `vague` | Gray |

## Review standards
- `phrase` should be a commonly used framing term.
- `neutral` should be descriptive and less manipulative.
- `explanation` should be factual and concise (8+ characters).
- Prefer phrase-level entries over broad single words when possible.
- Use `match.context.headlineOnly` for noisy broad terms.

## Validation
Run:
- `npm run check`
- `npm run build`
- `npm test`
