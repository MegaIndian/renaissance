# ADR 0009: The intent engine: one call, fixed tools, never invent

Date: 2026-11-18. Status: accepted. Implements ADR 0007 points 2, 3, 5 and 6.

## Context

The Ask bar takes any words in English or Gujarati. A model that answers from memory names songs
that do not exist and albums the family does not have. ADR 0007 decided the model acts only through
tools on real data; this records how that is enforced in code rather than in a prompt.

## Decision

1. **Grounding before the call.** For every utterance the hub first runs the deterministic layer:
   a Jellyfin library search with the caller's own token (so results are what that person may see)
   and a catalogue lookup (MusicBrainz, cached). Together with the caller's rules and profile these
   form the `<context>` block the model receives. The library hits are answered to the app at once
   (`instant`), before any model call.
2. **Deterministic first.** An exact library title ("Fireman", "play fireman", "fireman vagad") plays
   without the model, `model: "off"`, `reason: "deterministic"`.
3. **One call per utterance.** `claude-opus-5-5` (from `ANTHROPIC_INTENT_MODEL`) with the eight tools
   `search_library`, `lookup_catalogue`, `play`, `queue`, `make_playlist`, `request`, `set_rule`,
   `explain`, every tool `strict: true`, `tool_choice: auto`, `output_config.effort: low`, adaptive
   thinking (the model's default), the system prompt marked `cache_control: ephemeral`, at most 1024
   output tokens. There is no second round trip: tool calls that read (`search_library`,
   `lookup_catalogue`) are executed by the hub and their results attached to the action for the app to
   show.
4. **Never invent, enforced.** Each tool call is checked by `ground()` (`apps/hub/src/ask/engine.ts`):
   the tool must be one of the eight, the input must parse, and every id must be in the context of
   this call (`play`, `queue`, `make_playlist`, `explain`), or the title and artist of a `request` must
   match a catalogue result or appear in the user's own words. A `set_rule` text that is not a
   substring of the utterance is replaced by the utterance. Rejected calls are listed in the answer
   (`rejected[]`, with `unknown_tool`, `invalid_input`, `ungrounded_id`, `ungrounded_name`) so a
   hallucination is visible, logged and tested, not silently dropped.
5. **Language echo.** The answer's one-line "why" and every action summary are in the language of the
   question: Gujarati script means Gujarati, otherwise the asked or stored language. Summaries come
   from the shared `en.json` and `gu.json` catalogs, not from the model.
6. **Degrade, never block.** Without `ANTHROPIC_API_KEY` the hub runs and `POST /ask` answers
   `model: "off"`, `reason: "no_key"` with the instant layer. Past the monthly cap
   (`RENAISSANCE_BUDGET_USD_MONTH`, household-wide) it answers `reason: "budget"`. A refusal
   (`stop_reason: refusal`) or an API error answers with no actions and a line that says so.
7. **The meter.** Every call's `usage` (input, output, cache read, cache write tokens) is priced from a
   table in `apps/hub/src/ask/budget.ts` and stored per profile per day; `GET /budget` reports the
   month, the cap and the days.

## Consequences

- Hub-side actions (`request`, `set_rule`) carry an `undo` route (`DELETE /requests/:id`,
  `DELETE /rules/:id`, `DELETE /collection/:id`); app-side actions (`play`, `queue`, `make_playlist`)
  are performed and undone by the app, which holds the Jellyfin session.
- Server-side refusal fallbacks (`fallbacks: "default"`) are not enabled: a music request that the
  model declines is answered with a line, not retried on another model at another price. Open to
  change by one setting if refusals turn out to be common.
- `explain` answers only from the facts in the context plus a MusicBrainz link; fetching MusicBrainz
  and Wikipedia pages for F81 is phase 4+.
- Phase 4 adds enrichment tags (`claude-haiku-5-5` through the Batch API) to the context, which is
  what makes "something calm" work; until then mood words fall back to what the library search finds.
