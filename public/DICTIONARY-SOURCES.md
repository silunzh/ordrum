# Vocabulary enrichment

`enrich.py` preserves every extracted card identity, chapter, page, and displayed Swedish string. It matches Swedish headwords and inflected forms, uses the card's `en` / `ett` article to restrict noun matching, and reconstructs SALDO's numbered multiword constituents into complete particle-verb and reflexive-verb forms.

Run from the task directory:

```sh
python3 work/lexicon/enrich.py work/raw-vocab.json work/lexicon/enriched.json
```

The compact result is a list with the requested fields `english`, `pos`, `forms`, `lemma`, `source`, and `definitionStatus`. Missing translations were reviewed in `manual.json`. Beginner senses, ambiguous homographs, dictionary errors, and missing regular paradigms were reviewed in `sense-overrides.json`. Reviewed changes are identified in `definitionStatus` and `source`; editorial paradigms are not falsely attributed to SALDO. No runtime network request or API key is necessary.

## Sources and attribution

English translations and some lemma matching derive from **Folkets lexikon**, initially based on Lexin Swedish-English by the Swedish Language Council, hosted at KTH. Dictionary data is distributed under **Creative Commons Attribution-ShareAlike 2.5 Generic**. The supplied subset changes sense selection, punctuation, and learner-facing glosses. Attribution and the same license must be retained for the Folkets-derived dictionary material.

- Source information: https://folkets-lexikon.csc.kth.se/folkets/om.en.html
- Source XML: https://folkets-lexikon.csc.kth.se/folkets/folkets_sv_en_public.xml
- License: https://creativecommons.org/licenses/by-sa/2.5/
- Downloaded XML metadata: version 1.0.4488, last changed 2024-12-14, 39,554 senses.

Inflection tables derive from **Språkbanken (2017), SALDO's morphology**, enriched and distributed by Språkbanken, University of Gothenburg, under **Creative Commons Attribution 4.0**. Selection, multiword reconstruction, positive adjective forms, and Chinese grammatical labels are transformations made for this app. SALDO includes historical and rare alternatives; the app selects modern beginner forms and marks uncommon modal principal parts. A malformed SALDO `missförstådd` supine is explicitly corrected to `missförstått` in the editorial overlay.

- Dataset information: https://sprakbanken.se/en/resources/saldom
- Citation: https://doi.org/10.23695/agcm-ny22
- Source XML: https://svn.spraakbanken.gu.se/sb-arkiv/pub/lmf/saldom/saldom.xml
- License: https://creativecommons.org/licenses/by/4.0/

The card membership and chapter/page mapping come from the user's supplied Rivstart A1/A2 Ordkort PDF. The dictionary licenses above do not license the book/PDF itself. The full dictionary downloads and build cache are intermediate files and are not needed by the website.
