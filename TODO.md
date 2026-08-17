# ClearFrame TODO

## Product focus

- [x] Analyze every page automatically and refresh when page text changes.
- [x] Keep the popup focused on General, Customize, and Detected.
- [x] List exact matched wording and navigate back to each occurrence.
- [ ] Make headline treatment the clearest, highest-confidence experience.
- [ ] Add short, uncertainty-aware explanations for detected cues.
- [ ] Reword replacements to sentence case / title case based on the surrounding headline or lead-in.
- [ ] Handle all-caps separately in the sentence / title case rewording suggestion.
- [ ] Give the quote category its own distinct type instead of folding into another category.
- [ ] Let users dismiss false positives and remember those decisions locally.

## Detection quality

- [ ] Rank combinations and context above isolated single-word matches.
- [ ] Audit high-volume terms such as `reveal`, `exclusive`, `secret`, `most`, and `best`.
- [ ] Separate strong cues from weak cues in the default settings.
- [ ] Keep article-body rewording reversible; never delete evidence without an explicit user setting.

## Quality

- [ ] Add DOM tests for automatic startup, dynamic-page updates, reword restoration, and exact-word navigation.
- [ ] Profile automatic analysis on large Chromium news pages.
