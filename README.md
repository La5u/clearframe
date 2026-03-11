# ClearFrame

ClearFrame is a browser extension that highlights euphemisms, framing, and emotionally manipulative terms while showing neutral alternatives and explanations.

## Architecture
- Local source dictionaries in `data/terms/*.json`.
- Build step compiles term files into runtime indexes for Chrome and Firefox.
- Shared matcher logic powers both the extension runtime and fixture tests.
- Content runtime is split into matcher, mark UI, and scanner modules.
- Popup and options pages control category toggles and behavior.

## Quick start
1. Run `npm run build`.
2. Load `dist/` in Chromium-based browsers.
3. Load `dist-firefox/` in Firefox.
4. Run `npm test` to check the saved-page fixtures.

## Browser targets
- `dist/`: Chrome/Chromium Manifest V3 build.
- `dist-firefox/`: Firefox build with Gecko metadata and Firefox-compatible background configuration.

## Settings
- Global enable/disable.
- Category toggles (`media`, `politics`, `tech`, `corporate`, `clickbait`).
- Match mode filtering (`replace`, `highlight`).

## Open source contribution
- Add or edit term files in `data/terms/`.
- Validate with `npm run check`.
- Run fixture checks with `npm test`.
- See `docs/contributing-terms.md` for schema and review standards.
