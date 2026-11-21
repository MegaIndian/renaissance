# ADR 0013: User data from other devices arrives through the socket push

Date: 2026-11-20. Status: accepted. Supersedes the last consequence of ADR 0012, which it does not
change; adds to ADR 0008.

## Context

ADR 0012's last consequence says that a favourite or a play made on another device reaches this one
through the 200-item `DateLastSaved` page, the socket's `UserDataChanged` refresh (a delta) or the next
full sync, and that an item outside that page waits for one of those. Measured on 10.10.7 during the
phase 1 reviews, the delta cannot see those changes at all: `MinDateLastSavedForUser` filters on the
item's own `DateLastSaved`, which a favourite or a play does not bump, so a heart given on the TV to a
song deep in a 20,000-track library waited for a full sync. The push itself, though, names the items.

## Decision

1. The server's `UserDataChanged` push is the path for another device's favourites and plays. Its
   `Data.UserDataList` carries `{ItemId, IsFavorite, PlayCount, LastPlayedDate}` per item; the app
   patches those rows in the cache the moment the push arrives, writes them to disk, and fetches by
   id the items the cache does not hold yet (one `/Items?Ids=` request without a type, sorted by the
   `Type` the server returns; songs and albums are kept, anything else a device touched is dropped;
   at most one page of unknown ids per push, the rest reach the cache through the next sync).
2. Each entry of the list is parsed on its own. One entry that misses the shape is dropped; the others
   in the same push still apply.
3. The push still schedules a delta for everything else it may signal (a new item, a renamed playlist).
4. Without the socket (a proxy that drops websockets), user data from other devices waits for the
   200-item `DateLastSaved` page or the next full sync, as ADR 0012 says.

## Consequences

- A heart or a play on any device shows on every other signed-in device within the push's latency,
  for any item in the library, not only the 200 most recently saved.
- A video library shared with the music app costs one request per push that names unknown ids, never
  one per id, and nothing that is not music enters the cache.
- ADR 0012's last consequence is superseded by this one; the rest of ADR 0012 stands.
