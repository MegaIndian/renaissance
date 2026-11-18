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
   `requested_by`, status, reason, detail, progress, and a `steps` log), `rules` (per profile, plain
   text), `usage` (tokens and cost per profile per day) and `cache` (JSON with a TTL for catalogue
   answers and token checks).
3. **Who is asking.** The apps send the Jellyfin access token they already hold. The hub asks
   Jellyfin `GET /Users/Me` once, caches the answer for five minutes under a hash of the token (the
   token itself is never stored), and upserts the profile. Admins are the names or ids in
   `RENAISSANCE_HUB_ADMINS`; with the list empty, Jellyfin's administrators are the admins.
4. **Scoping.** `GET /requests`, `GET /collection`, `GET /rules`, `GET /budget` and `GET /events`
   answer the caller's own rows. `?scope=house` answers everyone's, for admins only. A request belongs
   to the profile that made it; when it is ready the item goes into that profile's collection and the
   `ready` event goes to that profile (and to admins watching the house).
5. **Already on the server.** `POST /requests` looks the song or album up in Jellyfin with the hub's
   own key first. A hit is an add, not a fetch: a `collection` row with `source: add` and a `200`
   answer that says so. Nothing is downloaded twice.
6. **One file, many owners.** Removing a file from the server stays an admin action in Lidarr; the
   collection rows of other profiles that hold the item are the warning the admin sees (phase 3+).

## Consequences

- A hub restart loses nothing: requests in `requested` start again, singles that were mid-download
  are marked `failed` with reason `interrupted` (a half download cannot be resumed safely), albums
  waiting on Lidarr keep waiting.
- The "House" profile for the living-room speaker (plan.md, Profiles rule 5) is a union query over
  `collection`; it is not built in phase 2.
- Backups: the one file under `/data` in the container (docker/hub/compose.yml).
