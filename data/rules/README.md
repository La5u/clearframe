# Rule source

JSONL files in this directory are ClearFrame's provenance-aware rule source. Large
research corpora never ship in the extension. `build.js` compiles these records
and the legacy CSV terms into the small in-memory matcher.

Required fields: `id`, `phrase`, `type`, `status`, `sources`. Only records with
`status: "approved"` are executable. A replacement also requires
`reword.reviewed: true`; detection approval does not imply safe rewording.

Every approved rule needs at least one source, and each source must have
`redistribution: "allowed"` in `research/sources.json`. Sources that informed
review without deriving the rule go in `corroboratedBy`. Evidence gates fail
when evidence fields are missing.

Exceptions for a rule ("electric shock") go in `data/terms/exceptions.json`,
keyed by the rule's `phrase`; see `TERMS.md`.

Corpora with `role: "evaluation-only"` in `research/sources.json` are rejected as
rule provenance during every build.

`llm-mined.jsonl` is written by `npm run mine:llm -- output` and holds only
`status: "candidate"` records (they do not ship). It adds `evidence` (`proposals`,
`outlets`, `judged`, `precision`), an optional drafted `exception` (not read by the
build; move it into `data/terms/exceptions.json` on approval) and an unreviewed
`reword` suggestion. Re-running the stage regenerates the candidates but leaves records you have
already moved to another status untouched.
