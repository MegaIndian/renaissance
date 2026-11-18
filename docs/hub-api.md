# Hub API (phase 2)

The hub is the one server-side process (`apps/hub`, Fastify). It holds every key, runs the fetch
pipeline, the intent engine and the household database, and talks to Jellyfin, Lidarr, slskd,
Navidrome, MusicBrainz, Deezer and the Anthropic API so the apps never do (ADR 0006, 0007, 0009 and 0010).

Every body is JSON. Validation is Zod; a failed parse answers `400` with
`{ "error": "invalid_request", "issues": [...] }` (Zod's issue list). The shapes below are the Zod
schemas in `packages/core/src/hub.ts`; the apps call the hub through `createHubClient` in
`packages/core/src/hub-client.ts`, which validates every answer against the same schemas.

Run it locally with `pnpm --filter hub dev` (port 8787, `.env` loaded if present). Browser calls are
allowed from `http://localhost:5173` outside production; set `RENAISSANCE_HUB_CORS_ORIGINS` for
anything else.

## Who is asking (F86, F87)

Every route but `GET /health` needs the caller's Jellyfin access token, the one the app got from
`AuthenticateByName`:

```sh
TOKEN=...   # the Jellyfin access token of the signed-in user
curl -s http://localhost:8787/me -H "Authorization: Bearer $TOKEN"
# {"id":"<jellyfin user id>","name":"Sahil","role":"admin","mode":"simple","language":"en"}
```

`Authorization: Bearer <token>`, `Authorization: MediaBrowser ..., Token="<token>"` and
`X-Emby-Token: <token>` are all read. `GET /events` also reads `?token=` because `EventSource`
cannot set headers (`/ask` is a POST and reads headers only). The hub validates a token against
Jellyfin `GET /Users/Me` once and caches the user's id, name and admin flag for five minutes under a
hash of the token; the token itself and the rest of the user record are never stored or logged. The
profile is upserted in the household database on every sighting.

| Code | Body                                  | When                                       |
| ---- | ------------------------------------- | ------------------------------------------ |
| 401  | `{"error":"unauthorized"}`            | No token, or Jellyfin rejected it          |
| 403  | `{"error":"forbidden"}`               | `?scope=house` from a member               |
| 503  | `{"error":"jellyfin_not_configured"}` | `JELLYFIN_URL` is not set                  |
| 503  | `{"error":"jellyfin_unreachable"}`    | Jellyfin did not answer; try again shortly |

Admins are the Jellyfin user names or ids in `RENAISSANCE_HUB_ADMINS`; with the list empty,
Jellyfin's administrators are the admins. Admins may add `?scope=house` to `GET /requests`,
`GET /collection`, `GET /budget` and `GET /events` to see everyone's.

## `GET /health`

Liveness plus, with a token the hub has checked recently, which integrations are configured
(presence, never a value). Never rate limited (container health checks poll it), so the token is
read from the five-minute cache only: `/health` never calls Jellyfin, never fails when Jellyfin is
down, and cannot be used to test tokens. Call `/me` first and the detail appears. `version` is read
from `apps/hub/package.json` beside the built code, so the container reports its real version.

```sh
curl -s http://localhost:8787/health
# {"status":"ok","service":"renaissance-hub","version":"0.0.1","database":"ok"}
# 503 {"status":"degraded",...,"database":"error"} when the hub's own database refused its last write
# (a read-only volume, a full disk): the container health check fails and the problem is seen.
# When the database cannot be used at start (read-only, bad path), the process stays up in the same
# shape: /health answers 503 with database "error" and the SQLite message in "error", every other
# route answers 503 storage_error, nothing else runs; fix the volume and restart.
curl -s http://localhost:8787/health -H "Authorization: Bearer $TOKEN"
# ...,"integrations":{"environment":"development","jellyfin":true,"anthropic":false,"lidarr":true,
#   "slskd":true,"navidrome":false,"intentModel":"claude-opus-5-5","budgetUsdPerMonth":10,...}
```

## `GET /me`, `POST /me`

The caller's profile and preferences. `POST` takes `mode` (`simple`, `advanced`) and/or `language`
(`en`, `gu`).

```sh
curl -s -X POST http://localhost:8787/me -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"mode":"advanced","language":"gu"}'
```

## `GET /catalogue/search?q=` (F61)

Typeahead for the one search box: songs, artists and albums for the words typed. Two speeds. The
typeahead does not wait its turn at MusicBrainz (one request a second for the whole house): it
answers from the cache when the words were looked up before, else from Deezer alone (tracks plus an
album search; art, previews, durations; no MusicBrainz ids, `partial: true`, ten-minute cache),
with one exception below. A full search (Enter, the model's context) asks MusicBrainz (recordings
and release groups, with a `User-Agent` naming the app and `RENAISSANCE_CONTACT`), merges Deezer's
art and previews, falls back to a Cover Art Archive URL, and is cached for a day. Not an LLM.

The full search asks MusicBrainz for the words as typed OR every way they split into a title and an
artist as a boosted fielded clause (`recording:"fireman" AND artist:"lil wayne"`, both orders, up to
six words; a sentence is sent as it is), the way the pipeline's own lookup finds a song, because the
plain search lists songs that merely contain the words ("Lil Wayne Fireman" by DJ Symphony, ten
mixtapes titled "Lil Wayne") ahead of the song by the artist. Twenty-five recordings are read, and
every Deezer track the recordings did not match becomes a row of its own (no ids yet, like a
typeahead row), so the song is in the answer when MusicBrainz's list missed it.

Every list is ranked and pruned before it is cut to size (never after, or the right row could be cut
away unseen): a row must cover the words typed (command words and filler such as "play", "get me",
"for", "something" do not count; a prefix and one typo do match), the exact title and artist come
first, a title or artist carrying a version word the words did not ask for (live, remix, karaoke,
cover, tribute, stripped, instrumental, acoustic, "radio edit", "originally performed", "made
famous", "in the style of") ranks under every plain row, and when the words read as a sentence (a
command verb, or four or more words with a request word among them: "something", "songs", "hits",
"please"; articles and pronouns do not count, so "Rolling in the Deep Adele" and "Someone Like You
Adele" are a title and an artist) only a row that is the title itself survives. When no row is the
exact title and artist, both speeds ask Deezer once more with the words split by what the rows say
(an artist the rows name whose every word was typed, else the words left over from an exact title:
`artist:"Adele" track:"Rolling in the Deep"`) and merge before ranking. The exception to "never
waits": when the rows named a title and an artist and still none is the song by that artist (Deezer's
catalogue from the hub's address has no Adele at all and no plain "Halo"), the typeahead starts the
full search and waits up to two seconds for MusicBrainz; its answer, when it comes in time, is the
one shown, and either way it lands in the cache for the next letters or the Enter that follows.
So "fireman lil wayne" puts Lil Wayne's Fireman first and drops the mixtapes named after him,
"Rolling in the Deep Adele" shows Adele above the tribute acts, "Halo Beyonce" puts Halo above
"Halo (Live)", and "play something calm for cooking" or "રસોઈ માટે શાંત ગીત વગાડ" show no rows at
all; a long title ("Kabhi Kabhie Mere Dil Mein") is not a sentence and keeps its exact row. Songs
already on the server carry `libraryId` and come first; the rows' artists are looked up in Jellyfin
too, so an artist query marks the songs the server has. `q` is 2 to 200 characters.

The two speeds are cached apart (`catalogue:fast:` and `catalogue:search:`). The typeahead reads
the full answer when it has the song typed (it carries MusicBrainz ids) or when neither answer
does; a full answer without the exact row never replaces a fast answer that had it, so an Enter can
never take the right song away from the letters typed afterwards.

```sh
curl -s "http://localhost:8787/catalogue/search?q=lil%20wayne%20fireman" -H "Authorization: Bearer $TOKEN"
```

```json
{
  "query": "lil wayne fireman",
  "songs": [
    {
      "id": "mb:recording:da9023df-cd6b-48dc-b82c-2c43ad9a89dc",
      "recordingId": "da9023df-cd6b-48dc-b82c-2c43ad9a89dc",
      "title": "Fireman",
      "artist": "Lil Wayne",
      "artistId": "ac9a487a-d9d2-4f27-bb23-0f4686488345",
      "album": "Tha Carter II",
      "releaseGroupId": "d97d9f3b-3dc1-3330-a240-b84b74e62044",
      "releaseId": "1684a38a-9809-4b3f-8f7f-1722dfb1d10e",
      "duration": 264,
      "year": 2005,
      "art": "https://cdn-images.dzcdn.net/.../250x250.jpg",
      "preview": "https://cdnt-preview.dzcdn.net/....mp3"
    }
  ],
  "artists": [
    {
      "id": "mb:artist:ac9a487a-...",
      "artistId": "ac9a487a-...",
      "name": "Lil Wayne",
      "art": "..."
    }
  ],
  "albums": [
    {
      "id": "mb:release-group:d97d9f3b-...",
      "releaseGroupId": "d97d9f3b-...",
      "title": "Tha Carter II",
      "artist": "Lil Wayne",
      "type": "Album",
      "year": 2005,
      "art": "..."
    }
  ],
  "cached": false
}
```

Deezer allows about 50 requests per 5 seconds per address, so its calls go through a limiter of
their own (one every 100 ms): identical in-flight queries share one call (each caller with its own
promise, so one typist moving on never fails another), a profile's older prefix still waiting is
dropped when its newer letters arrive, and the queue is capped. Past the cap, or for a prefix that
was replaced, the typeahead route answers `503 { "error": "busy" | "superseded" }` with
`retry-after: 1` (the Deezer client lets the limiter's refusal through; only Deezer's own failures
and quota errors become "no answer"); the apps keep the rows they have and ask again for the
current letters. A Deezer failure or quota error is answered as no rows but never cached, so the
next keystroke asks again; in the full search it means no Deezer rows and a briefly cached answer.
MusicBrainz has the same limiter rules at one request a second, with one more: the pipeline's
lookups for a request somebody made are never refused as busy and take the next slot ahead of the
typing, and when the queue is full `/ask` answers with the Deezer rows instead of none.

## Requests (F61, F62, F63, F87)

A request is a song (`kind: track`) or an album (`kind: album`) the caller wants on the server. The
pipeline (`apps/hub/src/fetch/pipeline.ts`) runs one request at a time:

| Status        | Meaning                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requested`   | Stored, waiting for the runner                                                                                                                                                                                           |
| `finding`     | Catalogue ids resolved; slskd searched with cleaned queries; files ranked. Albums stay here while Lidarr looks for them                                                                                                  |
| `downloading` | The best file is being fetched from Soulseek; `progress` is `{ unit: "percent", done, total: 100, etaSeconds? }`, the estimate from the transfer rate so far                                                             |
| `importing`   | The file is mapped to its MusicBrainz track and imported into Lidarr; scans are triggered                                                                                                                                |
| `ready`       | On the server; in the caller's collection; the `ready` event was pushed                                                                                                                                                  |
| `failed`      | `reason` says why: `catalogue_miss`, `no_results`, `no_candidates`, `download_failed`, `lidarr_artist`, `lidarr_album`, `track_unmapped`, `import_failed`, `not_configured`, `interrupted`, `not_found_in_time`, `error` |
| `cancelled`   | Stopped by the person who asked (or an admin) while `requested` or `finding`; no reason, no retry                                                                                                                        |

Album requests stay `finding` with `progress: { unit: "songs", done, total }` while Lidarr looks
(the total from Lidarr's statistics, read back after the album is monitored, else the monitored
release's track count: never "0 of 0"), and fail with `not_found_in_time` after
`RENAISSANCE_ALBUM_DEADLINE_DAYS` (default 7), counted from `requestedAt`, the last time the request
was made (a retry sets it again; it is a column of its own, so the step cap cannot lose it); the
album is then unmonitored in Lidarr. Every ten minutes the poll also files what soularr fetched but
Lidarr's automatic import refused ("Has missing tracks" against another edition): one `manualimport`
listing of the failed-imports folder per tick (`RENAISSANCE_LIDARR_FAILED_IMPORTS_DIR`, default
`failed_imports` under `RENAISSANCE_LIDARR_DOWNLOADS_DIR`), shared by every waiting album and taken
only when an incomplete album is due. A folder counts as an album's only when it is named
`<Artist> - <Title>` (a year may follow; "Tha Carter II" never claims "Lil Wayne - Tha Carter III
(2008)") and at least one of its files maps to a track by its own title; inside such a folder
Lidarr's own track attribution is trusted for the rest. The files are mapped to the monitored
release's tracks and filed with the same explicit `ManualImport` the single path uses. A track that
already has a file is never replaced (the stray `.m4a` beside a FLAC is left alone), a file already
handed to Lidarr is not handed over again (when Lidarr completes the command without moving it, the
next tick says so once, with Lidarr's `rejections`, in a step), and nothing here fails the request:
files that map to no track have not arrived (soularr leaves wrong matches behind in folders of the
right name, Marina Kaye's under "Taylor Swift - Fearless (2008)"), the hub logs it and keeps
waiting, and the deadline decides.

A request records `matched: { title, artist, album? }` when the catalogue resolved the words typed
to a song with another spelling or credit (a Deezer row with no MusicBrainz ids yet), or to a
release other than the album named on the row; the request's own `album` stays what was asked for,
the apps show the match on its own line ("Will arrive as Why This Kolaveri Di?: The Soup of Love by
Dhanush, on The Bollywood Remix Project") and the pipeline searches for and maps that song. The
release named on the row is preferred when the recording is on it. Credits keep their join phrases
("Lil Wayne feat. Static Major"). A
caller's `duration` is kept as given and picks the version meant; the lookup itself never settles
for a live take, a remix or a demo of a plain title (MusicBrainz's own note on the recording, or
every release being a live album, rules it out unless the words asked for it), and a title that is
not the same song once "feat." and edition tags are stripped is a `catalogue_miss` rather than a
stand-in.

Every status change is a row in `steps` (`at`, `status`, `reason`, `detail`), so the Requests tab can
show (in advanced mode and to admins) what the pipeline tried: the queries and how many files each
returned, the file it picked and why (`score 108: title 100% in name, duration matches, flac, free
slot, artist in path`), the Lidarr track it mapped to, and which scans ran. Progress writes change
`progress` only and add no step; the log keeps at most 50 steps (the first and the latest), so a
request that polls for a week stays a few kilobytes. The `reason` codes and `detail` lines are the
pipeline's own words: the apps show them only in advanced mode or to admins, and translate the
reason into a plain sentence for everyone else.

Singles: queries are `artist title`, then `artist-without-Lil title` (the Soulseek server returns
nothing for some short tokens; "Lil Wayne Fireman" gives 0 files, "Wayne Fireman" hundreds), then
`title album`, then `title`. Ranking is deterministic: duration within 3 s of the catalogue, lossless
or 320 kbps, a free upload slot, a short queue, the title in the file name, the artist in the path,
penalties for live, remix, karaoke, sped-up and DJ-pack folders, and the caller's rules (F80) as
exclusions. The file is downloaded, mapped to the MusicBrainz track by recording id (then title),
and imported with Lidarr's `ManualImport` carrying `albumReleaseId` and `disableReleaseSwitching`,
so Lidarr's edition matching never refuses it. A new artist is added to Lidarr first, unmonitored
for new items, with the metadata profile that allows singles (created if missing); an artist that
already exists is used exactly as it is (its profile and monitoring are never changed, because a
profile switch would make Lidarr monitor and soularr fetch every single and EP) and the album is
added explicitly, which Lidarr accepts outside the profile; the step detail says so. Albums are
added to Lidarr monitored and left to Lidarr and soularr; the hub checks every minute and marks the
request `ready` when every track has a file.

A cancel can land while the pipeline is mid-search: every write goes through one guard that refuses
a cancelled or removed row, cancellation is checked again before the download and before the import,
and `run()` never throws, so a cancel never wedges the queue and never downloads anyway.

### `GET /requests`

The caller's own, newest first. Admins: `?scope=house` for everyone's, with `requestedByName`.

```sh
curl -s http://localhost:8787/requests -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:8787/requests?scope=house" -H "Authorization: Bearer $TOKEN"   # admins; 403 otherwise
```

### `POST /requests`

| Field            | Type                   | Rule                                          |
| ---------------- | ---------------------- | --------------------------------------------- |
| `kind`           | `"track"` or `"album"` | required                                      |
| `title`          | string                 | required, 1 to 200 chars                      |
| `artist`         | string                 | required, 1 to 200 chars                      |
| `album`          | string                 | optional                                      |
| `recordingId`    | UUID                   | optional, from the catalogue                  |
| `releaseGroupId` | UUID                   | optional, from the catalogue                  |
| `releaseId`      | UUID                   | optional, from the catalogue                  |
| `artistId`       | UUID                   | optional, from the catalogue                  |
| `duration`       | number (seconds)       | optional; the ranking wants a file within 3 s |

`201` with the stored request. Without ids the pipeline resolves them from MusicBrainz first. If the
song or album is already on the server (F86), the hub answers `200` with
`{ "alreadyHere": true, "item": <collection item> }` and nothing is downloaded. If the same song or
album (same `recordingId` or `releaseGroupId`, else the same title and artist) is already being
fetched for anyone in the house, the hub answers `200` with
`{ "alreadyRequested": true, "request": <the running request> }` instead of starting a second one,
and the caller becomes one of its `watchers`: the request is in their `GET /requests`, every change
and the `ready` event reach them over `GET /events`, and the item lands in their collection too.
Only the asker (or an admin) can cancel or retry it.

```sh
# 201: a request from a catalogue entry
curl -s -X POST http://localhost:8787/requests -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"kind":"track","title":"Fireman","artist":"Lil Wayne","recordingId":"da9023df-cd6b-48dc-b82c-2c43ad9a89dc","releaseGroupId":"d97d9f3b-3dc1-3330-a240-b84b74e62044","releaseId":"1684a38a-9809-4b3f-8f7f-1722dfb1d10e","artistId":"ac9a487a-d9d2-4f27-bb23-0f4686488345","duration":264}'

# 201: words only; MusicBrainz fills the ids
curl -s -X POST http://localhost:8787/requests -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"kind":"track","title":"Fireman","artist":"Lil Wayne"}'

# 200 alreadyHere when the library has it; 200 alreadyRequested with the running request when it is
# already on its way; 400 on a missing artist or a title over 200 characters
```

### `GET /requests/:id`

One request, own, watched, or (admins) anyone's; `404 {"error":"not_found"}` otherwise.

### `DELETE /requests/:id`

Cancel. Allowed while `requested` or `finding` (the undo of an Ask bar `request` action). The
request becomes `cancelled` (its own status, no reason); an album is unmonitored in Lidarr, best
effort, and the detail says so. The write is conditional (`UPDATE … WHERE status IN ('requested',
'finding')`): a poll or a step that finished while Lidarr was being told loses nothing. Answers:
`200` with the row (also for a request already cancelled: pressing Undo twice is fine);
`409 {"error":"too_late"}` once the download has started; `409 {"error":"not_active"}` for a
request that already finished (`ready` or `failed`); `404` for someone else's, a watcher's
included (the apps show no Cancel on a watched card and say who asked). An album cancelled while
the pipeline was still adding it to Lidarr is unmonitored by the pipeline itself once the add
lands, so soularr never fetches it.

### `POST /requests/:id/retry`

Run a failed request again (`202`); the asker's and every watcher's event stream sees the
`requested` row. A request whose file was already downloaded (`sourceFile`) resumes at the import;
`409 {"error":"not_failed"}` for anything not `failed` (a cancelled request is not retried: ask
again instead).

```sh
curl -s -X DELETE http://localhost:8787/requests/<id> -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:8787/requests/<id>/retry -H "Authorization: Bearer $TOKEN"
```

## `GET /collection`, `DELETE /collection/:id` (F86)

What counts as "mine": items this profile requested, added ("already here"), imported or favourited.
`item` is the Jellyfin item id when the hub found it on the server, otherwise the catalogue id
(`mb:recording:...`, `mb:release-group:...`). Admins: `?scope=house`.

```sh
curl -s http://localhost:8787/collection -H "Authorization: Bearer $TOKEN"
# [{"id":1,"profile":"...","item":"mb:recording:da9023df-...","kind":"track","title":"Fireman","artist":"Lil Wayne","album":"Tha Carter II","addedBy":"...","addedAt":"2026-11-18T05:10:00.000Z","source":"request"}]
curl -s -X DELETE http://localhost:8787/collection/1 -H "Authorization: Bearer $TOKEN"
```

## Rules (F80): `GET /rules`, `POST /rules`, `DELETE /rules/:id`, `GET /rules/policy`

Plain-text rules per profile ("no live versions", "prefer flac"). The ranking step reads them as a
policy (`GET /rules/policy`: `exclude` versions, `preferLossless`, `preferSmall`, and `unknown` for
rules the vocabulary does not know, which the intent engine still sees). The Ask bar's `set_rule`
tool stores one with an undo.

```sh
curl -s -X POST http://localhost:8787/rules -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"text":"no live versions"}'      # 201
curl -s http://localhost:8787/rules -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:8787/rules/policy -H "Authorization: Bearer $TOKEN"
# {"exclude":["live"],"preferLossless":false,"preferSmall":false,"unknown":[]}
curl -s -X DELETE http://localhost:8787/rules/1 -H "Authorization: Bearer $TOKEN"
```

## `POST /ask` (F75, F76)

The Ask bar's endpoint. Body: `text` (1 to 2000 chars), optional `language` (`en`, `gu`).

1. The deterministic layer runs first: a Jellyfin search with the caller's own token (`instant`:
   tracks, albums, artists that person may see) for the words as typed and for the title inside them
   ("play carefree", "carefree vagad" also search "carefree"), the hits unioned. An exact library
   title plays at once with no model call and no catalogue call (`model: "off"`,
   `reason: "deterministic"`). Otherwise the catalogue is looked up and returned as `catalogue`
   (songs, albums, artists with art, duration and `libraryId` when already on the server): the add
   path the apps render as rows with Add and Play, with or without the model.
2. One call to `ANTHROPIC_INTENT_MODEL` (`claude-opus-5-5`) with the eight strict tools
   `search_library`, `lookup_catalogue`, `play`, `queue`, `make_playlist`, `request`, `set_rule`,
   `explain`, a cached system prompt and the context block. Every tool call is grounded: ids must
   come from the context of this call, a request's title and artist from a catalogue result or the
   user's words. Rejected calls are listed in `rejected[]` (`unknown_tool`, `invalid_input`,
   `ungrounded_id`, `ungrounded_name`).
3. Hub-side actions run (`request`, `set_rule`, `search_library`, `lookup_catalogue`, `explain`)
   and carry `result` and an `undo` route, with a past-tense `summary`; app-side actions (`play`,
   `queue`, `make_playlist`) are returned for the app to perform, their `summary` in the imperative
   ("Play Carefree", "Queue 2 songs") and a `doneSummary` ("Playing Carefree") the app shows once it
   has done them, with its own undo. `why` is one line in the question's language; summaries come
   from `en.json` and `gu.json`.

Without `ANTHROPIC_API_KEY` the hub still answers: `model: "off"`, `reason: "no_key"`, with
`instant` and `catalogue`. Past the monthly cap: `reason: "budget"` (an estimated cost is reserved
while a call is in flight, so concurrent asks cannot all pass at the cap). A refusal or API error:
`reason: "refusal"` or `"error"`, no actions, still with `catalogue`.

```sh
curl -s -X POST http://localhost:8787/ask -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"text":"get me fireman by lil wayne","language":"en"}'
```

```json
{
  "model": "claude-opus-5-5",
  "language": "en",
  "instant": { "tracks": [], "albums": [], "artists": [] },
  "actions": [
    {
      "tool": "request",
      "input": {
        "kind": "track",
        "title": "Fireman",
        "artist": "Lil Wayne",
        "catalogueId": "mb:recording:da9023df-..."
      },
      "summary": "Requested Fireman by Lil Wayne",
      "ranBy": "hub",
      "result": { "id": "987a922b-...", "status": "requested", "...": "..." },
      "undoable": true,
      "undo": { "method": "DELETE", "path": "/requests/987a922b-..." }
    }
  ],
  "catalogue": {
    "query": "get me fireman by lil wayne",
    "songs": [
      { "id": "mb:recording:da9023df-...", "title": "Fireman", "artist": "Lil Wayne", "...": "..." }
    ],
    "albums": [],
    "artists": [],
    "cached": false
  },
  "why": "Requested Fireman from Tha Carter II.",
  "rejected": [],
  "usage": { "inputTokens": 2100, "outputTokens": 140, "cacheReadTokens": 1800, "costUsd": 0.0117 },
  "tools": [
    "search_library",
    "lookup_catalogue",
    "play",
    "queue",
    "make_playlist",
    "request",
    "set_rule",
    "explain"
  ]
}
```

Streaming: add `?stream=1` (or `Accept: text/event-stream`). The hub sends `event: instant` with the
library hits as soon as it has them, then `event: answer` with the full answer above, then closes.

```sh
curl -N -X POST "http://localhost:8787/ask?stream=1" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"text":"something calm for cooking"}'
# event: instant
# data: {"tracks":[...],"albums":[],"artists":[]}
#
# event: answer
# data: {"model":"claude-opus-5-5",...}
```

## `GET /budget`

This month's model spend for the caller (admins: `?scope=house`), the cap from
`RENAISSANCE_BUDGET_USD_MONTH`, and whether the model is off. Cost comes from the SDK's usage fields
priced per model (`apps/hub/src/ask/budget.ts`).

```sh
curl -s http://localhost:8787/budget -H "Authorization: Bearer $TOKEN"
# {"model":"claude-opus-5-5","month":"2026-11","capUsd":10,"spentUsd":0.0117,"remainingUsd":9.9883,"off":false,
#  "days":[{"day":"2026-11-18","calls":1,"inputTokens":2100,"outputTokens":140,"costUsd":0.0117}]}
```

## `GET /events` (Server-Sent Events)

Request status changes and "Ready" for the caller only (admins: `?scope=house`). Events are
`request` (the full request after each change), `ready` (the request that just became ready) and
`ping` every 25 seconds. A reconnecting app lists `GET /requests` to catch up.

```sh
curl -N "http://localhost:8787/events?token=$TOKEN"
# event: ping
# data: {"type":"ping","at":"2026-11-18T05:10:00.000Z"}
#
# event: request
# data: {"type":"request","request":{"id":"...","status":"downloading","progress":{"unit":"percent","done":42,"total":100,"etaSeconds":70},...}}
#
# event: ready
# data: {"type":"ready","request":{"id":"...","status":"ready",...}}
```

## Rate limit

Every route but `/health` is limited per client address: `RENAISSANCE_HUB_RATE_LIMIT` requests a
minute (default 120; 0 turns it off). Each answer carries `x-ratelimit-limit`,
`x-ratelimit-remaining` and `x-ratelimit-reset`; past the limit the hub answers `429` with
`retry-after`. Behind a reverse proxy set `RENAISSANCE_HUB_TRUST_PROXY=true` so the limit sees the
client's address instead of the proxy's.

```sh
for i in 1 2 3; do curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/me -H "Authorization: Bearer $TOKEN"; done
```

## Errors the framework returns

| Code | When                                                                       |
| ---- | -------------------------------------------------------------------------- |
| 404  | Unknown route, or an id that is not stored                                 |
| 413  | Body over Fastify's 1 MiB default                                          |
| 415  | A content type the hub has no parser for (anything but JSON or plain text) |
| 429  | More requests than the per-address limit in a minute                       |
| 500  | `storage_error`: the hub's own database refused a read or write            |
| 503  | `jellyfin_unreachable`: Jellyfin did not answer the token check            |

## The web app

`apps/web` talks to the hub through `createHubClient` (`packages/core/src/hub-client.ts`) from one
`HubProvider` (`apps/web/src/lib/hub.ts`). The hub's address is `VITE_HUB_URL` at build time, else
this host on port 8787. The token is the signed-in Jellyfin session's; the phase 0 shell, which has no
sign-in yet, reads `?hubToken=<jellyfin token>` once and keeps it under `renaissance.hubToken`:

```sh
pnpm dev
open "http://localhost:5173/requests?hubToken=$TOKEN"
```

The Requests tab lists the caller's requests live over `GET /events`, with cancel and retry and an
admin "Whole house" switch; Library's "Mine" is `GET /collection`; the Ask bar calls
`GET /catalogue/search` as the user types (250 ms after the last letter, the previous call aborted)
and shows the rows with Add (the first one primary) and Play (the hub strips every command phrase,
"get me", "find me", "please", before the catalogue sees the words), then sends Enter to `POST /ask?stream=1`
and shows the action cards with undo and the one-line why first, the library hits and the catalogue
rows under them; the typeahead's rows are cleared by every answer. Add says what happened on its own
line under the title ("Requested. Progress is in Requests", "Already on its way, asked by Mom"), and
an undo that does not take says so truthfully ("Couldn't undo that. The request is still in
Requests"; "Too late, it is already downloading. It stays in Requests"), and says "Undoing…" while
the hub is asked. Enter aborts the typeahead still waiting for the same letters, so its rows never
land under the answer. The art placeholder sits under every picture until it has loaded. A request
card keeps the album that was asked for in its subtitle; what will actually arrive is its own
line, wrapping to two lines on a phone. A card for a request someone else made (the viewer is a
watcher) says who asked in every scope and offers no Cancel or Retry; an admin may cancel anyone's
from the "Whole house" view. The pipeline's `detail` lines are shown in advanced mode only, and
stay in English; the Gujarati panel says so.

Phase 1 seam: the "Play Carefree" card and the "Carefree · In your library" row under it both
carry the ghost Play with the same reason today. When phase 1 wires `perform`, the row's Play goes
where the card already offers it.

`apps/web/e2e/hub.spec.ts` drives a real page against the real hub (`apps/hub/scripts/e2e-hub.mjs`:
the server in dry-run mode in front of stand-ins for every outside service), adding a song, undoing
it and cancelling it through the browser's own DELETE requests, so the CORS preflight is tested
where it matters.

## The request CLI and dry runs

`pnpm --filter hub request "<title>" "<artist>"` runs one request through the pipeline from the
command line (no HTTP server; the request is stored under a local `cli` profile). With `--dry-run`
the searches are real and every write to slskd, Lidarr, Navidrome or Jellyfin is logged instead of
sent, the mapping step uses MusicBrainz's own track list, and the run ends `ready` with the
`ManualImport` body it would have sent. `--album` requests an album; `--retry <id>` runs a stored
request again. `RENAISSANCE_HUB_DRY_RUN=true` puts the whole server in the same mode.

```sh
RENAISSANCE_HUB_DB=:memory: pnpm --filter hub request --dry-run "Fireman" "Lil Wayne"
```

## Configuration

Environment variables only (`apps/hub/.env.example` lists every one; `docker/hub/compose.yml` shows
the TrueNAS layout). Nothing is read from a file except `.env` through Node's own
`--env-file-if-exists` and the SQLite database.

| Variable                                | Default                      | Meaning                                                                                               |
| --------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `RENAISSANCE_HUB_HOST`, `_PORT`         | `0.0.0.0`, `8787`            | Where to listen                                                                                       |
| `RENAISSANCE_HUB_CORS_ORIGINS`          | dev: `localhost:5173`        | Browser origins, comma separated; empty in production: same origin                                    |
| `RENAISSANCE_HUB_TRUST_PROXY`           | `false`                      | Trust `x-forwarded-for` behind a reverse proxy                                                        |
| `RENAISSANCE_HUB_RATE_LIMIT`            | `120`                        | Requests a minute per client address; 0 off                                                           |
| `RENAISSANCE_HUB_DB`                    | `./data/hub.sqlite`          | The household database; `:memory:` keeps nothing                                                      |
| `RENAISSANCE_HUB_ADMINS`                | empty                        | Jellyfin user names or ids who see the whole house; empty: Jellyfin administrators                    |
| `RENAISSANCE_BUDGET_USD_MONTH`          | `10`                         | Household model spend a month; the model turns off when reached; 0 off                                |
| `RENAISSANCE_HUB_DRY_RUN`               | `false`                      | Log writes to slskd, Lidarr, Navidrome, Jellyfin instead of sending                                   |
| `RENAISSANCE_ALBUM_DEADLINE_DAYS`       | `7`                          | Days an album request waits on Lidarr before `not_found_in_time`                                      |
| `RENAISSANCE_LIDARR_DOWNLOADS_DIR`      | `/downloads/complete`        | slskd's completed folder as Lidarr's container sees it                                                |
| `RENAISSANCE_LIDARR_FAILED_IMPORTS_DIR` | `<downloads>/failed_imports` | Where soularr parks refused files, as Lidarr sees it; the album poll lists this folder, once per tick |
| `RENAISSANCE_CONTACT`                   | repo URL                     | MusicBrainz `User-Agent` contact                                                                      |
| `JELLYFIN_URL`, `JELLYFIN_API_KEY`      |                              | Token checks (`/Users/Me`), library lookups, `Library/Refresh`                                        |
| `ANTHROPIC_API_KEY`                     |                              | Optional; without it `/ask` is `model: "off"`                                                         |
| `ANTHROPIC_INTENT_MODEL`                | `claude-opus-5-5`            | The intent engine's model                                                                             |
| `ANTHROPIC_ENRICHMENT_MODEL`            | `claude-haiku-5-5`           | Phase 4 enrichment batches                                                                            |
| `LIDARR_URL`, `LIDARR_API_KEY`          |                              | Artists, albums, `ManualImport`, `RefreshArtist`                                                      |
| `LIDARR_ROOT_FOLDER`                    | Lidarr's first               | Root folder for new artists                                                                           |
| `SLSKD_URL`, `SLSKD_API_KEY`            |                              | Soulseek search and downloads                                                                         |
| `NAVIDROME_URL`, `_USER`, `_PASSWORD`   |                              | Optional `startScan` after an import                                                                  |

Secrets (`*_API_KEY`, `NAVIDROME_PASSWORD`) are typed as secrets: `describe()` reports presence
only, request logging is off, error messages carry a path but never a query string or header. The
container image is `apps/hub/Dockerfile` (multi-stage, `node:22-alpine`, runs as `node`, `/data`
volume, health check on `/health`); the hub is bundled with esbuild so `@renaissance/core` is inlined
and no TypeScript runs in the image. The release workflow publishes it as
`ghcr.io/megaindian/renaissance-hub:<tag>` on every `v*` and `phase-*` tag and as `:edge` on every
push to `main`; `docker/hub/compose.yml` pins a tag.
