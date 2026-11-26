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

## Addendum (2026-11-17, phase 0 rework)

- The hub has no authentication in phase 0: it is a stub on a home network behind nothing. Phase 2
  introduces a hub token that every app sends; from then on `GET /health` answers `status` only to
  anonymous callers and the `integrations` detail (which services and models are configured) only
  with the token. Request strings are bounded (200 characters) and the in-memory request store is
  capped (500, oldest dropped) so an unauthenticated phase-0 hub cannot be filled up.

## Addendum, 2026-11-18 (phase 2 rework round 3)

- **The full search is fielded.** MusicBrainz's plain search ranks songs that contain the words ahead
  of the song by the artist, so an Enter on "fireman lil wayne" showed two junk rows and then poisoned
  the typeahead for a day. The full search now asks for the words OR every title-and-artist split of
  them as a boosted fielded clause in one request (the pipeline's own `recordingQuery` shape), reads
  twenty-five recordings, keeps every Deezer track the recordings did not match as a row, prunes before
  it cuts the list, and when no row is the exact title and artist asks Deezer once more with the words
  split by what the rows say. The two speeds are cached apart, and a full answer without the exact row
  never replaces a fast answer that had it.
- **Version words demote.** A title or artist carrying live, remix, karaoke, cover, tribute,
  stripped, "radio edit", "originally performed", "made famous" or the like, when the words did not
  ask for it, ranks under every plain row. Still no model: token overlap and a word list.
- **A sentence has request words, not articles or pronouns.** "Rolling in the Deep Adele" and "Someone
  Like You Adele" are a title and an artist; "something calm for cooking" and "કિશોર કુમાર ના ગીતો" are
  sentences. Only a command verb, or a word that names what is asked for ("something", "songs",
  "hits", "please"), makes one.
- **The typeahead waits for MusicBrainz in one case.** When Deezer's rows name a title and an artist
  but none is the song by that artist (Deezer has no Adele at all from here, and no plain "Halo"), the
  typeahead starts the full search and waits up to two seconds; the answer lands in the cache either way.
