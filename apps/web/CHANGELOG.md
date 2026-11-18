# web

## 0.0.1

### Patch Changes

- [#13](https://github.com/MegaIndian/renaissance/pull/13) [`a10fa33`](https://github.com/MegaIndian/renaissance/commit/a10fa33cc74b9c9052fa9913fb641c95b99708c8) Thanks [@MegaIndian](https://github.com/MegaIndian)! - Phase 0 rework round 2: a solid 2 px focus outline on every control, measured for contrast on every
  surface it sits on; 24 px (30 px in simple mode) targets on the language segments and sidebar items;
  the Ask bar's placeholder is "Ask for anything" with the examples in the hint; a list glyph for
  Library; the person glyph instead of a placeholder square on the signed-out card; a favicon,
  theme colour and a Ctrl K hint outside macOS; an unknown URL keeps the shell with a translated
  sentence and a link home; mobile draws the same glyphs as web and remembers the language; the queue
  tracks each queued copy by its own key (previous returns to what played, play next inserts after the
  playing copy, replace and clear drop the history, a Next press moves on under repeat one); an
  unknown network is treated as cellular; the hub lists requests newest first by insertion, reports its
  real version and rate limits every route but `/health` per client address.

- [#9](https://github.com/MegaIndian/renaissance/pull/9) [`b3051e0`](https://github.com/MegaIndian/renaissance/commit/b3051e03769ac3e067fde5c78c326325ee822dd7) Thanks [@MegaIndian](https://github.com/MegaIndian)! - Phase 0 scaffold: monorepo and tooling, design tokens with measured AA contrast and a rem type
  pipeline, the web and mobile shells (tab bar, sidebar, Ask bar on every screen, simple-mode home with
  readable empty states, English and Gujarati), the hub's `/health`, `/ask` and `/requests` shape with
  `.env` loading and a dev CORS default, the queue state machine, and the demo Jellyfin that sets
  itself up.
- Updated dependencies [[`a10fa33`](https://github.com/MegaIndian/renaissance/commit/a10fa33cc74b9c9052fa9913fb641c95b99708c8), [`b3051e0`](https://github.com/MegaIndian/renaissance/commit/b3051e03769ac3e067fde5c78c326325ee822dd7)]:
  - @renaissance/core@0.0.1
  - @renaissance/design@0.0.1
