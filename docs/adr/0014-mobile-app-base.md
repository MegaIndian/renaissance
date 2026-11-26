# ADR 0014: The mobile app base: what lives in core, and how the phone stores, plays and styles

Date: 2026-11-26. Status: accepted.

## Context

The Expo app gets the phase 1 screens (sign in, home, library, album, artist, favourites,
playlists, now playing, queue). ADR 0001 says each feature is written once and skinned twice, and
ADR 0008 left the phone's token store and library store open ("the real keychain", "a SQLite
implementation ... without touching the sync logic"). The web app's `lib/` held logic that was not
web-specific: the library lifecycle (refresh, pushes, patches, retries), the session state machine,
the sign-in address rules and the persisted queue format.

## Decision

1. **Core takes the platform-neutral halves.** `LibraryController` (open a store per user, sync,
   refresh on pushes, resume and every fifteen minutes, patch at once and replay a patch made during
   a sync, fetch ids a push named), `SessionController` (restore once, sign in, Quick Connect, a 401
   to a token-bearing request expires the session, sign out revokes the token), `address.ts`
   (`serverFromAddress`, https first, `isPlainHttp`, `classifySignInError`) and `saved-queue.ts`
   (song ids plus the queue's bookkeeping). The platform injects the store, the vault, the adapter
   factory and what "resumed" means. The phone runs on them; the web keeps its own `lib/library.ts`,
   `lib/session.ts` and queue persistence for now: moving it onto the controller costs about 190 bytes
   gzipped of a 200 kB shell budget that has 168 bytes left, so that move waits for room in the budget.
2. **The token is in the platform keychain** through expo-secure-store, readable after the first
   unlock and on this device only, validated on the way back in and cleared when unreadable.
3. **The library cache is SQLite** (expo-sqlite), one database per server and user: one table per
   kind, keyed by id, the item as JSON (core validates every record on read), a one-row meta table,
   writes in transactions and in chunks under SQLite's bound-parameter limit. Sign-out deletes the
   database file. When SQLite cannot open, core's `MemoryLibraryStore` holds the library for the run.
4. **Playback is core's `Player` over an RNTP `AudioPort`.** RNTP's own queue holds at most two
   items: the current stream and the preloaded next one, so RNTP buffers the next song and moves
   onto it by itself (as gapless as its player is). That move is reported to core as `ended`, and
   core's `takeOver` adopts the stream already playing; a Next press with the next song buffered
   skips onto it. The universal endpoint is asked only for containers AVPlayer and ExoPlayer play
   (`containers` on the adapter), so Opus, Vorbis and WebM arrive as mp3. Background audio is on
   (`UIBackgroundModes: audio`); remote and lock-screen controls come with their own change.
5. **Styles read `@renaissance/design` tokens through `useTheme`**, as the phase 0 shell did, not
   NativeWind. NativeWind 4 needs Tailwind 3 beside the web's Tailwind 4 in one hoisted workspace and
   NativeWind 5 is a release candidate; the tokens are the same values either way.
6. **Pages pushed over the tabs live in the root stack** and carry the same Ask bar and player
   (`PageShell`). expo-router 58 treats a tab route with `href: null` as guarded and redirects away
   from it, so hidden tab routes cannot hold the album, artist and playlist pages.

7. **Plain http is allowed** (`NSAllowsArbitraryLoads` on iOS, `usesCleartextTraffic` on Android
   through expo-build-properties), because a household Jellyfin is often `http://` on the home
   network or a tailnet and the address is whatever the user types. The sign-in screen says before
   anything is sent that an http address carries the password and token in clear text (ADR 0008's
   rule on the web), and an address without a scheme is tried on https first.

## Consequences

- A fix to sync, session expiry or the queue format is made once, in core, with its Vitest test.
- The phone keeps working offline from SQLite; the token never leaves the keychain.
- The app needs a development build (native modules: RNTP, SQLite, SecureStore); Expo Go cannot run
  it. `npx expo prebuild` and `npx expo run:ios` make one without an Apple Developer membership.
- expo-dev-client is not used: its launcher does not compile with Xcode 27 at SDK 58.
