# ADR 0006: Requests go through the hub, never through Lidarr or slskd in the apps

Date: 2026-11-17. Status: accepted. Supersedes the earlier "Lidarr key in the app" design.

## Context

Mom and Dad will never open Lidarr or slskd. Lidarr sends no CORS headers, so the web app cannot call it
from another origin. Lidarr's own edition matching fought back on real albums; explicit track mapping
fixed them by hand.

## Decision

The apps show one search box with catalogue typeahead (MusicBrainz first, Deezer's public search for art
and previews) with library hits first. A tap sends the catalogue entry (artist, title, album, duration,
MusicBrainz ids) to the hub's `/requests`. The hub owns the chain: cleaned slskd queries, deterministic
ranking (duration within 3 s, lossless or 320 kbps, free slot, not karaoke or live or sped up unless asked),
one model call to pick only when the top candidates are ambiguous, download, a `ManualImport` into Lidarr
with explicit track ids, a library scan, and a push to the apps. Albums go through Lidarr and soularr;
singles the hub downloads directly. The hub is the only process with Lidarr, slskd and Anthropic keys; the
apps hold the hub address and a sign-in.

## Consequences

- No LLM typeahead: it would be slow, cost per letter and invent names.
- The Requests tab (F63) is the hub's request list: requested, finding, downloading, ready, failed.
- The hub runs as a container next to Jellyfin; its keys are environment variables of that container.

## Addendum, 2026-11-18 (phase 2 rework round 3)

- **Parked files are filed, never failed.** soularr fetches albums for Lidarr and leaves what Lidarr
  refused in `failed_imports/<Artist> - <Title> (<year>)`, including its own wrong matches (Marina
  Kaye's "Fearless" under Taylor Swift's folder; a CLIFFDIVER track under "Drowning"). The album poll
  lists that folder once per tick for every waiting album, treats a folder as an album's only when it
  is named `<Artist> - <Title>` and at least one file maps to a track by its own title, never replaces
  a track that already has a file, never hands the same file to Lidarr twice (Lidarr's `rejections`
  are written to the step log once instead), and never fails a request from what it finds there:
  files that map to no track have not arrived, and the deadline alone fails an album. The deadline
  runs from `requested_at`, a column set on creation and on every retry.
- **The card tells the truth about the album.** A request keeps the album it was made with; the
  release the file will land on, when different, is `matched.album`, shown on its own line. The
  catalogue prefers the release named on the row when the recording is on it.
- **Only the asker cancels.** The hub already answers 404 to a watcher's cancel or retry; the apps
  now show no Cancel or Retry on a watched card and say who asked, in every scope. A retry is
  published to every party, and the ready write reads the row again so a watcher who joined during
  the poll gets the item.
