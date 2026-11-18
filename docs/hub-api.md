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
# {"status":"ok","service":"renaissance-hub","version":"0.0.1"}
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

Typeahead for the one search box: songs, artists and albums for the words typed, from MusicBrainz
(recordings and release groups, one request a second with a `User-Agent` naming the app and
`RENAISSANCE_CONTACT`), with cover art and 30-second previews from Deezer and a Cover Art Archive
URL where Deezer has nothing. Not an LLM. Answers are cached in SQLite for a day. Songs already on
the server carry `libraryId` and come first. `q` is 2 to 200 characters.

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

MusicBrainz allows one request a second, so the hub keeps the box live when the whole house types:
identical in-flight queries share one call, a profile's older prefix still waiting is dropped when
its newer letters arrive, and the queue is capped (16 waiting calls). Past the cap, or for a prefix
that was replaced, the route answers `503 { "error": "busy" | "superseded" }` with `retry-after: 1`;
the apps keep the rows they have and ask again for the current letters. Cached answers (24 h per
query) skip the limiter altogether.

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

Album requests stay `finding` with `progress: { unit: "songs", done, total }` while Lidarr looks, and
fail with `not_found_in_time` after `RENAISSANCE_ALBUM_DEADLINE_DAYS` (default 7); the album is then
unmonitored in Lidarr.

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
fetched for anyone in the house, the hub answers `200` with that request instead of starting a
second one.

```sh
# 201: a request from a catalogue entry
curl -s -X POST http://localhost:8787/requests -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"kind":"track","title":"Fireman","artist":"Lil Wayne","recordingId":"da9023df-cd6b-48dc-b82c-2c43ad9a89dc","releaseGroupId":"d97d9f3b-3dc1-3330-a240-b84b74e62044","releaseId":"1684a38a-9809-4b3f-8f7f-1722dfb1d10e","artistId":"ac9a487a-d9d2-4f27-bb23-0f4686488345","duration":264}'

# 201: words only; MusicBrainz fills the ids
curl -s -X POST http://localhost:8787/requests -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"kind":"track","title":"Fireman","artist":"Lil Wayne"}'

# 200 alreadyHere when the library has it; 200 with the running request when it is already on its way;
# 400 on a missing artist or a title over 200 characters
```

### `GET /requests/:id`

One request, own or (admins) anyone's; `404 {"error":"not_found"}` otherwise.

### `DELETE /requests/:id`

Cancel. Allowed while `requested` or `finding` (the undo of an Ask bar `request` action); `409
{"error":"too_late"}` once the download has started. The request becomes `cancelled` (its own
status, no reason); an album is unmonitored in Lidarr, best effort, and the detail says so.

### `POST /requests/:id/retry`

Run a failed request again (`202`). A request whose file was already downloaded (`sourceFile`)
resumes at the import; `409 {"error":"not_failed"}` for anything not `failed` (a cancelled request
is not retried: ask again instead).

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
and shows the rows with Add and Play, then sends Enter to `POST /ask?stream=1` and shows the library
hits, the catalogue rows, the action cards with undo and the one-line why.

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

| Variable                              | Default               | Meaning                                                                            |
| ------------------------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `RENAISSANCE_HUB_HOST`, `_PORT`       | `0.0.0.0`, `8787`     | Where to listen                                                                    |
| `RENAISSANCE_HUB_CORS_ORIGINS`        | dev: `localhost:5173` | Browser origins, comma separated; empty in production: same origin                 |
| `RENAISSANCE_HUB_TRUST_PROXY`         | `false`               | Trust `x-forwarded-for` behind a reverse proxy                                     |
| `RENAISSANCE_HUB_RATE_LIMIT`          | `120`                 | Requests a minute per client address; 0 off                                        |
| `RENAISSANCE_HUB_DB`                  | `./data/hub.sqlite`   | The household database; `:memory:` keeps nothing                                   |
| `RENAISSANCE_HUB_ADMINS`              | empty                 | Jellyfin user names or ids who see the whole house; empty: Jellyfin administrators |
| `RENAISSANCE_BUDGET_USD_MONTH`        | `10`                  | Household model spend a month; the model turns off when reached; 0 off             |
| `RENAISSANCE_HUB_DRY_RUN`             | `false`               | Log writes to slskd, Lidarr, Navidrome, Jellyfin instead of sending                |
| `RENAISSANCE_ALBUM_DEADLINE_DAYS`     | `7`                   | Days an album request waits on Lidarr before `not_found_in_time`                   |
| `RENAISSANCE_LIDARR_DOWNLOADS_DIR`    | `/downloads/complete` | slskd's completed folder as Lidarr's container sees it                             |
| `RENAISSANCE_CONTACT`                 | repo URL              | MusicBrainz `User-Agent` contact                                                   |
| `JELLYFIN_URL`, `JELLYFIN_API_KEY`    |                       | Token checks (`/Users/Me`), library lookups, `Library/Refresh`                     |
| `ANTHROPIC_API_KEY`                   |                       | Optional; without it `/ask` is `model: "off"`                                      |
| `ANTHROPIC_INTENT_MODEL`              | `claude-opus-5-5`     | The intent engine's model                                                          |
| `ANTHROPIC_ENRICHMENT_MODEL`          | `claude-haiku-5-5`    | Phase 4 enrichment batches                                                         |
| `LIDARR_URL`, `LIDARR_API_KEY`        |                       | Artists, albums, `ManualImport`, `RefreshArtist`                                   |
| `LIDARR_ROOT_FOLDER`                  | Lidarr's first        | Root folder for new artists                                                        |
| `SLSKD_URL`, `SLSKD_API_KEY`          |                       | Soulseek search and downloads                                                      |
| `NAVIDROME_URL`, `_USER`, `_PASSWORD` |                       | Optional `startScan` after an import                                               |

Secrets (`*_API_KEY`, `NAVIDROME_PASSWORD`) are typed as secrets: `describe()` reports presence
only, request logging is off, error messages carry a path but never a query string or header. The
container image is `apps/hub/Dockerfile` (multi-stage, `node:22-alpine`, runs as `node`, `/data`
volume, health check on `/health`); the hub is bundled with esbuild so `@renaissance/core` is inlined
and no TypeScript runs in the image. The release workflow publishes it as
`ghcr.io/megaindian/renaissance-hub:<tag>` on every `v*` and `phase-*` tag and as `:edge` on every
push to `main`; `docker/hub/compose.yml` pins a tag.
