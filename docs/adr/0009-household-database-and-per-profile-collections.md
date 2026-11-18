# ADR 0009: The household database and per-profile collections

Date: 2026-11-18. Status: accepted. Builds on ADR 0006 and ADR 0007.

## Context

One server, one library, one copy of every file, but four people (F86, F87). Jellyfin keeps
favourites, playlists and play counts per user, so phase 1 got "mine" for free by signing each person
in as their own Jellyfin user. What Jellyfin cannot keep is who asked for a song, whose "Ready" it is,
which rules apply to whom, and what the model cost whom. Jellyfin's per-user library access works per
folder, which would mean one folder per person and duplicate files.

## Decision

1. **One SQLite file on the hub** (`RENAISSANCE_HUB_DB`), opened through `node:sqlite` so the Alpine
   image needs no native build. Migrations are code (`apps/hub/src/db/database.ts`), run in order at
   start, each once, in a transaction.
2. **Tables.** `profiles` (the Jellyfin user id, name, role `admin`/`member`, mode, language),
   `collection` (`profile`, `item`, `kind`, `title`, `artist`, `album`, `added_by`, `added_at`,
   `source` in `request`/`add`/`import`/`favourite`, unique per profile and item), `requests` (with
   `requested_by`, status, reason, detail, progress as `unit`/`done`/`total`/`eta`, and a `steps`
   log), `rules` (per profile, plain text), `usage` (tokens and cost per profile per day) and
   `cache` (JSON with a TTL for catalogue answers and token checks, swept on start and every minute).
   A request's `steps` holds status changes only (never progress) and at most 50 rows, the first and
   the latest, so a request that polls Lidarr for a week stays a few kilobytes; `status` has seven
   values, `cancelled` being its own (the person stopped it; nothing failed), and album requests
   carry a deadline (`RENAISSANCE_ALBUM_DEADLINE_DAYS`, default 7) after which they fail with
   `not_found_in_time` and the album is unmonitored.
3. **Who is asking.** The apps send the Jellyfin access token they already hold. The hub asks
   Jellyfin `GET /Users/Me` once, caches the user's id, name and admin flag for five minutes under a
   hash of the token (the token itself and the rest of the user record are never stored), and
   upserts the profile. Admins are the names or ids in `RENAISSANCE_HUB_ADMINS`; with the list
   empty, Jellyfin's administrators are the admins. `GET /health`, which is unauthenticated and never
   rate limited, reads that cache only and never calls Jellyfin.
4. **Scoping.** `GET /requests`, `GET /collection`, `GET /rules`, `GET /budget` and `GET /events`
   answer the caller's own rows. `?scope=house` answers everyone's, for admins only. A request belongs
   to the profile that made it; when it is ready the item goes into that profile's collection and the
   `ready` event goes to that profile (and to admins watching the house).
5. **Already on the server, or already on its way.** `POST /requests` looks the song or album up in
   Jellyfin with the hub's own key first. A hit is an add, not a fetch: a `collection` row with
   `source: add` and a `200` answer that says so. A request for a song or album another request is
   already fetching (same recording or release group, else the same title and artist) answers `200`
   with that request. Nothing is downloaded twice.
6. **Every write to a request goes through one guard.** The pipeline writes status and progress
   through two functions that refuse a cancelled or removed row, checks cancellation again before a
   download and before an import, and never throws out of a run; the runner clears its "running"
   slot in a `finally`. A cancel that lands mid-search therefore stops the request where it is, and
   a cancel plus a failing step can neither wedge the queue nor crash the process.
7. **Existing Lidarr artists are never changed.** A song by an artist Sahil added by hand keeps that
   artist's metadata profile and monitoring; the album is added explicitly instead (Lidarr accepts an
   album outside the profile), and the step detail says so. Only artists the hub adds get the singles
   profile, with `monitorNewItems: none`.
8. **One file, many owners.** Removing a file from the server stays an admin action in Lidarr; the
   collection rows of other profiles that hold the item are the warning the admin sees (phase 3+).

## Consequences

- A hub restart loses nothing: requests in `requested` start again, singles that were mid-download
  are marked `failed` with reason `interrupted` (a half download cannot be resumed safely), albums
  waiting on Lidarr keep waiting.
- The "House" profile for the living-room speaker (plan.md, Profiles rule 5) is a union query over
  `collection`; it is not built in phase 2.
- Backups: the one file under `/data` in the container (docker/hub/compose.yml).
