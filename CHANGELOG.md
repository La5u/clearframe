# Changelog

## 1.2.1

- Highlights appear while the page is still loading instead of after it
  finishes parsing. On slow pages such as the Daily Mail this is seconds sooner.

## 1.2.0

### Learn the names of the techniques
- Tooltips name each device with its technical term (Hyperbole, Hedging,
  Agentless passive, Euphemism, Loaded language...). Hover the (i) for the
  plain-English name and what the wording does to the reader.
- The popup's category chips use the same terms.

### Fairer political coverage
- Political framings are flagged only together with their equivalent from the
  other side, with the same category and strength (far-left / far-right,
  border crisis / climate crisis, pro-life / pro-choice, radical left /
  extreme MAGA, and more). One-sided terms without a fair mirror are not
  flagged.
- New sources: recent Congressional Record speech, partisan-phrase research
  data, and Wikipedia's "Words to watch". A propaganda dataset with lopsided
  examples was dropped.

### Fewer false alarms
- Tested on news front pages across the spectrum; highlights fell from 757
  to about 230.
- Capitals: acronyms, brand names, section labels, captions, and photo
  credits are no longer treated as shouting.
- Literal senses are skipped: "far right corner", "sacked eight times",
  "Resident Evil", "severe storms", "breaking down".
- Common news wording is drawn fainter instead of at full strength: "alleged"
  at 75%, "probe" and "warns" at 50%. The tooltip shows the confidence level.

### Calmer by default
- Monochrome highlights by default (a saved colour choice is kept).
- Rewording and removal stay off unless you turn them on. YouTube captions
  are never changed, and transcripts are highlighted but never reworded.

### Fixes
- Tooltips can be hovered and stay on their word while you move to the (i).
- Hovering blank space no longer opens a tooltip for a nearby word.
- Headlines behind full-card links (e.g. the Guardian) show tooltips in
  Firefox.
- Tooltips no longer close when an unrelated carousel scrolls.
- Undo reliably restores text after pages re-render.

### Requirements
- Firefox 140 or newer; Chrome 105 or newer.
