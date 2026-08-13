# ClearFrame taxonomy

ClearFrame describes language rather than declaring it simply biased or neutral.
One span may have several independent dimensions.

- `emotionalIntensity`: strength of expressed or evoked emotion.
- `valence`: positive or negative affect, without implying wrongdoing.
- `subjectivity`: opinion, evaluation, or personal stance.
- `certainty`: confidence, absolutism, hedging, and uncertainty.
- `sensationalism`: attention-amplifying presentation such as hype or clickbait.
- `loadedFraming`: wording that presupposes or evaluates a disputed interpretation.
- `agency`: obscured, omitted, or foregrounded actors and responsibility.
- `persuasiveAppeal`: ethos, logos, pathos, calls to action, and propaganda technique.
- `rhetoricalForm`: repetition, rhetorical questions, parallelism, and emphasis.
- `figurativeLanguage`: idiom, metaphor, simile, hyperbole, irony, and related devices.

Detection and rewording are separate decisions. Figurative and structural devices
normally receive an explanation only. A reword must preserve sense, part of speech,
factual scope, named entities, numbers, negation, and agency.

Confidence describes evidence and context, not whether a phrase is permitted:

- `high`: stable meaning across ordinary contexts.
- `medium`: useful signal with occasional neutral uses.
- `contextual`: meaningful mainly in headlines or a larger construction.
- `exploratory`: corpus-mined candidate shown for learning and feedback.

Only reviewed rules may reword text. Lower-confidence rules remain detection-only.
