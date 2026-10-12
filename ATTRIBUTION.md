# Data attribution

ClearFrame's phrase rules include material derived from the following datasets.

- **MAGPIE idiom corpus**: Haagsma, Bos and Nissim (2020). Licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Idiom phrases and
  occurrence statistics were selected and reformatted.
- **Congressional Record partisan phrases**: Gentzkow, Shapiro and Taddy,
  *Congressional Record for the 43rd-114th Congresses: Parsed Speeches and
  Phrase Counts*, Stanford Libraries (2018), <https://data.stanford.edu/congress_text>.
  Licensed under the [Open Data Commons Attribution License v1.0](https://opendatacommons.org/licenses/by/1-0/).
  Short phrases and partisanship statistics were selected, un-stemmed, and
  reviewed; ClearFrame's labels are its own, not the dataset authors'.
- **Wiki Neutrality Corpus**: Pryzant et al., *Automatically Neutralizing
  Subjective Bias in Text*. Derived from Wikipedia text
  ([CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/)); only short
  repeated phrases are used.
- **Wikipedia, Manual of Style/Words to watch**: Wikipedia contributors,
  revision 1379085656 (7 October 2026),
  <https://en.wikipedia.org/wiki/Wikipedia:Manual_of_Style/Words_to_watch>.
  Licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  Selected phrases were reviewed, guarded against neutral senses, and typed;
  the adapted list (`data/rules/wikipedia-words-to-watch.jsonl`) is released
  under CC BY-SA 4.0.
