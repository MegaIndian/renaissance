# ADR 0004: Offline downloads as a per-track manifest

Date: 2026-11-17. Status: accepted.

## Context

Offline (F34 to F38) must work for albums, playlists, artists and single tracks, survive a quality-setting
change, detect corrupt files, and behave on web where storage is browser-managed.

## Decision

The unit of download is the track. Albums, playlists and artists expand to tracks and keep a parent record
so "downloaded" badges and removal work at every level. Each download records quality (`original` from
`/Items/{id}/Download`, or `capped` from the universal endpoint with a bitrate), so changing the setting
never breaks existing files. The manifest (`DownloadItem` in core: track id, server id, path, bytes, codec,
quality, hash, downloaded at, pinned) lives in SQLite on mobile and IndexedDB on web; files live under the
app's documents directory per server id on mobile and in OPFS on web. Integrity is checked on open; a bad
file is redownloaded. Offline mode flips on automatically after repeated network failure and manually from
the top bar; play reporting is queued in the listening log and flushed on reconnect.

## Consequences

- Storage drivers are injected; core's manifest logic is tested headless.
- Web shows a quota meter and honest Safari limits; real files come with a desktop shell (F69, v1.1).
- Keep-synced playlists (F37) are the `pinned` flag plus a reconcile job.
