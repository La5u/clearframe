# ClearFrame

ClearFrame is a Manifest V3 browser extension that highlights euphemisms, framing, and emotionally manipulative terms while showing neutral alternatives and explanations.

## Architecture (Option 2)
- Local source dictionaries in `data/terms/*.json`.
- Build step compiles term files into a runtime index (`dist/terms-index.json`).
- Content script performs fast phrase matching using compiled first-character buckets.
- Popup and options pages control category toggles and behavior.

## Quick start
1. Run `npm run build`.
2. Load `dist/` as an unpacked extension in your browser.

## Settings
- Global enable/disable.
- Category toggles (`media`, `politics`, `tech`, `corporate`, `clickbait`).
- Match mode filtering (`replace`, `highlight`).

## Open source contribution
- Add or edit term files in `data/terms/`.
- Validate with `npm run check`.
- See `docs/contributing-terms.md` for schema and review standards.
