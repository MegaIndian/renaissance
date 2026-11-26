# Renaissance

**An AI-first, self-hosted music app for Jellyfin libraries.** One box, any words, any language; your own
library, any song fetched. Web app for desktops and browsers, native app for iPhone, iPad and Android, one
shared TypeScript core. GPL-3.0.

> **Status: pre-alpha, phase 1 (core and web).** The web app signs in to a Jellyfin server, caches the
> library locally, searches it instantly, plays gaplessly with a persisted queue, and syncs favourites,
> playlists and play counts with the server. The Ask bar is the search box until the hub arrives in
> phase 2; mobile screens come in phase 3. Features land phase by phase (see the
> [roadmap](docs/ROADMAP.md)).

## The idea

Spotify's strength is a taste graph built from a billion listeners. Ours is that we own the library, can
fetch anything, and have a model that understands plain language and your own history. So Renaissance is
built around one box that takes anything: a song name, a half-remembered lyric, a mood, a chore, a request,
a playlist to build, in English or Gujarati, typed or spoken. The model is the hands behind the box, never a
chat screen: it turns words into intent and acts only through a fixed set of tools on real data (your
library, a music catalogue, the queue, playlists, requests). It cannot name a song the catalogue or your
library did not return. Every action shows what it did and has an undo. Simple commands and exact matches
never touch the model at all. The model runs on a small server-side hub next to your Jellyfin, so keys and
history never leave your house and one hub serves every phone and browser in it.

## Screenshots

Phase 1, signed in to the demo server, simple mode, dark. Every width, language, theme and mode is in
[`docs/screens/phase-1/`](docs/screens/phase-1/) (phase 0's signed-out set is in `phase-0/`); the
rules are in [`packages/design/DESIGN.md`](packages/design/DESIGN.md) and the mockup in
[`docs/design/mockup-2026-11-17.html`](docs/design/mockup-2026-11-17.html).

<p>
  <img src="docs/screens/phase-1/home-phone-en-dark.png" alt="Phone home, English, dark: greeting by name, My songs and Recently played rows, the Ask bar, the player bar and three tabs" width="240" />
  <img src="docs/screens/phase-1/library-songs-desktop-en-dark.png" alt="Desktop library, Songs, English, dark: sidebar with playlists, the Ask bar as the top bar, the song list with hearts and menus, the player bar with transport and scrubber" width="620" />
</p>

## What works today (phase 1, web)

- Sign in by address, user name and password, or with Quick Connect; each person in the house is their
  own Jellyfin user, so favourites, playlists and play counts are their own. The token is encrypted in
  the browser with a key the page cannot export ([ADR 0008](docs/adr/0008-token-vault-and-library-cache.md)).
- The library (artists, album artists, albums, songs, genres, years, playlists) lives in a local
  IndexedDB cache with a delta refresh, so browsing is instant and works offline; 20,000 songs scroll
  through a virtualised list; sort and filter sit in the URL.
- The Ask bar answers from the cache as you type (songs, albums, artists, playlists, recent searches).
  With the hub running, the catalogue follows the library hits: tap a song or album you do not have
  and the hub fetches it, the row going from "on its way" to "Ready" (F61). Asking in plain words
  arrives with the intent engine.
- Gapless playback through two media elements, direct play or Jellyfin transcoding by network class
  and quality setting, a queue that survives reloads (play next, add to end, drag to reorder, clear,
  history), shuffle with an album-aware option, repeat, media keys and lock-screen controls, and play
  reporting so counts and "continue listening" work on every client.
- Simple mode (big type, three rows on Home) is the default; Advanced in Settings adds Search, grid and
  list views, sorting and filters, and playback details. English and Gujarati throughout.

## What you need on the server

| Piece                                                                    | Needed for                                                   | Version            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------ |
| [Jellyfin](https://jellyfin.org) with a Music library                    | everything                                                   | 10.10 or later     |
| Renaissance Hub (this repo, `apps/hub`)                                  | the Ask bar, requests, enrichment, mixes                     | ships with the app |
| [Lidarr](https://lidarr.audio) + [slskd](https://github.com/slskd/slskd) | optional: requesting music you do not have                   | current            |
| An Anthropic API key, set on the hub only                                | optional: the Ask bar's intent engine and library enrichment | n/a                |

Nothing else. No account with us, no telemetry.

## Run it (developers)

```sh
npm i -g pnpm@12           # or, on Node 22 only: corepack enable
pnpm install
pnpm dev                   # web on http://localhost:5173, hub on http://localhost:8787
pnpm --filter mobile start # Expo dev server (needs Xcode or Android Studio, or Expo Go)
```

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. A demo Jellyfin with Creative Commons
music for tests and for contributors without a library: `node docker/demo/start.mjs` (needs Docker;
it completes the Jellyfin wizard, creates the `demo` user and the music library, and prints the
password). The browser suite against it, the unit layers and the bundle budget are described in
[docs/testing.md](docs/testing.md). The hub's routes and curl lines are in
[docs/hub-api.md](docs/hub-api.md); its container image is `apps/hub/Dockerfile`. Screenshots at
phone, tablet and desktop widths are in `docs/screens/`.

## Repository

```
apps/web        React 19, Vite, Tailwind 4, React Router, TanStack Query
apps/mobile     Expo (React Native), expo-router
apps/hub        Node, Fastify: intent engine, catalogue, fetch pipeline, enrichment; holds every key
packages/core   Everything that is not a screen: adapters, models, queue, playback policy, i18n
packages/design Design tokens and DESIGN.md
docs/           ROADMAP.md, hub-api.md, adr/, design/, screens/
docker/demo     Demo Jellyfin with Creative Commons tracks
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Issues labelled `good first issue` are a fine start. Design
rules live in `packages/design/DESIGN.md`; the hub's never-invent rule in `docs/adr/0007-ai-first-ask-bar-and-hub.md`.

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
