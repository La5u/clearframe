# Rule source

JSONL files in this directory are ClearFrame's provenance-aware rule source. Large
research corpora never ship in the extension. `build.js` compiles these records
and the legacy CSV terms into the small in-memory matcher.

Required fields: `id`, `phrase`, `type`, `status`, `sources`. Only records with
`status: "approved"` are executable. A replacement also requires
`reword.reviewed: true`; detection approval does not imply safe rewording.

Corpora with `role: "evaluation-only"` in `research/sources.json` are rejected as
rule provenance during every build.
