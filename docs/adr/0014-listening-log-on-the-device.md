# ADR 0014: The listening log lives on the device, behind a store interface in core

Date: 2026-11-26. Status: accepted. Adds to ADR 0005 (mixes read the local `ListenEvent` log) and
ADR 0008 (one IndexedDB database per server and user).

## Context

F47 asks for a local log of every play (device, time, skip) kept on the device and optionally synced
to a server as a playlist-free history. Four features are built against it in parallel: "Because you
listened" (F44), "Rediscover" (F45), daily mixes (F42) and "Year in review" (F48). Jellyfin already
counts plays through play reporting (F26), but it keeps a count and a last-played date per item, not
a history, and it has no idea of a skip.

## Decision

1. **Core owns the log.** `packages/core/src/listening-log.ts` holds the `ListenEvent` schema, the
   `ListeningTracker` that turns playback into events, the `ListeningLogStore` interface, a
   reference `MemoryListeningLogStore`, the query API and the sync interface. It is framework-free
   and exported from `@renaissance/core`.
2. **The Player reports plays, the tracker logs them.** The Player emits a `start` play event when a
   queue entry begins (a restored queue starts on the first real play, as F26 does) and one `end`
   with the reason: `ended`, `next`, `previous`, `jump`, `replaced`, `removed`, `cleared`, `stopped`
   or `error`. Each queued copy carries its source (`album`, `artist`, `playlist`, `radio`,
   `search`, `library`, `favorites`, `home`, `history`, `queue`, `other`). The tracker adds up the
   seconds actually heard from the Player's position (forward steps of five seconds or less while
   playing), so seeks and pauses do not count. Play reporting to Jellyfin is unchanged and separate.
3. **The skip rule.** A play is a skip when the user moved away (next, previous, a jump, a new
   queue, removing the playing entry) after less than 30 seconds, or pressed Next or jumped before
   half the track; for a track under a minute the 30 seconds become half its length. A natural end,
   a cleared queue, a sign-out, a closed tab and a failed stream are never skips. A play is
   completed when it ran to its end or 90 % of it was heard. Plays heard for under a second are not
   logged.
4. **One store per server and user.** Web keeps the log in IndexedDB
   (`renaissance-history-<server>-<user>`, one object store keyed by id with an index on the start
   time), the way the library cache is kept; memory when the browser refuses storage. Mobile will
   implement the same `ListeningLogStore` on SQLite. A play that ends because of a sign-out is
   written to the database of the user who started it. A play cut short by a reload or a closed tab
   is written to localStorage synchronously on `pagehide` and moved into the log on the next start.
5. **The log outlives a sign-out.** Unlike the library cache, which the server can rebuild, the log
   exists nowhere else, so sign-out closes it and leaves it on the device. Another household member
   never sees it (separate database per user). Settings has a switch that stops new plays from being
   kept and a Clear history action with an undo.
6. **Sync is an interface for now.** `ListeningSync.push(events)` resolves with the ids the target
   stored; `syncListening` sends unsynced plays oldest first in batches and marks what was stored.
   The only implementation is `noopListeningSync` until the hub has an endpoint; nothing leaves the
   device.

## Consequences

- F42, F44, F45 and F48 read `ListeningLog` (top tracks, artists and albums in a window, plays per
  track, last played, skip rate, total time heard) and never touch storage.
- The hub endpoint plugs in as one `ListeningSync`; events carry their own id, server, user and
  device, so the target can accept a repeat by id.
- `@renaissance/core` is marked `"sideEffects": false`, so a web chunk that does not use a core
  module does not carry it; the log's code stays out of the shell's first load.
