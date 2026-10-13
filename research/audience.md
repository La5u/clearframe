# Who ClearFrame is for

Two rounds of audience research. Both point at the same first users: English
and media-literacy students and teachers, using ClearFrame for close reading
rather than as an automatic bias verdict.

## October 2026: IB English A: Language and Literature

Sources are linked; teacher and revision sites are not official IB guidance. The IB site blocks automated fetches, so official
details below come from search results and could not be re-checked directly.

### The course

- Paper 1 (guided textual analysis) is 35% at SL and HL: unseen non-literary
  texts such as articles, ads, blogs, speeches, infographics and cartoons. SL
  analyses one text in 75 minutes; HL analyses two in 135 minutes.
  [IB course page](https://ibo.org/programmes/diploma-programme/curriculum/language-and-literature/language-a-language-and-literature/)
- Criterion B (analysis and evaluation) rewards explaining how textual features
  and authorial choices construct meaning. Naming a device does not earn the
  top bands.
- The guide was updated for first assessment 2026 (Paper 2 criteria changed;
  Paper 1 criteria did not).
- Subject reports (2023, 2024) repeatedly criticise "feature spotting", generic
  effects ("grabs the reader's attention"), and ethos/pathos/logos used as a
  checklist.

### Implications for ClearFrame

- A tool that only labels devices trains the habit examiners penalise. Every
  label needs an effect, and the student should do the explaining.
- Reword mode is the "swap test" teachers recommend: change the word and ask
  what the meaning loses.
- Predict-then-reveal (hide labels until the student has looked) keeps it a
  practice tool, not an answer key. Exams are offline, so it is practice-only.
- Current type names such as `clickbait`, `reveal`, `moral` are not analytic
  terms. Closest classroom terms: emotive/loaded diction and connotation,
  hyperbole, pejorative lexis, dysphemism, euphemism, violent metaphor,
  hedging and modality, vague attribution, agentless passive, superlatives,
  direct address, rhetorical questions, register (colloquialism).
- Text-only detectors that are cheap and common in teaching: inclusive and
  second-person pronouns, imperatives, modal verbs, general rhetorical
  questions, statistics, exclamations, tricolon, anaphora and epistrophe,
  "not X but Y" antithesis, sentence length. Structural devices need
  sentence- or paragraph-level text, but the content script works on single
  text nodes.
- Out of reach without images or judgement: tone, irony, perspective and
  omission, colour, layout, typography, text-image interplay. Say so in the UI.

### Competitors

- Rheta (Chrome): highlights rhetorical patterns; a handful of users.
- BiasLens: local per-paragraph bias score, no device names.
- Ground News and AllSides: outlet-level bias, not close reading.
- ChatGPT-style prompts already do Paper 1 commentary, in the cloud and with
  accounts. ClearFrame's position: free, local, in the page, no account.

### Where to get feedback

- InThinking English A Lang & Lit teacher site: https://thinkib.net/englishalanglit
- r/IBO (read the wiki's advertising policy first): https://www.reddit.com/r/IBO/
- A school's IB coordinator, or a short disclosed email to a few IB English
  teachers. Teachers first; students once a teacher has tried it.

### Sources

- https://www.lanterna.com/resources/ace-ib-english-a-paper-1-commentary-guide
- https://www.clastify.com/knowledge-hub/post/ib-english-rhetorical-devices
- https://www.revisiondojo.com/blog/how-to-analyze-non-literary-texts-in-ib-english-language-and-literature
- https://tutorsplus.com/how-to-analyse-visual-texts-in-ib-english-paper-1/
- https://www.revisiondojo.com/blog/analyzing-figurative-language-news-opinion-ib-english

## July 2026: market decision

Research date: 2026-07-27. Scope: 128 unique Reddit post pages across
anti-clickbait/media literacy, teachers/ELA, literary devices, poetry, writing,
browser extensions, privacy, and comparable writing/annotation tools. The repo
audit that accompanied it is out of date and has been dropped; replacements
and removal are now off by default.

### Decision

Do not continue ClearFrame as a general-purpose automatic persuasion or “neutral writing” judge. The useful product is a narrow, local-first close-reading notebook:

> Select a passage → label the rhetorical move → add a private note → return/export the evidence later.

Keep rule matches only as optional, clearly uncertain suggestions. Drop automatic replacements and deletion as product promises. Do not add an LLM until real users repeatedly ask for explanations after using the notebook.

The best initial customer is an ELA/media-literacy teacher or student who needs repeatable close-reading evidence. A secondary customer is a researcher or writer who wants persistent web highlights and notes. This is a niche worth validating, not evidence for a broad consumer launch.

### Feature-by-feature demand

| Feature | Demand | Conclusion |
|---|---|---|
| Persistent highlights | Strong | Core MVP. People repeatedly ask for highlights that survive reloads and remain findable. |
| Selection-based annotation | Strong | Core MVP. Teachers describe close reading as highlighting plus commentary, often with existing tools. |
| Private notes/quote anchors | Strong | Core MVP. This is the missing value layer between a highlighter and a lesson/research workflow. |
| Local/offline/no-account | Strong differentiator | Use it as trust and privacy positioning, not as the whole product. |
| Media-literacy labels | Medium, niche | Good teacher workflow if labels are editable and framed as questions/effects, not verdicts. |
| Literary/rhetorical-device detection | Medium educational demand, weak standalone demand | Teach/assist identification; do not promise reliable automatic inference. |
| Clickbait detection | Strong problem awareness, weak install proof | Narrow to headline close reading or “why might this bait?” prompts. A recent bias-detector founder explicitly reported zero users despite strong survey interest. |
| Passive/style highlighting | Medium adjacent demand | Useful optional rule pack; users want highlights, not mandatory rewrites. |
| Neutral alternatives | Weak/negative | Writers repeatedly say prescriptive rewrites flatten voice and misclassify intentional choices. Keep as a user-invoked experiment, not default behavior. |
| Remove terms | Weak and risky | It destroys evidence and can make a reader think the original said something else. Remove from the MVP. |
| Color customization | Medium workflow detail | Useful for teacher schemes and personal organization; not an acquisition feature. |
| Counts and jump-to-match | Medium workflow detail | Keep only if it helps review/export; not a reason to install by itself. |
| Keyboard shortcuts | Low standalone demand | Add after the selection workflow is reliable. |
| LLM explanations | Unproven | Defer: cost, privacy, false certainty, and AI resistance are all visible in the research. |

### Repeated complaints about comparable tools

- Grammarly and similar assistants are described as intrusive, wrong in context, too corporate, hostile to fiction, and harmful to author voice. Passive voice is often flagged even when intentional or appropriate.
- Users dislike extensions that read every keystroke or send text to a server. Privacy concerns are a direct opening for local-only behavior.
- LanguageTool’s move to a premium-only browser extension created immediate replacement demand, but users still complained about price and browser weight.
- Highlighters are valuable but unreliable: highlights disappear on reload, drift when pages change, fail on dynamic sites, or become impossible to find later.
- Annotation users ask for local storage, no account, exports, search, tags, and cross-device recovery. They care about persistence and retrieval more than decorative marker styles.
- Teachers already use CommonLit, Kami, Google Docs, Hypothesis, Canvas, and Perusall. A new tool must remove a specific friction—fast, private, reusable evidence capture—not merely add another colored overlay.

### Validation plan before more architecture

1. Build only: select text, choose one of six labels, add a note, persist an anchor locally, and export Markdown.
2. Recruit five ELA/media-literacy teachers and five students/researchers. Give them a real article or assigned passage and observe whether they use it twice in one week.
3. Keep the project only if at least five of ten users repeat the workflow and at least three ask to keep using it without prompting.
4. If that fails, archive the project. Do not spend time expanding the taxonomy, adding an LLM, or polishing color controls.

### Reddit inventory

The links below are 130 inventory entries representing 128 unique post pages. The exact `r/anticlickbait` search did not produce a usable body of posts in the search index, so anti-clickbait evidence comes from adjacent communities. Post pages are evidence of expressed problems or existing workflows, not proof of market size. Project-showcase posts are marked as such; their low engagement is useful as a warning against treating “someone built this” as demand.

#### Anti-clickbait, headlines, and media literacy

1. [Anti-clickbait YouTube workflow](https://www.reddit.com/r/chrome_extensions/comments/1um84da/my_anticlickbait_workflow_a_chrome_extension_that/)
2. [Public ranking site for misleading clickbait](https://www.reddit.com/r/ideas/comments/1rq71u4/idea_a_public_ranking_site_for_misleading/)
3. [Clickbait detector for YouTube](https://www.reddit.com/r/SideProject/comments/1q4nlzw/clickbait_detector_for_youtube/)
4. [Free AI clickbait detector](https://www.reddit.com/r/chrome_extensions/comments/1q4nrd0/free_clickbait_detector_for_youtube_using_ai/)
5. [Clickbait getting out of control](https://www.reddit.com/r/youtube/comments/1t2492t/click_bait_is_getting_out_of_control/)
6. [Anti-clickbait design](https://www.reddit.com/r/antiassholedesign/comments/gblzcy/)
7. [Are headlines supposed to be confusing?](https://www.reddit.com/r/explainlikeimfive/comments/y2437z/)
8. [Clickbait title](https://www.reddit.com/r/SUBREDDITNAME/comments/1s9r0yu/clickbait_title/)
9. [And it’s clickbait](https://www.reddit.com/r/YoutubeThumbs/comments/1uy07bz/and_its_click_bait/)
10. [Wish to label every video clickbait](https://www.reddit.com/r/TheMonkeysPaw/comments/glpktk)
11. [Clickbait post](https://www.reddit.com/r/shitposting/comments/1ba225v)
12. [Clickbait final boss](https://www.reddit.com/r/TeenIndia/comments/1s9encp/clickbait_final_boss/)
13. [ADHD video with clickbait title](https://www.reddit.com/r/Healthygamergg/comments/sekzx4/serious_concerns_about_your_adhd_is_actually_an/)
14. [News subreddit becoming clickbait](https://www.reddit.com/r/RepublicadeChile/comments/1toneip/rchile_ahora_es_un_sub_de_noticias_clickbait_bots/)
15. [Media-literacy curriculum](https://www.reddit.com/r/teaching/comments/1jxucqw/is_there_any_sort_of_curriculum_at_my_school/)
16. [New clickbait detector project](https://www.reddit.com/r/chrome_extensions/comments/1snzdzj/new_chrome_extension_clickbait_detector_for/)
17. [Clickbait detector project and zero-user risk](https://www.reddit.com/r/saasbuild/comments/1soavl6/we_pivoted_from_ai_news_generation_to_bias/)
18. [Clickbait detector project in SaaS](https://www.reddit.com/r/SaaS/comments/1q4nh1l/clickbait_detector_for_youtube/)
19. [Clickbait detector project in ProductivityHQ](https://www.reddit.com/r/ProductivityHQ/comments/1q4nklt/clickbait_detector_for_youtube/)
20. [Misleading headline complaint](https://www.reddit.com/r/Coronavirus/comments/id263b)
21. [Misleading headlines and narrative framing](https://www.reddit.com/r/FreeSpeech/comments/n1czaz)

#### Teachers, ELA, annotation, and close reading

22. [Annotation tool for Chromebooks](https://www.reddit.com/r/Teachers/comments/sk1j3cj)
23. [Finding a layered annotation tool](https://www.reddit.com/r/Teachers/comments/plauw8)
24. [Teaching literary devices](https://www.reddit.com/r/ELATeachers/comments/nd7xe5)
25. [Media literacy and illiteracy](https://www.reddit.com/r/Teachers/comments/1g6ukbj)
26. [Student PDF highlighting and annotation](https://www.reddit.com/r/Professors/comments/1qmp7m6)
27. [Visualiser and classroom annotation](https://www.reddit.com/r/TeachingUK/comments/1gnyvkg)
28. [Digital writing pads for teaching](https://www.reddit.com/r/Teachers/comments/g73h01)
29. [Edtech tools for distance learning](https://www.reddit.com/r/Teachers/comments/imyklv)
30. [Text annotation and close reading online](https://www.reddit.com/r/ELATeachers/comments/hs116z)
31. [High-school media literacy redesign](https://www.reddit.com/r/ELATeachers/comments/116ec9m)
32. [Media-literacy unit needs a new approach](https://www.reddit.com/r/ELATeachers/comments/1cnb7zh)
33. [Annotation lessons](https://www.reddit.com/r/ELATeachers/comments/1hqpdbz)
34. [Ready-made media-literacy practice](https://www.reddit.com/r/ELATeachers/comments/iwefip)
35. [Accessible and rigorous close reading](https://www.reddit.com/r/ELATeachers/comments/ly2sar)
36. [8th-grade English technology toolkit](https://www.reddit.com/r/Teachers/comments/1riwwi9)
37. [Annotation guidelines for ELA](https://www.reddit.com/r/Teachers/comments/1dm571a)
38. [Secondary reading strategies](https://www.reddit.com/r/ELATeachers/comments/1irz4cg)
39. [How to approach books for teaching](https://www.reddit.com/r/ELATeachers/comments/cjnh53)
40. [Comprehension tests and reading resistance](https://www.reddit.com/r/ELATeachers/comments/dauaoc)
41. [Literary devices outside the teacher’s area](https://www.reddit.com/r/ELATeachers/comments/1026ia0)
42. [Literary analysis help: tools versus rooms](https://www.reddit.com/r/ELATeachers/comments/1or5faj)
43. [Alliteration and literary-device categories](https://www.reddit.com/r/ELATeachers/comments/1ctto5x)
44. [Close-reading activity in class](https://www.reddit.com/r/Professors/comments/1prjjz2)
45. [Annotation and students’ purpose](https://www.reddit.com/r/ELATeachers/comments/1u0d96h)
46. [Close reading question](https://www.reddit.com/r/ATAR/comments/1tptome)
47. [District-forced teaching methods](https://www.reddit.com/r/Teachers/comments/1hyhcbe/what_things_do_districts_forcing_teachers_to_do/)
48. [Urgent teacher reading post](https://www.reddit.com/r/Teachers/comments/1jomybo/urgent_read/)
49. [AskTeachers: literacy and writing expectations](https://www.reddit.com/r/AskTeachers/comments/1om1rdi/please_tell_me_this_isnt_the_norm_or_rationalize/)
50. [English-teacher media literacy curriculum](https://www.reddit.com/r/ELATeachers/comments/116ec9m)

#### Literary devices and rhetorical analysis

51. [AP Literature device list](https://www.reddit.com/r/APLit/comments/1sya01q/literary_devices/)
52. [Naming a literary technique](https://www.reddit.com/r/AskLiteraryStudies/comments/ldmwma)
53. [Literary devices in campaigns](https://www.reddit.com/r/DnD/comments/129i8pm)
54. [Favorite literary device](https://www.reddit.com/r/TeensMeetTeens/comments/1kxlzcr)
55. [Favorite literary device in writing](https://www.reddit.com/r/writers/comments/1fjom4z)
56. [Learning literary markers](https://www.reddit.com/r/learn_arabic/comments/1j9wgp6)
57. [Rhetorical-analysis tips](https://www.reddit.com/r/APStudents/comments/1tahcne)
58. [Struggling with rhetorical analysis](https://www.reddit.com/r/APStudents/comments/19aadqt)
59. [AI and ELA teacher feedback](https://www.reddit.com/r/teaching/comments/1ocvbaj)
60. [AP rhetorical-analysis notes](https://www.reddit.com/r/APLang/comments/nledbu)
61. [AP rhetorical-analysis essay tips](https://www.reddit.com/r/APStudents/comments/1oigqjc)
62. [One rhetorical device versus multiple](https://www.reddit.com/r/APStudents/comments/1tabp9q)
63. [Rhetorical analysis unit for Night](https://www.reddit.com/r/ELATeachers/comments/1u0d96h)
64. [How to write rhetorical analysis](https://www.reddit.com/r/PaperWritingHelper/comments/1t195ph)
65. [Rhetorical-analysis assignment](https://www.reddit.com/r/u_debaterthatchases/comments/ebl1ft)
66. [Rhetorical-analysis assignment help](https://www.reddit.com/r/DoMyAssignments/comments/z3i8yz)
67. [Understanding rhetorical analysis](https://www.reddit.com/r/ENGLISH/comments/xdhc2v)
68. [AP Lang rhetorical-analysis structure](https://www.reddit.com/r/APLang/comments/12v98tm)

#### Poetry and AI/writing detection

69. [Poem incorrectly identified as AI](https://www.reddit.com/r/Poetry/comments/1cng6hx/help_my_poem_is_being_identified_as_ai_what_can_i/)
70. [Poem with no literary devices](https://www.reddit.com/r/Poetry/comments/1c7efuy)
71. [Help with literary devices in poetry](https://www.reddit.com/r/Poetry/comments/ykofy5)
72. [Poetry homework and literary devices](https://www.reddit.com/r/Poetry/comments/10ezw3q)
73. [Learning to like literary poetry](https://www.reddit.com/r/Poetry/comments/r0y6z)
74. [Do writers use AI checkers?](https://www.reddit.com/r/WritingWithAI/comments/1s4jwf8/do_you_use_an_ai_checker/)
75. [Do AI detectors work?](https://www.reddit.com/r/WritingWithAI/comments/1q39lhw/do_you_really_believe_in_ai_detectors_dawmm/)
76. [AI detection is unreliable](https://www.reddit.com/r/WritingWithAI/comments/1k9bluf/this_whole_ai-detecting_thing_is_stupid/)
77. [AI checkers flagging human writing](https://www.reddit.com/r/writers/comments/1hnuxq7/how_do_you_deal_with_ai_checkers_flagging_your_work_as_ai/)
78. [GPT as an editor](https://www.reddit.com/r/WritingWithAI/comments/1ukxcr/gpt_as_my_editor/)

#### Writing tools, editing, and complaints about prescriptive feedback

79. [Grammar-checker recommendations](https://www.reddit.com/r/writing/comments/1gy95g0/what_do_you_guys_use_for_a_grammar_checker/)
80. [Grammar checkers](https://www.reddit.com/r/writing/comments/1njdwfo/grammar_checkers/)
81. [Best grammar checker](https://www.reddit.com/r/writers/comments/1sj1378/best_grammar_checker/)
82. [Thoughts on Grammarly](https://www.reddit.com/r/writing/comments/1kfjzqp/thoughts_on_grammarly/)
83. [Grammarly: yay or nay](https://www.reddit.com/r/writing/comments/un6lus/grammarly_yay_or_nay/)
84. [Editing software for writers](https://www.reddit.com/r/writing/comments/17mv7n6/as_a_writer_is_it_advisable_to_use_editing_software/)
85. [Editing versus hiring an editor](https://www.reddit.com/r/writing/comments/1iu6pjd/editing/)
86. [Best editing software](https://www.reddit.com/r/writers/comments/t89t21/whats_the_best_editing_software/)
87. [Writing tools discussion, 2025](https://www.reddit.com/r/writing/comments/1pxs10d/daily_discussion_writing_tools_software_and/)
88. [Writing tools discussion, 2022](https://www.reddit.com/r/writing/comments/ybh40b)
89. [Best writing tools](https://www.reddit.com/r/writers/comments/1p99oc1/looking_for_the_best_writing_tools/)
90. [Writing tools discussion, 2020](https://www.reddit.com/r/writing/comments/j981s5)
91. [Writing tools discussion, 2025](https://www.reddit.com/r/writing/comments/1lneee4)
92. [Writing tools discussion, 2022](https://www.reddit.com/r/writing/comments/l9csuq)
93. [Writing tools discussion, 2021](https://www.reddit.com/r/writing/comments/my7ukl)
94. [Writing tools discussion, 2026](https://www.reddit.com/r/writing/comments/1sjdxm7)
95. [Passive or active voice](https://www.reddit.com/r/writing/comments/usqo7q)
96. [Hard time avoiding passive voice](https://www.reddit.com/r/writing/comments/egfcvx)
97. [Passive-voice checker request](https://www.reddit.com/r/freelanceWriters/comments/iz8a26)
98. [Is “is” always passive?](https://www.reddit.com/r/grammar/comments/ozb4vk)
99. [Grammarly passive-voice complaints](https://www.reddit.com/r/ENGLISH/comments/zs3tfv)
100. [Professor marked off points for passive voice](https://www.reddit.com/r/mildlyinfuriating/comments/109rk37)
101. [Grammarly sucks](https://www.reddit.com/r/writing/comments/br877v)
102. [Is Grammarly okay for writers?](https://www.reddit.com/r/writers/comments/1663avg)
103. [Best grammar checkers, writers](https://www.reddit.com/r/writers/comments/1ocz9d3/best_grammar_checkers/)
104. [Writing voice and style](https://www.reddit.com/r/writing/comments/9n9o58)

#### Comparable extensions, annotation, privacy, and persistence

105. [LanguageTool browser-extension paywall](https://www.reddit.com/r/chrome_extensions/comments/1qbuuzt/languagetool_extension_will_now_only_be_available/)
106. [Grammarly alternative for Firefox](https://www.reddit.com/r/firefox/comments/18j3fk6)
107. [Make Grammarly go away](https://www.reddit.com/r/chrome/comments/1o7xsu4)
108. [Privacy of grammar extensions](https://www.reddit.com/r/privacy/comments/ulqqy3)
109. [Grammarly broken in Firefox](https://www.reddit.com/r/firefox/comments/do9jh2)
110. [LanguageTool paywall on Firefox](https://www.reddit.com/r/firefox/comments/1qbux7j)
111. [Offline private grammar extension](https://www.reddit.com/r/chrome_extensions/comments/1m8fdkl)
112. [Markwise web annotation](https://www.reddit.com/r/chrome_extensions/comments/1usibjw)
113. [Simple web highlighter](https://www.reddit.com/r/chrome_extensions/comments/1pauymy)
114. [Best web annotation extension](https://www.reddit.com/r/firefox/comments/1sboylc)
115. [Highlights into connected notes](https://www.reddit.com/r/chrome_extensions/comments/1telsqv)
116. [Highlight Sync](https://www.reddit.com/r/chrome_extensions/comments/1srj6ce)
117. [Permanent webpage erase and annotation](https://www.reddit.com/r/chrome_extensions/comments/1tueie8)
118. [All-in-one web annotator](https://www.reddit.com/r/chrome_extensions/comments/1rr114y)
119. [PencilKit web annotation](https://www.reddit.com/r/chrome_extensions/comments/1sbd3nl)
120. [Notes on webpage components](https://www.reddit.com/r/chrome_extensions/comments/1snss0y)
121. [Webpage notes](https://www.reddit.com/r/chrome_extensions/comments/1czimai)
122. [WebNoteMate](https://www.reddit.com/r/chrome_extensions/comments/1o0eetq)
123. [Notefox website notes](https://www.reddit.com/r/firefox/comments/1oe0d6d)
124. [Highlights disappearing after reload](https://www.reddit.com/r/chrome_extensions/comments/1ukn8nw)
125. [Phrase highlighting across sites](https://www.reddit.com/r/chrome_extensions/comments/ot552z)
126. [Highlight and bookmark across devices](https://www.reddit.com/r/chrome_extensions/comments/1ex4cka)
127. [Color-code and annotate links](https://www.reddit.com/r/firefox/comments/f01kz4)
128. [Color specific words](https://www.reddit.com/r/chrome_extensions/comments/158nm3b)
129. [Highlight words in logs with chosen colors](https://www.reddit.com/r/chrome_extensions/comments/1b3yqtj)
130. [Local-first Markdown editor](https://www.reddit.com/r/opensource/comments/1prqzx9)

The inventory intentionally exceeds 100 because several pages are project showcases rather than organic requests. The consistent signal is the workflow around saved evidence and user-controlled interpretation—not a larger detector taxonomy.

