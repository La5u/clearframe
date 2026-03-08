# Contributing Terms

## Goal
Term entries should expose framing clearly and transparently, not enforce hidden editorial bias.

## File layout
- Add terms in `data/terms/<category>.json`.
- Keep terms grouped by category: `media`, `politics`, `tech`, `corporate`, `clickbait`.

## Entry format
```json
{
  "id": "media-collateral-damage",
  "phrase": "collateral damage",
  "neutral": "civilian harm",
  "type": "military euphemism",
  "category": "media",
  "explanation": "Term often used to soften civilian casualties in conflict reporting.",
  "mode": "replace",
  "aliases": ["collateral-damage"],
  "severity": 4,
  "enabledByDefault": true
}
```

## Review standards
- `phrase` should be a commonly used framing term.
- `neutral` should be descriptive and less manipulative.
- `explanation` should be factual and concise.
- `mode`:
  - `replace`: show neutral wording inline.
  - `highlight`: keep original wording and annotate.
- Include a `source` URL when possible for controversial or disputed terminology.

## Validation
Run:
- `npm run check`
- `npm run build`
