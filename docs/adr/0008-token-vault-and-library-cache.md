# ADR 0008: Where the token lives in a browser, and how the library cache stays fresh

Date: 2026-11-18. Status: accepted.

## Context

Phase 1 puts a real Jellyfin session into the web app. Two questions had no obvious answer in a browser:
where to keep the access token (F5 asks for "the platform keychain, never plain files", and a browser has
no keychain), and how to keep a local copy of a 20,000-track library current without re-downloading it
(F14 asks for a delta refresh, and Jellyfin 10.10's `MinDateLastSaved` filter answers 500 on the demo
server).

## Decision

### Token vault (`apps/web/src/lib/vault.ts`)

1. The session (server, user id, user name, token) is encrypted with AES-GCM under a 256-bit key that
   Web Crypto generates as **non-extractable** and that is stored as a `CryptoKey` object in IndexedDB.
   Script on the origin can ask the browser to encrypt and decrypt with the key; it can never read the
   key's bytes. The stored blob is useless anywhere else, and the token is never written in clear text.
2. Web Crypto exists only on secure origins (https or localhost). On a plain http origin the session is
   stored unencrypted in the same database and Settings says so in words (`signIn.tokenPlain`). The
   honest answer, not a silent downgrade.
3. The vault is read once at startup; until then the app is `loading`, not signed out, so a reload
   does not flash the sign-in screen.
4. Signing out clears the vault, tells the server (`POST /Sessions/Logout`), stops the library, clears
   the player and the per-user queries. Nothing of one household member is shown to the next (F86).

What this does not do: protect against script running on the same origin. An XSS on the app could use
the key through the API while the page is open. The defence against that is the usual one (no inline
scripts, dependencies audited in CI, no `dangerouslySetInnerHTML`), not the vault. The mobile app will
use the real keychain and keystore in phase 3.

### Library cache (`packages/core/src/library-cache.ts`, `apps/web/src/lib/library.ts`)

1. One IndexedDB database per server and user (`renaissance-library-<server>-<user>`), four object
   stores (tracks, albums, artists, playlists) keyed by id, and a meta record with the time of the last
   sync. Every record is validated with Zod when read; a bad record is skipped, never fatal.
2. The whole library is held in memory as one snapshot; every list, sort, filter and the instant search
   read the snapshot, so browsing is instant and works offline. Genres, years and album artists are
   derived from the snapshot, no extra calls.
3. First sync: every track, album, artist and playlist in pages of 1,000 with progress shown in words.
4. Delta sync (on start, on every `LibraryChanged` or `UserDataChanged` push over Jellyfin's websocket,
   when the browser comes back online, and every fifteen minutes):
   - new tracks and albums by paging `SortBy=DateCreated` descending until an item older than the last
     sync appears;
   - recently edited items by one page of 200 sorted by `DateLastSaved` descending;
   - favourite and play-count changes through `MinDateLastSavedForUser`, which does work on 10.10;
   - artists and playlists refetched whole (they are small);
   - deletions by comparing the server's total with the cache and, only when they differ, fetching the
     id list (no images, no user data) and dropping what is gone.
     The sync time is written last, so a failure half-way is retried from the previous time.
5. Local actions (a heart, a rename, a created playlist, a finished play) patch the snapshot and the
   database at once and then tell the server; a refused call rolls the patch back and says so in a
   toast.

## Consequences

- The web app has no keychain but the token is never readable from storage, and the user is told
  plainly when the origin cannot offer that.
- A 20,000-track library costs one first sync (about 10 MB with `MediaStreams`, once) and then small
  deltas; the websocket keeps it current while the app is open.
- The same `LibraryStore` interface takes a SQLite implementation on mobile in phase 3 without touching
  the sync logic.
- When Jellyfin fixes `MinDateLastSaved`, the delta can switch to it behind the same interface; the
  adapter notes the server versions it was measured against.
