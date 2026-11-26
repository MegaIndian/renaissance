# ADR 0012: The delta refresh reads from a server-stamped watermark, not a clock

Date: 2026-11-18. Status: accepted. Adds to ADR 0008, which it does not change.

## Context

ADR 0008 pages new items by `DateCreated` "until an item older than the last sync appears" and asks for
user-data changes "since the last sync". Phase 1's first rework took that time from the server's `Date`
header, so the two clocks (server and device) could not disagree. Measured afterwards: Jellyfin sends
`Date` but no `Access-Control-Expose-Headers`, so a page served from any origin other than Jellyfin's
own (the dev server, the Pages demo, an app host) reads `null` and silently fell back to the device's
clock. The documented deployments are all cross-origin, so the server clock never applied in practice.

## Decision

1. The delta keeps no clock at all. The sync records a watermark made of the server's own stamps on
   the items it has seen: the newest `dateAdded` (`DateCreated`) and the newest `lastSaved`
   (`DateLastSaved`, which 10.10.7 leaves out of the item DTO even when asked for; `DateCreated` then
   stands in). The next delta pages `DateCreated` descending down to the `added` mark (strictly older
   stops it; an item stamped exactly at the mark is fetched again rather than skipped) and asks
   `MinDateLastSavedForUser` from the `saved` mark. The watermark only moves forward.
2. `syncedAt` stays, as the device's own clock, and only says "last refreshed" on screen. Nothing
   compares it with a server date.
3. A stored meta without a watermark (written by an older build, or by a server whose items carry no
   stamps) means the next sync is a full one; the reconcile-by-count from ADR 0008 heals anything a
   delta still misses.

## Consequences

- Correctness no longer depends on which origin serves the page or on either clock being right; a
  device set to the wrong year syncs the same (tested with a 2000 and a 2099 clock).
- One full re-sync on the first start after this change, then deltas as before.
- `Library.serverTime()` is gone from the adapter interface; nothing reads response headers.
- Measured on 10.10.7 while doing this: `MinDateLastSavedForUser` filters on the item's own
  `DateLastSaved`, which a favourite or a play does not bump. Those changes reach the cache through the
  200-item `DateLastSaved` page, the socket's `UserDataChanged` refresh and the next full sync; a
  favourite toggled on another device for an item outside that page waits for one of those. ADR 0008's
  "favourite and play-count changes through `MinDateLastSavedForUser`" over-states what the filter does.
