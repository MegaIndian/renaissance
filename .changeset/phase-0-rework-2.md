---
'web': patch
'mobile': patch
'hub': patch
'@renaissance/core': patch
'@renaissance/design': patch
---

Phase 0 rework round 2: a solid 2 px focus outline on every control, measured for contrast on every
surface it sits on; 24 px (30 px in simple mode) targets on the language segments and sidebar items;
the Ask bar's placeholder is "Ask for anything" with the examples in the hint; a list glyph for
Library; the person glyph instead of a placeholder square on the signed-out card; a favicon,
theme colour and a Ctrl K hint outside macOS; an unknown URL keeps the shell with a translated
sentence and a link home; mobile draws the same glyphs as web and remembers the language; the queue
tracks each queued copy by its own key (previous returns to what played, play next inserts after the
playing copy, replace and clear drop the history, a Next press moves on under repeat one); an
unknown network is treated as cellular; the hub lists requests newest first by insertion, reports its
real version and rate limits every route but `/health` per client address.
