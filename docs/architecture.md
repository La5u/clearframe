# ClearFrame Architecture

## Overview

ClearFrame is a browser extension (Manifest V3) that highlights euphemisms, framing, and emotionally manipulative language in web content. It provides neutral alternatives and explanations to help users identify biased framing.

## Directory Structure

```
clearframe/
├── src/                    # Extension source code
│   ├── manifest.json       # Chrome/Firefox manifest
│   ├── manifest.firefox.json # Firefox-specific overrides
│   ├── content.js         # Content script (matcher, scanner, marks)
│   ├── content.css        # Styling for highlights/tooltips
│   ├── popup.html         # Extension popup UI
│   └── popup.js           # Popup logic
├── data/
│   ├── schema.json         # Term entry JSON schema
│   └── terms/              # Pattern-based term dictionaries
│       ├── euphemism.json   # Euphemisms (red)
│       ├── aggressive.json  # Aggressive/loaded language (orange)
│       ├── sensational.json # Clickbait, exaggeration (yellow)
│       ├── framing.json     # Attribution, authority (green)
│       ├── emotional.json   # Fear, amplification (blue)
│       ├── conflict.json    # Drama, disaster metaphors (purple)
│       └── vague.json       # Buzzwords, abstractions (gray)
├── scripts/
│   ├── build-dictionary.js # Build script
│   └── test-fixtures.js    # Test runner
├── dist/                   # Chrome build output
└── dist-firefox/           # Firefox build output
```
clearframe/
├── src/                    # Extension source code
│   ├── background/         # Service worker
│   ├── content/            # Content scripts (scanner, marks)
│   ├── shared/             # Core logic, matcher, UI utilities
│   ├── popup/              # Extension popup UI
│   ├── options/            # Full settings page
│   ├── manifest.json       # Chrome/Firefox manifest
│   └── manifest.firefox.json # Firefox-specific overrides
├── data/
│   ├── schema.json         # Term entry JSON schema
│   └── terms/              # Term dictionaries (JSON)
├── scripts/
│   ├── build-dictionary.js # Build script
│   └── test-fixtures.js    # Test runner
├── dist/                   # Chrome build output
└── dist-firefox/           # Firefox build output
```

## Key Concepts

### Pattern Categories (Color-Grouped)
Each term has a `type` field that maps to a color group:

| Color | Group | Types |
|-------|-------|-------|
| Red | Euphemisms | `euphemism` |
| Orange | Aggressive/Loaded | `aggressive`, `aggression`, `moral`, `derogatory`, `loaded` |
| Yellow | Sensational | `sensational`, `clickbait`, `superlative`, `exaggeration`, `reveal`, `hype` |
| Green | Framing | `framing`, `unsourced`, `uncertainty`, `authority` |
| Blue | Emotional | `emotional`, `fear` |
| Purple | Conflict/Drama | `conflict`, `drama`, `disaster` |
| Gray | Vague/Abstract | `vague` |

### Match Modes
- **replace**: Show neutral wording inline
- **highlight**: Keep original text, annotate with tooltip

### Term Structure
```json
{
  "phrase": "euphemism to detect",
  "neutral": "neutral alternative",
  "type": "euphemism | aggressive | sensational | framing | emotional | conflict | vague",
  "explanation": "Why this is problematic",
  "aliases": ["optional", "variants"],
  "patterns": ["optional regex patterns"],
  "match": {
    "context": {
      "headlineOnly": true
    }
  }
}
```

## Content Script Flow

1. **scanner.js**: Initializes, loads terms index, watches for DOM mutations
2. **marks.js**: Creates DOM marks, handles tooltips
3. **matcher.js**: Compiles term index into efficient data structures for fast matching

## Build Process

The build script (`scripts/build-dictionary.js`):
1. Loads all JSON term files from `data/terms/`
2. Validates term structure
3. Compiles terms into optimized index (buckets by first letter, patterns)
4. Copies src/ to dist/ and dist-firefox/
5. Generates runtime `terms-index.js` and `terms-index.json`

## Running Commands

```bash
npm run build      # Build Chrome + Firefox versions
npm run check      # Validate term files
npm test           # Run fixture tests
```

## Adding New Terms

1. Add entry to appropriate `data/terms/<category>.json`
2. Run `npm run check` to validate
3. Run `npm test` to ensure fixtures still pass

## Browser-Specific Notes

### Chrome
- Uses Manifest V3 service worker
- Background script: `background/service-worker.js`

### Firefox
- Uses Gecko-specific manifest keys
- Background scripts array instead of service worker
