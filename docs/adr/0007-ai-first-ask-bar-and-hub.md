# ADR 0007: The Ask bar and the hub; the model acts only through tools and never invents

Date: 2026-11-17. Status: accepted.

## Context

Sahil asked for an AI-first rethink. A chat screen bolted onto a music player helps nobody; a model that
names songs from memory invents them. The real advantages are different: we own the library, can fetch
anything, and have a model that understands plain language in English and Gujarati and the user's own
history.

## Decision

1. **One box, any words, any language.** The Ask bar (F75) is on every screen. Typed or spoken; English or
   Gujarati in either script. Library hits appear instantly; the model's answer streams in under them as
   cards with actions and an undo.
2. **Tool-only, never invent.** The intent engine (F76) on the hub calls the model with a fixed tool set:
   `search_library`, `lookup_catalogue`, `play`, `queue`, `make_playlist`, `request`, `set_rule`, `explain`.
   The model may not produce a song, album, artist or id that a tool did not return in that call. Output is
   strict JSON; one model call per utterance; cached system prompt. Every action says what it did and can be
   undone.
3. **Deterministic first.** Exact title matches, library hits and simple commands never call the model.
4. **The model runs on the hub, never in the apps.** Keys, history and the library index live there; the
   apps send words and receive actions. One hub serves every phone and browser in the house.
5. **Models.** `claude-opus-5-5` for intent parsing, ambiguity and ranking (about a cent a call);
   `claude-haiku-5-5` through the Batch API for library enrichment (F77: mood, energy, era, language, vocal,
   explicit; well under a dollar for 5,000 tracks). Switchable by one hub setting.
6. **Cost is a setting.** A per-household monthly budget is shown in Settings; the hub stops calling the
   model when it is reached and says so.

## Consequences

- Phase 0 ships the API shape only: `POST /ask` returns the tool list and no actions; `/requests` is a
  list. Phase 2 implements both.
- Hallucination is closed by construction and tested: an action whose ids are not in a tool result is a
  bug, not a prompt problem.
- Nothing leaves the house except the words typed and the metadata a call needs; no audio is uploaded.
- Not adopted: a talking DJ (F85, later). Explain (F81) answers only from MusicBrainz and Wikipedia pages
  the hub fetched, with sources.
